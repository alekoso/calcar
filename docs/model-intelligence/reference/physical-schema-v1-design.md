# MODEL INTELLIGENCE PHYSICAL SCHEMA v1: DESIGN

Дата: 2026-09-11. Основа: Architecture Specification v1.1 (утверждена, не пересматривается). Целевая СУБД: PostgreSQL 15+ на Supabase. Статус: design для ручного review; SQL, миграции, код и данные не создаются.

Соглашения: имена таблиц и колонок в snake_case, английские; все MI-таблицы в схеме `mi`, VM-интерфейсные таблицы в `mi_vm` (чтобы не смешивать с существующими `public.*`); ключи сущностей-subjects это bigint из реестра; прочие PK bigint identity (компактнее uuid для join-тяжёлых таблиц); `created_at timestamptz default now()` везде, не повторяется в описаниях; RLS включён без политик (доступ только service_role), как в `supabase-knowledge.sql`.

---

# A. MVA tables: CREATE NOW

| Таблица | Зачем сейчас | Что потеряем, если отложить |
|---|---|---|
| `mi.knowledge_subject` | единый FK-якорь и носитель `knowledge_rev` | целостность ссылок и точечная инвалидация |
| `mi.brand`, `mi.model_line` | навигация и редкие brand-level claims | subject brand для политик BMW |
| `mi.generation`, `mi.vehicle_version`, `mi.version_market_year` | ядро идентичности и composition | ничего не соберётся |
| `mi.component_family`, `mi.component_variant`, `mi.component_alias`, `mi.component_relation`, `mi.version_fitment` | 35..45% знаний живут на variant; алиасы N63R/TU2/O2 | переносы между ревизиями |
| `mi.equipment_item`, `mi.equipment_visual_hint`, `mi.package_content`, `mi.equipment_availability` | опции, пакеты, конфигурации подвески, правила Vision | PDCC/пневмо/DHP как предикаты |
| `mi.entitlement` | Tesla права | зарядка/автопилот как «опция» |
| `mi.component_state_type` | ремонт/замена/ретрофит как знание | Tesla пак/LDU, гильзовка |
| `mi.issue`, `mi.maintenance_item`, `mi.fluid_spec`, `mi.check_item`, `mi.check_covers` | контейнеры знаний и чек-листа | четыре слоя обслуживания, MUST-логика |
| `mi.claim`, `mi.claim_applicability`, `mi.claim_link`, `mi.claim_support` | атомы, предикаты, связи | всё |
| `mi.source`, `mi.evidence` | provenance | gates |
| `mi.recurrence_summary` (derived) | классы anecdote/repeated/strong без prevalence | ранжирование owner-знания |
| `mi.knowledge_snapshot`, `mi.publish_batch` | audit и воспроизведение | старые отчёты нельзя воспроизвести |
| `mi.subject_closure` (derived, per VMY) | детерминированный отбор кандидатов и propagation | hot path через рекурсивные запросы |
| `mi.pack_fragment`, `mi.fragment_dependency`, `mi.knowledge_pack` | hot path и кэш | SLO |
| `mi.candidate_claim`, `mi.candidate_evidence` | staging: research не пишет в published | прямая запись LLM в canonical |
| `mi_vm.resolved_identity`, `mi_vm.resolved_identity_dimension` | интерфейс VM→MI, factory/current, статусы | applicability без идентичности |
| `mi_vm.component_state_instance`, `mi_vm.entitlement_state` | экземпляры состояний и прав по VIN | Tesla-кейсы |
| `mi.decision_reason` (интерфейс) | reason codes verification gap | требование §18 |

# B. DEFER (FUTURE)

| Таблица/механизм | Почему отложить | Какое требование заставит добавить |
|---|---|---|
| `coverage` | считается запросом по published-claims для 50 версий за миллисекунды; таблица нужна при тысячах версий | появление user-facing «CalCar знает эту версию хорошо» или research-приоритизации по тысячам VMY |
| `research_task` | оркестрация вручную-ассистируемая; staging достаточно | автоматический ingestion |
| `claim_conflict` | в v1 конфликт выражается парой claims с `contested=true` и `claim_link(role=contradicts)`; отдельная таблица с resolution нужна при потоке конфликтов | > 1 конфликта в день на ревью |
| `claim_embedding` (pgvector) | dedup детерминированный по `dedup_key`; Chat-ранжирование по полнотекстовому индексу | семантический dedup при массовом ingestion; Chat по свободным вопросам вне пакета |
| render cache (`report_render`) | рендер это функция пакета; кэшируется на уровне отчёта (`reports`) как сейчас | многоязычный рендер одного пакета много раз |
| refresh scheduler / `refresh_queue` | очередь формируется запросом по `refresh_class` и датам | сотни версий с volatile-знанием |
| `claim_translation` | canonical EN; перевод на рендере | UA/RU рендер при масштабе |
| `vmy_knowledge_rev` агрегат | dependency-проверка по массиву id укладывается в SLO (по бенчмарку) | dependency_set > ~500 subjects |
| прямое хранение prevalence | v1: prevalence = unknown без знаменателя | VM-агрегаты с покрытием |

---

# C, D, E. Физические таблицы, ограничения, индексы

Формат: назначение; колонки (тип, ограничения); PK/FK/UNIQUE/CHECK; индексы; ожидаемый объём после 50 версий / после масштабирования (тысячи версий, сотни тысяч claims).

## C.1. Реестр subjects

### `mi.knowledge_subject`
- Назначение: единый идентификатор всего, о чём есть знание; носитель `knowledge_rev`.
- Колонки: `id bigint PK identity`; `kind mi.subject_kind NOT NULL` (enum: brand, model_line, generation, vehicle_version, version_market_year, component_family, component_variant, equipment_item, entitlement, component_state_type, issue, maintenance_item, check_item); `knowledge_rev bigint NOT NULL DEFAULT 1`; `label text NOT NULL` (денормализованное имя для логов/пакета); `updated_at timestamptz`.
- UNIQUE `(id, kind)` (нужен для составных FK из таблиц сущностей).
- Индексы: PK; `(kind)`; PK покрывает проверку rev.
- Объём: 50 версий: ~5,000 (variants ~600, equipment ~1,500, issues ~600, check ~800, maintenance ~400, state types ~150, прочее); scale: ~200,000.

**FK-стратегия.** Каждая таблица-сущность имеет `subject_id bigint PK` и константную колонку `kind` (generated always as const) с составным FK `(subject_id, kind) REFERENCES mi.knowledge_subject(id, kind) ON DELETE RESTRICT`. Так строка сущности не может существовать без реестра и не может ссылаться на реестр другого kind. Создание: единая функция `mi.new_subject(kind, label)` возвращает id; приложение создаёт subject, затем сущность (одна транзакция). Все «о чём» ссылки (claim.subject_id, applicability.ref_subject_id, check.target, issue.about) это простой FK на `knowledge_subject(id)`; проверка kind там, где нужна, делается CHECK через `mi.subject_kind_of(id)` только при записи (immutable-функция не требуется; допустим триггер-валидатор на INSERT/UPDATE этих колонок).

Hot path и реестр: overlay и фрагменты работают с уже разрешёнными subject id; реестр читается в runtime ровно в одном месте: проверка валидности фрагмента (index-only по PK на массив id). Ни одного join с реестром для имён в runtime: `label` денормализован в payload фрагмента. Это зафиксировано в разделе J.

## C.2. Иерархия автомобиля

### `mi.brand`
- `subject_id bigint PK`, `kind` const 'brand', `name text NOT NULL UNIQUE`, `country text`.
- Объём: десятки.

### `mi.model_line`
- `subject_id PK`, `brand_id bigint NOT NULL FK mi.brand`, `name text NOT NULL`, UNIQUE `(brand_id, name)`.
- Объём: сотни.

### `mi.generation`
- Назначение: платформа/поколение и фаза.
- Колонки: `subject_id PK`; `model_line_id FK NOT NULL`; `platform_code text NOT NULL` (G30, MS_GEN1, 958); `phase text` (pre_lci / lci; pre_facelift / facelift; 958_1 / 958_2; NULL для родителя); `phase_of_id bigint FK mi.generation NULL`; `prod_from date`, `prod_to date`; `powertrain_types mi.powertrain[] NOT NULL` (enum: ice, bev, phev, hev); `default_system_profile text NOT NULL` (ключ профиля: ice_default, bev_default).
- UNIQUE `(model_line_id, platform_code, coalesce(phase,''))`; CHECK `phase_of_id IS NULL OR phase IS NOT NULL`.
- Индексы: `(model_line_id)`, `(phase_of_id)`.
- Объём: ~120 / ~5,000.

### `mi.vehicle_version`
- `subject_id PK`; `generation_id FK NOT NULL`; `version_code text NOT NULL` (M550i_xDrive, P85D, GTS); `name_en text NOT NULL`; `powertrain mi.powertrain NOT NULL`; `system_profile_override text NULL`.
- UNIQUE `(generation_id, version_code)`.
- Объём: ~150 / ~10,000.

### `mi.version_market_year` (VMY)
- Назначение: тонкий слой рынок × год с окном производства.
- `subject_id PK`; `version_id FK NOT NULL`; `market mi.market NOT NULL` (enum: US, CA, EU, UK, JP, CN, RU, UA, OTHER); `model_year smallint NOT NULL CHECK (model_year BETWEEN 1990 AND 2100)`; `prod_from date`, `prod_to date`; `base_price numeric(12,2)`, `currency char(3)`; `meta jsonb` (только не критичное: EPA-цифры, ссылки на прайс-лист).
- UNIQUE `(version_id, market, model_year)`; CHECK `prod_from <= prod_to`.
- Индексы: `(version_id)`, `(market, model_year)`.
- Объём: ~400 (50 версий × ~3 MY × 1..3 рынка) / ~60,000.

Не хранится: большой JSON модели. Composition только через fitment/availability.

## C.3. Компоненты

### `mi.component_family`
- `subject_id PK`; `brand_id FK NULL` (ZF/Aisin без бренда авто); `family_key text NOT NULL UNIQUE` (N63, M48, ZF_8HP, TESLA_PACK_18650_GEN1, TESLA_LDU, TESLA_MCU, PDCC, PASM); `kind mi.component_kind NOT NULL` (enum: engine, transmission, transfer_case, differential, battery_pack, drive_unit, infotainment, adas_hw, charger, modem, suspension_system, brake_system, body_module, hvac, electrical, other); `architecture_en text`; `attributes jsonb` (структурные family-атрибуты по словарю: `cylinder_bore_technology`, `cell_chemistry`, `cooling_layout`).
- Объём: ~80 / ~3,000.

### `mi.component_variant`
- Назначение: конкретный вариант и ревизия (ревизия = variant с `revision_of_id`).
- `subject_id PK`; `family_id FK NOT NULL`; `variant_code text NOT NULL` (N63B44O2, N63B44T3, M48.02, 8HP75, TR-80SD, ATC13-1, PACK_85_GEN1_REV_D, LDU_PRE_U, LDU_U, MCU1, MCU2, AP1, MODEM_3G, HANDLE_GEN2, PTC_GEN1, PDCC_958, PCCB_958_1); `name_en text NOT NULL`; `revision_of_id FK mi.component_variant NULL`; `supersedes_id FK mi.component_variant NULL`; `prod_from date`, `prod_to date`; `attributes jsonb` (variant-атрибуты: `cylinder_bore_technology`, `injection_bar`, `capacity_kwh`; значения, по которым нужны предикаты, дублируются в `mi.variant_attribute`).
- UNIQUE `(family_id, variant_code)`; CHECK `revision_of_id <> subject_id`.
- Индексы: `(family_id)`, `(revision_of_id)`.
- Объём: ~600 / ~50,000.

### `mi.variant_attribute`
- Назначение: queryable структурные атрибуты для предикатов (`variant_attribute` dimension), без EAV-разрастания: только словарные ключи.
- `variant_id FK NOT NULL`; `attr_key text NOT NULL` (словарь `mi.attribute_key`: cylinder_bore_technology, cell_chemistry, has_rotor_coolant_seal, performance_division); `attr_value text NOT NULL`.
- PK `(variant_id, attr_key)`; индекс `(attr_key, attr_value)`.
- Объём: ~1,500 / ~150,000.

### `mi.component_alias`
- `id PK`; `target_subject_id FK knowledge_subject NOT NULL` (family или variant или equipment); `alias text NOT NULL`; `alias_norm text NOT NULL` (lower, без пробелов/дефисов/точек); `lang char(2)`; `alias_kind mi.alias_kind NOT NULL` (official, catalog, community, legal); `brand_scope bigint FK mi.brand NULL`; `source_id FK mi.source NULL`.
- UNIQUE `(coalesce(brand_scope,0), alias_norm)`: один alias в бренде указывает ровно на один subject; конфликт блокирует запись.
- Индекс: `(alias_norm)`; `(target_subject_id)`.
- Объём: ~3,000 / ~300,000.

### `mi.component_relation`
- `id PK`; `from_variant_id FK NOT NULL`; `to_variant_id FK NOT NULL`; `relation_kind mi.relation_kind NOT NULL` (compatible_replacement, retrofit_from, requires, shares_component_with); `note_en text`; `source_id FK NULL`.
- UNIQUE `(from_variant_id, to_variant_id, relation_kind)`; CHECK `from <> to`.
- Индексы: `(from_variant_id)`, `(to_variant_id)`.
- Объём: ~300 / ~30,000.

### `mi.version_fitment`
- Назначение: какой variant стоит в VMY в какой роли и в каком окне.
- `id PK`; `vmy_id FK NOT NULL`; `role mi.component_role NOT NULL` (enum: engine, transmission, transfer_case, rear_diff, battery_pack, drive_unit_front, drive_unit_rear, mcu, instrument_cluster, adas_hw, charger, modem, suspension_system, brake_system, door_handle, cabin_heater, other); `variant_id FK NOT NULL`; `fitment mi.fitment_kind NOT NULL` (standard, optional, in_package); `prod_from date`, `prod_to date`; `package_item_id FK mi.equipment_item NULL`; `source_id FK NULL`.
- UNIQUE `(vmy_id, role, variant_id, coalesce(prod_from,'0001-01-01'))`; CHECK окна.
- Индексы: `(vmy_id, role)`, `(variant_id)`.
- Объём: ~6,000 / ~900,000.

## C.4. Оборудование и права

### `mi.equipment_item`
- `subject_id PK`; `brand_id FK NOT NULL`; `code text` (ZDH, 2VW, 6F1, PDCC, SC01_HW); `kind mi.equipment_kind NOT NULL` (option, package, system_config, wheel_tire_setup); `name_en text NOT NULL`; `implements_variant_id FK mi.component_variant NULL`; `legacy_option_id uuid NULL` (ссылка на `public.option_dict.option_id` для миграции).
- UNIQUE `(brand_id, coalesce(code, name_en))`.
- Объём: ~1,500 / ~100,000.

### `mi.equipment_visual_hint`
- Назначение: правила, имеет ли Vision право подтвердить наличие.
- `id PK`; `equipment_id FK NOT NULL`; `cue_key text NOT NULL` (bw_grille_logo, seat_ventilation_button, hud_projector, blue_calipers); `specificity mi.visual_specificity NOT NULL` (definitive, strong, ambiguous, not_visually_resolvable); `combination_group smallint NULL` (для STRONG: набор cue, который вместе достаточен); `required_in_group smallint NULL`; `description_en text`; `negative_note_en text` (почему не подтверждает: «синие суппорты у 540i M Sport»).
- UNIQUE `(equipment_id, cue_key)`; CHECK `(specificity='strong') = (combination_group IS NOT NULL)`.
- Индекс `(cue_key)` (Identity Resolver ищет по cue из Vision).
- Объём: ~2,000 / ~150,000.

### `mi.package_content`
- `package_id FK equipment_item`, `item_id FK equipment_item`; PK `(package_id, item_id)`; CHECK package.kind='package' (валидация триггером).

### `mi.equipment_availability`
- `id PK`; `vmy_id FK NOT NULL`; `item_id FK NOT NULL`; `availability mi.availability NOT NULL` (standard, optional, in_package, not_available); `price numeric(12,2)`, `currency char(3)`; `sop_from date`, `sop_to date`; `requires_item_id FK NULL`; `source_id FK NULL`.
- UNIQUE `(vmy_id, item_id, coalesce(sop_from,'0001-01-01'))`.
- Индексы: `(vmy_id)`, `(item_id)`.
- Объём: ~15,000 / ~2,000,000.

### `mi.entitlement`
- `subject_id PK`; `brand_id FK NOT NULL`; `key text NOT NULL` (fusc_sc01, autopilot_ap1_option, premium_connectivity, ludicrous); `name_en`; `binding mi.binding NOT NULL` (vin, account, owner); `transferable_private bool`, `transferable_dealer bool`, `revocable bool`, `revoke_reasons text[]`, `network_dependency bool`; `requires_variant_id FK NULL`; `requires_item_id FK NULL`.
- UNIQUE `(brand_id, key)`.
- Объём: ~20 / ~500.

## C.5. Состояния компонентов

### `mi.component_state_type`
- `subject_id PK`; `key text NOT NULL UNIQUE` (n63_sleeved_rebuild, pack_reman_85, pack_new_90_locked, ldu_rev_u_replacement, coolant_delete, mcu2_retrofit, lte_upgrade, ccs_retrofit, pdcc_delete, air_to_coil_conversion, stage1, thermostat_corrector); `kind mi.state_kind NOT NULL` (repair, rebuild, replacement_new, replacement_reman, replacement_used, retrofit, modification_unsanctioned, service_beyond_schedule); `applies_to_subject_id FK knowledge_subject NOT NULL` (family или variant или equipment); `resulting_variant_id FK component_variant NULL`; `resulting_equipment_change mi.equipment_change NULL` (adds, removes); `resulting_item_id FK NULL`; `sanctioned_by_oem bool NOT NULL`.
- Индексы: `(applies_to_subject_id)`.
- Объём: ~150 / ~10,000.

## C.6. Issue, maintenance, check

### `mi.issue`
- `subject_id PK`; `issue_key text NOT NULL UNIQUE` (совместим с `public.issue_observation.issue_key`); `about_subject_id FK knowledge_subject NOT NULL` (variant/family/generation/equipment/entitlement); `name_en`; `mechanism_en text`; `severity mi.severity NOT NULL` (catastrophic, major, moderate, minor); `sensitivity mi.sensitivity NOT NULL` (calendar, mileage, cycles, usage, mixed); `status mi.entity_status NOT NULL` (active, retired).
- Нет `frequency_class`, нет prevalence.
- Индекс `(about_subject_id)`.
- Объём: ~600 / ~50,000.

### `mi.fluid_spec`
- `id PK`; `brand_scope FK NULL`; `key text UNIQUE` (BMW_LL01_FE_0W30, ZF_LIFEGUARD_8, DTF_1, SHELL_TF_0870, PORSCHE_A40_0W40); `name`; `notes_en`.

### `mi.maintenance_item`
- `subject_id PK`; `about_subject_id FK NOT NULL`; `service_kind mi.service_kind NOT NULL` (engine_oil, spark_plugs, ignition_coils, coolant, atf, transfer_case_fluid, differential_fluid, brake_fluid, battery_coolant, ac_desiccant, radiator_cleaning, charging_habit, tire_rotation, other); `fluid_spec_id FK NULL`; `capacity_note_en`.
- UNIQUE `(about_subject_id, service_kind)`.
- Слои интервалов это claims с `subject_id = maintenance_item.subject_id` и `layer`.
- Объём: ~400 / ~40,000.

### `mi.check_item`
- `subject_id PK`; `test_method mi.test_method NOT NULL` (visual, diagnostic_scan, borescope, compression, leak_down, battery_diagnostics, road_test, cold_start, fluid_analysis, documentation, vin_build_sheet, hardware_identification, software_verification, overnight_test, entitlement_verification, dc_charge_session); `scope_subject_id FK NOT NULL` (где применим: generation/version/family/variant); `why_en`, `proves_en`, `cannot_prove_en text NOT NULL`; `conditions text[]`; `default_priority mi.priority NOT NULL` (must, good); `materially_resolves bool NOT NULL DEFAULT false`; `resolves_dimension mi.identity_dimension NULL` (если проверка разрешает измерение идентичности: table pack label -> battery_pack current).
- Приоритет по applicability: строки `claim_applicability` с `owner_subject_id = check_item.subject_id` (тот же механизм, что у claims), например предикат `variant_attribute cylinder_bore_technology = Alusil`.
- Индекс `(scope_subject_id)`.
- Объём: ~800 / ~60,000.

### `mi.check_covers`
- `check_id FK`, `target_subject_id FK` (issue/variant/state_type/equipment), `role mi.cover_role` (detects, verifies_state, resolves_identity); PK `(check_id, target_subject_id)`.

## C.7. Claim и связи

### `mi.claim`
- Назначение: атом знания.
- Колонки: `id bigint PK identity`; `subject_id FK knowledge_subject NOT NULL`; `knowledge_type mi.knowledge_type NOT NULL` (official_fact, known_issue, specialist_practice, owner_practice, owner_pattern, calcar_synthesis); `text_en text NOT NULL`; `normalized_assertion text NOT NULL`; `value_kind mi.value_kind NULL` (quantity, range, interval, date_window, part_number, option_code, cost, document_ref, enum); `structured_value jsonb NULL`; `confidence mi.confidence NOT NULL` (high, medium, low); `buyer_implication_en text`; `buyer_importance smallint NOT NULL CHECK 1..5`; `layer mi.practice_layer NULL` (official, specialist, owner, calcar); `causal_status mi.causal_status NULL` (observed_association, plausible_mechanism, supported_cause, unknown); `contested bool NOT NULL DEFAULT false`; `contested_note_en text`; `policy_status mi.policy_status NULL` (stable, mutable_policy); `propagation mi.propagation NOT NULL DEFAULT 'exact'` (exact, descendants, family_context); `propagation_note text`; `refresh_class mi.refresh_class NOT NULL` (immutable, slow, aging, volatile); `status mi.claim_status NOT NULL` (draft, review, published, superseded, retired); `effective_from date`, `effective_to date`; `supersedes_id FK mi.claim NULL`; `superseded_by_id FK mi.claim NULL`; `review_note text`; `applicability_signature text NOT NULL DEFAULT ''` (canonical serialization предикатов, обновляется триггером); `dedup_key text NOT NULL`; `evidence_summary jsonb` (derived); `published_snapshot_id FK knowledge_snapshot NULL`; `reviewed_at timestamptz`; `reviewed_by text`.
- CHECK: `(layer IS NOT NULL) = (subject kind = maintenance_item)` (валидация триггером по kind); `causal_status IS NOT NULL` для owner_practice/specialist_practice; `policy_status IS NULL OR knowledge_type = 'official_fact'`; `propagation <> 'exact' -> propagation_note IS NOT NULL`; `structured_value IS NULL OR value_kind IS NOT NULL`; `status='published' -> published_snapshot_id IS NOT NULL`; `contested -> contested_note_en IS NOT NULL`.
- UNIQUE partial: `(dedup_key) WHERE status = 'published'`.
- Индексы: `(subject_id, status)`; `(status, knowledge_type)`; `(supersedes_id)`; GIN `to_tsvector('english', text_en)` для Chat/поиска; `(refresh_class, reviewed_at)` для refresh-очереди.
- JSONB оправдан только для `structured_value` (типизирован `value_kind`, схема на приложение: `{value, unit}`, `{from, to, unit}`, `{km, months}`, `{from, to}`, `{pn, oem}`, `{code}`, `{from, to, currency, market, as_of, performer}`, `{doc_id, authority}`) и `evidence_summary`. Запросы по числам структурных значений: через выражения `(structured_value->>'value')::numeric` с частичными индексами только там, где появится реальная потребность (в v1 не создаются).
- Объём: ~12,000 (50 версий × ~250) / ~500,000.

### `mi.claim_applicability`
- См. раздел G.

### `mi.claim_link`
- `id PK`; `claim_id FK NOT NULL`; `target_subject_id FK NOT NULL` (issue/maintenance_item/check_item/state_type/version для comparison); `role mi.link_role NOT NULL` (symptom, code, mechanism_detail, repair_option, prevention, cost, official_action, prerequisite, interval, related, contradicts, comparison_with).
- UNIQUE `(claim_id, target_subject_id, role)`; индексы `(target_subject_id, role)`.
- Объём: ~15,000 / ~700,000.

### `mi.claim_support`
- `synthesis_claim_id FK`, `supporting_claim_id FK`; PK пары; CHECK через триггер: synthesis.knowledge_type = calcar_synthesis; UNIQUE-гарантия «≥ 2 support» проверяется gate при публикации, не constraint.
- Объём: ~2,000 / ~100,000.

## C.8. Источники и evidence

### `mi.source`
- `id PK`; `source_type mi.source_type NOT NULL` (official, legal, specialist, owner, review, market, vendor, aggregator); `quality mi.source_quality NOT NULL` (primary, secondary, low); `url text`; `reference text` (номер бюллетеня, ISBN, thread id); `title text`; `lang char(2)`; `published_at date`, `updated_at_src date`, `retrieved_at timestamptz NOT NULL`; `access_status mi.access_status NOT NULL` (ok, proxy, blocked, captcha, offline_copy, search_summary); `market mi.market NULL`; `platform text` (bimmerpost, tmc, rennlist, drive2, nhtsa); `notes text`.
- UNIQUE `(coalesce(url,''), coalesce(reference,''))` partial при непустом url.
- Индексы: `(source_type, quality)`, `(platform)`.
- Объём: ~4,000 / ~300,000.

### `mi.evidence`
- `id PK`; `claim_id FK NOT NULL`; `source_id FK NOT NULL`; `stance mi.stance NOT NULL` (supports, contradicts, context); `excerpt text` (ограничение длины на приложении ~2,000 символов; полные копии не хранятся); `excerpt_lang char(2)`; `independence_group text NOT NULL` (thread id / author hash / document id); `context jsonb` (пробег, год, рынок из сообщения: маленький словарь, не критичный для retrieval); `retrieved_at`.
- UNIQUE `(claim_id, source_id, coalesce(independence_group,''))`.
- Индексы: `(claim_id)`, `(source_id)`, `(independence_group)`.
- Объём: ~30,000 / ~2,000,000.

### `mi.recurrence_summary` (derived)
- `claim_id FK PK`; `independent_groups int`; `contradicting_groups int`; `markets text[]`; `mileage_km int[]`; `age_years smallint[]`; `specialist_support bool`; `recurrence_class mi.recurrence` (anecdote, repeated_pattern, strong_consensus); `computed_at`.
- Пересчёт триггером/функцией при изменении evidence claim. Prevalence отсутствует по конструкции.

## C.9. Audit и публикация

### `mi.knowledge_snapshot`
- `id bigint PK identity`; `published_at timestamptz NOT NULL`; `note text`; `compiler_min_version text`.

### `mi.publish_batch`
- Назначение: единая транзакционная точка публикации и источник bump.
- `id PK`; `snapshot_id FK NOT NULL`; `actor text`; `touched_subject_ids bigint[] NOT NULL`; `created_at`.

## C.10. Derived для отбора и hot path

### `mi.subject_closure` (derived, per VMY)
- Назначение: детерминированный список subjects, чьи claims могут быть кандидатами для VMY, с типом связи для propagation.
- `vmy_id FK NOT NULL`; `subject_id FK NOT NULL`; `via mi.closure_via NOT NULL` (self_vmy, version, generation, generation_parent, model_line, brand, fitted_variant, revision_ancestor, family_of_fitted, equipment_available, entitlement_of_brand, state_type_of, issue_of, maintenance_of, check_of, comparison_peer); `role mi.component_role NULL`; `variant_id FK NULL` (для fitted и их потомков); `built_at`.
- PK `(vmy_id, subject_id, via)`; индекс `(subject_id)` (для инвалидации: найти VMY, зависящие от subject).
- Пересборка при изменении fitment/availability/иерархии/relations для конкретного VMY (триггер ставит `closure_dirty`).
- Объём: ~50 × ~250 = ~12,500 / ~15,000,000 (при тысячах VMY: партиционирование не требуется, таблица узкая).

### `mi.pack_fragment`
- `id PK`; `vmy_id FK NOT NULL`; `purpose mi.pack_purpose NOT NULL` (decision, report, component, chat); `locale char(2) NOT NULL`; `budget_profile text NOT NULL`; `compiler_version text NOT NULL`; `fingerprint text NOT NULL`; `payload jsonb NOT NULL` (см. I); `payload_bytes int`; `built_at`; `snapshot_id FK`; `valid bool NOT NULL DEFAULT true`.
- UNIQUE `(vmy_id, purpose, locale, budget_profile, compiler_version)`.
- Объём: ~600 / ~50,000 (только prebuilt VMY).

### `mi.fragment_dependency`
- `fragment_id FK`; `subject_id FK`; `knowledge_rev bigint NOT NULL`; PK `(fragment_id, subject_id)`; индекс `(subject_id)` для точечной инвалидации.
- Объём: ~600 × ~250 = ~150,000 / ~12,000,000.

### `mi.knowledge_pack`
- `id PK`; `identity_id FK mi_vm.resolved_identity NOT NULL`; `identity_version text NOT NULL`; `fragment_id FK NULL`; `purpose`, `locale`, `budget_profile`, `compiler_version`; `fingerprint text NOT NULL`; `payload jsonb NOT NULL`; `applicability_log jsonb NOT NULL`; `snapshot_id FK NOT NULL`; `created_at`; `stale bool DEFAULT false`.
- UNIQUE `(identity_version, fingerprint)`; индекс `(identity_id, purpose, created_at desc)`.
- Объём: растёт с числом Check; retention как у `reports`.

## C.11. Staging (MVA)

### `mi.candidate_claim`
- `id PK`; `task_ref text` (свободная ссылка на research-задачу; таблицы research_task нет); `proposed_subject_text text NOT NULL` (как в источнике: «N63TU2», «85 pack rev D»); `resolved_subject_id FK knowledge_subject NULL`; `proposed_knowledge_type mi.knowledge_type`; `text_en text NOT NULL`; `value_kind`, `structured_value jsonb`; `proposed_confidence`; `proposed_layer`; `proposed_causal_status`; `proposed_propagation mi.propagation DEFAULT 'exact'`; `proposed_applicability jsonb` (предложение предикатов в том же формате, что строки applicability; единственное место, где applicability временно JSONB, потому что ещё не canonical); `proposed_links jsonb` (issue_key, service_kind, check method); `extractor text` (llm model/version или human); `review_status mi.review_status NOT NULL` (new, normalized, evidence_linked, gate_pending, approved, rejected, merged); `rejection_reason mi.rejection_reason NULL` (no_source, vendor_only, insufficient_recurrence, revision_transfer, duplicate, contradiction_open, missing_unit, out_of_scope, other); `merge_into_claim_id FK mi.claim NULL`; `published_claim_id FK mi.claim NULL`; `reviewer text`; `review_note text`; `created_at`, `reviewed_at`.
- CHECK: `review_status='published'`-эквивалент это `published_claim_id IS NOT NULL AND review_status='approved'`; `review_status='rejected' -> rejection_reason IS NOT NULL`; `review_status='merged' -> merge_into_claim_id IS NOT NULL`.
- Индексы: `(review_status)`, `(resolved_subject_id)`, `(published_claim_id)`.
- Объём: ~3× claims в первый год.

### `mi.candidate_evidence`
- `id PK`; `candidate_id FK NOT NULL`; `source_id FK NOT NULL` (источник создаётся сразу в canonical `mi.source`: источники не «кандидаты»); `stance`; `excerpt`; `independence_group`; при публикации копируется в `mi.evidence`.

Поток: candidate(new) → normalize (alias → resolved_subject_id) → evidence_linked → gate_pending (функция gate проверяет правила Appendix G v1.1 по типу) → approved → publish (создаёт `mi.claim`, `mi.claim_applicability`, `mi.evidence`, `claim_link`, обновляет `published_claim_id`) | rejected | merged (evidence переносится в существующий claim).

## C.12. VM-интерфейс

### `mi_vm.resolved_identity`
- `id PK`; `vin text NOT NULL` (FK `public.vehicles.vin`); `identity_version text NOT NULL` (hash отсортированных измерений: dimension, role, slot, value, status); `resolver_version text NOT NULL`; `inputs jsonb` (какие источники участвовали: decoder_version, snapshot_id, vision run id); `resolved_at`.
- UNIQUE `(vin, identity_version)`; индекс `(vin, resolved_at desc)`.

### `mi_vm.resolved_identity_dimension`
- `identity_id FK NOT NULL`; `dimension mi.identity_dimension NOT NULL` (brand, model_line, generation, version, vmy, market_sold, market_operated, production_date, first_sale_date, model_year, component_variant, equipment_present, entitlement_state, component_state_present, mileage_km, age_years, condition_tag, salvage_status); `role mi.component_role NULL` (для component_variant); `slot mi.config_slot NOT NULL` (factory, current, na); `value_subject_id FK knowledge_subject NULL`; `value_text text`; `value_num numeric`; `value_date date`; `value_bool bool`; `confidence mi.confidence NOT NULL`; `resolution_status mi.resolution_status NOT NULL` (confirmed, assumed_factory, conflicted, unresolved); `provenance jsonb NOT NULL` (список {source_kind: vin_decoder|build_sheet|vehicle_memory|diagnostic|vision|document|seller|user, ref, specificity?, confidence}); `conflict_note text`.
- PK `(identity_id, dimension, coalesce(role,'other'), slot, coalesce(value_subject_id,0), coalesce(value_text,''))` (позволяет несколько equipment_present строк и несколько condition_tag).
- Индекс `(identity_id, dimension)`.

### `mi_vm.component_state_instance`
- `id PK`; `vin FK`; `state_type_id FK mi.component_state_type NOT NULL`; `role mi.component_role NULL`; `occurred_on date`; `mileage_km int`; `performer_kind mi.performer` (oem, independent, unknown); `documents jsonb` (ссылки на snapshot/photo assets в VM); `measurements jsonb`; `confidence`; `source_kind`; `snapshot_id uuid FK public.vehicle_snapshots NULL`.
- Индекс `(vin)`.

### `mi_vm.entitlement_state`
- `vin FK`; `entitlement_id FK`; `state mi.entitlement_status` (present, absent, revoked, unknown); `checked_at`; `source_kind`; PK `(vin, entitlement_id, checked_at)`.

### `mi_vm.measurement`
- `id PK`; `vin`; `kind mi.measurement_kind` (borescope, battery_snapshot, compression, leak_down, fluid_analysis, dc_session, scan); `value jsonb`; `measured_at`; `expires_at`; `source_kind`; `check_item_id FK mi.check_item NULL`.

### `mi.decision_reason` (интерфейс к отчёту)
- `id PK`; `report_id uuid FK public.reports`; `code text NOT NULL` (VERIFIED_CLEAN_<check>, OBSERVED_<issue_key>, VG_<issue_key>_<method>, IDENTITY_CONFLICT_<dimension>, ASSUMED_FACTORY_<role>); `kind mi.reason_kind` (positive, observed_risk, verification_gap, identity_conflict, assumption); `issue_id FK NULL`; `check_item_id FK NULL`; `affects mi.reason_affects[]` (score, decision_confidence, checklist, context); `explanation_en text`.
- CHECK: `kind='verification_gap' -> 'score' <> ALL(affects)`; `kind='assumption' -> affects = {context, checklist}`.
- Второго пользовательского confidence score нет: только код и объяснение.

---

# F. Knowledge revision и инвалидация

**Инвариант:** `knowledge_subject.knowledge_rev` изменяется при любом изменении знания, способном изменить фрагмент любого VMY, в чей closure входит subject.

**Один механизм:** триггеры AFTER INSERT/UPDATE/DELETE на ограниченном списке таблиц вызывают одну функцию `mi.touch_subjects(bigint[])`, а список затронутых subjects для строки вычисляет одна функция `mi.affected_subjects(table_name, old_row, new_row)`. Таблица соответствий живёт в этой функции и в документации, а не в каждом write-path:

| Таблица | Затронутые subjects |
|---|---|
| `claim` (только переходы, где старый или новый status = published, либо изменение полей published-claim) | `subject_id`; для `propagation <> exact` дополнительно: все variants семейства (family) или потомки по `revision_of` (descendants): вычисляются запросом по `component_variant`; supersedes: subject старого claim |
| `claim_applicability` (для published claim) | `claim.subject_id`; `ref_subject_id` не трогается (зависимость идёт через subject claim) |
| `claim_link`, `claim_support` | `claim.subject_id` и `target_subject_id` |
| `issue`, `maintenance_item`, `check_item`, `check_covers` | сам subject и `about/scope/target_subject_id` |
| `component_relation` | оба variants |
| `component_variant` (revision_of/supersedes/окна), `variant_attribute` | variant, family, все VMY через fitment (closure dirty) |
| `version_fitment`, `equipment_availability`, `package_content` | `vmy_id` subject, `variant_id`/`item_id`; closure dirty для VMY |
| `component_state_type`, `entitlement` | сам subject и `applies_to/requires` subjects |
| `equipment_visual_hint` | equipment subject (влияет на overlay-логику через identity, но фрагмент содержит cue-правила) |

Bump это `UPDATE knowledge_subject SET knowledge_rev = knowledge_rev + 1, updated_at = now() WHERE id = ANY($1)`; внутри одной транзакции публикации `publish_batch.touched_subject_ids` агрегирует id (триггер statement-level с переходной таблицей, чтобы не делать N апдейтов). Инвалидация фрагментов: не делается синхронно; валидность проверяется при чтении по `fragment_dependency` (раздел J) и асинхронно worker помечает `valid=false` по индексу `fragment_dependency(subject_id)`.

**Audit:** каждая публикация создаёт `knowledge_snapshot`; `claim.published_snapshot_id`, `knowledge_pack.snapshot_id`. Воспроизведение отчёта = выборка claims с `published_snapshot_id <= N AND (superseded_by is null OR superseded claim's snapshot > N)`. Runtime валидность никогда не использует snapshot.

---

# G. Applicability: физическое представление

### `mi.claim_applicability`
- `id PK`; `owner_subject_id bigint FK knowledge_subject NULL` (для check_item/issue приоритетов) и `claim_id bigint FK mi.claim NULL`; CHECK ровно один из них не NULL.
- `group_no smallint NOT NULL` (all_of: разные группы; any_of: строки одной группы).
- `dimension mi.identity_dimension NOT NULL`.
- `operator mi.pred_operator NOT NULL` (eq, ne, in_range, present, absent, tag_has, tag_not, attr_eq).
- `config_scope mi.config_slot NOT NULL DEFAULT 'current'`.
- `ref_subject_id bigint FK knowledge_subject NULL` (для eq/ne/present/absent по subjects: generation, version, vmy, variant, family, equipment, entitlement, state_type).
- `include_revisions bool NOT NULL DEFAULT false` (для component_variant: сравнивать по дереву `revision_of` значения identity).
- `attr_key text NULL`, `attr_value text NULL` (для `variant_attribute`).
- `value_num_from numeric NULL`, `value_num_to numeric NULL` (mileage_km, age_years, model_year).
- `value_date_from date NULL`, `value_date_to date NULL` (production_date, first_sale_date).
- `tag text NULL` (condition_tag, market как текст enum).
- CHECK по dimension: `component_variant|generation|version|vmy|component_family|equipment_present|equipment_absent|entitlement_state|component_state_present -> ref_subject_id NOT NULL`; `mileage_km|age_years|model_year -> value_num_*`; `production_date|first_sale_date -> value_date_*`; `condition_tag|market_sold|market_operated -> tag NOT NULL`; `variant_attribute -> attr_key/attr_value NOT NULL`.
- Индексы: `(claim_id, group_no)`; `(owner_subject_id)`; `(dimension, ref_subject_id)` (обратный поиск «какие claims зависят от equipment X»).
- Объём: ~8,000 / ~400,000 (большинство claims без предикатов).

`claim.applicability_signature` = отсортированная сериализация строк (dimension, operator, scope, ref, values, tag) → text; обновляется триггером на `claim_applicability`; участвует в `dedup_key`.

**Оценка (в компиляторе, не в SQL):** для каждой строки предикат оценивается против измерений identity в нужном `slot`: значение с `resolution_status ∈ {confirmed, assumed_factory}` → MATCH/NO_MATCH (assumed даёт `basis=assumed_factory`); `conflicted|unresolved` или отсутствие измерения → UNKNOWN. Группа: any MATCH → MATCH; all NO_MATCH → NO_MATCH; иначе UNKNOWN. Claim: all groups MATCH → APPLICABLE; any NO_MATCH → EXCLUDED; иначе CONDITIONAL.

**Query shapes (форма, не код).**

Кандидаты для VMY (publish-time, строит фрагмент):

```
SELECT c.*
FROM mi.subject_closure sc
JOIN mi.claim c ON c.subject_id = sc.subject_id AND c.status = 'published'
WHERE sc.vmy_id = :vmy
  AND (
       sc.via IN ('self_vmy','version','generation','generation_parent',
                  'fitted_variant','equipment_available','entitlement_of_brand',
                  'state_type_of','issue_of','maintenance_of','check_of','comparison_peer')
    OR (sc.via IN ('family_of_fitted','revision_ancestor','model_line','brand')
        AND c.propagation IN ('descendants','family_context'))
  )
```

Правило: claim с subject family/ancestor/brand попадает в кандидаты только при `propagation <> 'exact'`; статус для `family_context` фиксируется как APPLICABLE_CONTEXT с importance cap 2 в компиляторе.

Предикаты кандидатов одним запросом:

```
SELECT a.* FROM mi.claim_applicability a WHERE a.claim_id = ANY(:candidate_ids)
ORDER BY a.claim_id, a.group_no
```

Обратный вопрос «почему исключён»: чтение `knowledge_pack.applicability_log` (json массив {claim_id, status, basis, predicates[]}), без повторной оценки.

Три запросные проверки propagation:

- Early N63 timing chain: claim subject N63B44O0, propagation exact. Closure для M550i/US/2018 содержит N63B44O2 (fitted_variant), N63 (family_of_fitted); N63B44O0 отсутствует в closure (он не ancestor по `revision_of`, потому что O2 revision_of O1 revision_of O0? Если цепочка ревизий ведёт к O0, O0 попадёт как `revision_ancestor`, но правило требует `propagation <> exact` → claim не кандидат). Забытое исключение ничего не меняет: механизма исключений нет.
- Hot-V context: claim subject family N63, propagation family_context → via family_of_fitted и propagation разрешён → кандидат со статусом APPLICABLE_CONTEXT.
- TU3-specific claim: subject N63B44T3; closure M550i/2018 не содержит T3 ни как fitted (fitment окно 03/2017..06/2019), ни как ancestor (T3 не предок O2) → не кандидат. Для MY2020 fitted_variant = T3 → кандидат.

---

# H. Identity representation

См. C.12. Правила заполнения слотов:

- Незаменяемые измерения (brand, model_line, generation, version, vmy, market_sold, production_date, model_year): `slot = na`, источник VIN/декодер/build sheet.
- **Заменяемые роли v1 (factory/current):** engine, transmission, transfer_case, battery_pack, drive_unit_front, drive_unit_rear, mcu, adas_hw, charger, modem, suspension_system, brake_system. Обоснование дополнений к минимуму: modem (Tesla 3G→LTE меняет права и функции), suspension_system (Porsche/Tesla конверсии пневмо↔пружины, DHP), brake_system (PCCB ретрофит, M Sport brakes). Не включены: instrument_cluster, door_handle, cabin_heater (покрываются state_types и generation-claims, замена не меняет applicability).
- Equipment: `dimension = equipment_present`, `slot = factory` из build sheet/VIN-опций, `slot = current` из Vision (только DEFINITIVE/STRONG по `equipment_visual_hint`) или документов; отсутствие current-наблюдения → current строка не создаётся, предикаты по current используют factory через `assumed_factory` только для kinds `system_config` и `option`, где ретрофит нетипичен; для retrofit-able items (B&W, PCCB, MCU) `assumed_factory` тоже допустим, но всегда с MUST-check на подтверждение, если importance claims ≥ 4.
- Статусы: два источника одного слота, оба с достаточной специфичностью, разные значения → `conflicted`, `conflict_note`, оба значения в `provenance`; production LLM видит только «CONFLICTED: <dimension>».

Примеры (строки dimension):

| Кейс | Строки |
|---|---|
| Tesla, пак не наблюдался | (component_variant, battery_pack, factory, PACK_85_GEN1, high, confirmed, vin_decoder+fitment); (component_variant, battery_pack, current, PACK_85_GEN1, medium, assumed_factory, derived_from_factory) |
| Tesla, MCU2 ретрофит по документу | (component_variant, mcu, factory, MCU1, high, confirmed); (component_variant, mcu, current, MCU2, high, confirmed, vehicle_memory:state_instance) |
| BMW, build sheet B&W, Vision «нет решёток B&W» (DEFINITIVE negative cue) | (equipment_present, B&W, factory, present, high, confirmed, build_sheet); (equipment_present, B&W, current, absent, medium, confirmed, vision:definitive) → не конфликт: замена аудио; state-кандидат |
| BMW, VIN-опции без DHP, документ дилера с DHP | (equipment_present, DHP, factory, conflicted, provenance оба) → предикаты UNKNOWN |
| Swapped engine, ревизия неизвестна | (component_variant, engine, factory, N63B44O2, confirmed); (component_variant, engine, current, NULL, unresolved, vehicle_memory:state_instance replacement_used) → variant-claims CONDITIONAL, family_context остаётся |

---

# I. Fragment / cache representation

**Что во фрагменте (VERSION STATIC):** для (VMY, purpose, locale, budget_profile): `identity_defaults` (fitment по ролям с окнами, standard equipment, entitlements бренда); `claims[]` с полями пакета плюс `pre_status` (APPLICABLE/EXCLUDED/CONDITIONAL по предикатам, разрешимым из VMY: generation, version, vmy, market_sold, model_year, production_date по окну MY, component_variant для factory-слота по fitment, variant_attribute, family) и `vin_dependent[]` (список оставшихся предикатов в компактной форме); `issues[]`, `check_items[]` (с их предикатами), `maintenance[]` (четыре слоя), `state_catalog[]` (state types, применимые к fitted variants, с их claims), `entitlement_catalog[]`, `visual_cue_rules[]` (только для overlay-объяснений), `labels` (subject_id → label), `importance` уже посчитан; сортировка выполнена; усечение по бюджету не выполнено (усечение только после overlay).

**Что в overlay (VIN-DEPENDENT):** оценка `vin_dependent` предикатов по измерениям: equipment_present/absent (current/factory), component_variant в current-слоте заменяемых ролей, component_state_present, entitlement_state, market_operated, mileage_km, age_years, condition_tag, production_date точнее MY, first_sale_date, salvage_status; добавление строк identity_summary (CONFIRMED/ASSUMED/UNRESOLVED/CONFLICTED); применение CONDITIONAL-политики; учёт measurements VM (свежая эндоскопия закрывает check как verified, помечается для Decision); формирование reason-кандидатов (verification gap, identity conflict, assumption) для Decision Engine; финальное усечение по бюджету; запись `knowledge_pack` с `applicability_log`.

Fingerprint фрагмента = sha256(отсортированный список `subject_id:knowledge_rev` из `fragment_dependency` + compiler_version + purpose + locale + budget_profile). Fingerprint пакета = sha256(fragment.fingerprint + identity_version + measurement_ids в сроке годности).

---

# J. Hot-path query plan

Runtime (на Check, purpose=decision):

1. `resolved_identity` по (vin, latest): 1 запрос, индекс `(vin, resolved_at desc)`, index scan, ~1 ms. Измерения: 1 запрос по `identity_id`, ~30..80 строк.
2. `pack_fragment` по UNIQUE (vmy, purpose, locale, budget_profile, compiler_version): 1 запрос, index scan на уникальном индексе, чтение jsonb до ~100 KB, ~2..5 ms.
3. Валидность: `SELECT 1 FROM mi.fragment_dependency d JOIN mi.knowledge_subject s ON s.id = d.subject_id WHERE d.fragment_id = :f AND s.knowledge_rev <> d.knowledge_rev LIMIT 1`: план: index scan `fragment_dependency(fragment_id)` (~250 строк) с nested loop по PK `knowledge_subject`; index-only, если добавить covering index `knowledge_subject(id) INCLUDE (knowledge_rev)`; ожидание ~1..3 ms. Это единственный runtime-контакт с реестром.
4. VM-факты: `component_state_instance`, `entitlement_state`, `measurement` по vin: 3 запроса по индексу `(vin)`, ~1 ms каждый.
5. Overlay в приложении: оценка ≤ ~500 vin_dependent предикатов в памяти, CONDITIONAL-политика, усечение, сериализация: ~10..40 ms.
6. Запись `knowledge_pack`: асинхронно после ответа (не в критическом пути).

Итого: 6 запросов, 0 join-ов с реестром кроме валидности, ни одного join с `claim`/`claim_applicability` в runtime. Оценка: p50 ~25 ms, p95 ≤ 120 ms при тёплом буфере, что укладывается в overlay ≤ 150 ms и общую добавку ≤ 200 ms (остаток на identity resolution, если она пересчитывается в этот же Check).

Publish/precompile-only запросы: closure build (join fitment/availability/relations; recursive CTE по `revision_of` глубиной ≤ 5), кандидаты (раздел G), предикаты, links, recurrence, evidence_summary, сортировка, запись фрагмента и dependency. Ожидание на VMY: 0.5..3 s, вне SLO Check.

Fallback long-tail (нет фрагмента): выполняется publish-time путь синхронно с уменьшенным бюджетом; целевой p95 ≤ 1.5 s; помечается `coverage weak` в пакете.

Chat purpose: фрагмент chat + overlay + полнотекстовый фильтр по GIN на `claim.text_en` только внутри candidate_ids пакета (никогда по всей базе).

---

# K. Migration mapping (additive)

| Текущее | Schema v1 | Действие |
|---|---|---|
| `public.option_dict` | `mi.equipment_item` (`legacy_option_id` = option_id) | скопировать; option_dict остаётся источником для существующего хука до переключения |
| `public.option_alias` | `mi.component_alias` (target = equipment subject, alias_kind community/official по origin) | скопировать; UNIQUE по alias_norm сохраняется |
| `public.model_option_catalog` | `mi.equipment_availability` (по VMY, source из source_url) + claims official_fact/known по evidence_excerpt | требует сопоставления model/year/market → VMY; несопоставимые остаются в старой таблице |
| `public.model_issue_catalog` | `mi.issue` (issue_key 1:1) + `mi.claim` (knowledge_type по источнику) + `mi.source`/`mi.evidence` | issue без source_url не переносится (правило текущей схемы совпадает) |
| `public.issue_observation.issue_key` | внешняя ссылка на `mi.issue.issue_key` | сначала без FK (проверка совпадения ключей), затем FK NOT VALID → VALIDATE |
| `public.equipment_observation` | вход Identity Resolver: `equipment_present` current с provenance по evidence (vision/document/seller/vehicle_data) и специфичностью через `equipment_visual_hint` | не копируется; читается |
| `public.observation_coverage` | вход Identity Resolver и будущий знаменатель (FUTURE prevalence) | читается |
| `public.derived_option_stats`, `derived_issue_stats` | остаются VM-derived; в MI не пишутся; research-сигнал | без изменений |
| `public.vehicles`, `vehicle_snapshots` | FK для `mi_vm.*` | без изменений |
| `public.reports` | `mi.decision_reason.report_id`, `knowledge_pack` привязка через `_meta` | без изменений схемы reports |

Порядок: 1) enums и `mi.knowledge_subject`; 2) иерархия и компоненты; 3) equipment/entitlement/state; 4) issue/maintenance/check; 5) claim/applicability/links/source/evidence/snapshot; 6) closure/fragment/pack; 7) staging; 8) `mi_vm.*`; 9) копирование option_dict/alias/catalog; 10) back-loading трёх карточек через staging. Ничего не удаляется; RLS как в knowledge-слое.

---

# L. Synthetic benchmark plan

**Scope (зафиксировано):** бенчмарк проверяет только latency, индексы, планы запросов, поведение фрагментов/кэша и масштабируемость физических запросов. Он **не** подтверждает семантическую корректность (dedup, alias resolution, applicability, owner-pattern normalization, cross-revision isolation): её подтверждают golden tests, back-loading трёх карточек и реальное наполнение первых 30..50 версий. Зелёный бенчмарк сам по себе не является quality GO.

Корпус: 50 VMY (150 версий, 30 поколений, 5 брендов), 800 variants (глубина ревизий до 4), 200 families, 3,000 equipment items, 20,000 availability, 8,000 fitment, 100,000 claims (60% без предикатов, 30% с 1..2 группами, 10% с 3..5; 5% descendants, 3% family_context), 250,000 applicability строк, 300,000 evidence, 30,000 sources, 40,000 aliases, 600 фрагментов, 1,000 identities (20 на VMY: полная, без опций, с состояниями, с конфликтами, с измерениями).

Измерения (p50/p95, тёплый и холодный буфер): identity lookup (цель 1/5 ms); fragment load (3/10 ms); validity check (2/8 ms); VM-факты (3/10 ms); overlay в приложении (15/60 ms); pack assembly + сериализация (10/40 ms); итог runtime (35/120 ms); cache hit по `knowledge_pack` UNIQUE (2/8 ms); candidate retrieval publish-time (100/600 ms); closure build (200/1,500 ms); фрагмент целиком (500/3,000 ms); fallback полный online-путь (400/1,500 ms); точечная инвалидация после публикации claim (найти фрагменты по `fragment_dependency(subject_id)`: 5/30 ms). Планы: EXPLAIN ANALYZE для запросов G и J; проверка отсутствия seq scan на `claim`, `claim_applicability`, `fragment_dependency`; buffer hits. Порог: SLO раздела J; при провале сначала уменьшать `vin_dependent` за счёт более раннего фиксирования во фрагменте, затем денормализация статусов, затем `vmy_knowledge_rev` агрегат (FUTURE).

Не запускается до утверждения схемы.

---

# M. Hardest worked examples (back-loading)

1. **Tesla заменённый пак (T-028, C.2.3 v1.1).** `component_state_type(pack_new_90_locked, replacement_new, applies_to PACK_85_GEN1, resulting_variant PACK_90_LOCKED)`; claims subject PACK_90_LOCKED (official part number: value_kind part_number; cost: value_kind cost с market US, as_of 2023; «без chargegate»: known_issue-negation как official_fact о variant). VM: `component_state_instance(vin, pack_new_90_locked, документы)`. Identity: current battery_pack = PACK_90_LOCKED confirmed → overlay переключает pre_status claims PACK_85_GEN1 (chargegate: subject PACK_85_GEN1, exact) в EXCLUDED, claims PACK_90_LOCKED в APPLICABLE (они во фрагменте через `state_catalog`, потому что state_type применим к fitted variant). Без blob: всё relations.
2. **Swapped engine.** VM state `replacement_used` без ревизии → current engine unresolved → variant-claims TU2 CONDITIONAL; CONDITIONAL-политика пропускает их только с importance ≥ 4 и с check `hardware_identification(engine number)` `resolves_dimension=component_variant`; family_context N63 остаётся; `decision_reason(IDENTITY_UNRESOLVED_engine...)` не создаётся (не конфликт), создаётся checklist MUST.
3. **ZF 8HP family против 8HP75 (C-080..C-083).** maintenance_item(about 8HP75, atf) с 4 claims-слоями; family-claims ZF_8HP «симптомы старого ATF» propagation descendants (note, источник ZF); issue `8hp_mechatronic_sleeve_leak` about 8HP45 и 8HP70 (два issue или один с about family? Правило: about конкретных variants, exact) → в closure M550i только через family_of_fitted, но claims issue имеют subject 8HP45 → не в closure → не кандидат.
4. **BMW brand policy (C-031).** claim subject brand BMW, propagation descendants, applicability: group 1 any_of: `variant_attribute performance_division = series` (или `ne M`) через `attr_eq`. Closure содержит brand via `brand`; кандидат, потому что propagation descendants; предикат оценивается по engine variant attribute.
5. **Porsche PDCC CONDITIONAL.** issue about PDCC_958 (variant, implements equipment PDCC); claims exact; applicability: group 1 `equipment_present ref=PDCC scope=current`. Identity без build sheet: нет строки → UNKNOWN → CONDITIONAL; importance 4; check_item `vin_build_sheet` с `resolves_dimension=equipment_present` в пакете → политика пропускает; лимит 3 группы на систему считается по `resolves_dimension`.
6. **Verification gap BMW borescope.** Не в MI-таблицах, а в `mi.decision_reason(report, VG_m48/n63_bore_scoring_borescope, verification_gap, issue, check, affects={decision_confidence, checklist})`; входы из MI: `issue.severity=catastrophic`, `check_item.materially_resolves=true`, статус issue APPLICABLE с basis confirmed из `applicability_log`; вход из VM: отсутствие `measurement(kind=borescope)` в сроке годности. Score в `reports` не читает decision_reason kind verification_gap по CHECK-инварианту `affects`.
7. **Owner-практика с contested (C-067 холодный термостат).** claim owner_practice, contested=true, note с позициями; evidence с двумя independence_group stance supports и contradicts; recurrence_summary: groups 2, contradicting 1 → repeated_pattern не достигается → anecdote/low; calcar_synthesis «не рекомендуем» с claim_support на оба; state_type `thermostat_corrector` (modification_unsanctioned) + check_item visual с cue.
8. **Alias-конфликт «N63TU1».** `component_alias(N63TU1, alias_kind legal, target N63B44O1, brand_scope BMW)`; community-alias «TU» → тоже O1; «TU2» → O2. UNIQUE по (brand_scope, alias_norm) не даёт двум variants делить alias; конфликт при ingestion → candidate остаётся `normalized`-блокированным до ручного решения.

Ни один пример не потребовал brand-specific JSON, free-form blob вместо relation, потери evidence, applicability или слоя practice.

---

# N. Golden test support (кратко)

| Класс | Чем обеспечивается |
|---|---|
| Positive | closure + published claims + предикаты; `applicability_log` для объяснения |
| Negative (соседние ревизии) | closure не содержит variant вне fitment; `propagation=exact` по умолчанию; T3-claims не в closure MY2018 |
| Uncertain identity | `resolution_status ∈ {unresolved, conflicted}` → UNKNOWN → CONDITIONAL; политика в компиляторе с входами `buyer_importance`, `check_item.resolves_dimension`, `issue.severity` |
| Supersession | `status=superseded` исключается из кандидатов; воспроизведение по snapshot через `published_snapshot_id` |
| Contested | `contested=true` + note + пара claims с `claim_link(contradicts)`; компилятор выводит оба в одном блоке |
| Factory vs current | два `slot` в `resolved_identity_dimension`; `config_scope` на предикатах; `assumed_factory` как basis |
| Inheritance isolation | closure `via` + `propagation` в запросе кандидатов; отсутствие таблицы исключений |
| Cache invalidation | `fragment_dependency` + `knowledge_rev`; тест 36: публикация claim subject MCU1 не меняет rev subjects из dependency M550i → fingerprint равен |
| Vision specificity | `equipment_visual_hint.specificity`; Identity Resolver создаёт current equipment_present только для definitive/strong (по combination_group) |
| Verification gap | `decision_reason` с CHECK на `affects` |

---

# O. Risks / open questions

1. Составные FK `(subject_id, kind)` и константная колонка kind в каждой сущности: небольшая избыточность ради целостности; альтернатива триггер-валидатор. Решение принято в пользу FK.
2. Триггеры bump на `claim` при UPDATE любых полей published-claim: claims immutable после публикации по правилам, поэтому фактически bump только при status-переходах и supersession; нужна защита от «тихих» UPDATE (trigger, запрещающий UPDATE published-полей кроме status/superseded_by/evidence_summary).
3. `descendants` bump требует вычисления потомков при публикации: дешёво (десятки строк), но должно быть в одной функции.
4. `resolved_identity_dimension` PK с coalesce-выражениями: допустимо через уникальный индекс по выражениям; проверить поддержку в Supabase (стандартный Postgres поддерживает).
5. Размер `pack_fragment.payload` для Report purpose может достигать сотен KB; TOAST допустим, но замер в бенчмарке обязателен; при необходимости разделить payload на секции (FUTURE).
6. Staging `proposed_applicability` в JSONB: единственное место JSONB для applicability, только до публикации; при публикации разворачивается в строки. Риск: рассинхрон формата; смягчение: одна функция сериализации.
7. `equipment_present` для retrofit-able items с `assumed_factory`: политика по kinds требует утверждения (условие 3 из v1.1 GO).
8. Chat: GIN-поиск только внутри candidate_ids пакета; при вопросах «вне пакета» (например про другую версию) нужен отдельный Component Pack путь: не в v1 hot path.
9. Партиционирование `evidence`/`claim_applicability` не планируется до миллионов строк; индексы покрывают.
10. Reason codes формируются Decision Engine (VM/report сторона): MI даёт только входы (severity, materially_resolves, resolves_dimension); граница соблюдена, но контракт кодов должен быть зафиксирован при реализации Decision Engine.

---

# P. GO / NO-GO to write migrations

**GO при выполнении трёх условий review:**

1. Утвердить список enum-словарей (subject_kind, component_role, identity_dimension, test_method, service_kind, state_kind, visual_specificity, rejection_reason) как закрытые на v1: расширение только миграцией.
2. Утвердить список заменяемых ролей (12) и правило `assumed_factory` для equipment kinds.
3. Утвердить staging-поток (candidate → normalize → evidence → gate → publish/reject/merge) как единственный путь записи в published claims.

После GO: миграции создавать аддитивно по порядку раздела K, с идемпотентным SQL и RLS как в `supabase-knowledge.sql`; бенчмарк по разделу L выполнить до включения фрагментов в Check.

Конец документа.
