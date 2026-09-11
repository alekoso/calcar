# CalCar Model Intelligence: Architecture Specification v1

Дата: 2026-09-11. Статус: спецификация для ручного review. Без SQL, без кода, без миграций.

Эмпирическая база: BMW M550i G30 MY2018 (Reference v1, frozen), Tesla Model S P85D MY2015, Porsche Cayenne GTS 958.1 MY2013, Cross-Car Model Intelligence Audit. Все требования ниже выведены из атомов этих документов; там, где требование не проявилось в них, оно помечено как отложенное.

Документ состоит из двух частей:

- **Часть I. Core Specification** (для review за одно чтение): сущности, applicability, claim/evidence, Identity Resolution, Knowledge Pack Compiler, runtime-интерфейсы, что не строим в v1.
- **Часть II. Appendices** (A..R): детали сущностей, концептуальная модель данных, примеры, lifecycle, ingestion, gates, retrieval, composition, интерфейсы, coverage, refresh, масштаб, миграция, worked examples, reference back-loading, golden tests, риски.

Минимально жизнеспособная архитектура (MVA) и future-proof расширения отмечены по всему тексту метками **[MVA]** и **[FUTURE]**.

---

# ЧАСТЬ I. CORE SPECIFICATION

## 1. Назначение и граница

Model Intelligence (MI) это reusable structured knowledge о том, **что означает** компонент, ревизия, опция, право, ремонт, практика или известная проблема для покупателя автомобиля данной версии. Vehicle Memory (VM) это то, **что наблюдалось у конкретного VIN**. Граница жёсткая: в MI нет VIN, в VM нет обобщений. Их соединяет Decision Engine через два интерфейса: Identity Resolution (VM/Check -> Resolved Identity) и Knowledge Pack Compiler (Resolved Identity + MI -> Knowledge Pack).

Три принципа, которые не подлежат пересмотру:

1. Structured DB (Postgres/Supabase) это единственный canonical store. Embeddings и готовые статьи это derived-артефакты.
2. LLM никогда не получает сырую базу и никогда не решает applicability в runtime. Applicability вычисляется детерминированно до сборки пакета.
3. Applicability claim никогда не расширяется из-за неопределённости идентичности. Неизвестное измерение даёт статус CONDITIONAL или исключение, но не превращает revision-specific знание в факт о всей модели.

## 2. Canonical entities [MVA]

| Сущность | Identity | Что canonical именно здесь | Почему не relation/атрибут |
|---|---|---|---|
| **generation** | brand + platform code (G30, Model S Gen1 pre-facelift, 958.1) + фаза | знание всего поколения: испаритель G30, ручки/PTC Gen1 Model S, пластик и дренажи 958 | 15..20% атомов живут здесь (audit) |
| **vehicle_version** | generation + version code (M550i xDrive, P85D, GTS) | характер, динамика, сравнения, «что делает версию версией» (главная передача GTS, LDU у P85D) | composition-узел, к которому Check привязывает машину |
| **version_market_year** (VMY) | version + market + model year, с production window | стандарт/опции с кодами и ценами, официальные действия рынка, границы TU2/TU3 по окну | «тонкий слой»: 10% атомов; MY хранится здесь как производная окна сборки |
| **component_family** | brand-independent family key (N63, M48, Tesla 18650 NCA pack Gen1, ZF 8HP, Aisin TR-80, ATC13) | архитектурные claims (hot-V, Alusil как класс, LDU-класс) и «чего не переносить» | 5% атомов, но нужна для наследования и для «относится ли к ревизии» |
| **component_variant** | family + variant code; ревизия это variant с `revision_of` | 35..45% атомов: N63B44O2, M48.02, 85-пак rev D/E, LDU pre-U / U, 8HP75, TR-80SD, ATC13-1, MCU1, AP1, ручки Gen2, PTC Gen1 | hardware revision не отдельная сущность: это variant в дереве ревизий |
| **component_alias** | (variant или family) + alias string + language + source kind | N63R = N63B44O2 = N63TU2; 0C8 = TR-80SD; «N63TU1» в settlement | обязательное multilingual сопоставление |
| **equipment_item** | brand + code (ZDH, 2VW, PDCC, SC01-hardware side) + kind (option, package, system_config) | содержимое, цена, SOP, визуальные признаки, что даёт/что стареет | пакет это equipment_item с relation `contains`; конфигурация подвески это `system_config` |
| **entitlement** | brand + entitlement key (FUSC, Autopilot AP1 option, Premium Connectivity, Ludicrous) | привязка (VIN/аккаунт/владелец), переносимость, отзываемость, зависимость от сети, как проверить | не equipment: может исчезнуть без изменения железа |
| **component_state_type** | key (sleeved_rebuild, reman_pack, new_pack_locked, ldu_rev_u, coolant_delete, mcu2_retrofit, thermostat_corrector, stage1) + kind (repair, replacement, retrofit, modification) | что означает состояние, риски, документы и измерения, снижающие неопределённость, чего не гарантирует | first-class после BMW/Tesla; VM хранит экземпляр состояния |
| **issue** | issue_key (n63r_thermostat_coolant_ingress) + subject entity | канонический смысл проблемы: механизм (prose EN), класс тяжести, класс частоты, чувствительность к возрасту/пробегу; всё остальное derived из claims | нужен как ключ агрегации с `issue_observation.issue_key` |
| **maintenance_item** | subject + service kind (engine_oil, atf, transfer_case_fluid, spark_plugs, brake_fluid, battery_coolant) | контейнер для слоёв official / specialist / owner / calcar (каждый слой это claim) | не одно число интервала |
| **check_item** | test method + target (issue/component/state) + version scope | зачем, что подтверждает, чего не гарантирует, условия, приоритет MUST/GOOD | audit: один тест закрывает несколько issues |
| **claim** | uuid | атом знания (раздел 4) | |
| **source** / **evidence** | source: uuid; evidence: claim × source | provenance, excerpt, независимость | |
| **knowledge_snapshot** | монотонный id публикации | версия всего опубликованного знания для воспроизводимости пакетов | |

Явно **не** сущности: brand и model_line (навигационные справочники без знаний), model year (атрибут VMY), production range (предикат), hardware revision (variant), package (kind у equipment_item), practice (слой claim), retrofit type (kind у component_state_type), sentiment (опциональный атрибут claim), cost band (структурное значение claim с рынком и датой), market (справочник), condition (словарь тегов предиката), comparison peer (relation version↔version с claims), coverage (derived), knowledge pack (derived артефакт), resolved identity (runtime-объект VM-стороны).

Relations (не сущности): `revision_of`, `supersedes`, `compatible_replacement`, `retrofit_from`, `requires_hardware`, `shares_component_with` (насос PDCC/ГУР); `version_fitment` (VMY → variant, роль, окно, standard/optional); `equipment_availability` (VMY → equipment_item, standard/optional/in_package, цена, SOP); `package_contains`; `entitlement_requires` (entitlement → variant/equipment); `check_covers` (check_item → issue/component/state); `claim_about_issue`, `claim_about_maintenance`, `claim_about_check`, `claim_about_state`; `comparison` (version ↔ version).

## 3. Applicability model [MVA]

Applicability хранится как **набор типизированных предикатов** на claim (таблица `claim_applicability`), а не как JSONB и не как десятки nullable-колонок. Каждая строка: `claim_id, group_no, dimension, operator, ref_id | value_from | value_to | tag`. Семантика: внутри `group_no` OR, между группами AND (DNF). Словарь `dimension`:

`generation`, `version`, `vmy`, `component_variant` (с флагом `include_revisions`), `component_family`, `equipment_present`, `equipment_absent`, `entitlement_state`, `component_state_present`, `market_sold`, `market_operated`, `production_date` (range), `model_year` (range), `mileage_km` (range), `age_years` (range), `condition_tag` (климат, профиль эксплуатации, топливо, тюнинг).

**Неявная applicability по subject.** Claim о component_variant без предикатов применим ко всем VMY, где этот variant стоит по `version_fitment` (с учётом окна). Claim о family применим ко всем variants семейства, кроме тех, где есть claim-исключение `not_applicable_to` (explicit негатив: «цепи ГРМ: проблема N63 2008..2013, к TU2 не относится»). Явные предикаты только сужают.

**Оценка против Resolved Identity.** Каждый предикат возвращает MATCH / NO_MATCH / UNKNOWN. Claim: APPLICABLE (все MATCH), EXCLUDED (хотя бы один NO_MATCH), CONDITIONAL (нет NO_MATCH, есть UNKNOWN). CONDITIONAL попадает в пакет только если `buyer_importance` ≥ порога задачи, и всегда с текстом условия. Никогда не превращается в APPLICABLE. Лог оценок хранится с пакетом: ответ на «почему включён / почему исключён» это выборка из этого лога.

Примеры (полностью в Appendix C): термостат N63R: subject variant N63B44O2 + `generation ∈ {G30, G12}`; продление гарантии: + `vmy = M550i/US/2018` + `market_operated = US`. AP1: subject variant AP1 + `production_date ≥ 2014-09`. Tesla заменённый пак: claim о `component_state_type = new_90_locked_pack` применим только при `component_state_present`; при UNKNOWN состоянии пака claim о reman-паке не расширяется на всех P85D. PDCC: `equipment_present = PDCC`; при UNKNOWN -> CONDITIONAL с условием «если установлен PDCC». Задиры M48.02: subject variant, без предикатов, применимо ко всем VMY с M48.02; claim об «отсутствии более высокой подверженности 958» не переносится на 957 через family, потому что subject это variant. ZF 8HP: claims о maintenance_item `atf` на variant 8HP75 в трёх слоях, без предикатов.

## 4. Claim и evidence [MVA]

Claim это атом с полями: `subject_type/subject_id`, `knowledge_type` (шесть, без расширения), `text_en` (canonical prose, английский), `structured_value` (опциональный типизированный факт: число, единица, диапазон, код опции, интервал, окно дат, part number), `confidence` (high/medium/low), `evidence_type` (official/legal/specialist/owner/review/market/vendor/aggregator), `buyer_implication_en`, `buyer_importance` (1..5, детерминированная шкала, см. Appendix H), `layer` (только для maintenance: official/specialist/owner/calcar), `causal_status` (observed_association / plausible_mechanism / supported_cause / unknown), `contested` (bool + краткое описание позиций), `policy_status` (stable / mutable_policy, только для official_fact-политик), `status` (draft/review/published/superseded/retired), `created_at/reviewed_at/effective_from/effective_to/supersedes_id`. Sentiment оставлен опциональным: audit показал, что для выводов он не использовался.

Evidence: связь claim × source с `excerpt`, `retrieved_at`, `supports/contradicts`, `independence_group` (один и тот же тред или один и тот же владелец на двух площадках это одна группа). Source: type, url/reference, язык, дата публикации/обновления, quality (official/primary specialist/community/vendor/aggregator), рынок.

Owner intelligence хранится **без псевдостатистики**: у owner_pattern-claim есть `recurrence` = {independent_groups (число), markets, mileage_contexts (список), age_contexts, specialist_support (bool), contradicting_groups (число)}; словесный класс `anecdote / repeated_pattern / strong_consensus` выводится детерминированно из recurrence (Appendix D), и он никогда не отображается как процент парка.

CalCar synthesis это claim с `knowledge_type = calcar_synthesis` и обязательными `supports` -> claims, из которых собран; без ссылок synthesis не публикуется.

## 5. Vehicle Identity Resolution [MVA]

Отдельный слой между Check/VM и MI. Вход: VIN и декодер, build sheet/опции по VIN, listing, Current Vision (и Historical Vision), диагностика (если есть), Vehicle Memory (прошлые наблюдения, зафиксированные component_state), верифицированные данные пользователя. Выход: `resolved_identity` со списком измерений, где каждое: `{dimension, value, confidence, provenance[], resolved_at}`. Измерения: brand, model_line, generation, version, vmy, market_sold, market_operated, production_date, component_variant по ролям (engine, transmission, transfer_case, battery_pack, drive_unit_front/rear, mcu, adas_hw, charger, modem...), equipment_present/absent (с источником: VIN-options / vision / seller / document), entitlement_state, component_state_present, mileage, age, condition_tags.

Правила: VIN сам по себе не разрешает всё (у Tesla он не даёт ревизию пака, MCU, права; у BMW не даёт DHP без опций по VIN; у Porsche не отличает пневмо от стали без build sheet). Измерение считается разрешённым для предикатов только при `confidence ≥ medium`; иначе UNKNOWN. Значение из VM (например, зафиксированное состояние «пак заменён на новый 90») имеет provenance `vehicle_memory` и участвует наравне с остальными. Resolved identity версионируется (`identity_version` = hash значений и confidence): любое изменение это новая версия и инвалидация пакетов.

## 6. Knowledge Pack Compiler [MVA]

Единственный путь знания к модели. Поток: knowledge_snapshot + resolved_identity -> детерминированный отбор claims (раздел 3) -> применение supersession (superseded не попадают; конфликтующие пары попадают как «contested» с обеими позициями, если обе published) -> дедупликация (по `dedup_key` claim: subject + issue + структурный смысл; при дублях остаётся claim с большей confidence, остальные как evidence) -> ранжирование по `buyer_importance` с корректировкой на задачу и статус (APPLICABLE > CONDITIONAL) -> усечение по бюджету задачи -> сериализация в Knowledge Pack.

Структура пакета: `identity_summary` (CONFIRMED / UNRESOLVED / CONDITIONAL измерения человекочитаемо, без предикатов), `systems[]` (по системному профилю силовой установки: ICE: engine, transmission, drivetrain, chassis, electronics, body; BEV: battery, drive_units, charging, mcu_adas, entitlements, chassis, body), внутри: `issues[]`, `claims[]` (id, text, type, confidence, layer, importance, status, condition_text), `maintenance[]` (четыре слоя), `check_items[]` (MUST/GOOD, что подтверждает, чего не гарантирует), `states[]` (знание о зафиксированных и возможных состояниях компонентов), `coverage_statement`, `pack_meta` (identity_version, snapshot_id, compiler_version, purpose, locale, budget, truncated_count).

Бюджеты по задачам (ориентиры, настраиваются): Decision Pack ≤ 6k токенов (importance ≥ 3, все MUST check items, все issues тяжести high, synthesis); Report Pack ≤ 20k (все published APPLICABLE + CONDITIONAL importance ≥ 2); Component Pack ≤ 3k (один subject и его дерево ревизий); Chat Query Pack ≤ 2.5k (пересечение Decision Pack и семантического поиска по вопросу, Appendix H). Кэш: ключ = hash(identity_version, snapshot_id, compiler_version, purpose, locale, budget_profile); инвалидация: публикация нового snapshot, новая identity_version, новый compiler_version; stale-пакет отдаётся только с явным флагом `stale=true` и только для Chat при недоступности компилятора, никогда для Decision.

## 7. Runtime interfaces [MVA]

- **VM/Check -> Identity Resolution**: `resolve(vin, inputs) -> resolved_identity(version)`.
- **Identity Resolution + MI -> Pack Compiler**: `compile(identity_version, purpose, locale) -> knowledge_pack`.
- **Decision Engine** получает: (A) VM-факты по VIN (issue_observation, equipment_observation, component_state instances, measurements с `measured_at`), (B) Knowledge Pack, (C) Personal Intelligence (страна, использование, бюджет, толерантность к риску). Формирует risks / positives / checklist / confidence / verdict. Правило: generic model weakness из MI влияет на контекст, риски-как-контекст, чек-лист, интерпретацию VM-фактов, Decision Confidence и Verdict; **объективный Score VIN снижается только при VM-evidence** (наблюдённый симптом/код/состояние или невыполненный MUST-check, который снижает confidence, а не score).
- **Report Composer** получает Report Pack и рендерит секции по системному профилю, переводя canonical EN в UA/RU отдельным слоем.
- **Обратный канал VM -> MI**: только как research-сигнал (агрегаты `issue_observation` по issue_key, покрытие), никогда как автоматическая правка знания.

## 8. Что явно не строится в v1

Числовой reliability rating; автоматическая перезапись знания из Check-ов; graph DB; vector DB как store (только индекс поверх claims для поиска/дедупа) [FUTURE]; отдельный scheduler refresh (в v1 refresh-классы и очередь review) [FUTURE]; несколько уровней confidence сверх трёх; новые knowledge_type; хранение готовой статьи как truth (только кэш рендера); оценка prevalence в процентах; массовый ingestion (v1: 30..50 версий вручную-ассистируемым пайплайном); multilingual canonical text (canonical EN, aliases multilingual, рендер переводится).

---

# ЧАСТЬ II. APPENDICES

## Appendix A. Domain model: детальные определения и границы

### A.1. Навигационные справочники

- **brand**: имя, страна, справочник. Знаний не хранит; исключение: политики бренда (Tesla salvage/аудит) хранятся как claims с subject `generation` или `entitlement`, а не brand.
- **model_line**: brand + line (5 Series, Model S, Cayenne). Только для навигации и «моделей рынка» будущего Model Page.

### A.2. generation

Identity: brand, platform_code (G30/G31 как одно поколение с body-вариантами), phase (pre-LCI / LCI, pre-facelift / facelift, 958.1 / 958.2), production window. Атрибуты: powertrain_types доступные (ICE/BEV/PHEV), system_profile по умолчанию (Appendix I). Canonical знания: generation-wide известные проблемы (испаритель G30, растяжки G30, LED DRL pre-LCI, ручки Model S Gen1, PTC Gen1, пано-крыша Gen1, пластик 958, дренажи 958, «слабая батарея» 958, раздатка 958 как класс до уточнения по variant). Reuse: 530i и M550i делят generation-claims; 85D и P85D делят Model S Gen1.

Решение по фазам: фаза это отдельная generation-запись с relation `phase_of` к родителю, потому что у Porsche 958.1 и 958.2 различаются моторами GTS, а у BMW LCI меняет iDrive и дифференциал; знания «всего 958» хранятся у родителя и наследуются обеими фазами.

### A.3. vehicle_version

Identity: generation + version_code (M550i xDrive, 540i xDrive, P85D, 85D, Cayenne GTS, Cayenne S) + powertrain_type. Атрибуты: positioning, default system_profile override (BEV vs ICE). Canonical знания: характер, динамика, расход по owner-данным, «почему хотеть», сравнения (relation `comparison` с claims), «признаки подлинности версии» (M5-клон, S-как-GTS) как check_item scope. Не хранит комплектацию (это VMY) и не хранит компонентные знания (это variant).

### A.4. version_market_year (VMY)

Identity: version + market_sold + model_year; атрибуты: production window (from/to), base price, currency, official range/economy ratings. Relations: `version_fitment` к variants по ролям с окнами (у M550i: engine=N63B44O2 для окна 03/2017..06/2019, N63B44T3 с 07/2019; у P85D: LDU pre-U, SDU, pack Gen1 85, MCU1, AP1, modem 3G до 06/2015 и LTE после, charger 10 kW standard / 20 kW optional); `equipment_availability` (стандарт/опция/в пакете, цена, SOP-окно внутри MY); официальные действия рынка (`official_action` как claim c `structured_value` окна сборки). Reuse: MY2018 и MY2019 M550i делят почти всё через version+generation, различаются только VMY-фактами (CarPlay стандарт, ADAS стандарт).

Почему MY вообще хранится: он нужен для декодера, для отзывов, для цен и для человека; но applicability-предикаты предпочитают production_date, а MY это производная окна.

### A.5. component_family и component_variant

- **family**: identity = family_key (N63, S63, B58, M48, ZF_8HP, AISIN_TR80, ATC13, TESLA_PACK_18650_GEN1, TESLA_LDU, TESLA_SDU, TESLA_MCU, TESLA_AP_HW, PDCC, PASM, PORSCHE_AIR_SUSP, DOOR_HANDLE_MS, PTC_HEATER_MS). Атрибуты: kind (engine, transmission, transfer_case, battery_pack, drive_unit, infotainment, adas_hw, suspension_system, brake_system, body_module...), architecture summary (prose EN), `cylinder_bore_technology` и подобные family-level структурные атрибуты в JSONB `attributes` (не критичный для retrieval метаданный слой).
- **variant**: identity = family + variant_code (N63B44O2, N63B44T3, M48.02, 8HP75, TR-80SD, ATC13-1, PACK_85_GEN1_REV_D, LDU_PRE_U, LDU_U, MCU1, MCU2, AP1, AP2, MODEM_3G, HANDLE_GEN2, PTC_GEN1, PDCC_958, PCCB_958_1). Атрибуты: `revision_of` (variant), `supersedes` (variant), production window по умолчанию, структурные факты (объём масла, мощность, давление впрыска, ёмкость) как claims с `structured_value`, а не как колонки. Relations: `compatible_replacement` (reman 85 pack -> оригинальный 85; new 90 locked -> 85), `retrofit_from` (MCU2 <- MCU1; LDU_U <- LDU_PRE_U), `requires` (CCS adapter -> CCS retrofit ECU), `shares_component_with` (PDCC pump ↔ PS pump).

Решение: hardware revision это variant, потому что у Tesla ревизия пака/LDU и у BMW TU2/TU3 ведут себя одинаково: своё окно, свои знания, наследование от family, `revision_of` для эволюции. Отдельная сущность «revision» дублировала бы variant.

Alias: `component_alias(target_type, target_id, alias, lang, alias_kind: official/catalog/community/legal, source_id)`. Уникальность по нормализованному alias в пределах бренда; конфликт (один alias на два variant) блокирует публикацию до ручного решения.

### A.6. equipment_item

Identity: brand + code (или synthetic key, если кода нет) + kind (option, package, system_config, wheel_tire_setup). Атрибуты: name_en, содержимое (relation `package_contains`), `visual_hints` (что видно на фото, что нет, что только в диагностике), cost и SOP через `equipment_availability`. Знания: «что даёт, что стареет, стоит ли искать» как claims с subject equipment_item. Suspension system (сталь+PASM / пневмо+PASM / PDCC / PTV Plus / IAS) моделируется как equipment_item kind `system_config`, при этом его физический агрегат (PDCC_958, PASM damper) это variant: связь `implements_variant`. Это позволяет и «наличие опции» (предикат equipment_present), и «знание об узле» (variant claims).

### A.7. entitlement

Identity: brand + key. Атрибуты: binding (vin / account / owner), transferable_private (bool), transferable_dealer (bool), revocable (bool + причины: salvage, audit, resale_by_oem), network_dependency (bool), `requires_hardware` (variant/equipment). Знания: claims (official policy с `policy_status = mutable_policy`, owner patterns удаления). VM хранит `entitlement_state` для VIN на дату проверки. Для ICE не используется, но продления гарантии «от даты продажи» и «только US-registered» хранятся как official_action-claims, а не как entitlement.

### A.8. component_state_type

Identity: key + kind (repair, rebuild, replacement_new, replacement_reman, replacement_used, retrofit, modification_unsanctioned, service_beyond_schedule). Атрибуты: `applies_to` (family/variant), `resulting_variant` (если состояние меняет variant: LDU_PRE_U -> LDU_U; PACK_85 -> PACK_90_LOCKED; MCU1 -> MCU2), `sanctioned_by_oem` (bool). Знания как claims: что означает, чего не гарантирует, документы и измерения, снижающие неопределённость, порог пробега после (20,000..30,000 km для гильзовки), риски неправильного исполнения. Interface с VM: VM хранит `component_state_instance(vin, state_type_id, date, mileage, performer_kind, documents[], measurements[], confidence)`; Identity Resolution поднимает это в измерение `component_state_present` и, если задан `resulting_variant`, переопределяет измерение `component_variant` для роли.

### A.9. issue

Identity: issue_key (snake, глобально уникален) + subject (family/variant/generation/equipment/entitlement). Canonical поля: name_en, mechanism_en (краткая проза), severity_class (catastrophic / major / moderate / minor), frequency_class (unknown / rare / recurring / common; выводится из recurrence claims и official actions по правилу Appendix D, хранится как derived-кэш с датой), sensitivity (calendar / mileage / cycles / usage / mixed), status. Всё остальное derived из claims, связанных `claim_about_issue` с ролью: symptom, code, prevalence, mechanism_detail, repair_option, prevention, cost, official_action, prerequisite. Diagnostic methods это `check_covers` от check_item. Решение: Issue это сущность, а не тип claim, потому что ему нужна стабильная идентичность для агрегации VM (`issue_observation.issue_key`), для check-items и для отчёта; но у issue нет собственных «фактов» кроме идентичности и кэшируемых классов.

### A.10. maintenance_item

Identity: subject (variant или generation) + service_kind. Canonical: только identity, fluid_spec ссылки (`fluid_spec` как справочник: LL-01 FE, Lifeguard 8, DTF-1, Shell TF 0870) и capacity как claim со structured_value. Интервалы: claims с `layer ∈ {official, specialist, owner, calcar}` и `structured_value = interval(km, months)`; у practice-claims `causal_status` и `contested`. Четыре слоя сосуществуют; calcar-слой это synthesis со ссылками на три остальных.

### A.11. check_item

Identity: test_method (visual, diagnostic_scan, borescope, compression, leak_down, battery_diagnostics, road_test, cold_start, fluid_analysis, documentation, vin_build_sheet, hardware_identification, software_verification, overnight_test, entitlement_verification, dc_charge_session) + target (issue / variant / equipment / state / version-authenticity) + scope (generation/version/variant). Поля: why_en, proves_en, cannot_prove_en (current_health_limitations), conditions (прогрет, ночь, OBD-адаптер, после переоформления), default_priority (MUST/GOOD), `priority_rule` (например MUST если issue.severity=catastrophic и test cheap). Приоритет может зависеть от applicability: хранится как claim_applicability на check_item (тот же механизм предикатов), например «эндоскопия MUST для всех Alusil-variants».

### A.12. claim, source, evidence

См. Core 4 и Appendix D.

### A.13. Что решили не делать сущностями и почему

- **Practice** как сущность: это слой claims у maintenance_item; отдельная сущность заставила бы дублировать applicability.
- **Retrofit** как сущность: это component_state_type kind retrofit + relation `retrofit_from`; сам факт ретрофита у VIN живёт в VM.
- **Cost band**: structured_value claim {amount_from, amount_to, currency, market, as_of, performer_kind}; отдельная сущность не нужна, но правило: cost всегда с рынком и датой.
- **Diagnostic test method**: справочник enum, не сущность знаний; знания привязаны к check_item.
- **Coverage**: derived (Appendix K).
- **Comparison**: relation с claims subject `comparison(version_a, version_b)`.
- **Vehicle profile / big JSON**: отвергнуто; composition собирается запросами по relations.

## Appendix B. Conceptual data model (без SQL)

Таблицы и ключевые поля (типы условные; PK uuid если не сказано; все published-объекты с created_at/updated_at и `snapshot_id` публикации):

1. `brand(id, name, aliases)`; `model_line(id, brand_id, name)`.
2. `generation(id, brand_id, model_line_id, platform_code, phase, phase_of_id, prod_from, prod_to, powertrain_types[], default_system_profile)`.
3. `vehicle_version(id, generation_id, version_code, name_en, powertrain_type, system_profile_override)`.
4. `version_market_year(id, version_id, market, model_year, prod_from, prod_to, base_price, currency, meta jsonb)`.
5. `component_family(id, brand_id nullable, family_key, kind, architecture_en, attributes jsonb)`.
6. `component_variant(id, family_id, variant_code, name_en, revision_of_id, supersedes_id, prod_from, prod_to, attributes jsonb)`.
7. `component_alias(id, target_type, target_id, alias, alias_norm, lang, alias_kind, source_id)`; UNIQUE(brand_scope, alias_norm).
8. `component_relation(id, from_variant_id, to_variant_id, relation_kind ∈ {compatible_replacement, retrofit_from, requires, shares_component_with, not_applicable_transfer}, note_en)`.
9. `version_fitment(id, vmy_id, role, variant_id, fitment ∈ {standard, optional, in_package}, prod_from, prod_to, source_id)`.
10. `equipment_item(id, brand_id, code, kind, name_en, visual_hints jsonb, implements_variant_id nullable)`; `package_contains(package_id, item_id)`; `equipment_availability(id, vmy_id, item_id, availability, price, currency, sop_from, sop_to, requires_item_id, source_id)`.
11. `entitlement(id, brand_id, key, name_en, binding, transferable_private, transferable_dealer, revocable, revoke_reasons[], network_dependency, requires_variant_id, requires_item_id)`.
12. `component_state_type(id, key, kind, applies_to_type, applies_to_id, resulting_variant_id, sanctioned_by_oem)`.
13. `issue(id, issue_key UNIQUE, subject_type, subject_id, name_en, mechanism_en, severity_class, frequency_class, frequency_computed_at, sensitivity, status)`.
14. `maintenance_item(id, subject_type, subject_id, service_kind, fluid_spec_id)`; `fluid_spec(id, brand_scope, key, name, viscosity, notes)`.
15. `check_item(id, test_method, target_type, target_id, scope_type, scope_id, why_en, proves_en, cannot_prove_en, conditions[], default_priority)`.
16. `claim(id, subject_type, subject_id, knowledge_type, text_en, structured_value jsonb typed-by-kind, value_kind, confidence, evidence_type, buyer_implication_en, buyer_importance smallint, layer nullable, causal_status, contested bool, contested_note_en, policy_status, status, dedup_key, created_at, reviewed_at, effective_from, effective_to, supersedes_id, superseded_by_id, review_note, snapshot_id)`.
17. `claim_link(claim_id, target_type ∈ {issue, maintenance_item, check_item, component_state_type, comparison}, target_id, role)`; `claim_support(synthesis_claim_id, supporting_claim_id)`.
18. `claim_applicability(id, owner_type ∈ {claim, check_item, issue}, owner_id, group_no, dimension, operator, ref_type, ref_id, value_from, value_to, tag, include_revisions bool)`.
19. `claim_recurrence(claim_id, independent_groups, markets[], mileage_contexts[], age_contexts[], specialist_support bool, contradicting_groups, computed_at)`.
20. `source(id, source_type, url, reference, title, lang, published_at, updated_at, retrieved_at, quality, market, access_status, notes)`; `evidence(id, claim_id, source_id, excerpt, stance ∈ {supports, contradicts, context}, independence_group, retrieved_at)`.
21. `claim_conflict(id, claim_a_id, claim_b_id, resolution ∈ {open, a_wins, b_wins, both_contested}, note_en, resolved_at)`.
22. `knowledge_snapshot(id serial, published_at, note, compiler_min_version)`.
23. `coverage(id, subject_type, subject_id, area, level ∈ {strong, medium, weak, none}, basis jsonb, computed_at)` (derived).
24. `knowledge_pack(id, identity_version, snapshot_id, compiler_version, purpose, locale, budget_profile, payload jsonb, applicability_log jsonb, created_at, stale bool)` (derived cache).
25. `research_task`, `candidate_claim` (ingestion staging, Appendix F).
26. VM-сторона (не MI): `resolved_identity(id, vin, identity_version, dimensions jsonb[{dimension, value, confidence, provenance}], resolved_at)`; `component_state_instance(id, vin, state_type_id, date, mileage, performer_kind, documents, measurements, confidence, source)`; `entitlement_state(vin, entitlement_id, state, checked_at, source)`; `measurement(vin, kind, value jsonb, measured_at, expires_at, source)`.

JSONB допустим в: `attributes` (family/variant), `visual_hints`, `structured_value` (типизирован `value_kind`), `payload` пакета, `basis` coverage, `dimensions` resolved identity. Не допустим для core applicability, для связей и для provenance.

## Appendix C. Applicability model: правила и примеры

### C.1. Правила оценки

1. Предикаты на claim: DNF по `group_no`. Пустой набор = неявная applicability по subject.
2. Неявная applicability: subject variant -> все VMY с `version_fitment` этого variant (или его ревизий, если `include_revisions`); subject family -> все variants семейства минус `not_applicable_transfer`; subject generation -> все versions поколения и фаз-потомков; subject VMY -> только он; subject equipment -> все VMY, где item доступен, при условии equipment_present.
3. Оценка измерения: MATCH если значение известно с confidence ≥ medium и удовлетворяет; NO_MATCH если известно и не удовлетворяет; UNKNOWN иначе. Для range-предикатов с частично известным значением (production_date известна с точностью до MY) правило консервативное: если весь MY внутри диапазона -> MATCH, если пересекается -> UNKNOWN.
4. Статусы: APPLICABLE / CONDITIONAL / EXCLUDED. CONDITIONAL включается в пакет только при `buyer_importance ≥ purpose_threshold` и всегда с `condition_text` (человекочитаемо: «если установлен PDCC», «если пак заменён на новый 90»).
5. Запрет расширения: система не имеет операции «relax predicate». Единственный способ получить более общее знание это другой claim с более широким subject.
6. Лог: для каждого оценённого claim в пакет пишется {claim_id, status, predicates:[{dimension, expected, observed, result}]}; «почему включён/исключён» это чтение лога.

### C.2. Примеры

**BMW thermostat issue.** Issue `n63r_thermostat_coolant_ingress`, subject variant N63B44O2. Claim «SI B12 13 16: течь через разъём термостата в жгут» (official_fact, known_issue): предикаты `generation ∈ {G30, G12}` (одна группа, OR). Claim «продление гарантии 15y/150k mi по SIB 01 01 21» (official_fact, policy_status=stable): предикаты `vmy = M550i/US/MY2018` AND `market_operated = US`. Для украинской M550i MY2018: первый claim APPLICABLE (variant по VIN high, generation high); второй EXCLUDED по `market_operated` (NO_MATCH), но его вывод «BMW признала дефект» хранится отдельным claim без market-предиката и попадает в пакет.

**Tesla AP1 production boundary.** Variant AP1 (family TESLA_AP_HW) с `version_fitment` для всех Model S VMY с окном 2014-09..2016-10. Claim «функции AP1: Autosteer, TACC...» subject AP1, без предикатов. Claim «FSD/HW3 capabilities» subject AP2/AP3: для P85D EXCLUDED через fitment (variant не установлен). Если production_date неизвестна, а VMY=P85D известна: fitment P85D содержит только AP1 (все P85D после 09/2014), значит MATCH; для «Model S MY2014» без даты: UNKNOWN -> CONDITIONAL «если сборка после 09/2014».

**Tesla replaced battery pack.** State types `pack_reman_85` (resulting_variant PACK_85_GEN1_REMAN), `pack_new_90_locked` (resulting_variant PACK_90_LOCKED). Claims «без chargegate, 14 модулей, гарантия 4y/50k» subject PACK_90_LOCKED. Identity: если VM содержит `component_state_instance(pack_new_90_locked)` с confidence ≥ medium, роль battery_pack переопределяется, и claims PACK_85_GEN1 (chargegate, batterygate) становятся EXCLUDED, claims PACK_90_LOCKED APPLICABLE. Если состояние пака UNKNOWN: claims о заводском 85-паке остаются APPLICABLE по fitment (это пак по умолчанию для VMY), claims о заменённых паках CONDITIONAL с условием «если пак менялся», а claim-synthesis «проверить табличку пака» MUST.

**Porsche PDCC.** Issue `pdcc_958_hydraulic_line_failure`, subject variant PDCC_958. Предикат `equipment_present = PDCC (equipment_item)`. Identity из build sheet: present -> APPLICABLE; VIN-опции недоступны и Vision не подтверждает -> UNKNOWN -> CONDITIONAL (importance 4 -> включается с условием). Vision «кнопка PDCC на консоли» даёт present с confidence medium -> MATCH.

**Porsche bore scoring.** Issue `m48_alusil_bore_scoring`, subject variant M48.02 (и отдельные issues для M48.01 с собственными claims). Claim «случаи на 958 есть, реже, чем 957» subject M48.02, без предикатов; claim family-level «Alusil-цилиндры подвержены задирам» subject family M48 с `condition_tag` пустым; claim о 957 MY2008 subject M48.01 c `model_year=2008` не переносится. Check item `borescope_all_cylinders` scope family M48 (все Alusil) с priority MUST по правилу severity=catastrophic.

**ZF 8HP75 maintenance.** maintenance_item(subject 8HP75, atf): claims: official «lifetime» (layer official, policy_status mutable_policy), specialist «80,000..150,000 km первая замена» (layer specialist, structured interval), owner «80,000..160,000 km» (layer owner, recurrence), calcar «первая 80,000..100,000, далее 80,000» (layer calcar, supports -> три предыдущих). Без предикатов: применимо ко всем VMY с 8HP75 (M550i, 750i, X5 M50i). Для 540i с 8HP50 EXCLUDED по fitment, но family ZF_8HP-claims (конструкция, симптомы старого масла) APPLICABLE.

## Appendix D. Claim и evidence: детали

### D.1. Поля claim и правила заполнения

- `text_en`: одна мысль, без ссылок на источники, без имён площадок.
- `structured_value` по `value_kind`: `quantity{value, unit}`, `range{from, to, unit}`, `interval{km, months}`, `date_window{from, to}`, `part_number{pn, oem}`, `option_code{code}`, `cost{from, to, currency, market, as_of, performer}`, `enum{...}`. Правило: если факт естественно структурен, structured_value обязателен, prose это выражение.
- `buyer_importance` (1..5): детерминированно по таблице Appendix H.1 при review; synthesis наследует максимум поддерживающих.
- `causal_status`: обязателен для owner_practice и specialist_practice; для known_issue отражает знание механизма.
- `contested`: true при наличии published-claim с противоположной позицией в том же subject/layer или при conflict; `contested_note_en` хранит позиции; в пакете обе позиции идут одним блоком.
- `policy_status`: только для official_fact; `mutable_policy` для правил, которые производитель может изменить (Tesla salvage, lifetime-жидкости, продления).
- `effective_from/to`: для official actions, цен, политик; для конструкции не заполняется.

### D.2. Evidence и независимость

`independence_group` присваивается при ingestion: один тред = одна группа; тот же автор на другой площадке = та же группа; перепечатки одного текста (агрегаторы) = группа исходника. Vendor-источники (продавцы услуг и запчастей) допускаются только со stance `context` для known_issue и не считаются в recurrence.

### D.3. Owner intelligence без псевдостатистики

`claim_recurrence` считается из evidence owner-типа: `independent_groups`, `markets`, `mileage_contexts` (список пробегов из кейсов), `age_contexts`, `specialist_support` (есть ли evidence specialist-типа с stance supports), `contradicting_groups`. Класс выводится детерминированно: anecdote (groups ≤ 1), repeated_pattern (groups ≥ 3 в ≥ 2 источниках-площадках или ≥ 2 рынках), strong_consensus (groups ≥ 5 и specialist_support и contradicting_groups ≤ 1). Класс влияет на confidence и на текст пакета («повторяющаяся практика владельцев», «единичные случаи»), но никогда не рендерится как процент. `frequency_class` issue: unknown по умолчанию; rare при anecdote+catastrophic с ≥ 2 групп; recurring при repeated_pattern; common только при official action плюс strong_consensus либо при VM-агрегате с покрытием (FUTURE).

## Appendix E. Knowledge lifecycle и versioning

Статусы claim: draft -> review -> published -> superseded | retired. Правила:

- Публикация не изменяет published-claim; исправление = новый claim с `supersedes_id`, старый получает `superseded_by_id`, `effective_to` и статус superseded, но остаётся читаемым (для «почему раньше говорили иначе» и для пакетов старых snapshot).
- Причина смены хранится в `review_note` нового claim (новый бюллетень, ошибка, уточнение ревизии).
- Каждая публикация группы изменений создаёт `knowledge_snapshot`; пакеты ссылаются на snapshot; retrieval по умолчанию читает «latest snapshot», а воспроизведение старого отчёта читает его snapshot.
- Conflicts: `claim_conflict` с resolution; open-конфликты с обеими published-сторонами рендерятся как contested; при `a_wins` проигравший переводится в superseded с причиной.
- Retire: для знаний, потерявших предмет (деталь NLA появилась снова, политика отменена), с `effective_to`.
- Audit сверх этого не строится: нет полной истории правок полей, потому что claims immutable после публикации.

## Appendix F. Research / ingestion pipeline

Улучшенный lifecycle (относительно исходного):

1. **Target scoping**: выбор VMY/variant и системного профиля; проверка coverage: что уже strong, что weak; формирование research_task с гипотезами из существующих family-claims (например «Alusil -> проверить задиры на этой ревизии»).
2. **Identity verification first**: до любых issue-поисков зафиксировать variants по ролям, окна, алиасы, фазы; источник первого уровня: technical training / техпаспорт / pricing guide. Без этого ingestion issues запрещён (иначе переносы между ревизиями).
3. **Source discovery по типам с квотами**: official (бюллетени NHTSA/регуляторы, пресс-киты, training), specialist (ремонтники, профильные сервисы), owner (треды long-term, wiki-треды, журналы drive2/TMC/Rennlist), review/test, market (каталоги part numbers, применимость), legal. Для каждого типа фиксируется access_status (ok / proxy / blocked / captcha) и способ доступа (прямой запрос, прокси, ручной импорт).
4. **Fetch и архивирование excerpt**: сохраняется только excerpt и метаданные, не полные копии; для PDF извлекается текст; для форумов фиксируются автор-хэш, дата, пробег, рынок из сообщения.
5. **Candidate claim extraction** (LLM-ассистируемо, в staging `candidate_claim`): текст EN, предполагаемый subject, предполагаемый knowledge_type, structured_value, предполагаемые предикаты, excerpt. LLM предлагает, не публикует.
6. **Normalization**: сопоставление subject через alias-таблицу; неразрешённый alias -> задача на ручное решение; запрет создавать новый variant без official/catalog-источника.
7. **Applicability proposal**: из subject и текста; правило «специфичнее по умолчанию»: если источник о G12, предикат generation=G12, а не family.
8. **Evidence linking и independence grouping**.
9. **Dedup**: `dedup_key` + семантический поиск по embeddings кандидатов против published (FUTURE в автоматике, MVA вручную по ключу).
10. **Contradiction detection**: по subject+issue+layer; открытый conflict блокирует auto-publish.
11. **Synthesis**: только человеком-ревьюером или LLM-черновик с обязательными `claim_support`.
12. **Quality gate** (Appendix G).
13. **Publish** в snapshot.
14. **Refresh/supersede** по классам (Appendix L).

Работа с типами источников:

- Official docs: приоритет; извлекать окна сборки и рынки буквально; хранить номер документа как structured_value.
- Forums: читать целиком тред и комментарии; фиксировать пробег/рынок/дату у каждого кейса; один тред = одна independence_group; wiki-треды (TMC) как specialist-quality community.
- Owner journals (drive2): высокая ценность для СНГ-практик; читать серию записей одного автора как одну группу.
- Specialist sites: различать ремонтника (primary specialist) и контент продавца (vendor).
- Inaccessible sources: фиксировать `access_status=blocked` и способ (Rennlist/6speedonline через ASN-блок; drive2 прямым запросом; reddit недоступен); знание через пересказ поисковика получает confidence не выше medium и помечается `via_search_summary`.
- Multilingual: excerpt хранится на языке источника, claim EN; alias добавляется на языке источника.
- Duplicated content: агрегаторы/перепечатки объединяются в independence_group исходника; quality aggregator.

## Appendix G. Quality gates

| knowledge_type | Минимум для publish |
|---|---|
| official_fact | 1 official или legal источник с документом/номером; structured_value при структурности; policy_status выставлен |
| known_issue | issue существует с механизмом; ≥ 1 official ИЛИ (≥ 1 primary specialist И ≥ 2 independence_groups owner) ИЛИ ≥ 3 independence_groups owner в ≥ 2 площадках с указанием пробега/года; applicability по ревизии подтверждена (не перенос с family) |
| specialist_practice | ≥ 1 primary specialist источник; causal_status заполнен; при конфликте с official -> оба published, contested по необходимости |
| owner_practice | recurrence ≥ repeated_pattern; causal_status заполнен; contested если есть ≥ 1 contradicting group с аргументом |
| owner_pattern | ≥ 2 independence_groups с контекстом (пробег/год/рынок) для confidence low; ≥ 3 для medium; high только с specialist_support или official |
| calcar_synthesis | ≥ 2 supporting claims из ≥ 2 разных knowledge_type или evidence_type; ревью человеком в v1 |

Общие: один форумный комментарий никогда не даёт known_issue; vendor не даёт ничего кроме context; claim с subject family, если источник о конкретной ревизии, отклоняется; claim с числом без единицы отклоняется; claim с «часто»/«обычно» без recurrence отклоняется; cost без рынка и даты отклоняется.

## Appendix H. Retrieval architecture и Knowledge Pack

### H.1. buyer_importance (детерминированно при review)

Базовые значения: catastrophic issue = 5; major issue с известной стоимостью = 4; MUST check item = 5; official action, влияющий на VIN = 4; maintenance calcar-слой = 3; official/specialist слои = 2; owner practice = 2..3 по классу; version character/comparison = 2; equipment знание = 2, +1 если visual hint; structured spec без buyer implication = 1. Корректировки purpose: Decision усиливает issues/check/state; Report сохраняет; Component усиливает variant-claims; Chat усиливает семантическое совпадение.

### H.2. Запрос «всё relevant для BMW M550i MY2018 US VIN X»

1. Identity Resolution -> identity_version (VIN -> VMY M550i/US/2018, production_date из VIN/декодера, engine N63B44O2 по fitment, опции по VIN-декоду/Vision, состояния из VM).
2. Кандидаты: claims subject ∈ {generation G30, version M550i, VMY, variants по fitment для ролей (с revision-деревом), equipment из identity, entitlements (нет для BMW), state_types applies_to этих variants, issues и check_items тех же subjects, comparison версии}.
3. Оценка предикатов -> статусы, лог.
4. Supersession/conflict, dedup, ранжирование, бюджет по purpose.
5. Pack + кэш.

### H.3. Запрос «что мы знаем о N63TU2 wastegate actuators?»

1. Alias resolution: «N63TU2» -> variant N63B44O2; «wastegate actuators» -> issue `n63r_wastegate_actuator_electric` (по alias issue/семантическому индексу issue-имён) и variant sub-component, если есть.
2. Component Pack: claims subject variant с link к issue + check_items + state_types (coolant lines не сюда) + official actions (G12 service actions как EXCLUDED-for-G30, но включаются в Component Pack как «знание о variant» с пометкой applicability); revision-дерево: TU3 claims той же категории отказов как «related, other revision».
3. Семантический индекс (FUTURE в автоматике; MVA: полнотекстовый поиск по text_en и alias) используется только для ранжирования и для поиска синонимов, не для отбора applicability.

### H.4. Структура Knowledge Pack (сериализация)

```
pack_meta {identity_version, snapshot_id, compiler_version, purpose, locale, budget_profile, truncated_count}
identity_summary {confirmed:[{dimension, value}], unresolved:[dimension], conditional_notes:[text]}
coverage_statement {areas:[{area, level}]}
systems:[{
  system_key, title,
  issues:[{issue_key, name, severity, frequency_class, mechanism, status: applicable|conditional, condition_text}],
  claims:[{id, text, knowledge_type, confidence, layer, importance, status, condition_text, issue_key?, check_ref?}],
  maintenance:[{service_kind, official, specialist, owner, calcar}],
  check_items:[{id, method, priority, why, proves, cannot_prove, conditions, status}],
  states:[{state_key, kind, meaning, reduces_uncertainty:[...], cannot_guarantee:[...], present: true|unknown}]
}]
comparisons:[...]
```

Модель не видит предикаты; видит статусы и condition_text.

### H.5. Кэш и инвалидация

Ключ пакета = hash(identity_version, snapshot_id, compiler_version, purpose, locale, budget_profile). Хранение в `knowledge_pack`. При публикации нового snapshot все пакеты предыдущего помечаются stale (не удаляются: нужны для воспроизведения старых отчётов). Decision и Report всегда компилируются на текущем snapshot; Chat может использовать пакет отчёта, к которому привязан чат (тот же snapshot, что и отчёт), чтобы разговор был консистентен с отчётом. Компиляция дешёвая (SQL + сортировка), поэтому кэш это оптимизация, а не необходимость.

## Appendix I. Report composition

- `system_profile` задаётся powertrain_type и может быть переопределён версией: ICE: {identity, engine, transmission, drivetrain, chassis, electronics_comfort, equipment, ownership, age_map, checklist, comparisons, verdict}; BEV: {identity_and_build, drive_units, battery, charging_hardware_and_entitlements, mcu_displays, adas, software_defined_state, chassis, body_comfort, ownership, age_cycles_hardware_map, checklist, comparisons, verdict}; PHEV: объединение (FUTURE).
- Композиция: для каждой секции берутся claims с subject в системе; порядок внутри секции: synthesis (итог надёжности системы) -> issues по severity -> maintenance -> practices -> equipment -> character. Обязательные блоки не зависят от бренда: «что даёт и чего не даёт диагностика», «current health != remaining life», «если компонент перебирали/меняли».
- Канонический текст EN; локализация отдельным слоем (перевод claims-текстов кэшируется по claim_id+lang+snapshot); правила стиля продукта (обращение на «ти», без имён источников) применяются при рендере.
- Готовая статья хранится только как кэш рендера с ключом пакета; при смене snapshot перерендер.

## Appendix J. Интерфейсы

**MI ↔ VM.** VM никогда не пишет в MI. VM экспортирует в Identity Resolution: vehicles (VIN, decoder), equipment_observation (present/absent с provenance), issue_observation (issue_key, event), component_state_instance, entitlement_state, measurement. MI экспортирует в VM только справочники ключей: issue_key, equipment_item id (замена option_dict), state_type key.

**MI ↔ Decision Engine.** Вход: Knowledge Pack (purpose=decision) + VM-факты + Personal Intelligence. Логика сопоставления: для каждого issue в пакете Decision Engine ищет VM-evidence (наблюдение с тем же issue_key, код, симптом, состояние); если есть -> risk «observed» с влиянием на Score; если нет, но check item MUST не выполнен -> risk «unverified» с влиянием на Decision Confidence и на checklist, без штрафа Score; если check выполнен и чист -> positive «verified today» с оговоркой cannot_prove. Personal Intelligence меняет вес рисков (страна: зарядка US-порта; использование: город против трассы для hot-V; бюджет: ценовые полосы), не меняя факты.

**MI ↔ Personal Intelligence.** Personal Intelligence хранит контекст покупателя (страна, климат, профиль, бюджет, прошлые решения). В Identity Resolution из него берутся `market_operated` и `condition_tags` (короткие поездки, такси, зима с солью), которые участвуют в предикатах; остальное используется Decision Engine для ранжирования.

**Обратный сигнал.** Агрегаты VM (issue_observation по issue_key с покрытием) поступают в research_task как гипотезы для refresh; они не меняют claims автоматически.

## Appendix K. Coverage model

`coverage(subject, area, level, basis)` считается детерминированно из published-claims: areas = системы профиля + ownership_practice + equipment + comparisons. Уровень: strong при ≥ N claims с ≥ 1 official и ≥ 1 owner/specialist на area и наличии synthesis; medium при claims без одного из типов; weak при < N или только aggregator; none при 0. N по умолчанию 8 для главных систем, 4 для остальных. Coverage попадает в пакет как `coverage_statement`, чтобы рендер и Decision Engine снижали уверенность формулировок для weak-областей, и попадает в research_task как приоритет. Пользователю числа не показываются, но «CalCar знает эту версию хорошо / частично» может рендериться словами (FUTURE после review).

## Appendix L. Refresh strategy

Классы refresh (атрибут claim, выводится из knowledge_type и value_kind, переопределяем при review):

| Класс | Примеры | Философия |
|---|---|---|
| immutable | конструкция, спецификации, окна сборки | не перепроверять; supersede только при ошибке |
| slow (24..36 мес.) | известные проблемы с механизмом, official actions | перепроверка при новых бюллетенях или VM-сигнале |
| aging (12 мес.) | owner patterns, practices, recurrence | парк стареет: паттерны усиливаются; пересчёт recurrence при новых evidence |
| volatile (3..6 мес.) | политики (Tesla), доступность деталей (NLA), цены | `policy_status=mutable_policy`, cost с as_of; при истечении класс не удаляет claim, а понижает confidence отображения «по состоянию на» |
| measurement (VM) | battery snapshot, эндоскопия | не в MI; в VM с `expires_at` |

Без планировщика в v1: очередь review формируется запросом «claims с истёкшим классом + VM-сигналы + coverage weak» и обрабатывается вручную-ассистируемо.

## Appendix M. Scaling

Postgres достаточно: все отборы это join по fitment/generation/subject плюс фильтр предикатов; при сотнях тысяч claims индексы по (subject_type, subject_id, status), по owner_id в claim_applicability, по alias_norm, по issue_key. Дорогие операции (recurrence, coverage, frequency_class) это derived-таблицы с пересчётом при публикации. Embeddings: отдельная таблица `claim_embedding` (pgvector) для дедупа и Chat-ранжирования [FUTURE], не участвует в applicability. Многоязычность: canonical EN, переводы кэшем. Партиционирование и отдельные сервисы не нужны до миллионов claims.

## Appendix N. Migration strategy from current CalCar

Текущее состояние (по коду и `supabase-knowledge.sql`, `docs/VEHICLE_INTELLIGENCE_STORAGE.md`): VM уже есть (vehicles, listings, snapshots, photo assets, equipment_observation, issue_observation с issue_key, observation_coverage); знания: option_dict/option_alias, model_option_catalog, model_issue_catalog (issue_key, source_url, evidence_excerpt), derived_*_stats; хук writeKnowledge в `api/check.js`.

План (аддитивный, без destructive-миграций):

1. Ввести MI-таблицы Appendix B рядом с существующими; `option_dict` становится источником для `equipment_item` (маппинг 1:1 с сохранением option_id как alias), `option_alias` -> `component_alias(target_type=equipment_item)`.
2. `model_issue_catalog` -> `issue` (issue_key совпадает) + по одному claim (knowledge_type по источнику) + source/evidence из source_url/evidence_excerpt. `model_option_catalog` -> `equipment_availability` + claims.
3. `issue_observation.issue_key` остаётся VM-ключом и ссылается на `issue.issue_key` без FK на первом шаге (данные должны совпасть), затем FK.
4. Identity Resolution v1: обёртка над текущим декодером и `_meta` Check (двигатель, год, рынок, комплектация из equipment_observation) с confidence по provenance; выход в `resolved_identity`.
5. Reference back-loading: три карточки переносятся в claims/issues/check_items/maintenance вручную-ассистируемо как первый snapshot (Appendix P даёт карту).
6. Pack Compiler v1 как серверная функция в `api/` (правило проекта), Decision Engine получает Decision Pack вместо текущих `model_issue_catalog`-выборок; чат получает Chat Pack.
7. derived_*_stats остаются VM-derived; в MI они не пишутся; используются как research-сигнал.
8. Ничего не удаляется; старые таблицы переводятся в read-only после подтверждения паритета.

## Appendix O. Worked examples

1. **N63TU2 thermostat issue.** issue `n63r_thermostat_coolant_ingress` (subject N63B44O2, severity major, sensitivity mixed). Claims: official_fact SI B12 13 16 (structured: document id, коды, part numbers; предикат generation ∈ {G30,G12}); official_fact SIB 01 01 21 продление (предикаты vmy=M550i/US/2018, market_operated=US; policy stable; effective 2021-11..2033); known_issue механизм (capillary ingress в жгут) supports по official; owner_pattern кейсы (recurrence); calcar_synthesis «любая ошибка термостата = проверка жгута». check_item `visual_thermostat_connector_and_harness` MUST (covers issue), `diagnostic_scan_thermostat_codes`. Для VIN в Украине: продление EXCLUDED, остальное APPLICABLE; Decision: risk «context», MUST-check; Score без штрафа, пока VM не покажет код/следы ОЖ.
2. **N63TU2 oil practice 5..8k km.** maintenance_item(N63B44O2, engine_oil): official 16,000 km/12 мес (structured interval, policy mutable_policy); specialist 5,000..8,000 km «идеал» (causal plausible_mechanism); owner СНГ 5,000..8,000 / NA 8,000..12,000 (recurrence: groups 6, markets [US, RU, UA-context], specialist_support true, contradicting 1 «15,000 без проблем»; contested=false, потому что противоречие не оспаривает практику, а оспаривает необходимость: хранится как contradicting group и в causal_status); calcar «документированные ≈5,000..8,000 km это положительный сигнал истории; заводские 16,000 верхняя граница» (supports три слоя). Decision Engine: VM чеки с интервалами -> positive; отсутствие чеков -> unverified, без штрафа.
3. **BMW sleeved engine.** component_state_type `n63_sleeved_rebuild` (kind rebuild, applies_to family N63, resulting_variant null, sanctioned false). Claims: specialist «чугунные гильзы с натягом; риски посадки/зазора/хона» (causal supported); owner_pattern «50,000 km на Stage 2 после гильзовки» (anecdote); vendor context «возвратов не было» (stance context, не считается); calcar «не автоматически минус; документы, измерения, пробег после ≥ 20..30k km снижают неопределённость; Stage поверх без документов красный флаг» (supports). check_items: documentation (MUST при state present), borescope_post_rebuild, compression_leakdown, coolant_loss_watch. VM: `component_state_instance(sleeved_rebuild, date, mileage, performer, documents)`; Identity: state_present=true -> claims APPLICABLE; Decision: risk «uncertainty», не «defect»; при отсутствии документов confidence вниз.
4. **Tesla MCU2 retrofit.** state_type `mcu2_retrofit` (kind retrofit, applies_to MCU1 cars, resulting_variant MCU2, sanctioned true, `retrofit_from` MCU1). Claims: official_fact цена/состав (cost с as_of, mutable_policy), official «FM/XM модуль отдельно», calcar «не меняет AP1; меняет интерфейс/приборку/стриминг». Identity: MCU variant из VM/документов или UI-признаков (Vision: интерфейс) -> MCU2 -> claims eMMC-отзыва EXCLUDED, claims MCU2 APPLICABLE; UNKNOWN -> MCU1 по fitment default APPLICABLE (консервативно, это заводское состояние), retrofit-claims CONDITIONAL.
5. **Tesla replaced battery.** См. Appendix C; плюс measurement в VM (CAN snapshot, expires_at 30 дней) и check_item `battery_diagnostics` MUST с cannot_prove «электронный отказ через год».
6. **Tesla Supercharging entitlement.** entitlement `fusc_sc01` (binding vin, transferable_private true, transferable_dealer false/mutable, revocable true [salvage, oem_resale], network_dependency true, requires_variant charge port NACS). Claims: official policy (mutable_policy, effective_from 2017-01), known_issue «salvage снимает», owner_pattern кейсы. VM: `entitlement_state(vin, fusc, state, checked_at)`; Identity: state known -> claims о наличии/отсутствии; UNKNOWN + salvage_status=true -> CONDITIONAL «вероятно снято» с check_item `entitlement_verification` MUST после переоформления. Decision: без подтверждения права не считать плюсом.
7. **Cayenne bore scoring.** См. Appendix C; check_item borescope MUST по правилу severity; claims о 957 не переносятся (subject M48.01, MY-предикат); family-claim «Alusil подвержен» APPLICABLE как контекст с confidence high, variant-claim «реже, чем 957» APPLICABLE medium.
8. **Cayenne PDCC.** См. Appendix C; плюс `shares_component_with(PDCC pump, PS pump)` даёт claim «отказ насоса влияет на ГУР» с subject PDCC_958 и relation-derived note; state_type `pdcc_delete` (modification, sanctioned false) с claims «снимает риск, меняет характер, признак при осмотре».
9. **ZF 8HP maintenance practice.** См. Appendix C; плюс known_issue `8hp_mechatronic_sleeve_leak` subject family ZF_8HP с `not_applicable_transfer` для 8HP75 rev (по specialist-claim «на этой ревизии практически не встречается»), чтобы family-issue не попадал в M550i как APPLICABLE, а попадал только как family-context с низкой importance.

## Appendix P. Reference back-loading acceptance test

Ниже карта всех material-атомов трёх карточек в модель. Колонки: атомы; canonical subject; applicability; knowledge_type; evidence; связи (Issue/Practice/CheckItem/State); чисто ли представимо; спец-логика.

### P.1. BMW M550i (C-001..C-146)

| Атомы | Subject | Applicability | Type | Evidence | Связи | Чисто | Спец-логика |
|---|---|---|---|---|---|---|---|
| C-001, C-003 | vmy M550i/US/2018; variant N63B44O2, N63B44T3 | fitment по окнам 03/2017..06/2019 и 07/2019+ | official_fact | official, catalog | alias (N63R, TU2) | да | нет |
| C-002, C-011, C-012 | vmy | subject | official_fact (structured quantity) | official, review | | да | нет |
| C-004, C-005 | variant 8HP75, ATC13-1 via fitment | subject | official_fact | official+market | alias 0C8-подобные | да | нет |
| C-006 | vmy (MY2018..2019 vs 2020) | model_year range | official_fact | official | equipment M Sport Diff | да | нет |
| C-007, C-008 | vmy equipment_availability | subject | official_fact | official | equipment_item + package_contains | да | нет |
| C-009, C-010 | version | subject | official_fact | mixed | | да | нет |
| C-013, C-014 | vmy official_action | production_date window; market_sold US | official_fact | official | | да | нет |
| C-015 | version (authenticity) | subject | calcar_synthesis | official specs+market | check_item vin_build_sheet (M5 clone) | да | нет |
| C-020, C-021, C-023, C-025, C-026 | variant N63B44O2 / N63B44T3 (structured attributes) | subject | official_fact | official training | revision_of, supersedes | да | family attribute `cylinder_bore_technology` |
| C-022 | variant N63B44T3 | subject | official_fact | official | | да | нет |
| C-024 | family N63 | subject family | calcar_synthesis | official+owner | supports C-036, C-037 | да | нет |
| C-030, C-031, C-032 | variant N63B44O2; family (BMW policy) | subject; C-031 subject brand-policy -> хранится как generation-agnostic claim на family «BMW engines» | owner_pattern; official_fact; official_fact | owner; official; official/legal | issue `n63_oil_consumption` (frequency rare) | да, кроме C-031 | C-031: subject «все BMW»: моделируется как claim на brand-scope family «BMW_ENGINE_POLICY»; единственный brand-level claim |
| C-033, C-034, C-035, C-038, C-039 | variant N63B44O2 | generation ∈ {G30,G12}; vmy+market_operated; generation G12 + production window; 530e-only | official_fact / known_issue | official | issue thermostat / turbo_coolant_lines / wastegate; check_items | да | нет (EXCLUDED-логика штатная) |
| C-036, C-037, C-041, C-045..C-048, C-050 | variant N63B44O2 | subject | owner_pattern / known_issue | owner + market | issues; recurrence | да | нет |
| C-040, C-042, C-043, C-044 | variant N63B44O2 (C-044 family-level DI) | subject; C-042 `not_applicable_transfer` от family-issue цепей | known_issue / specialist_practice / calcar_synthesis | mixed | issues | да | нет |
| C-049 | variant (after-run pump) | subject | official_fact + specialist_practice | official+specialist | practice | да | два claims |
| C-051, C-052 | variant N63B44O2; family Alusil-class | subject; condition_tags (climate, fuel) для C-052 | known_issue; specialist_practice | owner(3 groups, 3 markets); specialist | issue bore_scoring; check borescope MUST | да | нет |
| C-053..C-057 | variant | subject | official_fact/owner_pattern/specialist/calcar | mixed | issues, practices | да | нет |
| C-060..C-065 | maintenance_item(N63B44O2, oil/plugs/coolant) | subject | official_fact | official | fluid_spec | да | нет |
| C-063, C-066, C-067, C-068 | maintenance_item слои; condition_tags (CIS climate) для C-066; state_type thermostat_corrector для C-067 | subject + condition | owner/specialist_practice; calcar | owner+specialist | recurrence; contested (C-067) | да | нет |
| C-070..C-072 | variant N63B44O2 state_type stage1/stage2; variant 8HP75/ATC13-1 | state_present | specialist_practice | vendor-dyno (quality primary specialist для замера) | state_types | да | vendor-dyno трактуется как specialist (замер), не vendor-claim |
| C-080..C-083 | maintenance_item(8HP75, atf); variant | subject | specialist/owner/owner_pattern | mixed | practice слои | да | нет |
| C-090..C-093 | variant ATC13-1; generation G30 | subject; C-090 generation | known_issue/specialist/owner | official-via-specialist | issue shudder; check road_test | да | нет |
| C-100..C-104 | generation G30; equipment ZDH/IAS; wheels 21" | subject; equipment_present | known_issue/owner_pattern | mixed | issues | да | нет |
| C-110..C-116 | generation G30 (pre-LCI для DRL); version (sound) | subject | known_issue/owner_pattern/official | mixed | issues | да | нет |
| C-120..C-127 | version; comparison(M550i, 540i), (M550i, M5) | subject | owner_pattern/calcar | owner/official | comparison relation | да | нет |
| C-130..C-135 | state_type sleeved_rebuild (family N63/Alusil) | state_present | official/specialist/owner/calcar | mixed | state claims; check_items | да | нет |
| C-140..C-146 | check_items (borescope, compression, leak_down, scan, fluid, turbo checks, synthesis) | scope family/variant | specialist/calcar | mixed | check_covers issues | да | нет |

Не вписалось чисто: только C-031 (общебрендовая политика допуска расхода масла) требует brand-scope family; это единственный спец-случай, и он не brand-specific escape hatch, а общий приём «policy family».

### P.2. Tesla P85D (T-001..T-074)

| Атомы | Subject | Applicability | Type | Evidence | Связи | Чисто | Спец-логика |
|---|---|---|---|---|---|---|---|
| T-001 | vmy/version с production window; VIN MY как производная | production_date | official_fact | catalog | | да | MY из VIN хранится как атрибут VMY, applicability по дате |
| T-002 | version (структурно) + known_issue «691 vs 463» | subject | official_fact + known_issue | official+legal | issue `p85d_rated_power_dispute` (minor) | да | нет |
| T-003 | state_type ludicrous_upgrade (retrofit, sanctioned) | state_present | official_fact + owner_pattern | official+owner | check software_verification | да | нет |
| T-004 | variant AP1 via fitment; entitlement autopilot_option | production_date ≥ 2014-09; entitlement_state | official_fact | official | entitlement | да | нет |
| T-005 | variant MODEM_3G / LTE; entitlement premium_connectivity | production_date < 2015-06 | official_fact | official | state_type lte_upgrade | да | нет |
| T-006, T-040, T-041, T-044 | variant CHARGER_10KW/20KW, port NACS; state_type ccs_retrofit; market_operated | market_operated ∈ {EU, UA}; state_present | official_fact/specialist/calcar | official+vendor(context)+owner | check charging_hardware | да | market_operated обязателен |
| T-007, T-008 | vmy; version warranty | subject; effective_to | official_fact | official | | да | нет |
| T-010..T-013 | variant LDU_PRE_U (revision_of LDU), relation retrofit_from LDU_U; state_type coolant_delete | subject | known_issue/specialist/owner_pattern | mixed | issue `ldu_rotor_seal_coolant_leak`; check hardware_identification (speed sensor) | да | нет |
| T-014, T-015 | variant SDU; version drivetrain parts | subject | owner_pattern | owner | | да | нет |
| T-020, T-021 | variant PACK_85_GEN1 (структурно); degradation pattern | subject | official/specialist; owner_pattern | teardown specialist; owner+aggregate | measurement kind battery_snapshot (VM) | да | нет |
| T-022, T-023 | variant PACK_85_GEN1 (+60/70/75 packs) | generation pre-facelift; production_date < 2016-07 | known_issue + official(legal) | owner wiki + legal | issue batterygate / chargegate; check dc_charge_session, battery_diagnostics | да | policy event хранится как official_fact с effective_from и как known_issue последствий |
| T-024..T-027 | variant PACK_85_GEN1; condition_tag humid_climate (T-025) | subject; condition | known_issue/owner_pattern/specialist | owner+specialist | issues; check battery_diagnostics | да | нет |
| T-028 | state_types pack_reman_85, pack_new_90_locked с resulting_variant | state_present | official_fact (part numbers, cost as_of 2023) + owner_pattern | owner-documents | | да | нет |
| T-029, T-030, T-031 | maintenance_item(pack, charging_habit) как practice; check battery_diagnostics; maintenance_item coolant/brake/desiccant | subject | owner_practice/specialist/official | mixed | practice слои; official policy mutable (coolant lifetime change) | да | «charging habit» как service_kind практики |
| T-042, T-043 | entitlement fusc_sc01 / autopilot_option | entitlement_state; salvage_status | official policy (mutable) + known_issue | owner+press | check entitlement_verification | да | нет |
| T-050..T-054 | variant MCU1 (issue eMMC, IC), official action 21V-035 (market US), state_type mcu2_retrofit, variant AP1 | subject; market_sold/operated для отзыва | known_issue/official/owner_pattern | official+specialist+owner | issues; state | да | нет |
| T-060..T-067 | equipment air_suspension (present); generation Model S Gen1 (links, handles Gen2 variant, PTC Gen1 variant, roof); brakes | equipment_present; subject | known_issue/owner_pattern/official | mixed | issues; check overnight_test | да | нет |
| T-070..T-074 | version; comparison(P85D,85D), (P85D,90D), (P85D, later S) | subject | owner_pattern/calcar/official | mixed | comparison | да | нет |

Не вписалось чисто: ничего. Замечание: «policy event» (batterygate) представляется парой official_fact (событие с датой) + known_issue (последствия), без новой сущности.

### P.3. Porsche Cayenne GTS (P-001..P-084)

| Атомы | Subject | Applicability | Type | Evidence | Связи | Чисто | Спец-логика |
|---|---|---|---|---|---|---|---|
| P-001..P-005, P-008 | variant M48.02 (structured), vmy GTS/US/2013, version (final drive как version-attribute claim), variant TR-80SD, transfer case PTM_958 | subject | official_fact | official spec sheet | alias 0C8 | да | «главная передача 3.70» как claim subject version с structured quantity |
| P-006 | vmy equipment_availability; equipment system_config steel_pasm / air / PDCC / PTV+ / Sport Chrono | subject | official_fact (medium для мм) | official+press | equipment_items | да | конфликт «пневмо стандарт» хранится как claim_conflict resolved a_wins |
| P-007, P-027 | vmy official_action | production_date windows | official_fact | official | | да | нет |
| P-009, P-020 | variant M48.02; family M48 (Alusil) | subject; family claim с `not_applicable_transfer` для 957-specific MY2008 claim | specialist_practice; known_issue | specialist; owner-via-summary (confidence medium) | issue bore_scoring; check borescope MUST | да | нет |
| P-021, P-022 | variant M48.02 (и family 958 V8 incl. M48.52) | subject family-level 958_V8 с variants | known_issue/specialist | specialist+legal | issue coolant_pipe_adhesive; check documentation (aluminium upgrade), visual | да | нет |
| P-023, P-024, P-025, P-028, P-029, P-030 | variant M48.02; maintenance_item plugs/oil | subject | known_issue/official/owner_practice/calcar | mixed | issues AOS, HPFP; practice слои | да | нет |
| P-026 | variant M48.02 vs M48.02-MY2011 (окно) | production_date windows (MY2011 S/Turbo) -> для GTS 2013 EXCLUDED; residual claim «не подтверждено» как CONDITIONAL low | official_fact + known_issue | official+legal+specialist | issue cam_adjuster_bolts; check scan P0016/17 | да | нет |
| P-040..P-042 | maintenance_item(TR-80SD, atf); variant | subject | specialist/known_issue/calcar | specialist+press | practice; issue valve_body | да | нет |
| P-050..P-054 | variant PTM_958 transfer case; official_action warranty extension (effective from delivery date) | subject; effective window relative to first sale | official_fact/known_issue/specialist/owner | legal/press/specialist | issue shudder; check road_test; practice | да | `effective_from` относительно date_of_first_sale: измерение identity `first_sale_date` |
| P-060..P-064 | equipment air / PDCC / PCCB (present); variant PASM damper; generation 958 | equipment_present | known_issue/owner_practice/official parts | owner+specialist | issues; shares_component_with; state pdcc_delete | да | нет |
| P-070..P-073 | generation 958 (958.1 фаза для PCM 3.1) | subject | owner_pattern/owner_practice | owner+press | | да | нет |
| P-080..P-084 | version; comparison(GTS,S), (GTS,Turbo), (958.1 GTS, 958.2 GTS) | subject | owner_pattern/calcar/official | mixed | comparison | да | нет |

Не вписалось чисто: ничего. Единственное дополнительное измерение identity, которого не было у BMW/Tesla: `first_sale_date` для продлений «от даты продажи».

### P.4. Итог acceptance

Все атомы трёх карточек представимы штатными сущностями. Спец-логика потребовалась в трёх местах, и все три общие, а не brand-specific: brand-scope policy family (BMW C-031), измерение `first_sale_date` (Porsche P-050), `market_operated` как обязательное измерение (Tesla зарядка, BMW продления). Brand-specific escape hatches не нужны.

## Appendix Q. Golden retrieval tests (28 кейсов)

Формат: идентичность -> ожидаемый результат по claim/issue.

POSITIVE
1. M550i/US/2018, N63B44O2 confirmed: issue thermostat (SI B12 13 16) APPLICABLE.
2. Та же машина, market_operated=UA: SIB 01 01 21 продление EXCLUDED, claim «BMW признала дефект» APPLICABLE.
3. Та же: maintenance oil четыре слоя присутствуют одновременно, calcar-слой ссылается на три.
4. Та же: check borescope MUST присутствует (Alusil family rule).
5. P85D build 2015-03, pack state UNKNOWN: batterygate/chargegate APPLICABLE (fitment default), pack_new_90 claims CONDITIONAL.
6. P85D с VM state pack_new_90_locked (confidence high): chargegate EXCLUDED, PACK_90_LOCKED claims APPLICABLE.
7. P85D build 2015-03: modem 3G claim APPLICABLE; build 2015-09: EXCLUDED.
8. P85D salvage_status=true, entitlement UNKNOWN: FUSC CONDITIONAL «вероятно снято», check entitlement_verification MUST.
9. Cayenne GTS 2013 с build sheet PDCC present: PDCC issues APPLICABLE.
10. Cayenne GTS 2013, PDCC UNKNOWN: PDCC issues CONDITIONAL (importance 4), не APPLICABLE.
11. Cayenne GTS 2013: transfer case shudder APPLICABLE; warranty extension claim с first_sale_date 2013-04 -> effective_to 2023-04 -> «expired» рендер, не EXCLUDED (knowledge о прошлом покрытии полезно).
12. Любая машина с 8HP75: три слоя ATF присутствуют.

NEGATIVE
13. M550i MY2018: claims subject N63B44O0/O1 (CCP, инжекторы TU1, HPFP F10) EXCLUDED.
14. M550i MY2018: claims N63B44T3 (LDS, 350 bar, колпачки TU3) EXCLUDED как факты; допускается блок «related revision» только в Component Pack.
15. M550i MY2018: wastegate warranty extension 530e EXCLUDED.
16. M550i MY2018: ZF family issue mechatronic sleeve EXCLUDED через not_applicable_transfer для 8HP75.
17. 540i MY2018: N63 claims EXCLUDED; B58 claims APPLICABLE; generation G30 claims (evaporator) APPLICABLE для обоих.
18. P85D: AP2/HW3/FSD claims EXCLUDED; MCU2-native claims EXCLUDED без state.
19. 85D: LDU rotor seal issue EXCLUDED (SDU only), общие Gen1 issues APPLICABLE.
20. Cayenne GTS 2013: cam adjuster recall 17V-368 EXCLUDED (MY2011 окно); fuel rail recall EXCLUDED (окно до 05/2012); residual «не подтверждено» CONDITIONAL low.
21. Cayenne 957 4.8: 958 coolant-adhesive issue EXCLUDED; 957 plastic pipes APPLICABLE.
22. Cayenne GTS 958.2: M48.02 claims EXCLUDED; V6TT claims APPLICABLE.

UNCERTAIN IDENTITY
23. Model S без даты сборки, VMY MY2014: AP1 claims CONDITIONAL, не APPLICABLE.
24. M550i без VIN-опций и без Vision: DHP/IAS claims CONDITIONAL; для Decision Pack включаются только importance ≥ 4.
25. Tesla LDU revision UNKNOWN: LDU_PRE_U claims APPLICABLE (заводское по умолчанию), LDU_U claims CONDITIONAL; проверка speed sensor MUST.

SUPERSESSION
26. Claim «battery coolant 4y/50k» (effective_to 2019) superseded «lifetime»: пакет на текущем snapshot содержит новый; отчёт 2018-го snapshot содержит старый.
27. Claim с исправленной ревизией (ошибочный «TU2 с напылением» -> «Alusil») не возвращается; supersedes-лог доступен.

CONTESTED
28. M550i: «холодный термостат» возвращается как contested owner_practice с обеими позициями и calcar «не рекомендует»; PDCC-delete аналогично; coolant delete Tesla как specialist_practice с contested=false, но с cannot_guarantee.

## Appendix R. Risks и открытые вопросы

1. **Ручная нагрузка review** в v1: 30..50 версий по 150..250 атомов = 5..10 тыс. claims через ручной gate; нужен приоритет по importance и coverage.
2. **Identity Resolution для Tesla и опций Porsche**: без build sheet/VM большинство измерений UNKNOWN; риск «пустых» Decision Pack из-за CONDITIONAL-порога; порог по purpose требует калибровки на реальных Check.
3. **Знаменатели** для frequency_class: только VM-агрегаты с покрытием дадут их; до этого класс остаётся unknown/rare/recurring по recurrence.
4. **Alias-конфликты** между брендами и сообществами (N63TU1 в юридических документах против «TU» в форумах) требуют brand-scope и alias_kind; ошибки здесь дают тихие переносы.
5. **market_operated и condition_tags из Personal Intelligence**: границы приватности (страна/климат) и качество источника; предикаты на них должны быть немногочисленны.
6. **Стоимости**: as_of и рынок обязательны; локальные цены (UA/EU) отсутствуют; рендер должен маркировать «по данным рынка X на дату».
7. **Vendor-контент** просачивается через поисковые пересказы; gate требует stance context, но извлечение должно уметь распознавать продавцов.
8. **Chat**: семантический поиск по вопросу без applicability-фильтра может подтянуть EXCLUDED знание; правило: Chat Pack строится только из claims с уже вычисленным статусом для этой identity.
9. **Supersession политики Tesla**: claims с mutable_policy устаревают без сигнала; refresh volatile класс требует хотя бы ручной очереди.
10. **Sentiment**: оставлен опциональным; если не используется через 2 карточки, удалить из модели.
11. **PHEV/гибриды и мотоциклы/коммерческие**: system_profile расширяется, но не проверен.
12. **Vision как источник equipment_present**: confidence medium даёт MATCH; ложное срабатывание (синие суппорты у 540i M Sport) может включить лишнее; нужен список «визуально ненадёжных» признаков в visual_hints с confidence cap.

Конец спецификации.
