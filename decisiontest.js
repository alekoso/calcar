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
for (const x of ['check.js', 'check-schema.js', 'current-visual.js', 'canonical-merge.js', 'score.js', 'score-v3.js', 'score-v4.js', 'confidence.js', 'vision-reliability.js', 'auction.js', 'locale.js', 'visual-signals.js', 'share.js', 'vehicle-memory.js', 'mi-shadow.js', 'mi-equipment.js', 'historical-claims.js', 'history-owners.js', 'youtube.js']) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

const VALID = {
  recommendation: 'go_see',
  headline: 'Їхати дивитись, але спершу два питання продавцю',
  summary_short: 'Ціна нижча за ринок через ДТП у США, але удар за фото некритичний. Історія пробігу логічна. Головна невідомість: якість відновлення SRS.',
  reasoning: 'Абзац один.\n\nАбзац два.',
  questions_for_seller: ['Чому пробіг у поточному оголошенні менший, ніж торік?', 'Чи є документи на ремонт SRS?'],
  value_context: 'Ціна виглядає нижчою за аналоги, і причина цьому: аукціонне минуле.',
  missing_but_important: ['Сервісної історії нема: попросити виписку з СТО'],
};

(async () => {
  const {
    sanitizePurchaseDecision, buildMileageContext, objectiveDecisionContext,
    calibrateSeverityWording, humanizeDecisionJargon, applyDecisionLanguage, maxResolvedSeverity,
  } = await import('file://' + path.join(dir, 'api', 'check.js'));
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

  /* 1. валідна структура проходить цілою */
  let out = sanitizePurchaseDecision(VALID, 6.5);
  if (!out || out.recommendation !== 'go_see' || out.questions_for_seller.length !== 2) errs.push('валідне рішення покалічене');
  for (const dead of ['why_consider', 'main_concerns', 'must_check']) if (dead in out) errs.push('мертве поле ' + dead + ' повернулось у purchase_decision');
  if (out.score_conflict) errs.push('go_see при 6.5 позначений конфліктом');

  /* 2. битий чи відсутній: null, звіт живе, рендер старий */
  for (const bad of [null, undefined, 42, 'text', [], {}, { recommendation: 'maybe' },
    { ...VALID, headline: '' }, { ...VALID, reasoning: null }, { ...VALID, summary_short: '   ' }]) {
    if (sanitizePurchaseDecision(bad, 6.5) !== null) errs.push('битий висновок пройшов: ' + JSON.stringify(bad).slice(0, 60));
  }

  /* 3. summary_short ріжеться по 400, списки по 8, сміття в списках відсіюється */
  out = sanitizePurchaseDecision({ ...VALID, summary_short: 'Д'.repeat(500), questions_for_seller: [...Array(12)].map((x, i) => 'пункт ' + i).concat([42, '', null]) }, 6.5);
  if (out.summary_short.length !== 400) errs.push('summary_short не обрізаний по 400: ' + out.summary_short.length);
  if (out.questions_for_seller.length !== 8) errs.push('questions_for_seller не обрізаний по 8: ' + out.questions_for_seller.length);

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
    'ПРИНЦИПИ РІШЕННЯ', 'decision_style', 'DECISION_STYLE',
    '"історія чиста", коли джерела історії не підтверджені, це брак']) {
    if (!src.includes(k)) errs.push('check.js: нема "' + k.slice(0, 40) + '"');
  }
  if (!/decisionStyle === 'a' \? DECISION_PRINCIPLES : ''/.test(src)) errs.push('check.js: варіант B не вимикає принципи рішення');
  if (/DECISION_FEWSHOT|ПРИКЛАДИ СТИЛЮ МІРКУВАННЯ/.test(src)) errs.push('check.js: старий конфліктний few-shot повернувся');

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
  if (!page.includes('An assessment of this specific car based on confirmed data about its history, condition, mileage and other available facts.')) errs.push('result-check.html: нема пояснення оцінки в панелі');
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

    /* ---- 11. висновок обʼєктивний: контекст рішення лише з фактів про авто ----
       (повні сценарії в objectivereporttest.js) */
    if (objectiveDecisionContext({}) !== null) errs.push('порожній обʼєктивний контекст не дав null');
    const oc = objectiveDecisionContext({ mileage: { band: 'low' }, buyer: { note: 'бюджет 30 тисяч' }, recent: [{ title: 'x' }] });
    if (!oc || Object.keys(oc).join() !== 'mileage') errs.push('обʼєктивний контекст пропустив особисте: ' + JSON.stringify(oc));
    if (/BUYER_CONTEXT|RECENT_REPORTS/.test(src)) errs.push('промпт досі знає про BUYER_CONTEXT/RECENT_REPORTS');
    if (!/ОБʼЄКТИВНІСТЬ ВИСНОВКУ: висновок оцінює ЛИШЕ сам автомобіль/.test(src)) errs.push('нема правила обʼєктивності висновку');

    /* ---- проводка: контекст збирається ДО виклику і їде в промпт ---- */
    if (!/PROMPT\(listing, nhtsa, auction, langDirective, decisionStyle, auctionSearch, decisionContext, cvEvidence\)/.test(src)) errs.push('decisionContext не переданий у промпт');
    if (!/const decisionContext = buildDecision|let decisionContext = null/.test(src)) errs.push('decisionContext не збирається в хендлері');
    if (!/decision_inputs: decisionContext/.test(src)) errs.push('_meta не зберігає входи рішення');
    if (!/applyDecisionLanguage\(parsed\.purchase_decision/.test(src)) errs.push('мова висновку не нормалізується після моделі');
    /* resolved severity живе у breakdown v3; при активному v4 він у тіні */
    if (!/maxResolvedSeverity\(parsed\.score_breakdown && parsed\.score_breakdown\.score_version === 'v4' \? parsed\.score_breakdown_shadow : parsed\.score_breakdown\)/.test(src)) errs.push('нормалізація мови не спирається на вирішену тяжкість');

    /* ---- сторінка Check: у звіт ідуть лише адреса і мова ---- */
    if (/collectDecisionContext|user_memory|buyer_context|recent_reports|calcar_memory_reports/.test(home)) errs.push('check.html досі збирає особистий контекст для звіту');
    if (!/body: JSON\.stringify\(\{ url, lang: window\.calcarLang\(\) \}\)/.test(home)) errs.push('check.html шле в /api/check щось крім адреси і мови');
    /* перемикач "памʼять у висновках звітів" прибраний: памʼять у висновки не йде взагалі */
    if (/id="memUse"|calcar_memory_reports/.test(cab)) errs.push('кабінет досі обіцяє памʼять у висновках звітів');

    /* ---- 18. CTA у чат: існуючий чат, без нового ---- */
    if (!/id="pdChatBtn"/.test(page)) errs.push('нема CTA "Обговорити це авто в чаті"');
    if (!/window\.calcarOpenChat/.test(page)) errs.push('CTA не використовує наявний чат');
    if (!/decision_inputs: M\.decision_inputs/.test(page)) errs.push('чат не отримує входи рішення');
    if (!/decision_inputs/.test(chat)) errs.push('api/chat.js не знає про входи рішення');

    /* ---- 19/20. UI: формат пробігу і бейдж власника ---- */
    /* формат змінено: місячний пробіг стоїть поруч без дужок і розділювачів, це кнопка шкали (checkuxtest.js) */
    if (!/'<span class="mil-v"><span>' \+ esc\(r\[1\]\) \+ '<\/span>' \+ r\[3\]/.test(page) || !/'">≈' \+ esc\(nf\(mi\.monthly_km\)\) \+ ' ' \+ esc\(t\('km\/mo'\)\)/.test(page)) errs.push('19: місячний пробіг не поруч з основним значенням');
    if (/">· ≈'/.test(page)) errs.push('19: крапка перед місячним пробігом лишилась');
    if (/\.hrow\.reg > span:not\(\.hd\)\{font-weight:600\}/.test(page)) errs.push('20: реєстраційні події досі жирні');
    /* L: номер власника лише зі структурованого реєстру (api/history-owners.js,
       owner_ordinal у рядку history). Текст моделі і кількість подій номер не дають
       (повні перевірки хронології в checkuxtest.js) */
    if (/function ownerBadges/.test(page)) errs.push('20: повернувся підрахунок власників з тексту подій');
    if (!/h\.owner_ordinal \? ' <span class="badge reg-badge">'/.test(page)) errs.push('20: бейдж власника не з owner_ordinal');
    for (const d of ['i18n/ru.js', 'i18n/ua.js']) {
      const dict = fs.readFileSync(d, 'utf8');
      for (const k of ['Owner #{n}', 'Discuss with CalCar AI', 'Discuss the car with your preferences in mind.']) {
        if (!dict.includes("'" + k + "'")) errs.push('нема ключа "' + k + '" у ' + d);
      }
    }

    /* ---- B. ціна: чесна атрибуція розрахунку CalCar ---- */
    if (!/position_classifier: 'calcar_threshold'/.test(src)) errs.push('price_context не позначає, чия класифікація');
    if (!/delta_percent/.test(src)) errs.push('price_context без відсотка відхилення');
    if (!/смуга position \(below_average\/average\/above_average\) і delta_percent це РОЗРАХУНОК CalCar/.test(src)) errs.push('нема правила атрибуції position');
    if (!/ЗАБОРОНЕНО приписувати нашу смугу самій площадці/.test(src)) errs.push('дозволено видавати наш поріг за категорію площадки');
    if (/формулюй ВІД ІМЕНІ ПЛОЩАДКИ/.test(src)) errs.push('старе правило "від імені площадки" лишилось');

    /* ---- C. персоналізація переїхала в чат: висновок звіту про авто, не про людину ---- */
    for (const gone of ['HARD CONSTRAINTS', 'SOFT PREFERENCES', 'CURRENT CONSIDERATION', 'НЕДАВНІ АВТО ЦІЄЇ Ж ЛЮДИНИ', 'чи варто цій людині']) {
      if (src.includes(gone)) errs.push('у правилах висновку лишилась персоналізація: ' + gone);
    }
    if (!/ЗАБОРОНЕНО згадувати чи припускати бюджет покупця/.test(src)) errs.push('нема заборони бюджету у висновку');
    if (!/Ціну оцінюй лише відносно ринку і цінності самого авто/.test(src)) errs.push('нема правила ринкової ціни замість бюджету');

    /* ---- Score v3 і ретривал цією задачею не змінювались ---- */
    const v3 = fs.readFileSync('api/score-v3.js', 'utf8');
    if (/buyer_context|recent_report|decision_positives/i.test(v3)) errs.push('контекст покупця протік у Score v3');
  }

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
  console.log('валідація структури · битий висновок дає старий рендер · 400/8 ліміти · сумісність із балом · промпт і два стилі · словники');
  console.log('DECISION TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
