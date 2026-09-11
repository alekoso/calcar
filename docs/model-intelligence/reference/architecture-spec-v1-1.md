# CalCar Model Intelligence: Architecture Specification v1.1

Дата: 2026-09-11. Статус: для ручного review. Без SQL, без кода, без миграций. Базируется на v1; ниже только изменения, обновлённый Core и затронутые приложения. Незатронутые приложения v1 (A, E, F, I, K, L, M, N, O) действуют без изменений, кроме мест, явно перечисленных в разделе A.

---

# A. Что изменилось относительно v1

| # | Тема | v1 | v1.1 |
|---|---|---|---|
| 1 | Инвалидация кэша | новый глобальный snapshot помечает stale все пакеты | dependency-aware: у каждого knowledge subject есть `knowledge_rev`; пакет хранит dependency fingerprint; глобальный snapshot остаётся только для audit и воспроизведения |
| 2 | Наследование claims | family-claim применяется ко всем variants, пока нет `not_applicable_transfer` | `not_applicable_transfer` удалён; у claim явная `propagation ∈ {exact, descendants, family_context}`, default `exact`; знание не спускается на ревизии без явного разрешения |
| 3 | Логика applicability | названа DNF при семантике «OR внутри группы, AND между группами» | терминология исправлена: claim = `all_of` групп, группа = `any_of` предикатов; статусы MATCH/NO_MATCH/UNKNOWN и APPLICABLE/EXCLUDED/CONDITIONAL сохранены |
| 4 | Идентичность | одно значение на измерение | для заменяемых ролей два слота: `factory` и `current`; current не выводится из factory молча |
| 5 | Конфликты идентичности | только confidence | у каждого измерения `resolution_status ∈ {confirmed, assumed_factory, conflicted, unresolved}`; production LLM конфликт не разрешает |
| 6 | Hot path | «компиляция дешёвая, кэш опционален» | latency это требование: предкомпилированные фрагменты по VMY + VIN-overlay; SLO и план бенчмарка |
| 7 | Частота проблем | `frequency_class` у issue выводился из recurrence | `frequency_class` удалён из Issue v1; `evidence_recurrence` (anecdote / repeated_pattern / strong_consensus) отделена от `prevalence`, которая в v1 всегда unknown без знаменателя |
| 8 | Gate known_issue | допускал owner-only при ≥ 3 группах | known_issue только official ИЛИ primary specialist + независимая owner-корроборация; owner-only живёт как owner_pattern без потери статуса знания |
| 9 | Brand-claims | synthetic family BMW_ENGINE_POLICY | subject brand / model_line разрешены для редких genuine-знаний; synthetic families запрещены |
| 10 | Полиморфные ссылки | subject_type + subject_id | выбран вариант B: реестр `knowledge_subject` с настоящими FK; он же несёт `knowledge_rev` для кэша |
| 11 | `claim.evidence_type` | canonical поле | удалено; provenance только в evidence/source; для ранжирования derived `evidence_summary` |
| 12 | Dedup | `dedup_key` по subject + смыслу | ключ включает knowledge_type, layer, подпись applicability и kind структурного значения; сходные claims разных типов связываются, не сливаются |
| 13 | CONDITIONAL | порог по importance | importance ≥ порога И (разрешимо доступной проверкой ИЛИ условие само материально для решения); лимит на систему; группировка по нерешённому измерению |
| 14 | Приёмка | 28 golden tests | back-loading перепроверен под новые правила; 47 golden tests (добавлены factory/current, cache, inheritance, vision, verification gap) |
| 15 | Check items и confidence | «MUST не выполнен -> снижает confidence» | формализованный verification gap с четырьмя условиями и reason code; Score никогда не зависит от наличия проверки |
| 16 | Vision как evidence идентичности | confidence medium давал MATCH | specificity-классы DEFINITIVE / STRONG / AMBIGUOUS / NOT_VISUALLY_RESOLVABLE; AMBIGUOUS никогда не резолвит equipment_present |

# B. Что осталось без изменений

Граница MI / VM; список canonical entities (без добавлений; `knowledge_subject` это реестр ссылок, а не сущность знаний); шесть knowledge_type; три уровня confidence; поля causal_status / contested / policy_status; supersession и knowledge_snapshot для audit; ingestion pipeline (Appendix F) и refresh-классы (L); композиция отчёта по системному профилю (I); coverage (K); scaling на Postgres без graph DB (M); план миграции (N); worked examples (O) с поправками, перечисленными в D.6; принципы: structured DB canonical, LLM не решает applicability, applicability никогда не расширяется.

---

# C. Core Specification v1.1

## C.1. Назначение и граница

Без изменений относительно v1: MI знает, что означает компонент/ревизия/опция/право/ремонт/практика/проблема; VM знает, что наблюдалось у VIN; связь через Identity Resolution и Knowledge Pack Compiler. Три неизменных принципа: structured DB как единственный canonical store; LLM никогда не получает сырую базу и не решает applicability и конфликты идентичности; applicability claim никогда не расширяется из-за неопределённости.

## C.2. Canonical entities и реестр subjects

Сущности знаний те же, что в v1 §2: generation, vehicle_version, version_market_year, component_family, component_variant (ревизия = variant с `revision_of`), component_alias, equipment_item, entitlement, component_state_type, issue, maintenance_item, check_item, claim, source/evidence, knowledge_snapshot. Дополнительно допускаются subjects `brand` и `model_line` для редких genuine brand-level знаний (политики производителя, общебрендовые регламенты); synthetic families для таких знаний запрещены.

Все subjects регистрируются в **`knowledge_subject`** (реестр: id, kind, ссылка на строку сущности, `knowledge_rev`, `updated_at`). Все ссылки «на что-то, о чём знание» (claim.subject, check_item.target/scope, issue.subject, claim_applicability.ref, claim_link.target) это FK на реестр. Обоснование и сравнение вариантов в Appendix S.

## C.3. Applicability (терминология исправлена)

Claim применим, если выполнены **все группы** (`all_of`), где каждая группа выполнена, если выполнен **любой из её предикатов** (`any_of`). Предикат оценивается против Resolved Identity как MATCH / NO_MATCH / UNKNOWN; группа: MATCH если есть MATCH, NO_MATCH если все NO_MATCH, иначе UNKNOWN; claim: APPLICABLE (все группы MATCH), EXCLUDED (хотя бы одна NO_MATCH), CONDITIONAL (нет NO_MATCH, есть UNKNOWN).

**Неявная applicability и propagation.** Пустые предикаты означают «subject и то, что разрешает `propagation`»:

- `exact` (default): только сам subject. Для variant: только этот variant (и только VMY, где он стоит по fitment). Для family: никакой variant; claim виден только в Component Pack самого family.
- `descendants`: subject и его ревизионные потомки (`revision_of`-дерево) или, для family, все variants семейства. Требует явного решения ревьюера и обоснования в `propagation_note`.
- `family_context`: claim о family (или brand/model_line) показывается на variants/versions как архитектурный контекст: importance ограничена 2, статус APPLICABLE_CONTEXT, никогда не рендерится как issue или факт о конкретной ревизии.

Applicability не зависит от наличия «исключений»: чтобы знание попало на ревизию, оно должно быть либо о ней, либо явно разрешено вниз.

**Factory vs current.** Для заменяемых ролей (battery_pack, drive_unit_*, mcu, modem, charger, engine, transmission, transfer_case, suspension_system, brake_system, retrofit-able equipment, entitlements) identity хранит два слота: `factory` (VIN/декодер/build sheet/fitment по умолчанию) и `current` (VM component_state_instance, документы, диагностика, DEFINITIVE Vision). Предикаты по умолчанию оцениваются по `current`; `config_scope=factory` указывается явно (например, для отзывов по заводской конфигурации). Если `current` не наблюдался и нет признаков замены, измерение получает значение factory со статусом `assumed_factory` (см. C.5), и это отражается в пакете как допущение, а не факт.

## C.4. Claim и evidence

Поля claim как в v1 §4 со следующими изменениями: удалено `evidence_type` (provenance живёт только в evidence/source; при публикации считается derived `evidence_summary`: множество типов источников и число независимых групп, используется для ранжирования и gates, пересчитывается при изменении evidence); добавлены `propagation`, `propagation_note`, `config_scope` на предикатах; `dedup_key` определяется как hash(normalized_assertion, subject_id, knowledge_type, layer, applicability_signature, value_kind). Owner intelligence: у owner_pattern/owner_practice есть `evidence_recurrence` с классом anecdote / repeated_pattern / strong_consensus, выводимым из независимых групп; **prevalence в v1 не хранится и не выводится**: без знаменателя реальная частота = unknown, и ни recurrence, ни число VM-наблюдений не рендерятся как доля парка.

## C.5. Vehicle Identity Resolution

Выход: измерения `{dimension, slot ∈ {factory, current, na}, value, confidence, resolution_status, provenance[], resolved_at}`.

`resolution_status`:

- `confirmed`: одно значение, подтверждённое источником с достаточной специфичностью (VIN-декодер для generation/version/vmy; build sheet или VIN-опции для factory equipment; VM-документ, диагностика или DEFINITIVE Vision для current).
- `assumed_factory`: current-слот не наблюдался, замена не зафиксирована, значение взято из factory; допустимо только для заменяемых ролей.
- `conflicted`: два источника одного слота с достаточной специфичностью дают разные значения (build sheet против документа дилера о заводской комплектации; диагностика против DEFINITIVE Vision о текущем узле). Расхождение factory против current это не конфликт, а признак замены/ретрофита: оба слота сохраняются.
- `unresolved`: нет достаточного источника.

Оценка предикатов: `confirmed` -> MATCH/NO_MATCH; `assumed_factory` -> MATCH/NO_MATCH с пометкой `basis=assumed_factory` на claim-статусе; `conflicted` и `unresolved` -> UNKNOWN. Production LLM не видит источники конфликта и не выбирает между ними; конфликт попадает в пакет как строка identity_summary «CONFLICTED: ...» и порождает check_item на разрешение.

Vision участвует в identity только через specificity (C.8).

## C.6. Knowledge Pack Compiler и hot path

Runtime-латентность это требование первого класса. Для prebuilt-версий компилятор работает в два уровня:

1. **Version fragment** (offline, при публикации): для каждого (VMY, purpose, locale, budget_profile) заранее вычисляются все claims, чьи предикаты разрешимы из VMY (generation, version, vmy, production window внутри MY, fitment по умолчанию для factory-слотов), с уже применёнными supersession, dedup, importance и предварительной сортировкой. Хранится с dependency fingerprint.
2. **VIN overlay** (online): оцениваются только предикаты, зависящие от VIN-идентичности (equipment_present/absent, component_state_present, current-слоты заменяемых ролей, entitlement_state, market_operated, mileage, age, condition_tags, production_date точнее MY); результат: переключение статусов claims фрагмента (APPLICABLE -> EXCLUDED/CONDITIONAL и обратно для claims, зависящих от этих измерений), добавление state-/entitlement-специфичных claims, CONDITIONAL-политика, финальное усечение по бюджету, identity_summary и лог оценок.

Fallback: если фрагмента нет (long-tail версия), полная компиляция online с тем же контрактом, но с более коротким бюджетом и пометкой coverage.

**SLO (первые 30..50 версий, Decision Pack):** overlay p95 ≤ 150 ms и p99 ≤ 300 ms при тёплом фрагменте; чтение фрагмента из кэша ≤ 30 ms; полная online-компиляция (fallback) p95 ≤ 1.5 s; добавка ко времени Check от всей стадии MI ≤ 200 ms p95 при наличии фрагмента; offline-построение фрагмента ≤ 5 s на VMY. Report Pack: overlay p95 ≤ 400 ms. План бенчмарка в Appendix H.5.

**Кэш и инвалидация (dependency-aware).** Каждый `knowledge_subject` несёт `knowledge_rev`, увеличиваемый при публикации/supersession любого claim, link, check_item, applicability-строки или relation, где этот subject участвует. Фрагмент и пакет хранят `dependency_set` = {subject_id: knowledge_rev} по всем subjects, чьи claims были оценены (включая исключённые по предикатам, потому что смена предиката может их вернуть), плюс identity_version, compiler_version, purpose, locale, budget_profile. Fingerprint = hash(dependency_set + эти параметры). Пакет валиден, пока текущие `knowledge_rev` всех subjects из dependency_set равны сохранённым. Изменение знания о Tesla MCU не трогает revs subjects M550i, значит фрагменты и пакеты M550i остаются валидными. Глобальный `knowledge_snapshot` при этом создаётся при каждой публикации и записывается в пакет для audit и воспроизведения старых отчётов, но не участвует в проверке валидности.

**CONDITIONAL-политика.** APPLICABLE: обычный кандидат. CONDITIONAL включается только если `buyer_importance ≥ порога purpose` (Decision 4, Report 3) И выполнено одно из: (а) нерешённое измерение разрешимо check_item, который присутствует в пакете (build sheet, табличка пака, кнопка PDCC, документ о ретрофите), или (б) условие само материально для решения (catastrophic/major severity или крупная стоимость, где покупатель должен знать, что вопрос открыт). Все CONDITIONAL группируются по нерешённому измерению с одной строкой «как разрешить»; лимит 3 группы на систему в Decision Pack. Низкая importance отбрасывается; перечисление проблем всех возможных ревизий запрещено конструкцией.

## C.7. Runtime interfaces, Score и Decision Confidence

Интерфейсы как в v1 §7. Уточнение взаимодействия check_items со Score и Decision Confidence:

- Generic слабость модели из MI никогда не снижает объективный Score VIN.
- Невыполненный check_item никогда не является evidence дефекта и не становится observed risk.
- Обычное отсутствие рекомендованной проверки не снижает Decision Confidence.
- **Verification gap** фиксируется только при одновременном выполнении четырёх условий: (1) underlying issue APPLICABLE со статусом confirmed (не assumed, не conditional); (2) buyer impact issue high/catastrophic; (3) состояние именно этого компонента нельзя достаточно оценить другими доступными evidence VM; (4) проверка материально разрешает именно эту неопределённость. Gap не меняет Score, не становится риском, снижает Decision Confidence ограниченно (не более одной ступени на все gaps вместе) и имеет reason code с объяснением (`VG_<issue_key>_<check_method>`).
- Выполненная чистая проверка повышает Decision Confidence, потому что уменьшает неопределённость, с оговоркой cannot_prove из check_item; Score не меняется от самого факта проверки, а только от того, что она обнаружила.
- Отдельный пользовательский confidence score не вводится: Decision Confidence остаётся внутренней величиной Decision Engine с текстовой реплиcой.

Примеры в Appendix J.3.

## C.8. Vision как evidence идентичности

Каждый visual_hint у equipment_item/version имеет класс специфичности:

- **DEFINITIVE**: читаемый логотип/текст, уникальный физический орган управления, напрямую видимое оборудование или его функция, иной уникально идентифицирующий признак.
- **STRONG**: комбинация нескольких специфичных признаков, явно разрешённая visual_hints этого equipment_item как достаточная.
- **AMBIGUOUS**: цвет, generic-отделка, стиль колёс или обвес сами по себе, одиночный неуникальный признак.
- **NOT_VISUALLY_RESOLVABLE**: только VIN/build sheet/диагностика.

Правила: DEFINITIVE и разрешённый STRONG резолвят `equipment_present` в слоте current со статусом confirmed; AMBIGUOUS остаётся unresolved (кандидат для проверки), NOT_VISUALLY_RESOLVABLE не создаёт измерения. Vision описывает current-конфигурацию, build sheet описывает factory; расхождение между ними это два слота, а не конфликт; конфликт возникает только внутри слота (например, диагностика против DEFINITIVE Vision) и возвращает `conflicted`. Version никогда не устанавливается по обвесу или суппортам: только VIN/декодер (плюс check_item подлинности).

## C.9. Что не строится в v1.1

Как в v1 §8 плюс: prevalence/incidence любого вида (только «observed N times» в VM с покрытием); автоматическое разрешение конфликтов идентичности; global-snapshot-based invalidation как единственный механизм.

---

# D. Затронутые приложения

## D.1. Appendix B (concept data model): дельты

- Новый реестр **`knowledge_subject`**(id, kind ∈ {brand, model_line, generation, version, vmy, family, variant, equipment, entitlement, state_type, issue, maintenance_item, check_item, comparison}, entity_id, knowledge_rev bigint, updated_at). Каждая сущность-subject имеет `subject_id` (1:1, UNIQUE). Все ссылки «subject/target/ref» это FK на реестр.
- `claim`: удалено `evidence_type`, `sentiment` окончательно удалён (не использовался); добавлены `propagation`, `propagation_note`, derived `evidence_summary jsonb`, `dedup_key` по новой формуле.
- `claim_applicability`: `owner_subject_id` FK; `group_no` (all_of), предикаты в группе (any_of); добавлен `config_scope ∈ {current, factory}` (default current); `ref_subject_id` FK на реестр вместо (ref_type, ref_id).
- `issue`: удалены `frequency_class`, `frequency_computed_at`; добавлено derived `evidence_recurrence` (класс + число групп + computed_at).
- `component_relation.relation_kind`: удалён `not_applicable_transfer`.
- `knowledge_pack` и новый **`pack_fragment`**(id, vmy_id, purpose, locale, budget_profile, compiler_version, payload, dependency_set jsonb, fingerprint, built_at, valid bool): overlay читает fragment, пишет pack с собственным dependency_set (fragment.dependency_set ∪ subjects overlay).
- VM-сторона: `resolved_identity.dimensions[]` получают `slot` и `resolution_status`; `vision_observation` (существующий Vision) экспортирует `specificity_class` по visual_hint.
- `visual_hint` (внутри equipment_item.visual_hints и version) получает поле `specificity` и для STRONG список допустимых комбинаций.

## D.2. Appendix C (applicability): переписанные правила и примеры

### D.2.1. Правила

1. Claim = `all_of` групп; группа = `any_of` предикатов. Оценка как в C.3.
2. Пустые предикаты = subject + propagation. Fitment используется для отображения variant-claims на VMY только тогда, когда роль в identity имеет значение этого variant (factory или current по config_scope); при `assumed_factory` MATCH с basis.
3. Предикат `component_variant` с `include_revisions=true` оценивается по `revision_of`-дереву значения identity, а не по дереву subject; это единственный способ «сказать» claim о нескольких ревизиях без propagation.
4. Range-предикаты при частично известном значении: полностью внутри -> MATCH; пересекается -> UNKNOWN.
5. Лог оценок пишется в пакет: {claim_id, status, basis, predicates:[{group, dimension, slot, expected, observed, status_of_dimension, result}]}.
6. Нет операции ослабления предиката; более широкое знание = другой claim.

### D.2.2. Примеры propagation

- **Early N63 timing chain.** Claims об удлинении цепей и направляющих: subject variant N63B44O0 с `propagation=exact` (второй claim о TU1 отдельно, если evidence есть). На N63B44O2 ничего не попадает без каких-либо исключений: variant-claims TU2 «цепи: подтверждённой актуальности нет» (specialist, subject N63B44O2) и есть то, что видит M550i.
- **N63 hot-V architecture.** Subject family N63, `propagation=family_context`: на всех N63-variants появляется как архитектурный контекст (importance 2, статус APPLICABLE_CONTEXT, рендер «архитектурная особенность семейства»), никогда как issue.
- **Alusil family context.** Атрибут `cylinder_bore_technology=Alusil` хранится на variant (структурный факт, скопированный из family при регистрации variant и подтверждённый источником ревизии: TU2 official training, M48.02 LN). Family-claim «Alusil-цилиндры подвержены задирам» имеет `family_context`. Check_item «эндоскопия всех цилиндров MUST» не наследуется через propagation, а имеет предикат `variant_attribute cylinder_bore_technology = Alusil` (any_of): попадает и на N63B44O2, и на M48.02, и не попадает на N63B44T3 (LDS) и B58.
- **ZF family maintenance.** Claim «симптомы старого ATF: задержка на холодную, зависание» subject family ZF_8HP, `propagation=descendants` с note «общая гидромеханика семейства; подтверждено specialist для 8HP45/50/70/75»; claim «ZF: первая замена 80,000..150,000 km» subject family ZF_8HP, `descendants`. Issue «течь втулки мехатроника» subject variants 8HP45 и 8HP70 (`exact` каждый); на 8HP75 не попадает, потому что не о нём, а не потому, что кто-то создал исключение.
- **Brand policy (бывший C-031).** Subject brand BMW, official_fact «допуск расхода до 1 qt/750 mi для не-M моторов», `propagation=descendants`, предикат `component_family.kind = engine AND tag != m_engine` (одна группа any_of на список семейств или атрибут `performance_division=M` как NO_MATCH). Единственный тип brand-level claims: политики и общебрендовые регламенты.

### D.2.3. Примеры factory vs current

- **Tesla battery.** Factory: PACK_85_GEN1 (fitment, confirmed по VMY). Current: если VM не содержит state и табличка не читалась: `assumed_factory` -> claims batterygate/chargegate APPLICABLE с basis=assumed_factory; identity_summary: «ASSUMED FACTORY: тяговая батарея 85 kWh Gen1, признаков замены нет»; check_item «табличка пака / документы замены» MUST. Если VM: `component_state_instance(pack_new_90_locked, документы)` -> current PACK_90_LOCKED confirmed -> chargegate EXCLUDED, PACK_90_LOCKED claims APPLICABLE; factory-слот сохраняет PACK_85 для claims с `config_scope=factory` (например, история batterygate как факт биографии, importance низкая).
- **Tesla LDU.** Factory LDU_PRE_U; current: документ Tesla о замене на «-U» -> confirmed LDU_U -> issue течи ротора EXCLUDED (subject LDU_PRE_U, exact), claims LDU_U APPLICABLE; без документа: assumed_factory -> issue APPLICABLE (basis assumed) + check speed sensor MUST.
- **Tesla MCU.** Factory MCU1; current из Vision DEFINITIVE (интерфейс MCU2, наличие Netflix/YouTube на экране в кадре) -> confirmed MCU2; из документов о ретрофите -> confirmed; иначе assumed_factory MCU1.
- **Swapped engine (BMW).** Factory N63B44O2 по VIN; VM: «контрактный мотор, ревизия неизвестна» -> current variant unresolved (известно только family N63) -> variant-claims TU2 CONDITIONAL с условием «если установлен мотор той же ревизии», family_context остаётся, check «номер двигателя и ревизия» MUST. Если документ подтверждает N63B44O2 -> confirmed.
- **Retrofit equipment (Porsche PCCB / BMW MCU2 у Tesla аналогично).** Factory: build sheet без PCCB; current: Vision DEFINITIVE (жёлтые суппорты с надписью PCCB) -> current PCCB confirmed, factory «нет» сохраняется; это не конфликт, а ретрофит: state_type `pccb_retrofit` порождается как кандидат, claims PCCB APPLICABLE по current.

### D.2.4. Пример конфликта

Build sheet Cayenne: пневмоподвеска (factory confirmed). Диагностика: блока пневмо в сети нет, PASM-стойки стальные (current confirmed «steel»). Это два слота: current = steel_pasm, factory = air; state «конверсия на пружины» кандидат; не конфликт. Конфликт: диагностика говорит «пневмо активна», а DEFINITIVE Vision показывает пружины и отсутствие кнопки уровня -> current `conflicted` -> предикаты UNKNOWN -> claims пневмо и стали CONDITIONAL, identity_summary «CONFLICTED: подвеска», check_item «осмотр на подъёмнике» MUST. LLM не выбирает.

## D.3. Appendix D (claim/evidence): дельты

- `evidence_type` удалён из claim. `evidence_summary` (derived при публикации и при изменении evidence): {source_types: set, independent_groups: n, has_official: bool, has_primary_specialist: bool, contradicting_groups: n}. Используется gates, ранжированием, рендером формулировок; не редактируется вручную.
- **Recurrence против prevalence.** `evidence_recurrence` у owner-claims и у issue (derived по owner-claims issue): anecdote (≤ 1 группа), repeated_pattern (≥ 3 групп в ≥ 2 площадках или ≥ 2 рынках), strong_consensus (≥ 5 групп, specialist_support, contradicting ≤ 1). Это свойство доказательств, не парка. `prevalence` в v1 отсутствует; в рендере допустимы только формы «единичные случаи», «повторяющийся паттерн владельцев», «устойчивый консенсус» и, для VM, «наблюдалось N раз среди M проверенных машин с покрытием этой категории» без процентов и без слов common/rare. FUTURE: prevalence только при знаменателе с покрытием.
- **Dedup.** `dedup_key = hash(normalized_assertion, subject_id, knowledge_type, layer, applicability_signature, value_kind)`. `normalized_assertion`: канонизированный текст без чисел-значений (значения сравниваются структурно) и без источников. Слияние только при равном ключе: остаётся claim с большей confidence, evidence переносится. Сходные утверждения с разными knowledge_type/layer или разной applicability не сливаются, а связываются `claim_link(role=related)`; так official «lifetime», specialist «80..150k» и owner «80..160k» остаются тремя claims.

## D.4. Appendix G (gates): дельты

| knowledge_type | v1.1 минимум |
|---|---|
| known_issue | issue существует с механизмом; **official** (бюллетень, отзыв, продление, кампания) **ИЛИ** (≥ 1 primary specialist с описанием механизма/ремонта **И** ≥ 2 независимых owner-групп с контекстом); applicability по ревизии подтверждена источником о ревизии; propagation exact, если не доказано иное |
| owner_pattern | ≥ 2 групп -> low; ≥ 3 -> medium; high только при specialist_support или official; owner-only знание с strong_consensus остаётся owner_pattern, может иметь importance до 4 и участвовать в synthesis наравне с known_issue |
| остальные | как в v1; вдобавок: claim с `propagation=descendants` требует `propagation_note` и источник, покрывающий потомков; brand/model_line subject допускается только для official_fact/policy и calcar_synthesis о политике |

## D.5. Appendix H (retrieval, pack, hot path): дельты

### H.1. Двухуровневая компиляция

Фрагмент строится offline на публикации для prebuilt VMY по всем purpose/locale/budget_profile (для 50 VMY это порядка 50 × 4 purpose × 3 locale = 600 фрагментов, объём каждого до нескольких десятков KB). Содержимое: список claims с предварительным статусом по VMY-разрешимым предикатам и флагом `vin_dependent` (какие измерения ещё нужны), issues, check_items, maintenance слои, states-каталог для ролей, importance, порядок. Overlay online: только `vin_dependent` claims переоцениваются; остальные принимаются как есть.

### H.2. Кэш

Ключ пакета: hash(identity_version, fragment.fingerprint, compiler_version, purpose, locale, budget_profile). Валидность: сравнение `dependency_set` пакета с текущими `knowledge_rev` (один запрос по списку subject_id). Инвалидация точечная: публикация claim о MCU1 поднимает rev subjects {MCU1, issue eMMC, ...}; фрагменты/пакеты, чьи dependency_set содержат эти subjects (Tesla), становятся невалидными; M550i не затронут. Публикация generation-claim G30 инвалидирует все G30-версии, что корректно. Stale-пакет Decision/Report не отдаётся; Chat, привязанный к отчёту, использует пакет того отчёта по snapshot (консистентность разговора).

### H.3. Audit против runtime

Audit: `knowledge_snapshot` (монотонный, при каждой публикации), claim.snapshot_id, pack.snapshot_id; воспроизведение отчёта = чтение claims «как на snapshot N». Runtime: `knowledge_rev` per subject и dependency fingerprint. Сосуществование: snapshot это глобальные часы для истории; rev это локальные часы для валидности; пакет хранит оба.

### H.4. CONDITIONAL-политика

Как в C.6; дополнительно: CONDITIONAL по `assumed_factory` не существует (это APPLICABLE с basis); CONDITIONAL по `conflicted` всегда включается с importance ≥ 3, потому что конфликт сам по себе материален.

### H.5. План бенчмарка

Синтетический корпус: 300,000 claims, 2,000 subjects, 50 prebuilt VMY по 20 identities с разной полнотой (полная, без опций, с состояниями, с конфликтом). Измеряется: (1) построение фрагмента на VMY; (2) overlay p50/p95/p99 при тёплом кэше; (3) валидация fingerprint (один запрос по ≤ 200 subject_id); (4) fallback полной компиляции для long-tail; (5) планы запросов: индексы `claim_applicability(owner_subject_id)`, `(dimension, ref_subject_id)`, `claim(subject_id, status)`, `knowledge_subject(id, knowledge_rev)`; (6) размер пакета по purpose в токенах. Порог принятия: SLO из C.6 на инстансе класса текущего Supabase; при провале сначала сужать overlay (меньше vin_dependent предикатов за счёт более ранней фиксации фрагмента), затем денормализация статусов во фрагменте, только затем кэш второго уровня.

## D.6. Appendix J (интерфейсы): check items, confidence, Vision

### J.1. Reason codes

`VERIFIED_CLEAN_<check>`: проверка выполнена, результат чистый; повышает Decision Confidence; cannot_prove переносится в текст. `OBSERVED_<issue_key>`: VM-evidence симптома/кода/состояния; влияет на Score. `VG_<issue_key>_<check>`: verification gap по четырём условиям; снижает Decision Confidence ограниченно. `IDENTITY_CONFLICT_<dimension>`: снижает Decision Confidence, порождает check. `ASSUMED_FACTORY_<role>`: не снижает; отображается как допущение.

### J.2. Условия verification gap (повтор для Decision Engine)

(1) issue APPLICABLE и basis confirmed; (2) severity high/catastrophic; (3) в VM нет иных evidence о состоянии этого компонента (нет свежей эндоскопии, нет CAN-снимка в сроке годности, нет документа о замене); (4) check_item `check_covers` именно этот issue и помечен `materially_resolves=true`. При невыполнении любого условия отсутствие проверки не меняет ничего, кроме чек-листа.

### J.3. Примеры

- **BMW M550i, чистая эндоскопия (VM: measurement borescope, 8 цилиндров, дата в сроке).** Issue задиров APPLICABLE (basis confirmed по VIN -> TU2 -> Alusil). Score: без изменений от факта проверки; Decision Confidence: вверх (`VERIFIED_CLEAN_borescope`), текст: «стенки цилиндров без задиров на дату осмотра; проверка не защищает от будущих условий эксплуатации». Risk «задиры» переходит из checklist в «проверено».
- **BMW M550i, эндоскопии нет.** Условия: (1) да; (2) catastrophic; (3) иных evidence нет; (4) borescope materially_resolves. Verification gap `VG_n63_alusil_bore_scoring_borescope`: Score без изменений, observed risk не создаётся, Decision Confidence минус одна ступень максимум (суммарно по всем gaps), чек-лист MUST с объяснением «единственный способ увидеть задир до покупки».
- **Cayenne GTS, эндоскопия выполнена и чиста.** Аналогично BMW: confidence вверх, Score прежний.
- **Cayenne GTS, эндоскопии нет, но VM содержит свежий анализ масла без металла и историю расхода масла «ноль».** Условие (3) частично выполнено иными evidence? Нет: анализ масла и фильтр не исключают задиры (cannot_prove из check_item fluid_analysis), значит (3) остаётся истинным -> gap фиксируется. Если же VM содержит документ сервиса об эндоскопии месяц назад с фото -> (3) ложно -> gap не фиксируется, проверка переходит в «подтверждено документом» с confidence по provenance.
- **Защита от «все машины low-confidence».** Gap возможен только для issues с confirmed applicability и high/catastrophic impact, при отсутствии любых иных evidence, и суммарно снижает не более чем на одну ступень; наличие 15 GOOD-проверок в чек-листе на Decision Confidence не влияет.

### J.4. Vision specificity: примеры

| Наблюдение | Класс | Результат |
|---|---|---|
| Решётки Bowers & Wilkins с логотипом в двери | DEFINITIVE | equipment B&W current confirmed |
| Кнопки вентиляции сидений с пиктограммой | DEFINITIVE | ventilation confirmed |
| Проектор HUD на панели в кадре | DEFINITIVE | HUD confirmed |
| Синие суппорты | AMBIGUOUS | ничего не резолвит; не устанавливает M550i и не устанавливает M Sport Brakes без DEFINITIVE признака (надпись M на суппорте плюс 4-поршневая форма может быть объявлена STRONG-комбинацией в visual_hints M Sport Brakes) |
| Обвес M5 / GTS | AMBIGUOUS | version только по VIN; check_item подлинности |
| Integral Active Steering | NOT_VISUALLY_RESOLVABLE | только VIN/build sheet/диагностика |
| Кнопка регулировки уровня подвески на консоли Cayenne | DEFINITIVE | air suspension current confirmed |
| Кнопка PDCC | DEFINITIVE, если visual_hints подтверждают уникальность пиктограммы | PDCC confirmed |
| Жёлтые суппорты с надписью PCCB | DEFINITIVE | PCCB confirmed |
| Интерфейс MCU2 на экране в кадре | DEFINITIVE | MCU2 current confirmed |

Risk #12 из v1 закрыт этим правилом.

## D.7. Appendix P (reference back-loading): повторная проверка

Изменения при повторном отображении атомов:

- Каждому claim присвоена `propagation`: почти все `exact`; `family_context`: C-024 (hot-V), family-claims Alusil (C-052, P-009), T-010-подобное знание о классе LDU не создавалось (subject уже variant); `descendants`: ZF family symptoms (C-082), ZF interval (C-080), brand-policy C-031, Tesla family-level «пак дышит через сапуны» (T-025: остаётся exact на PACK_85_GEN1, потому что источник о нём).
- C-031 переведён на subject brand BMW (без synthetic family).
- Issue-атрибут frequency удалён: C-051 (задиры) хранит evidence_recurrence anecdote/repeated (3 группы, 3 рынка -> repeated_pattern) и severity catastrophic; в рендере «редкие подтверждённые случаи», без слов о доле парка. T-010 (LDU) хранит recurrence strong_consensus (specialist support: конструктивное изменение Tesla) без prevalence.
- C-040 (колпачки TU2, агрегаторные оценки) остаётся known_issue? По новому gate: official нет, primary specialist нет, owner-групп нет -> понижается до `owner_pattern` с confidence low и importance 2; buyer-текст «случаи не образуют паттерна» сохраняется как calcar_synthesis.
- P-020 (задиры 958 через пересказ Rennlist): known_issue сохраняется, потому что есть primary specialist (LN Engineering) плюс owner-корроборация ≥ 2 групп по пересказу; confidence medium.
- T-024 (BMS_u029), T-025 (конденсат), T-026 (изоляция): specialist + owner -> known_issue сохраняется; T-013 (milling) остаётся owner_pattern.
- Все identity-атомы получили слоты: Tesla T-006, T-028, T-050, T-053: роли с factory/current; BMW/Porsche роли engine/transmission/transfer_case: factory = current assumed_factory по умолчанию.
- `evidence_type` из ledger переносится в evidence/source, не в claim.
- Итог: все атомы трёх карточек представимы без спец-логики; brand-level claim теперь штатный; синтетические families отсутствуют.

## D.8. Appendix Q (golden tests v1.1)

Сохранены тесты 1..28 из v1 с правками: №16 переформулирован: «ZF family issue мехатроника EXCLUDED, потому что subject это 8HP45/8HP70 с exact» (без not_applicable_transfer); №5 и №25 используют basis=assumed_factory (см. ниже); №10 проверяет CONDITIONAL-политику (PDCC разрешим check_item -> включается).

Добавлены:

FACTORY vs CURRENT
29. P85D, VM без state: current battery = assumed_factory PACK_85_GEN1; chargegate APPLICABLE с basis=assumed_factory; identity_summary содержит строку ASSUMED FACTORY; check «табличка пака» MUST.
30. P85D, VM state pack_new_90_locked (документ): current confirmed PACK_90_LOCKED; chargegate EXCLUDED; factory-слот PACK_85 сохранён; claim с config_scope=factory (история batterygate как биография) APPLICABLE с низкой importance.
31. P85D, документ Tesla о LDU «-U»: течь ротора EXCLUDED; без документа: APPLICABLE basis assumed + speed sensor MUST.
32. M550i с VM «контрактный мотор, ревизия неизвестна»: TU2 variant-claims CONDITIONAL, family_context N63 присутствует, check «ревизия мотора» MUST.
33. Cayenne с build sheet air + диагностика steel: не conflicted; current steel confirmed, factory air; state-кандидат «конверсия»; claims пневмо EXCLUDED по current.

IDENTITY CONFLICT
34. Cayenne: диагностика «пневмо активна» + DEFINITIVE Vision «пружины, нет кнопки уровня» -> suspension conflicted; claims пневмо и стали CONDITIONAL; IDENTITY_CONFLICT reason; пакет не содержит источников конфликта для выбора.
35. M550i: VIN-опции без DHP, документ дилера с DHP -> factory conflicted -> IAS claims CONDITIONAL, check build sheet MUST.

CACHE INVALIDATION
36. Публикация claim о MCU1 (Tesla): fingerprint фрагмента M550i/US/2018 не меняется; пакеты M550i валидны.
37. Публикация generation-claim G30 (испаритель): фрагменты всех G30 VMY невалидны, Tesla/Porsche не затронуты.
38. Публикация нового snapshot без изменений subjects M550i (только Porsche): audit snapshot растёт, M550i пакеты валидны; старый отчёт M550i воспроизводится по своему snapshot.

INHERITANCE NEGATIVE
39. Family-claim N63 без propagation (exact): не появляется на N63B44O2.
40. Family_context hot-V на TU2: статус APPLICABLE_CONTEXT, importance ≤ 2, не в issues.
41. Early N63 timing chain (subject O0 exact): отсутствует на O2 даже при отсутствии любых «исключающих» записей.
42. Check borescope по атрибуту Alusil: присутствует на N63B44O2 и M48.02, отсутствует на N63B44T3 и B58.
43. ZF descendants-claim о симптомах ATF: присутствует на 8HP75 и 8HP50; issue мехатроника 8HP45: отсутствует на 8HP75.

VISION SPECIFICITY
44. Vision: синие суппорты medium confidence -> equipment M Sport Brakes остаётся unresolved; версия M550i не устанавливается.
45. Vision: логотип B&W DEFINITIVE -> B&W confirmed current; build sheet без B&W -> factory «нет», retrofit-кандидат, не конфликт.
46. Vision: обвес GTS на Cayenne S по VIN -> version остаётся S; check подлинности MUST.

VERIFICATION GAP
47. M550i без эндоскопии и без иных evidence -> VG_bore_scoring; Score равен Score той же машины с чистой эндоскопией; Decision Confidence различается на одну ступень; при наличии 15 невыполненных GOOD-проверок confidence не меняется дополнительно.

## D.9. Appendix R (риски): дельты

Закрыты: #12 (Vision) правилом C.8; #8 (Chat подтягивает EXCLUDED) уточнением: Chat Pack строится только из claims с вычисленным статусом. Изменён #2: «пустые Decision Pack» смягчены assumed_factory (заводская конфигурация как явное допущение) и CONDITIONAL-политикой. Новые риски: (a) неверно выставленный `propagation=descendants` даёт тихий перенос: gate требует note и источник, ревью обязателен; (b) `assumed_factory` может маскировать замену без документов у Tesla (LDU менялись у многих): смягчение через MUST-проверки табличек и через VM-агрегаты как research-сигнал, но не как prevalence; (c) фрагменты по (VMY × purpose × locale × budget) растут комбинаторно: при росте числа locale/purpose перейти к фрагменту без locale (перевод на рендере) [FUTURE]; (d) dependency_set пакета может быть большим (сотни subjects): проверка валидности одним запросом по массиву id укладывается в SLO по плану бенчмарка, иначе агрегировать rev на уровне VMY (`vmy_knowledge_rev` как max по dependency_set, инвалидируемый чаще, но дешевле) [FUTURE].

## D.10. Новое Appendix S: полиморфные ссылки

| Критерий | A. subject_type + subject_id | B. реестр knowledge_subject с FK | C. A + триггеры/валидация |
|---|---|---|---|
| Referential integrity | нет (сироты возможны, удаление сущности не каскадится) | полная: FK на реестр, реестр FK/1:1 на сущность | частичная: триггеры дублируют логику FK и ломаются при новых kind |
| Сложность schema | минимальная | +1 таблица и по одной колонке subject_id в 13 сущностях | средняя, плюс код триггеров на каждую сущность |
| Сложность ingestion | низкая, но ошибки id невидимы | низкая: создание сущности создаёт subject-строку (в приложении или триггером на insert одной таблицы) | средняя |
| Сложность retrieval | join по CASE на тип: планировщик не использует FK, фильтры по (type,id) индексируются составным индексом | один тип ссылки: `claim.subject_id`, `applicability.ref_subject_id`; имена/kind через один join с реестром и далее с сущностью только при рендере | как A |
| Масштаб до сотен тысяч claims | нормально по индексам, но целостность деградирует с ростом | нормально; реестр порядка десятков тысяч строк | как A с накладными на триггеры |
| Влияние на Pack Compiler | компилятор оперирует парами (type,id); dependency_set гетерогенный | компилятор оперирует subject_id; dependency_set это список id; `knowledge_rev` живёт в реестре, что закрывает требование #1 без второй структуры | как A |
| Hot-path cost | фильтр по составному индексу; без дополнительного join | overlay читает claims по subject_id из фрагмента; join с реестром нужен только для проверки rev (один запрос по массиву id) и для имён при рендере; лишний join отсутствует в критическом пути | как A плюс стоимость триггеров на записи |

Выбор: **B**. Trade-off: одна дополнительная таблица и дисциплина «сущность всегда с subject-строкой» против гарантированной целостности, единообразных ссылок в applicability и естественного места для `knowledge_rev`. Стоимость join с реестром в hot path не предполагается нулевой: план бенчмарка измеряет проверку валидности по массиву id отдельно; ожидаемая стоимость это index-only scan по PK на ≤ 200 id. Вариант A отвергнут из-за молчаливых сирот при supersession и удалениях; C из-за дублирования логики целостности в триггерах.

---

# E. GO / NO-GO для перехода к Schema v1

**GO с условиями.** Модель выдерживает три эталонные карточки без brand-specific escape hatches; опасное наследование убрано; идентичность различает заводское и текущее и не разрешает конфликты в LLM; кэш инвалидируется точечно; owner-знание сохранено как полноценный тип без псевдостатистики; hot path имеет измеримый SLO.

Условия до Schema v1 (не блокируют проектирование схемы, но должны быть закрыты до её утверждения):

1. Утвердить пороги CONDITIONAL-политики по purpose (Decision 4 / Report 3) и лимит групп на систему после прогона на трёх карточках вручную.
2. Утвердить набор `vin_dependent` измерений для overlay и состав фрагмента (что фиксируется offline, что online).
3. Утвердить список заменяемых ролей с двумя слотами и правило `assumed_factory` по типам силовой установки.
4. Провести бенчмарк по Appendix H.5 на синтетическом корпусе до финализации индексов схемы.
5. Ревью visual_hints с классами специфичности для опций трёх карточек (список STRONG-комбинаций).

Конец v1.1.
