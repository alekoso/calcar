# Заливка еталонних карток у Model Intelligence (Phase 3)

Тут лежать ДАНІ, а не міграції. Схему ці файли не змінюють і до продакшну
самі по собі не застосовуються.

## Порядок і спосіб запуску

Файли подаються psql **однією сесією** у порядку номерів. Помічники
завантаження живуть у `pg_temp` і зникають разом із сесією, тому подавати
файли поодинці не можна.

```bash
cat data/mi/reference/*.sql | psql -v ON_ERROR_STOP=1 -d "$TARGET_DB"
```

| Файл | Що робить |
|---|---|
| `000_loader.sql` | тимчасові помічники: реєстрація subject за природним ключем, створення джерела, постановка кандидата, читабельні предикати |
| `100_entities_bmw.sql` | граф сутностей BMW M550i xDrive G30 MY2018 US |
| `101_entities_tesla.sql` | граф сутностей Tesla Model S P85D MY2015 |
| `102_entities_porsche.sql` | граф сутностей Porsche Cayenne GTS 958.1 MY2013 |
| `110_sources.sql` | 198 джерел із реєстрів трьох карток |
| `114_equipment_bmw_530i.sql` | Equipment v1: 21 позиція обладнання BMW 530i xDrive US MY2018 з офіційного прайсу (S-G-OFF-02), пакети на VMY, аліаси, візуальні ознаки; наявні сутності бере за природними ключами (`pg_temp.adopt`), тому заливається і окремо поверх продакшн-каталогу; потребує міграції 027 |
| `120_candidates_bmw.sql` | 115 кандидатів зі 103 атомів |
| `121_candidates_tesla.sql` | 67 кандидатів із 49 атомів |
| `122_candidates_porsche.sql` | 54 кандидати з 42 атомів |
| `125_buyer_metadata.sql` | Phase 3.2: важливість для покупця і buyer-текст кожного атома з поля `buyer_implication` картки |
| `130_publish.sql` | перевірка якості для кожного кандидата, публікація, опори синтезу |
| `140_reclassified.sql` | Phase 3.1: перекласифікація заблокованого знання, де тип або формулювання були сильніші за джерела |

## Картки каталогу (MI Catalog)

Картки каталогу додаються тими самими правилами, своїми файлами між
наявними номерами і з власною літерою префікса `task_ref`. Публікація
іде через наявний `130_publish.sql`; синтез картки отримує опори і
публікується у своєму файлі після 130. Контракт:
`docs/model-intelligence/catalog-contract.md`.

| Файл | Картка |
|---|---|
| `103_entities_bmw_530i.sql`, `111_sources_bmw_530i.sql`, `123_candidates_bmw_530i.sql`, `131_synthesis_bmw_530i.sql` | картка 1: BMW 530i xDrive G30 B48 (B46B20O0), US MY2017-2020, префікс `G`; звіт `docs/model-intelligence/catalog-card-1-bmw-530i-xdrive.md` |
| `104_entities_tesla_model_3.sql`, `112_sources_tesla_model_3.sql`, `124_candidates_tesla_model_3.sql`, `132_synthesis_tesla_model_3.sql` | картка 2: Tesla Model 3 Long Range AWD (pre-Highland), US MY2018-2023, префікс `M`; звіт `docs/model-intelligence/catalog-card-2-tesla-model-3.md`; у продакшні з 2026-09-14 |
| `105_entities_hyundai_tucson.sql`, `113_sources_hyundai_tucson.sql`, `126_candidates_hyundai_tucson.sql`, `133_synthesis_hyundai_tucson.sql` | картка 3: Hyundai Tucson TL 2.4 GDI Theta II, US MY2018-2021, префікс `H`; звіт `docs/model-intelligence/catalog-card-3-hyundai-tucson.md`; у продакшні з 2026-09-15 |

## Що тут можна і чого не можна

Прямо вставляються ЛИШЕ сутності каталогу: бренд, ряд, покоління, версія,
версія x ринок x рік, родини і варіанти компонентів, обладнання, права,
проблеми, обслуговування, перевірки, типи стану компонента, аліаси,
джерела. Це ідентичність, а не знання.

Кожне ТВЕРДЖЕННЯ про ці сутності йде через `mi.candidate_claim`, проходить
`mi.run_gate` і публікується лише через `mi.publish_candidate`. Прямий
INSERT опублікованого клейма відхиляє сторож із міграції 010.

Правило gate не послаблюється заради того, щоб еталонні дані пройшли, і
жодна публікація не робиться через override. Заблокований кандидат
лишається у staging зі збереженим `gate_result`.

## Трасування

`mi.candidate_claim.task_ref` несе ідентифікатор атома картки
(`C-051`), а для розщеплених атомів ще й суфікс (`C-049#a`). Це постійна
трасування: карту покриття можна перерахувати в будь-який момент однією
вибіркою по `task_ref`, без тимчасових таблиць.

Карта покриття: `docs/model-intelligence/backload-reference-map.md`.
Розбір заблокованого знання: `docs/model-intelligence/blocked-knowledge-reconciliation.md`.
Заморожені картки: `docs/model-intelligence/reference/`.

Перекласифікований кандидат несе суфікс `-r1` або `#r1` у `task_ref`, а
старий заблокований кандидат лишається у staging із запискою, хто його
замінив. Атом при цьому не змінюється, і тест це перевіряє.

## Тест

```bash
MI_TEST_DB_URL=postgres://localhost/calcar_mi_test node mibackloadtest.js
MI_TEST_DB_URL=postgres://localhost/calcar_mi_test node micatalogtest.js
```

Тест рахує матеріальні атоми з самих заморожених карток, а не з константи,
і падає, якщо хоч один атом не має кандидата.
