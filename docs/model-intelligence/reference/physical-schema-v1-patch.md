# MODEL INTELLIGENCE PHYSICAL SCHEMA v1: FINAL PATCH

Дата: 2026-09-11. Базис: «MODEL INTELLIGENCE PHYSICAL SCHEMA v1: DESIGN» и Architecture Specification v1.1. Патч ограничен десятью пунктами задания. Архитектура не пересматривается, research не проводится, SQL не пишется, repo не меняется. Незатронутые секции design-документа действуют как есть.

---

# A. Patch list

| # | Проблема в v1 design | Исправление |
|---|---|---|
| 1 | `assumed_factory` давал обычный MATCH и обычный APPLICABLE | введены результаты предиката ASSUMED_MATCH / ASSUMED_NO_MATCH и статус claim APPLICABLE_ASSUMED; политика силы допущения вынесена в данные (`component_role.assumption_strength`) |
| 2 | evidence и recurrence не входили в bump-механизм | evidence это единственная точка решения: пересчёт recurrence и evidence_summary, сравнение `pack_visible_hash`, один bump; производные таблицы и колонки исключены из триггеров |
| 3 | заявлено «30 таблиц», фактически больше | честная инвентаризация: 52 таблицы CREATE NOW в шести группах; `subject_closure` и `component_relation` перенесены в FUTURE |
| 4 | UNIQUE/PK с `coalesce()` нельзя выразить как constraint | окна производства получили NOT NULL с сентинелами; `source` и `subject_alias` получили generated-колонки; `resolved_identity_dimension` получил суррогатный PK плюс UNIQUE expression index; cross-table проверки явно помечены как триггерные |
| 5 | identity оборудования держалась на OEM-коде и имени | добавлен `equipment_key`: стабильная внутренняя identity `(brand_id, equipment_key)`; `oem_code` отдельная неуникальная колонка |
| 6 | alias уникален по `(brand, alias_norm)`, что слишком строго | `component_alias` переименован в `subject_alias`, добавлен `scope_subject_id` (brand / model_line / generation / family) и детерминированный алгоритм разрешения с явным AMBIGUOUS |
| 7 | staging был конвенцией, а не запретом | публикация только через SECURITY DEFINER функцию плюс триггер-страж плюс отзыв прямых прав DML на canonical claims; административный путь остаётся, но не является API |
| 8 | «6 запросов» и рассогласованные кардинальности | честный пересчёт: 5..7 запросов в горячем пути; версии и VMY разведены; цифры p50/p95 помечены как TARGET |
| 9 | long-tail компиляция выполнялась синхронно до 1.5 s | синхронная компиляция удалена из Check; при промахе фрагмента ставится async-запрос, Check продолжается, перед Decision Pack дешёвая перепроверка; разведены «знание есть, фрагмента нет» и «знания нет» |
| 10 | все словари были enum | разделение: закрытые поведенческие enum против расширяемых предметных lookup-таблиц; `test_method`, `service_kind`, `rejection_reason`, `component_role`, `component_kind`, `link_role`, `market`, `attribute_key`, `condition_tag` стали lookup; `measurement_kind` устранён как отдельный словарь |

---

# B. Updated affected schema sections

## B.1. Evaluator: assumed_factory (пункт 1)

**Результат предиката** (было три значения, стало пять):

| Результат | Когда |
|---|---|
| MATCH | измерение в нужном слоте имеет `resolution_status = confirmed` и удовлетворяет предикату |
| NO_MATCH | `confirmed` и не удовлетворяет |
| ASSUMED_MATCH | `assumed_factory` и удовлетворяет |
| ASSUMED_NO_MATCH | `assumed_factory` и не удовлетворяет |
| UNKNOWN | `unresolved`, `conflicted` или измерение отсутствует |

**Группа (any_of)** берёт лучший результат по порядку: MATCH > ASSUMED_MATCH > UNKNOWN > ASSUMED_NO_MATCH > NO_MATCH.

**Claim (all_of)** по убыванию решительности:

1. любая группа NO_MATCH: **EXCLUDED** (окончательно, не повышается)
2. иначе любая группа ASSUMED_NO_MATCH: **EXCLUDED_ASSUMED** (в пакет не идёт, пишется в лог; повышается до CONDITIONAL, если `buyer_importance >= 4` и в пакете есть check с `resolves_dimension` по этому измерению)
3. иначе любая группа UNKNOWN: **CONDITIONAL** (политика CONDITIONAL без изменений)
4. иначе любая группа ASSUMED_MATCH: **APPLICABLE_ASSUMED**
5. иначе: **APPLICABLE**

**Сила допущения как данные.** Колонки lookup-таблицы `mi.component_role`: `is_replaceable bool`, `assumption_strength ∈ {strong, weak}`, `rationale text`.

- `weak`: ASSUMED_MATCH ведёт к APPLICABLE_ASSUMED. Клейм подаётся как «при условии, что узел заводской», строка ASSUMED в identity_summary обязательна, verification gap невозможен, MUST-check на разрешение измерения обязателен, если у claim importance >= 4.
- `strong`: ASSUMED_MATCH ведёт к APPLICABLE с `basis = assumed_strong`. Строка допущения в identity_summary всё равно присутствует, verification gap возможен.

Назначение по трём эталонным машинам:

| Роль | is_replaceable | strength | Основание |
|---|---|---|---|
| engine | да | strong | замена мотора редка, почти всегда оставляет след в VM/документах, VIN кодирует код мотора |
| transmission | да | strong | то же |
| transfer_case | да | strong | то же, замена по продлению гарантии фиксируется документом |
| battery_pack | да | weak | у Tesla замены массовые и невидимые снаружи |
| drive_unit_rear | да | weak | LDU менялись многократно в гарантии |
| drive_unit_front | да | weak | то же |
| mcu | да | weak | ретрофит MCU2 распространён |
| adas_hw | да | weak | замены блоков после ДТП |
| charger | да | weak | ретрофит второго зарядника и CCS |
| modem | да | weak | 3G в LTE меняли массово |
| suspension_system | да | weak | конверсии пневмо в пружины у Porsche и Tesla |
| brake_system | да | weak | ретрофит PCCB и обратные замены |

**Уточнение правила verification gap.** В v1.1 условие (1) звучит «issue APPLICABLE со статусом confirmed». После введения пяти результатов оно читается так: gap допустим при `basis ∈ {confirmed, assumed_strong}` и запрещён при `APPLICABLE_ASSUMED` (weak) и при CONDITIONAL. Это единственное место патча, меняющее формулировку интерфейсного правила v1.1; оно нужно, чтобы сохранить одобренный пример с эндоскопией BMW. Если при review решение будет иным, это изменение одной строки в `component_role` (engine становится weak) и одной строки в правиле.

**Поведение по пяти узлам:**

| Узел | Идентичность | Статус claims заводского варианта | Gap | Чек-лист |
|---|---|---|---|---|
| Tesla battery_pack | factory PACK_85 confirmed, current assumed | batterygate/chargegate APPLICABLE_ASSUMED | нет | MUST: табличка пака или документы замены (`resolves_dimension=component_variant/battery_pack`); claims PACK_90_LOCKED дают EXCLUDED_ASSUMED и не показываются (importance 3) |
| Tesla drive_unit_rear | current assumed LDU_PRE_U | issue течи ротора APPLICABLE_ASSUMED | нет | MUST: датчик скорости плюс табличка ревизии |
| Tesla mcu | current assumed MCU1 | issue eMMC APPLICABLE_ASSUMED | нет | MUST: software_verification; DEFINITIVE-кадр интерфейса переводит измерение в confirmed, после чего работает обычная логика |
| BMW engine | VIN даёт N63B44O2, следов замены нет | claims TU2 APPLICABLE (basis assumed_strong) | да | borescope MUST, gap `VG_bore_scoring_borescope` при отсутствии |
| BMW transmission | 8HP75 по fitment | слои ATF APPLICABLE (assumed_strong) | не применимо (severity ниже) | GOOD: чеки замен |

Если в VM есть запись о замене узла с неизвестным результатом (контрактный мотор), измерение становится `unresolved`, а не `assumed_factory`: claims уходят в CONDITIONAL, gap невозможен.

Пакет: в `claims[].status` появляются значения `applicable`, `applicable_assumed`, `conditional`; `basis ∈ {confirmed, assumed_factory, assumed_strong}`; `identity_summary.assumed[]` перечисляет роли с допущением и способ их подтверждения. Лимит: не более одной строки допущения на роль.

## B.2. Evidence и recurrence в механизме bump (пункт 2)

Единый поток, одна точка решения:

```
INSERT/UPDATE/DELETE mi.evidence (statement-level AFTER, transition tables)
  -> для затронутых claim_id, у которых claim.status = 'published':
       пересчитать mi.recurrence_summary (independent_groups, contradicting_groups,
         markets, mileage_contexts, age_contexts, specialist_support, recurrence_class)
       пересчитать mi.claim.evidence_summary
       вычислить pack_visible_hash = hash(recurrence_class, specialist_support,
         has_official, has_primary_specialist, contradicting_groups > 0)
  -> если pack_visible_hash изменился:
       собрать subject_id клеймов (плюс цели propagation, как для claim-изменений)
       вызвать mi.touch_subjects(array)  -> knowledge_rev + 1
  -> иначе: bump не выполняется
```

Правила против двойного bump:

- `mi.recurrence_summary` и колонки `mi.claim.evidence_summary`, `mi.claim.applicability_signature`, `mi.claim.dedup_key` объявлены производными: триггеры bump на них не навешиваются, а триггер на `mi.claim` игнорирует UPDATE, затрагивающий только эти колонки.
- Evidence, привязанная к claim в статусах draft/review/rejected, bump не вызывает.
- Внутри одной транзакции публикации bump выполняется один раз на subject: функция `mi.touch_subjects` дедуплицирует массив, а повторный вызов в той же транзакции для того же id допустим и безвреден (сравнение ревизий идёт на равенство, а не на дельту).

Обновлённая таблица соответствий триггеров (добавлены две строки, остальные из design-документа без изменений):

| Таблица | Затронутые subjects | Условие |
|---|---|---|
| `mi.evidence` | `claim.subject_id` плюс цели propagation | только published claim и только при изменении `pack_visible_hash` |
| `mi.recurrence_summary` | нет | производная, триггеров нет |

`mi.recurrence_summary` получает колонку `pack_visible_hash text NOT NULL` и `computed_at`.

## B.3. Ограничения PostgreSQL (пункт 4)

Системное решение: **все окна производства и доступности становятся NOT NULL с сентинелами** `'1900-01-01'` и `'9999-12-31'`. Это убирает `coalesce` из ключей, упрощает диапазонные предикаты и делает CHECK тривиальным.

| Таблица | Было (некорректно) | Стало |
|---|---|---|
| `mi.generation` | UNIQUE (model_line_id, platform_code, coalesce(phase,'')) | `phase text NOT NULL DEFAULT 'base'`; **UNIQUE constraint** (model_line_id, platform_code, phase); **CHECK** (phase_of_id IS NULL OR phase <> 'base'); `prod_from/prod_to` NOT NULL с сентинелами, **CHECK** (prod_from <= prod_to) |
| `mi.version_market_year` | UNIQUE (version_id, market_code, model_year) плюс CHECK с NULL | **UNIQUE constraint** без изменений; окна NOT NULL с сентинелами; **CHECK** (prod_from <= prod_to); `market_code text NOT NULL` **FK** на `mi.market` |
| `mi.subject_alias` | UNIQUE (coalesce(brand_scope,0), alias_norm) | `scope_key bigint GENERATED ALWAYS AS (COALESCE(scope_subject_id, 0)) STORED`; **UNIQUE constraint** (scope_key, alias_norm); `alias_norm text NOT NULL` заполняется приложением (нормализация не в БД, чтобы не зависеть от immutable-статуса функций) |
| `mi.version_fitment` | UNIQUE (..., coalesce(prod_from,...)) | окна NOT NULL с сентинелами; **UNIQUE constraint** (vmy_id, role_code, variant_id, prod_from); **CHECK** (prod_from <= prod_to) |
| `mi.equipment_item` | UNIQUE (brand_id, coalesce(code, name_en)) | **UNIQUE constraint** (brand_id, equipment_key); `oem_code` неуникальна, обычный **index** (brand_id, oem_code) |
| `mi.equipment_availability` | UNIQUE (..., coalesce(sop_from,...)) | окна NOT NULL с сентинелами; **UNIQUE constraint** (vmy_id, item_id, sop_from) |
| `mi.source` | UNIQUE (coalesce(url,''), coalesce(reference,'')) partial | `natural_key text GENERATED ALWAYS AS (COALESCE(NULLIF(url,''), 'ref:' \|\| lower(btrim(reference)))) STORED`; **CHECK** (num_nonnulls(url, reference) >= 1); **UNIQUE constraint** (natural_key) |
| `mi.evidence` | UNIQUE (claim_id, source_id, coalesce(independence_group,'')) | `independence_group text NOT NULL`; **UNIQUE constraint** (claim_id, source_id, independence_group) |
| `mi_vm.resolved_identity_dimension` | PK с coalesce-выражениями | суррогатный **PK** `id bigint identity`; **UNIQUE expression index** (identity_id, dimension, COALESCE(role_code,''), slot, COALESCE(value_subject_id, 0), COALESCE(value_text,'')); **не** table constraint |
| `mi.claim` | CHECK «layer заполнен, если subject это maintenance_item» | **триггер-валидатор** (cross-table) |
| `mi.package_content` | CHECK package.kind='package' | **триггер-валидатор** (cross-table) |
| `mi.claim_support` | CHECK synthesis.knowledge_type | **триггер-валидатор** (cross-table) |
| `mi.claim_applicability` | «ровно один из claim_id / owner_subject_id» | настоящий **CHECK** `num_nonnulls(claim_id, owner_subject_id) = 1` |
| `mi.claim` | UNIQUE (dedup_key) WHERE published | **partial unique index**, не constraint (помечено явно) |
| `mi.variant_attribute` | attr_key «по словарю» | **FK** на `mi.attribute_key(code)` |
| `mi.claim_applicability` | tag «по словарю» | **FK** на `mi.condition_tag(code)` при dimension = condition_tag, проверка **триггером** (условный FK не выразим) |

Итоговая классификация для писателя миграций: настоящие PK и FK везде, где отношение однозначно; UNIQUE constraint после устранения `coalesce`; UNIQUE expression index только в `resolved_identity_dimension`; partial unique index только для `claim.dedup_key`; триггер-валидация только для четырёх cross-table правил и одного условного FK.

## B.4. Equipment identity (пункт 5)

`mi.equipment_item` (обновлено):

- `subject_id bigint PK`
- `brand_id bigint NOT NULL FK mi.brand`
- `equipment_key text NOT NULL`: стабильная внутренняя идентичность, snake_case, неизменяемая после публикации. Конвенция: если одно и то же торговое имя означает разное содержимое в разных поколениях, ключ включает поколение (`bmw_dynamic_handling_package_g30`, `porsche_pdcc`, `tesla_smart_air_suspension_gen1`, `bmw_premium_package_g30`).
- `oem_code text NULL`: ZDH, 2VW, 6F1, M02. Не уникален: один код повторяется между поколениями и рынками с разным содержимым.
- `kind mi.equipment_kind NOT NULL` (enum), `name_en text NOT NULL`, `implements_variant_id FK NULL`, `legacy_option_id uuid NULL`.
- UNIQUE (brand_id, equipment_key); index (brand_id, oem_code).
- Привязка кода к конкретному VMY, где он действовал, живёт в `mi.equipment_availability` (там же цена и окно SOP), а не в identity.

## B.5. Context-aware aliases (пункт 6)

`mi.subject_alias` (переименование из `component_alias`, потому что цель это любой subject):

- `id PK`; `target_subject_id FK knowledge_subject NOT NULL`; `alias text NOT NULL`; `alias_norm text NOT NULL`; `lang char(2) NULL`; `alias_kind mi.alias_kind NOT NULL`; `scope_subject_id bigint FK knowledge_subject NULL`; `scope_kind mi.alias_scope NOT NULL` (enum: global, brand, model_line, generation, component_family); `scope_key bigint GENERATED ... STORED`; `source_id FK NULL`.
- UNIQUE (scope_key, alias_norm); index (alias_norm); index (target_subject_id); CHECK `(scope_kind = 'global') = (scope_subject_id IS NULL)`.

Алгоритм разрешения (детерминированный, без догадок):

1. Найти все строки по `alias_norm`.
2. Отфильтровать по контексту, который уже известен (brand, model_line, generation, family из частично разрешённой идентичности или из research-задачи): строка подходит, если `scope_kind = global` или её `scope_subject_id` присутствует в контексте.
3. Взять подходящие строки с максимальной специфичностью в порядке component_family > generation > model_line > brand > global.
4. Ровно одна строка на этом уровне: разрешено детерминированно.
5. Больше одной строки на одном уровне, либо ноль строк после фильтрации при наличии кандидатов в неприменимых контекстах: вернуть **AMBIGUOUS** со списком кандидатов. В ingestion кандидат остаётся в статусе `normalized` и блокируется до ручного решения; в runtime неоднозначный alias не используется вовсе (идентичность приходит из VIN/декодера, а не из текста).

Быстрый путь: «N63TU2», «PACK_85_GEN1», «0C8» существуют в одной глобальной или brand-строке, шаг 1 сразу даёт единственную запись за один index lookup. Пример реального конфликта, который эта модель разводит: «Premium Package» с `scope_kind=generation` отдельно для G30 и для F10.

## B.6. Публикация только через staging (пункт 7)

Три уровня, ни один из них не является workflow-движком:

1. **Права.** В схеме `mi` создаются две роли: `mi_ingest` (INSERT/UPDATE на `candidate_claim`, `candidate_evidence`, `source`; SELECT на canonical; EXECUTE на функции публикации) и владелец схемы `mi_admin`. Прямые INSERT/UPDATE/DELETE на `mi.claim`, `mi.claim_applicability`, `mi.claim_link`, `mi.claim_support`, `mi.evidence` отзываются у всех, кроме владельца. Роль приложения (та, под которой ходит серверный код) получает только `mi_ingest`.
2. **Функция.** `mi.publish_candidate(candidate_id, reviewer, override_reason default null)` объявлена SECURITY DEFINER, принадлежит владельцу схемы. Она: открывает или переиспользует `publish_batch`, выполняет `mi.check_gate(candidate_id)` по правилам Appendix G v1.1, при провале отказывает (либо записывает `override_reason` и метку в `review_note`), создаёт `mi.claim` со `status='published'`, разворачивает `proposed_applicability` в строки `claim_applicability`, копирует `candidate_evidence` в `evidence`, создаёт `claim_link`, проставляет `candidate_claim.published_claim_id` и `review_status='approved'`, собирает затронутые subjects в `publish_batch.touched_subject_ids`.
3. **Страж.** BEFORE INSERT OR UPDATE триггер на `mi.claim` отклоняет появление или переход в `status='published'`, если `current_setting('mi.publish_context', true)` не равен идентификатору активного `publish_batch`; этот GUC устанавливается только внутри `mi.publish_candidate`. Те же стражи на `claim_applicability` и `evidence` для строк, привязанных к published claim.

Аварийный путь: подключение под владельцем схемы из psql или дашборда с ручной установкой GUC. Он существует, документирован как «не API» и оставляет след в `publish_batch.actor`.

Дополнительно: `mi.candidate_claim` получает `gate_result jsonb` (последний прогон gate: список пройденных и проваленных правил) и `gate_checked_at`, чтобы review видел причину до попытки публикации.

## B.7. Long-tail и промах фрагмента (пункт 9)

Синхронная полная компиляция удаляется из Check. Новый порядок MI-стадии:

1. Пробы: `pack_fragment` по ключу VMY, затем валидность по `fragment_dependency`. Обе пробы это index lookup.
2. **Попадание и валиден**: overlay, бюджет TARGET p95 <= 150 ms.
3. **Промах или невалиден**: запись или обновление строки в `mi.build_request` (дедупликация по (vmy_id, purpose), счётчик и отметка времени), Check продолжает остальные стадии без ожидания.
4. Перед сборкой Decision Pack: одна дешёвая перепроверка наличия валидного фрагмента (тот же index lookup, TARGET <= 10 ms, без ожидания и без ретраев).
5. Готов: overlay как обычно. Не готов: пакет собирается пустым по знанию, с честным `coverage_statement`.

Разделение двух ситуаций (определяется одним запросом при постановке build_request, вне горячего пути или с ограничением по времени выполнения):

- **A. Знание есть, фрагмент не собран**: VMY существует и по нему есть published claims. `build_request.reason = 'fragment_missing'`, `coverage = weak`, текст для пакета: знание по версии есть, но подготовка не завершена. Фоновый воркер собирает фрагмент, следующий Check по этой версии уже получит его.
- **B. Знания по версии нет**: VMY отсутствует или число published claims ниже порога. `build_request.reason = 'knowledge_missing'` плюс `identity_descriptor jsonb` (бренд, модель, год, рынок, движок, как их разрешил Identity Resolution). `coverage = none`. Это сигнал спроса для research: приоритет следующих версий берётся из счётчиков этой таблицы.

Новая таблица `mi.build_request`: `id PK`; `reason mi.build_reason NOT NULL` (enum: fragment_missing, knowledge_missing, invalidated); `vmy_id FK NULL`; `identity_descriptor jsonb NULL`; `purpose mi.pack_purpose NOT NULL`; `status mi.request_status NOT NULL` (queued, running, done, failed); `requested_count int NOT NULL DEFAULT 1`; `first_requested_at`, `last_requested_at`, `finished_at`; `error text`. UNIQUE (coalesce(vmy_id,0), purpose, reason) реализуется как **UNIQUE expression index** либо через сентинел `vmy_id` = 0 в отдельной колонке; выбран сентинел `vmy_key bigint GENERATED ALWAYS AS (COALESCE(vmy_id,0)) STORED` и обычный UNIQUE (vmy_key, purpose, reason). Индексы: `(status, last_requested_at)`.

SLO при промахе: MI-стадия добавляет только две пробы, одну запись в очередь и одну перепроверку, суммарно TARGET p95 <= 30 ms. Полторы секунды из v1 design удалены из горячего пути полностью: сборка фрагмента живёт только в фоне с собственным бюджетом (TARGET p95 <= 3 s на VMY).

## B.8. Отложенные таблицы (пункт 3)

- `mi.subject_closure`: **перенесена в FUTURE**. Множество кандидатов вычисляется рекурсивным CTE при сборке фрагмента и материализуется как `fragment_dependency` (тот же набор subjects плюс ревизии). Отдельная таблица дублировала бы его. Вернуть, если появится потребность в запросах «какие VMY зависят от subject» вне контекста фрагментов.
- `mi.component_relation`: **перенесена в FUTURE**. В v1 её роли покрыты: `retrofit_from` и `compatible_replacement` выражаются через `component_state_type.resulting_variant`; `shares_component_with` (насос PDCC и ГУР) выражается claim с `claim_link(role='related', target = variant ГУР)`. Вернуть, когда понадобится машинный вывод совместимости замен.

---

# C. Final CREATE NOW table inventory

Всего **52 таблицы**. Ни одна не выдумана «про запас»: для каждой указано, что сломается без неё до первого работающего Model Intelligence.

## C.1. Core canonical (16)

| Таблица | Без неё невозможно |
|---|---|
| `mi.knowledge_subject` | FK-целостность и точечная инвалидация |
| `mi.brand` | brand-level политики (допуск расхода масла BMW) |
| `mi.model_line` | навигация и scope алиасов |
| `mi.generation` | 15..20% знаний (испаритель G30, ручки Model S, пластик 958) |
| `mi.vehicle_version` | характер, сравнения, привязка Check |
| `mi.version_market_year` | комплектация, отзывы, окна, цены |
| `mi.component_family` | архитектурный контекст и наследование |
| `mi.component_variant` | 35..45% знаний и все ревизии |
| `mi.equipment_item` | опции и конфигурации как предикаты |
| `mi.entitlement` | права Tesla отдельно от железа |
| `mi.component_state_type` | гильзовка, реман-пак, ретрофиты |
| `mi.issue` | стабильный issue_key и связь с VM |
| `mi.maintenance_item` | четыре слоя обслуживания |
| `mi.check_item` | MUST/GOOD и verification gap |
| `mi.claim` | атомы знания |
| `mi.source` | provenance |

## C.2. Relation / support (11)

`mi.variant_attribute` (предикат Alusil), `mi.subject_alias` (N63R = TU2 = O2), `mi.version_fitment` (что стоит в VMY), `mi.equipment_visual_hint` (право Vision подтверждать), `mi.package_content` (ZDH содержит IAS), `mi.equipment_availability` (стандарт/опция/цена/SOP), `mi.check_covers` (один тест на несколько issues), `mi.claim_applicability` (предикаты), `mi.claim_link` (роли claims у issue и maintenance), `mi.claim_support` (gate для synthesis), `mi.evidence` (связь claim и source).

## C.3. Vocabulary lookups (10)

`mi.component_role` (плюс `is_replaceable`, `assumption_strength`), `mi.component_kind`, `mi.test_method`, `mi.service_kind`, `mi.link_role`, `mi.rejection_reason`, `mi.market`, `mi.attribute_key`, `mi.condition_tag`, `mi.fluid_spec`. Каждая от 5 до 40 строк, каждая используется как FK в предикат-критичных или поведенческих полях.

## C.4. Audit / publish (2)

`mi.knowledge_snapshot`, `mi.publish_batch`.

## C.5. Derived / performance (4)

`mi.recurrence_summary`, `mi.pack_fragment`, `mi.fragment_dependency`, `mi.knowledge_pack`.

## C.6. Staging (2)

`mi.candidate_claim`, `mi.candidate_evidence`.

## C.7. Operations (1)

`mi.build_request`.

## C.8. VM interface (6)

`mi_vm.resolved_identity`, `mi_vm.resolved_identity_dimension`, `mi_vm.component_state_instance`, `mi_vm.entitlement_state`, `mi_vm.measurement` (поле метода теперь FK на `mi.test_method`), `mi.decision_reason` (граничная таблица; может быть перенесена в слой отчётов, если так решит review Decision Engine).

## C.9. Deferred to FUTURE (дополнение к списку B design-документа)

`mi.subject_closure`, `mi.component_relation`, плюс ранее отложенные: coverage, research_task, claim_conflict, claim_embedding, render cache, refresh queue, claim_translation, агрегат `vmy_knowledge_rev`.

---

# D. Final enum vs lookup inventory

Правило: **enum**, если новое значение требует изменения кода компилятора или оценщика; **lookup**, если новое значение это новый вид автомобильного знания без изменения логики движка.

## D.1. Closed behavioral enums (20)

| Enum | Одно предложение обоснования |
|---|---|
| `subject_kind` | новый вид subject требует новой ветки FK-валидации и компилятора |
| `knowledge_type` | шесть типов зашиты в gates и рендер |
| `confidence` | три уровня участвуют в ранжировании и формулировках |
| `propagation` | оценщик кандидатов переключается по значению |
| `claim_status` | конечный автомат публикации |
| `practice_layer` | компилятор собирает ровно четыре слоя обслуживания |
| `causal_status` | gates проверяют заполненность по типам |
| `policy_status` | рендер добавляет оговорку «правило может измениться» |
| `value_kind` | задаёт схему валидации `structured_value` |
| `refresh_class` | очередь ревью строится по классам |
| `pred_operator` | каждая операция это ветка оценщика |
| `identity_dimension` | каждая размерность это ветка оценщика и резолвера |
| `config_slot` | factory/current/na определяют семантику предиката |
| `resolution_status` | четыре статуса определяют результат предиката |
| `visual_specificity` | определяет право Vision подтверждать |
| `fitment_kind`, `availability` | стандарт/опция/в пакете влияют на identity-дефолты |
| `state_kind` | компилятор различает замену, ретрофит и несанкционированную модификацию |
| `severity`, `sensitivity` | severity управляет verification gap, sensitivity управляет картой возраста |
| `stance` | supports/contradicts/context участвуют в recurrence и gates |
| `review_status`, `build_reason`, `request_status` | конечные автоматы staging и очереди |
| `binding`, `entitlement_status`, `equipment_change`, `equipment_kind`, `alias_kind`, `alias_scope`, `powertrain`, `priority`, `cover_role`, `reason_kind`, `reason_affects`, `performer`, `source_type`, `source_quality`, `access_status` | все участвуют в ветках gates, резолвера или компилятора |

## D.2. Extensible domain lookups (10)

| Lookup | Одно предложение обоснования |
|---|---|
| `mi.component_role` | новая роль (например fuel_cell_stack) это новое знание, плюс таблица несёт `is_replaceable` и `assumption_strength` как настраиваемые данные |
| `mi.component_kind` | классификация семейств расширяется вместе с рынком, логика не меняется |
| `mi.test_method` | новые методы проверки появляются по мере роста базы, компилятор работает с кодом как со строкой |
| `mi.service_kind` | новые виды обслуживания это предметное знание |
| `mi.link_role` | компилятор специально обрабатывает три кода (interval, contradicts, comparison_with), остальные это ярлыки группировки |
| `mi.rejection_reason` | список причин отказа растёт с опытом ревью |
| `mi.market` | рынки добавляются без изменения логики |
| `mi.attribute_key` | ключи структурных атрибутов вариантов предикат-критичны и должны быть под FK, но расширяемы |
| `mi.condition_tag` | климат, профиль эксплуатации и топливо расширяются без изменения оценщика |
| `mi.fluid_spec` | спецификации жидкостей переиспользуются между моторами |

## D.3. Устранённый словарь

`measurement_kind` не создаётся: `mi_vm.measurement.method_code` ссылается на `mi.test_method`, чем гарантируется совпадение метода проверки и метода измерения (borescope, battery_diagnostics, compression).

---

# E. Updated hot-path plan

Горячий путь Decision Pack, идентичность уже разрешена в рамках того же Check (объект в памяти):

| # | Запрос | План | TARGET p95 |
|---|---|---|---|
| 1 | `pack_fragment` по UNIQUE (vmy_id, purpose, locale, budget_profile, compiler_version) | index scan, чтение jsonb | 10 ms |
| 2 | валидность: `fragment_dependency` join `knowledge_subject` с условием неравенства ревизий, LIMIT 1 | index scan по (fragment_id) и nested loop по PK с covering index `(id) INCLUDE (knowledge_rev)` | 8 ms |
| 3 | проба готового пакета `knowledge_pack` по (identity_version, fingerprint) | index scan, чаще промах при первом Check, попадание при повторном рендере и в чате | 5 ms |
| 4 | VM-факты: `component_state_instance`, `entitlement_state`, `measurement` по vin | три index scan по (vin); объединяются в один вызов при желании | 10 ms суммарно |
| 5 | запись `knowledge_pack` | вне критического пути, после ответа | не считается |

**Честный счёт: 5 запросов в общем пути** (фрагмент, валидность, проба пакета, плюс VM как один объединённый вызов), **до 7**, если VM-чтения не объединять и если идентичность приходится читать из `resolved_identity` и `resolved_identity_dimension` отдельно (ещё 2). Число 6 из v1 design было подогнано.

Joins с реестром: ровно один и только в запросе валидности. Фрагмент и overlay работают по уже разрешённым `subject_id`, имена лежат в payload денормализованно. Ни одного join с `claim` или `claim_applicability` в runtime.

Overlay в приложении: оценка `vin_dependent` предикатов (порядок сотен), применение пяти результатов предиката из B.1, CONDITIONAL-политика, усечение, сериализация. TARGET p95 <= 150 ms на всю MI-стадию при попадании фрагмента и <= 30 ms при промахе (пункт 9).

Все цифры в этом разделе это **TARGET**, а не измеренная оценка; подтверждение только бенчмарком раздела F.

---

# F. Updated benchmark cardinalities

Разведение версий и VMY (в v1 design они смешивались):

| Величина | Продакшн v1 (50 глубоко покрытых версий) | Бенчмарк-корпус (10x) |
|---|---|---|
| vehicle_version | 50 | 500 |
| version_market_year | ~150 (2.5 MY × 1.2 рынка на версию) | 1,500 |
| generation | ~30 | 300 |
| component_variant | ~800 | 8,000 |
| claim (published) | ~12,500 | 100,000 |
| claim_applicability | ~8,000 | 250,000 |
| evidence | ~30,000 | 300,000 |
| source | ~4,000 | 30,000 |
| subject_alias | ~3,000 | 40,000 |
| version_fitment | ~1,800 | 25,000 |
| equipment_availability | ~15,000 | 200,000 |
| knowledge_subject | ~5,000 | 60,000 |
| pack_fragment (VMY × 4 purpose × 1 locale) | ~600 | 6,000 |
| fragment_dependency (~250 subjects на фрагмент) | ~150,000 | 1,500,000 |
| resolved_identity (тестовых) | 200 | 1,000 |

Locale в v1 только `en`: канонический текст английский, перевод выполняется на рендере, поэтому измерение locale во фрагментах не размножается.

Измеряемые пути и TARGET p50/p95: identity lookup 1/5 ms; fragment load 3/10 ms; validity check 2/8 ms; pack probe 2/5 ms; VM-факты 3/10 ms; overlay 15/60 ms; сборка и сериализация 10/40 ms; итог MI-стадии при попадании 35/120 ms; при промахе 10/30 ms; сборка фрагмента в фоне 800/3,000 ms; точечная инвалидация после публикации 5/30 ms.

Область действия бенчмарка не изменилась: он проверяет только latency, индексы, планы, поведение кэша и масштабируемость запросов и **не** подтверждает семантическую корректность. Зелёный бенчмарк не является quality GO.

---

# G. Remaining risks

1. **`assumption_strength = strong` для мотора, коробки и раздатки.** Это единственное содержательное суждение патча: оно сохраняет verification gap для эндоскопии BMW и Porsche, но формально ослабляет правило «assumed не равно confirmed» для трёх ролей. Откат это одна строка данных плюс одна строка правила.
2. **Страж публикации на Supabase.** Разделение ролей `mi_ingest` и владельца схемы требует, чтобы серверный код ходил не под ролью с полными правами. Если инфраструктурно это окажется невозможно, остаются триггер-страж и SECURITY DEFINER функция, то есть защита от случайной записи, но не от намеренной.
3. **Generated-колонки в `source` и `subject_alias`.** Выражения используют только immutable-функции (`coalesce`, `nullif`, `lower`, `btrim`, конкатенация), но это нужно подтвердить на конкретной версии PostgreSQL при первой миграции.
4. **Сентинелы дат** делают невозможным отличить «окно неизвестно» от «окно бесконечно». Для v1 это допустимо, потому что предикаты диапазонов интересует только пересечение; если понадобится различать, добавляется булева колонка, а не NULL.
5. **`fragment_dependency` как материализованная closure.** После отказа от `subject_closure` единственный способ ответить «какие VMY зависят от subject» это обратный индекс по этой таблице; для VMY без фрагмента ответа нет до первой сборки. Принято осознанно.
6. **Размер payload фрагмента** для purpose=report измеряется в бенчмарке; при выходе за разумные границы payload делится на секции (FUTURE).
7. **`mi.decision_reason` на границе.** Если Decision Engine получит собственное хранилище, таблица переедет туда; контракт кодов фиксируется при его реализации.
8. **Ambiguity алиасов** блокирует ingestion до ручного решения. Это правильно, но при массовом наполнении может стать узким местом ревью.

---

# H. Final acceptance

## H.1. Hardest worked examples

| Пример | Результат после патча |
|---|---|
| Tesla заменённый пак | без документа: claims PACK_85 в APPLICABLE_ASSUMED, claims PACK_90 в EXCLUDED_ASSUMED, MUST-check таблички; с документом: current confirmed, обычные APPLICABLE и EXCLUDED |
| Контрактный мотор BMW | VM-запись о замене переводит current в `unresolved`, а не в `assumed_factory`: claims TU2 в CONDITIONAL, gap невозможен, MUST-check номера мотора |
| ZF family против 8HP75 | без изменений: propagation descendants для симптомов и интервала, issue мехатроника с subject 8HP45/8HP70 и `exact` |
| Brand policy BMW | без изменений: subject brand, propagation descendants, предикат по `variant_attribute` |
| PDCC CONDITIONAL | без изменений; equipment теперь адресуется по `equipment_key`, а не по OEM-коду |
| Verification gap borescope | сохранён: engine получает basis assumed_strong, gap допустим, Score не меняется |
| Contested практика (холодный термостат) | без изменений; evidence-триггер теперь пересчитывает recurrence и при смене `pack_visible_hash` поднимает ревизию |
| Alias-конфликт N63TU1 | усилен: конфликт разрешается scope-уровнями, при равной специфичности возвращается AMBIGUOUS и ingestion блокируется |
| Premium Package между поколениями | новый случай, закрыт `equipment_key` с поколением в ключе и alias со `scope_kind=generation` |

## H.2. 47 golden tests

Поддержка сохранена. Формулировки ожиданий уточняются в трёх тестах из-за пункта 1:

- Тест 5 и 29 (Tesla, пак не наблюдался): ожидание меняется с «APPLICABLE с basis assumed_factory» на **APPLICABLE_ASSUMED**, плюс проверка наличия MUST-check с `resolves_dimension`.
- Тест 25 (LDU ревизия неизвестна): то же, **APPLICABLE_ASSUMED**.
- Тест 31: добавляется проверка, что claims LDU_U дают EXCLUDED_ASSUMED и не попадают в пакет.

Добавляются три регрессионных теста (итого 50):

- **48. Evidence invalidation**: добавление второй независимой owner-группы к published claim меняет `recurrence_class` с anecdote на repeated_pattern, поднимает `knowledge_rev` subject и делает фрагмент невалидным; добавление третьего источника той же группы не меняет `pack_visible_hash` и ревизию не поднимает.
- **49. Alias ambiguity**: «Premium Package» без контекста возвращает AMBIGUOUS с двумя кандидатами; с контекстом generation=G30 возвращает ровно один subject.
- **50. Fragment miss**: при отсутствии фрагмента MI-стадия не превышает TARGET 30 ms, создаёт `build_request` с корректным `reason`, а пакет получает `coverage = weak` или `none` без синхронной компиляции.

## H.3. Прочие проверки

- **Factory/current и assumed**: раздел B.1, таблица по пяти узлам, тесты 29, 30, 31, 32, 33.
- **Evidence invalidation**: раздел B.2, тест 48.
- **Inheritance isolation**: без изменений (propagation по умолчанию `exact`, механизма исключений нет), тесты 39..43; отказ от `component_relation` ничего не меняет, потому что наследование никогда через неё не шло.
- **Fragment-miss hot path**: раздел B.7, тест 50.

---

# GO TO MIGRATIONS

Критических проблем не осталось. **GO.**

Зафиксировано этим патчем и не подлежит импровизации при написании миграций: пять результатов предиката и пять статусов claim; `component_role` как lookup с `is_replaceable` и `assumption_strength`; evidence как единственная точка решения о bump; 52 таблицы в шести группах; сентинелы вместо NULL в окнах; generated-колонки в `source` и `subject_alias`; суррогатный PK плюс UNIQUE expression index в `resolved_identity_dimension`; четыре триггер-валидации cross-table; `equipment_key` как identity; scope-аware алиасы; публикация только через `mi.publish_candidate`; отсутствие синхронной компиляции в Check; 20 enum и 10 lookup.

Одно решение требует вашего кивка при первой миграции, но не блокирует её: `assumption_strength = strong` для engine, transmission, transfer_case и вытекающее расширение условия verification gap на `assumed_strong`.

Конец патча.
