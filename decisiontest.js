/* Decision Engine: валідація purchase_decision і контракт рендера.
   Битий висновок не валить звіт, а вмикає старий рендер verdict.summary. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
/* check.js імпортує score.js і auction.js: збираємо tmp-пакет як у e2e */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_dec_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of ['check.js', 'score.js', 'score-v3.js', 'auction.js', 'locale.js', 'visual-signals.js', 'share.js']) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

const VALID = {
  recommendation: 'go_see',
  headline: 'Їхати дивитись, але спершу два питання продавцю',
  summary_short: 'Ціна нижча за ринок через ДТП у США, але удар за фото некритичний. Історія пробігу логічна. Головна невідомість: якість відновлення SRS.',
  reasoning: 'Абзац один.\n\nАбзац два.',
  why_consider: ['Ціна нижча за ринок', 'Логічна хронологія пробігу'],
  main_concerns: ['Якість відновлення SRS не підтверджена'],
  must_check: ['SRS: подушки стріляли за аукціонним фото auction_event_1'],
  questions_for_seller: ['Чому пробіг у поточному оголошенні менший, ніж торік?'],
  value_context: 'Ціна виглядає нижчою за аналоги, і причина цьому: аукціонне минуле.',
  missing_but_important: ['Сервісної історії нема: попросити виписку з СТО'],
};

(async () => {
  const {
    sanitizePurchaseDecision, buildMileageContext, selectRecentReports, sanitizeBuyerContext,
    calibrateSeverityWording, humanizeDecisionJargon, applyDecisionLanguage, maxResolvedSeverity,
    RECENT_STRONG_DAYS, RECENT_MAX_DAYS,
  } = await import('file://' + path.join(dir, 'api', 'check.js'));
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

  /* 1. валідна структура проходить цілою */
  let out = sanitizePurchaseDecision(VALID, 6.5);
  if (!out || out.recommendation !== 'go_see' || out.why_consider.length !== 2) errs.push('валідне рішення покалічене');
  if (out.score_conflict) errs.push('go_see при 6.5 позначений конфліктом');

  /* 2. битий чи відсутній: null, звіт живе, рендер старий */
  for (const bad of [null, undefined, 42, 'text', [], {}, { recommendation: 'maybe' },
    { ...VALID, headline: '' }, { ...VALID, reasoning: null }, { ...VALID, summary_short: '   ' }]) {
    if (sanitizePurchaseDecision(bad, 6.5) !== null) errs.push('битий висновок пройшов: ' + JSON.stringify(bad).slice(0, 60));
  }

  /* 3. summary_short ріжеться по 400, списки по 8, сміття в списках відсіюється */
  out = sanitizePurchaseDecision({ ...VALID, summary_short: 'Д'.repeat(500), must_check: [...Array(12)].map((x, i) => 'пункт ' + i).concat([42, '', null]) }, 6.5);
  if (out.summary_short.length !== 400) errs.push('summary_short не обрізаний по 400: ' + out.summary_short.length);
  if (out.must_check.length !== 8) errs.push('must_check не обрізаний по 8: ' + out.must_check.length);

  /* 4. сумісність із балом: червоні прапорці */
  out = quiet(() => sanitizePurchaseDecision({ ...VALID, recommendation: 'skip' }, 8.4));
  if (!out.score_conflict) errs.push('skip при 8.4 без прапорця');
  out = quiet(() => sanitizePurchaseDecision({ ...VALID, recommendation: 'buy' }, 4.2));
  if (!out.score_conflict) errs.push('buy при 4.2 без прапорця');
  out = sanitizePurchaseDecision({ ...VALID, recommendation: 'buy' }, 8.8);
  if (out.score_conflict) errs.push('buy при 8.8 хибно позначений');

  /* 5. промпт: структура, стиль, заборони, узгодженість, два варіанти */
  const src = fs.readFileSync('api/check.js', 'utf8');
  for (const k of ['"purchase_decision"', 'recommendation": buy | go_see | negotiate | skip',
    'покупця-перекупника', 'без страхувальної ковдри', 'пасує будь-якому авто цієї моделі, це брак',
    'ПРИКЛАДИ СТИЛЮ МІРКУВАННЯ', 'decision_style', 'DECISION_STYLE',
    '"історія чиста", коли джерела історії не підтверджені, це брак']) {
    if (!src.includes(k)) errs.push('check.js: нема "' + k.slice(0, 40) + '"');
  }
  if (!/decisionStyle === 'a' \? DECISION_FEWSHOT : ''/.test(src)) errs.push('check.js: варіант B не вимикає few-shot');

  /* 6. рендер: шари, фолбек без порожніх секцій, рядки в словниках */
  const page = fs.readFileSync('result-check.html', 'utf8');
  for (const el of ['id="pdBlock"', 'id="pdHeadline"', 'id="pdShort"', 'id="pdMoreBtn"', 'id="pdReasoning"']) {
    if (!page.includes(el)) errs.push('result-check.html: нема ' + el);
  }
  if (!page.includes("if (pd && pd.headline)")) errs.push('result-check.html: нема гілки нового рішення');
  if (!page.includes("if (!(pd && pd.headline)) $('verdictCard').style.display = ''")) errs.push('result-check.html: фолбек на verdict.summary зламаний');
  if (!page.includes("$('vText').style.display = 'none'")) errs.push('result-check.html: старий текст не ховається при новому блоці');
  /* екран на v2 із фолбеком на легасі для старих звітів, підпис на місці */
  if (!page.includes('D.score_v2_preview')) errs.push('result-check.html: екран не читає score_v2_preview');
  if (!page.includes("typeof vd.score === 'number'")) errs.push('result-check.html: зник фолбек на легасі оцінку');
  if (!page.includes('Our assessment of the car based on the data we could verify.')) errs.push('result-check.html: нема пояснення оцінки в tooltip');
  for (const d of ['i18n/ru.js', 'i18n/ua.js']) {
    const dict = fs.readFileSync(d, 'utf8');
    for (const k of ['Read the full reasoning', 'Questions for the seller', 'What we could not verify', 'Our assessment of the car based on the data we could verify.']) {
      if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  /* ---- висновок зважує ризик + бажаність + цінність, а не лише ризики ---- */
{
  const src = fs.readFileSync('api/check.js', 'utf8');
  /* A/B: комплектація і ціна стають факторами рішення */
  if (!/ГОЛОВНЕ ПИТАННЯ ВИСНОВКУ/.test(src)) errs.push('нема вимоги відповісти "чи варто саме цей екземпляр"');
  for (const k of ['decision_positives', 'decision_negatives', 'decision_unknowns', 'deal_breakers', 'reasons_to_choose_this_car', 'conditions_that_change_decision']) {
    if (!src.includes(k)) errs.push('нема внутрішнього списку ' + k);
  }
  if (!/НЕ виводь ці списки у відповідь/.test(src)) errs.push('внутрішні списки не позначені як службові');
  if (!/шість питань/.test(src)) errs.push('нема шести обовʼязкових питань');
  /* C: комплектація не рятує поганий екземпляр -> deal_breakers існують */
  if (!/deal_breakers: те, що робить покупку нерозумною за будь-якої ціни/.test(src)) errs.push('нема семантики deal_breaker');
  /* B: опції не рівноцінні, лише підтверджені і найвагоміші */
  if (!/КОМПЛЕКТАЦІЯ ЯК ФАКТОР РІШЕННЯ/.test(src)) errs.push('комплектація не піднята до фактора рішення');
  if (!/Називай 3-7 найвагоміших ПІДТВЕРДЖЕНИХ опцій/.test(src)) errs.push('нема обмеження на кілька ключових опцій');
  if (!/value_tier high_value/.test(src)) errs.push('рішення не спирається на value_tier');
  /* F: нічого не вигадувати про рідкість */
  if (!/РІДКІСНІСТЬ на ринку стверджуй ЛИШЕ за наявними порівняльними даними/.test(src)) errs.push('дозволена вигадана рідкість');
  /* 3: заводське проти доробок */
  if (!/retrofit НЕ видавай за заводську комплектацію/.test(src)) errs.push('retrofit не відділений від заводської комплектації');
  if (!/НЕ означає "за машиною добре стежили"/.test(src)) errs.push('вкладені гроші прирівняні до догляду');
  /* D/5: бал не є вердиктом про покупку в обидва боки */
  if (!/ОЦІНКА CALCAR НЕ Є ВЕРДИКТОМ ПРО ПОКУПКУ/.test(src)) errs.push('бал досі трактується як вердикт покупки');
  if (!/низький бал = погана покупка/.test(src) || !/високий бал = хороша покупка/.test(src)) errs.push('нема заборони механічного мапінгу балу');
  /* 7: без перестраховки */
  if (!/не закінчуй кожен висновок універсальним/.test(src)) errs.push('нема заборони універсальної кінцівки');
  /* 9: структура виводу */
  if (!/СТРУКТУРА reasoning/.test(src)) errs.push('нема структури висновку');
  /* Score v3 не зачеплений цією ітерацією */
  const v3 = fs.readFileSync('api/score-v3.js', 'utf8');
  if (/equipment|price|value_tier/i.test(v3)) errs.push('комплектація або ціна протекли у Score v3');
}

  /* ================= ітерація "AI-помічник по вибору авто" =================
     Score v3 не змінюється: тут перевіряються ВХОДИ рішення (пробіг,
     профіль покупця, недавні авто), мова висновку і UI-контракти. */
  {
    const src = fs.readFileSync('api/check.js', 'utf8');
    const page = fs.readFileSync('result-check.html', 'utf8');
    const home = fs.readFileSync('check.html', 'utf8');
    const cab = fs.readFileSync('cabinet.html', 'utf8');
    const chat = fs.readFileSync('api/chat.js', 'utf8');

    /* ---- 6. пробіг як фактор рішення, а не число ---- */
    const milLow = buildMileageContext({
      odometer_km: 49000, age_months: 74, powertrain: 'petrol',
      historical_points: [{ km: 38000, date: '2024-05-01', source: 'auction_record' }],
    });
    if (!milLow || milLow.band !== 'low') errs.push('49к за 6 років не потрапили в низьку смугу: ' + (milLow && milLow.band));
    if (!milLow || milLow.annual_km > 8200 || milLow.annual_km < 7600) errs.push('річний пробіг порахований невірно: ' + (milLow && milLow.annual_km));
    if (!milLow.confirmed_by_history) errs.push('історична точка пробігу загублена');
    if (milLow.reference_km_year !== 12000) errs.push('референс petrol не з конфігу осі Пробіг: ' + milLow.reference_km_year);
    const milHigh = buildMileageContext({ odometer_km: 300000, age_months: 72, powertrain: 'petrol' });
    if (!milHigh || milHigh.band !== 'very_high') errs.push('300к за 6 років не у верхній смузі: ' + (milHigh && milHigh.band));
    if (milHigh.confirmed_by_history) errs.push('пробіг без історичних точок названий підтвердженим');
    const milNoAge = buildMileageContext({ odometer_km: 49000 });
    if (!milNoAge || milNoAge.band !== 'unknown' || milNoAge.annual_km !== null) errs.push('без віку смуга мала бути unknown');
    if (buildMileageContext({}) !== null) errs.push('без одометра контекст пробігу мав бути null');
    if (!/MILEAGE_CONTEXT/.test(src)) errs.push('промпт не отримує MILEAGE_CONTEXT');
    if (!/не пиши "49 000 км", пиши, що це означає/.test(src)) errs.push('нема вимоги пояснювати значення пробігу');

    /* ---- 11. профіль покупця: лише з наявної памʼяті, без вигадок ---- */
    if (sanitizeBuyerContext(null) !== null) errs.push('порожній профіль покупця не дав null');
    if (sanitizeBuyerContext({ note: '   ' }) !== null) errs.push('порожня нотатка пройшла як профіль');
    const bc = sanitizeBuyerContext({ note: 'Важлива динаміка \u2014 і зовнішній вигляд' });
    if (!bc || bc.source !== 'assistant_memory') errs.push('джерело профілю покупця не позначене');
    if (bc.note.includes('\u2014')) errs.push('довге тире не прибране з профілю покупця');
    if (!/BUYER_CONTEXT/.test(src)) errs.push('промпт не отримує BUYER_CONTEXT');
    if (!/Пріоритети покупця НЕ змінюють Оцінку CalCar/.test(src)) errs.push('G/H: пріоритети покупця не відокремлені від Score');
    if (!/Не додумуй уподобань, яких у профілі нема/.test(src)) errs.push('дозволено додумувати уподобання');
    if (!/BUYER_CONTEXT у контексті відсутній, про пріоритети покупця не згадуй/.test(src)) errs.push('без профілю модель не мовчить про пріоритети');

    /* ---- 12/13. недавні звіти: свіжість + релевантність ---- */
    const NOW = Date.parse('2026-09-01T00:00:00Z');
    const day = d => new Date(NOW - d * 86400000).toISOString();
    const cur = { title: 'BMW 5 Series 2020', vin: 'WBAJS1C06LCD15114', price: 33000 };
    const pool = [
      { title: 'BMW 5 Series 2019', vin: 'V1', created_at: day(3), price: 32000 },          /* I */
      { title: 'Toyota RAV4 2019', vin: 'V2', created_at: day(60), price: 32000 },          /* J */
      { title: 'BMW 5 Series 2016', vin: 'V3', created_at: day(700), price: 31000 },        /* K */
      { title: 'BMW 5 Series 2019', vin: 'V1', created_at: day(9), price: 32000 },          /* дубль VIN */
      { title: 'BMW 5 Series 2018', vin: 'WBAJS1C06LCD15114', created_at: day(2), price: 33000 }, /* та сама машина */
    ];
    const rec = selectRecentReports(pool, cur, NOW);
    if (!rec.some(r => r.title === 'BMW 5 Series 2019')) errs.push('I: релевантний свіжий BMW не потрапив у порівняння');
    if (rec.some(r => /RAV4/.test(r.title))) errs.push('J: нерелевантний звіт 2 місяці тому потрапив у порівняння');
    if (rec.some(r => r.days_ago > RECENT_MAX_DAYS)) errs.push('K: звіт старший за поріг потрапив у порівняння');
    if (rec.filter(r => r.title === 'BMW 5 Series 2019').length > 1) errs.push('дублі одного VIN не злиті');
    if (rec.some(r => r.title === 'BMW 5 Series 2018')) errs.push('поточне авто потрапило у власне порівняння');
    /* 31-90 днів: та сама марка з іншою ціною недостатньо, потрібен той самий вибір */
    const rec2 = selectRecentReports([{ title: 'BMW 3 Series 2015', vin: 'V9', created_at: day(45), price: 12000 }], cur, NOW);
    if (rec2.length) errs.push('J2: слабко релевантний звіт 45 днів тому не відсіяний');
    /* свіжий RAV4 з тією ж ціною теж не є вибором тієї ж людини по суті */
    if (selectRecentReports([{ title: 'Toyota RAV4 2020', vin: 'V8', created_at: day(3), price: 33000 }], cur, NOW).length) {
      errs.push('J3: близька ціна сама по собі зробила чуже авто релевантним');
    }
    if (selectRecentReports(pool, cur, NOW).length > 3) errs.push('порівнянь більше трьох');
    if (RECENT_STRONG_DAYS !== 30 || RECENT_MAX_DAYS !== 90) errs.push('пороги свіжості зʼїхали: ' + RECENT_STRONG_DAYS + '/' + RECENT_MAX_DAYS);
    if (!/RECENT_REPORTS/.test(src)) errs.push('промпт не отримує RECENT_REPORTS');
    if (!/Порівнюй НЕ балами, а по суті/.test(src)) errs.push('порівняння дозволене лише по балах');
    if (!/минулі звіти НЕ згадуй взагалі/.test(src)) errs.push('нема заборони порівняння без релевантного авто');

    /* ---- 4. мова про ДТП відповідає вирішеній тяжкості ---- */
    if (maxResolvedSeverity({ accident_events: [{ derived_severity: 'minor' }, { derived_severity: 'moderate' }] }) !== 'moderate') errs.push('максимальна тяжкість визначена невірно');
    if (maxResolvedSeverity({ accident_events: [{ derived_severity: 'indeterminate' }] }) !== 'indeterminate') errs.push('indeterminate загублений');
    if (maxResolvedSeverity({ accident_events: [] }) !== null) errs.push('без подій тяжкість мала бути null');
    const strongUa = 'Сильний фронтальний удар, наслідки тяжкого удару помітні.';
    if (/[Сс]ильний|тяжк/.test(calibrateSeverityWording(strongUa, 'minor', 'ua'))) errs.push('A: при легкому ДТП лишилось "сильний удар"');
    if (!/помітн/.test(calibrateSeverityWording(strongUa, 'moderate', 'ua'))) errs.push('moderate не отримав помірного формулювання');
    if (calibrateSeverityWording(strongUa, 'severe', 'ua') !== strongUa) errs.push('при тяжкому ДТП текст пом’якшили');
    if (calibrateSeverityWording(strongUa, 'indeterminate', 'ua') !== strongUa) errs.push('при невизначеній тяжкості текст переписали');
    const strongRu = 'Заметный фронтальный удар и сильные повреждения кузова.';
    const softRu = calibrateSeverityWording(strongRu, 'minor', 'ru');
    if (/сильны|заметн/.test(softRu)) errs.push('ru: драматичні формулювання лишились при легкому ДТП: ' + softRu);
    if (/ненезнач/.test(softRu)) errs.push('ru: подвійна заміна зіпсувала слово: ' + softRu);
    if (!/[Mm]inor/.test(calibrateSeverityWording('Severe front impact', 'minor', 'en'))) errs.push('en: severe не пом’якшений');
    if (!/ВАГА ФАКТОРІВ/.test(src)) errs.push('нема правила про вагу факторів у тексті');
    if (!/присвячувати левову частку висновку невеликому ДТП/.test(src)) errs.push('A: дозволено топити висновок у дрібному ДТП');
    if (!/ЯК ГОВОРИТИ ПРО ДТП/.test(src)) errs.push('нема семантики формулювань тяжкості');
    if (!/ЗАБОРОНЕНО виводити силу удару з самих лише слів "Front end"/.test(src)) errs.push('дозволено робити висновок про удар зі слова Front end');

    /* ---- 5/M. без внутрішнього жаргону в тексті для людини ---- */
    const jarg = humanizeDecisionJargon('Стан SRS невідомий, SRS не перевіряли, structural damage не підтверджено.', 'ua');
    if (/\bSRS\b/.test(jarg)) errs.push('M: SRS лишився в тексті для людини');
    if (!/подушок безпеки/.test(jarg)) errs.push('M: SRS не розкритий у родовому відмінку');
    if (/structural/i.test(jarg)) errs.push('M: structural лишився в тексті для людини');
    if (/\bSRS\b/.test(humanizeDecisionJargon('Состояние SRS неизвестно', 'ru'))) errs.push('M: SRS лишився в російському тексті');
    const pdLang = applyDecisionLanguage({
      recommendation: 'go_see', headline: 'Сильний удар спереду', summary_short: 'Стан SRS невідомий.',
      reasoning: 'Тяжкий удар видно на фото.', value_context: null,
      why_consider: ['Мала ціна'], main_concerns: ['SRS не перевірено'], must_check: ['Перевірити SRS'],
      questions_for_seller: [], missing_but_important: [],
    }, { severity: 'minor', lang: 'ua' });
    const allText = JSON.stringify(pdLang);
    if (/\bSRS\b/.test(allText)) errs.push('M: SRS лишився в полях рішення');
    if (/Сильний удар|Тяжкий удар/.test(allText)) errs.push('A: сильні формулювання лишились при легкому ДТП');
    if (!/МОВА ДЛЯ ЛЮДИНИ, НЕ ДЛЯ ІНЖЕНЕРА/.test(src)) errs.push('нема заборони внутрішнього жаргону в промпті');
    if (!/ЗАБОРОНЕНІ внутрішні технічні позначки: SRS/.test(src)) errs.push('SRS не заборонений явно');

    /* ---- 7. сильні сторони версії і двигуна ---- */
    if (!/СИЛЬНІ СТОРОНИ ВЕРСІЇ І ДВИГУНА/.test(src)) errs.push('нема блоку про сильні сторони версії');
    if (!/а не "найкращий двигун усіх часів"/.test(src)) errs.push('нема заборони рекламних гіпербол про двигун');
    if (!/Якщо версія рядова, не вигадуй їй переваг/.test(src)) errs.push('дозволено вигадувати переваги рядовій версії');

    /* ---- 10. ціна пояснює trade-off ---- */
    if (!/ЦІНА І ЦІННІСТЬ/.test(src)) errs.push('нема блоку ціни як цінності');
    if (!/не зупиняйся на "ціна середня"/.test(src)) errs.push('дозволено обмежитись "ціна середня"');

    /* ---- 22. жодних нових числових оцінок ---- */
    if (!/будь-які НОВІ числові оцінки, бали, відсотки привабливості/.test(src)) errs.push('нема заборони нових числових оцінок');
    if (/desirability_score|value_score|buyer_fit_score/i.test(src)) errs.push('зʼявився новий числовий бал');

    /* ---- проводка: контекст збирається ДО виклику і їде в промпт ---- */
    if (!/PROMPT\(listing, nhtsa, auction, langDirective, decisionStyle, auctionSearch, decisionContext\)/.test(src)) errs.push('decisionContext не переданий у промпт');
    if (!/const decisionContext = buildDecision|let decisionContext = null/.test(src)) errs.push('decisionContext не збирається в хендлері');
    if (!/decision_inputs: decisionContext/.test(src)) errs.push('_meta не зберігає входи рішення');
    if (!/applyDecisionLanguage\(parsed\.purchase_decision/.test(src)) errs.push('мова висновку не нормалізується після моделі');
    if (!/maxResolvedSeverity\(parsed\.score_breakdown\)/.test(src)) errs.push('нормалізація мови не спирається на вирішену тяжкість');

    /* ---- сторінка Check: профіль і недавні звіти беруться з наявних сховищ ---- */
    if (!/collectDecisionContext/.test(home)) errs.push('check.html не збирає контекст рішення');
    if (!/user_memory/.test(home)) errs.push('check.html не читає нотатку памʼяті');
    if (!/calcar_memory_reports/.test(home) || !/calcar_memory_reports/.test(cab)) errs.push('перемикач памʼяті у висновках не спільний для кабінету і Check');
    if (!/buyer_context/.test(home) || !/recent_reports/.test(home)) errs.push('check.html не шле профіль або недавні звіти');
    if (!/gte\('created_at', since\)/.test(home)) errs.push('check.html тягне звіти без вікна свіжості');
    if (!/id="memUse"/.test(cab)) errs.push('кабінет без перемикача памʼяті у висновках');

    /* ---- 18. CTA у чат: існуючий чат, без нового ---- */
    if (!/id="pdChatBtn"/.test(page)) errs.push('нема CTA "Обговорити це авто в чаті"');
    if (!/window\.calcarOpenChat/.test(page)) errs.push('CTA не використовує наявний чат');
    if (!/decision_inputs: M\.decision_inputs/.test(page)) errs.push('чат не отримує входи рішення');
    if (!/decision_inputs/.test(chat)) errs.push('api/chat.js не знає про входи рішення');

    /* ---- 19/20. UI: формат пробігу і бейдж власника ---- */
    if (!/\(≈' \+ esc\(nf\(monthlyKm\)\)/.test(page) || !/esc\(t\('km\/mo'\)\) \+ '\)<\/span>'/.test(page)) errs.push('19: місячний пробіг не в дужках');
    if (/">· ≈'/.test(page)) errs.push('19: крапка перед місячним пробігом лишилась');
    if (/\.hrow\.reg > span:not\(\.hd\)\{font-weight:600\}/.test(page)) errs.push('20: реєстраційні події досі жирні');
    const obIdx = page.indexOf('function ownerBadges');
    const obEnd = page.indexOf('\nfunction boot2');
    if (obIdx < 0 || obEnd < obIdx) errs.push('20: нема функції ownerBadges');
    else {
      const ownerBadges = new Function(page.slice(obIdx, obEnd) + '\nreturn ownerBadges;')();
      const badges = ownerBadges([
        { event: 'Перша реєстрація в Україні' },
        { event: 'Re-registration' },
        { event: 'Заміна номерного знака, перереєстрація' },
        { event: 'Перереєстрація: 2-й власник' },
        { event: 'Зміна власника' },
        { event: 'Продавалось на AUTO.RIA' },
      ]);
      if (badges[0] !== null || badges[1] !== null || badges[2] !== null) errs.push('L: технічна перереєстрація створила власника: ' + JSON.stringify(badges));
      if (badges[3] !== 2) errs.push('L: названий у записі номер власника не використаний: ' + badges[3]);
      if (badges[4] !== 3) errs.push('L: підтверджена зміна власника не пронумерована: ' + badges[4]);
      if (badges[5] !== null) errs.push('L: минуле оголошення прирівняне до зміни власника');
    }
    for (const d of ['i18n/ru.js', 'i18n/ua.js']) {
      const dict = fs.readFileSync(d, 'utf8');
      for (const k of ['Owner #{n}', 'Discuss this car in chat', 'Use memory in report conclusions']) {
        if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
      }
    }

    /* ---- B. ціна: чесна атрибуція розрахунку CalCar ---- */
    if (!/position_classifier: 'calcar_threshold'/.test(src)) errs.push('price_context не позначає, чия класифікація');
    if (!/delta_percent/.test(src)) errs.push('price_context без відсотка відхилення');
    if (!/смуга position \(below_average\/average\/above_average\) і delta_percent це РОЗРАХУНОК CalCar/.test(src)) errs.push('нема правила атрибуції position');
    if (!/ЗАБОРОНЕНО приписувати нашу смугу самій площадці/.test(src)) errs.push('дозволено видавати наш поріг за категорію площадки');
    if (/формулюй ВІД ІМЕНІ ПЛОЩАДКИ/.test(src)) errs.push('старе правило "від імені площадки" лишилось');

    /* ---- C. buyer personalization: три рівні ---- */
    if (!/HARD CONSTRAINTS: лише ЯВНО сформульовані обмеження/.test(src)) errs.push('нема рівня hard constraints');
    if (!/ТІЛЬКИ вони можуть виключати автомобіль/.test(src)) errs.push('виключати авто може не лише hard constraint');
    if (!/SOFT PREFERENCES:/.test(src) || !/ніколи не дають "пропустити"/.test(src)) errs.push('soft preferences можуть виключати авто');
    if (!/CURRENT CONSIDERATION: сам факт, що людина відправила ЦЕ авто на перевірку/.test(src)) errs.push('нема правила current consideration');
    if (!/Поточна дія сильніша за стару памʼять/.test(src)) errs.push('стара память сильніша за поточну дію');
    if (!/ЗАБОРОНЕНО писати "ця машина вам не підходить"/.test(src)) errs.push('дозволено "не підходить вам" без hard constraint');
    if (!/не зводь її недавні звіти в один жорсткий профіль/.test(src)) errs.push('recent reports зводяться в один профіль');
    if (!/пропонує інший сценарій/.test(src)) errs.push('нема сценарної рамки замість відмови');

    /* ---- Score v3 і ретривал цією задачею не змінювались ---- */
    const v3 = fs.readFileSync('api/score-v3.js', 'utf8');
    if (/buyer_context|recent_report|decision_positives/i.test(v3)) errs.push('контекст покупця протік у Score v3');
  }

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('валідація структури · битий висновок дає старий рендер · 400/8 ліміти · сумісність із балом · промпт і два стилі · словники');
  console.log('DECISION TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
