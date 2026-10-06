/* Decision Engine після Final Conclusion: старий purchase_decision головним
   викликом не генерується і не обробляється; старі збережені звіти з ним
   і далі рендеряться. Детектор порад, привід, пробіг, обʼєктивність. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
/* check.js імпортує score.js і auction.js: збираємо tmp-пакет як у e2e */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_dec_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of ['check.js', 'check-schema.js', 'current-visual.js', 'canonical-merge.js', 'score.js', 'score-v3.js', 'score-v4.js', 'confidence.js', 'vision-reliability.js', 'auction.js', 'locale.js', 'visual-signals.js', 'share.js', 'vehicle-memory.js', 'mi-shadow.js', 'mi-equipment.js', 'mi-research.js', 'value.js', 'conclusion.js', 'historical-claims.js', 'history-owners.js', 'youtube.js', 'check-email.js', 'check-job.js', 'vehicle-spec.js']) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

(async () => {
  const {
    buildMileageContext, objectiveDecisionContext,
    calibrateSeverityWording, humanizeDecisionJargon, maxResolvedSeverity,
    directiveVerdictHits, localizeDrive,
  } = await import('file://' + path.join(dir, 'api', 'check.js'));
  const quiet = fn => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

  /* 1-5. старий висновок виведений з ужитку: ні в промпті, ні в схемі, ні в обробці */
  const src = fs.readFileSync('api/check.js', 'utf8');
  const schemaAll = fs.readFileSync('api/check-schema.js', 'utf8');
  for (const gone of ['sanitizePurchaseDecision', 'applyDecisionLanguage', 'DECISION_RULES', 'DECISION_PRINCIPLES', 'decisionStyle', 'decision_style', 'DECISION_STYLE', 'score_conflict', 'questions_for_seller', 'missing_but_important', 'purchase_decision.value_context', 'recommendation": buy']) {
    if (src.includes(gone)) errs.push('check.js досі знає старий висновок: ' + gone);
  }
  if (/purchase_decision|recommendation/.test(schemaAll)) errs.push('схема відповіді досі просить старий висновок');
  if (!/ЗВІТ ОЦІНЮЄ АВТО, А НЕ РАДИТЬ ЛЮДИНІ ДІЮ: verdict\.summary, risks та інші тексти звіту/.test(src)) errs.push('правило без порад не перенесене на verdict.summary і ризики');
  if (/DECISION_FEWSHOT|ПРИКЛАДИ СТИЛЮ МІРКУВАННЯ/.test(src)) errs.push('check.js: старий конфліктний few-shot повернувся');

  /* 5b. висновок звіту оцінює авто, а не радить людині дію */
  {
    const rules = src.slice(src.indexOf('const REPORT_TEXT_RULES = `'), src.indexOf('export function compactHistoricalVisual'));
    for (const bad of ['як жива порада', 'так, їхати дивитись', 'краще розглянути інший екземпляр', 'варто поїхати на огляд', 'цей екземпляр варто розглядати',
      'чи варто розглядати САМЕ ЦЕЙ', 'чи варто далі розглядати', 'мусять підтвердитись до купівлі', 'прямо скажи, що її варто продовжувати розглядати']) {
      if (rules.includes(bad)) errs.push('правила висновку досі радять дію: "' + bad + '"');
    }
    if (!/Що це означає для конкретної людини, обговорює чат CalCar AI, не звіт/.test(rules)) errs.push('нема межі звіт проти чату');
    if (!/"лучше рассмотреть другой экземпляр"/.test(rules) || !/"look for another"/.test(rules)) errs.push('заборона не покриває RU і EN');
    const schemaSrc = fs.readFileSync('api/check-schema.js', 'utf8');
    if (/чи варто розглядати/.test(schemaSrc) || !/загальна оцінка екземпляра без порад людині/.test(schemaSrc)) errs.push('verdict.summary у схемі досі про пораду');

    /* детектор поради: високий ризик, змішаний, чистий; RU, UA, EN */
    const directive = [
      'Лучше рассмотреть другой экземпляр: подтверждённое затопление и отрицание этого факта продавцом перевешивают плюсы.',
      'Краще розглянути інший екземпляр через підтверджене затоплення.',
      'Можно брать после проверки подвески.', 'Можна брати після діагностики.', 'Не берите эту машину.',
      'Стоит покупать: сильный экземпляр.', 'Варто їхати дивитись, але спершу два питання продавцю.', 'Ищите другую машину.',
      'Хороший выбор для вас.', 'Рекомендуем отказаться от покупки.', 'Worth buying if the service history checks out.', 'Better to look for another car.', 'Walk away from this one.',
    ];
    for (const t of directive) if (!directiveVerdictHits({ headline: t }).length) errs.push('детектор пропустив пораду: ' + t);
    const descriptive = [
      'Экземпляр с высоким риском: подтверждённое затопление и отрицание этого факта продавцом существенно ухудшают оценку автомобиля.',
      'Серьёзные риски: подтверждённое затопление и противоречие в описании продавца перевешивают положительные стороны экземпляра.',
      'В целом сильный экземпляр, но остаются вопросы, требующие проверки.',
      'Сильний екземпляр без підтверджених серйозних ризиків.', 'Екземпляр з високим рівнем підтверджених ризиків.',
      'A strong example with no confirmed serious risks.', 'Mixed example: solid history, but the mileage is not confirmed.',
      'Ціна нижча за середню площадки, стан кузова потребує підтвердження на огляді.',
    ];
    for (const t of descriptive) if (directiveVerdictHits({ headline: t, summary_short: t, reasoning: t }).length) errs.push('детектор зачепив оцінку авто: ' + t);
    const hits = directiveVerdictHits({ headline: 'Сильный экземпляр.', summary_short: 'Можно брать.', reasoning: 'ok', value_context: null });
    if (hits.length !== 1 || hits[0].field !== 'summary_short') errs.push('детектор не каже, в якому полі порада');
    if (!/directiveHits = directiveVerdictHits\(/.test(src) || !/console\.log\('\[decision-directive\]'/.test(src) || !/decision_directive: directiveHits\.length \? directiveHits : null/.test(src)) errs.push('порада у висновку не логується і не пишеться в _meta');
  }

  /* 5c. привід для людини: сирі значення не йдуть у звіт */
  {
    const T = { full: ['повний', 'полный', 'AWD'], awd: ['повний', 'полный', 'AWD'], '4wd': ['повний', 'полный', 'AWD'], AWD: ['повний', 'полный', 'AWD'],
      front: ['передній', 'передний', 'FWD'], fwd: ['передній', 'передний', 'FWD'], rear: ['задній', 'задний', 'RWD'], rwd: ['задній', 'задний', 'RWD'], 'all-wheel drive': ['повний', 'полный', 'AWD'] };
    for (const [raw, [ua, ru, en]] of Object.entries(T)) {
      if (localizeDrive(raw, 'ua') !== ua || localizeDrive(raw, 'ru') !== ru || localizeDrive(raw, 'en') !== en) errs.push('привід ' + raw + ' не локалізований: ' + [localizeDrive(raw, 'ua'), localizeDrive(raw, 'ru'), localizeDrive(raw, 'en')].join('/'));
    }
    for (const keep of ['xDrive', '4MATIC', 'quattro', 'полный', 'Повний', 'передний']) if (localizeDrive(keep, 'ru') !== keep) errs.push('привід змінено без потреби: ' + keep);
    if (localizeDrive(null, 'ru') !== null || localizeDrive(undefined, 'ru') !== undefined || localizeDrive('', 'ru') !== '') errs.push('порожній привід ламається');
    if (!/if \(parsed\.vehicle && typeof parsed\.vehicle\.drive === 'string'\) parsed\.vehicle\.drive = localizeDrive\(parsed\.vehicle\.drive, lang\);/.test(src)) errs.push('Check не нормалізує привід у звіті');
  }

  /* 6. рендер: шари, фолбек без порожніх секцій, рядки в словниках */
  const page = fs.readFileSync('result-check.html', 'utf8');
  for (const el of ['id="pdBlock"', 'id="pdHeadline"', 'id="pdShort"', 'id="pdMoreBtn"', 'id="pdReasoning"']) {
    if (!page.includes(el)) errs.push('result-check.html: нема ' + el);
  }
  /* старі збережені звіти (без ключа final_conclusion) рендерять свій висновок;
     звіт нового покоління без висновку ховає блок, а не воскрешає старий */
  if (!page.includes("} else if (!fcGen && pd && pd.headline) {")) errs.push('result-check.html: старий збережений purchase_decision не рендериться або показується новим звітам');
  if (!page.includes("if (!fcGen && !(pd && pd.headline)) $('verdictCard').style.display = ''")) errs.push('result-check.html: verdict.summary показується як висновок нового звіту');
  if (!page.includes("const fcGen = !!D && Object.prototype.hasOwnProperty.call(D, 'final_conclusion');")) errs.push('result-check.html: нема ознаки звіту нового покоління');
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
  /* ---- правила зважування старого висновку прибрані з головного виклику ---- */
{
  const src = fs.readFileSync('api/check.js', 'utf8');
  for (const gone of ['ГОЛОВНЕ ПИТАННЯ ВИСНОВКУ', 'decision_positives', 'deal_breakers', 'КОМПЛЕКТАЦІЯ ЯК ФАКТОР РІШЕННЯ', 'ОЦІНКА CALCAR НЕ Є ВЕРДИКТОМ ПРО ПОКУПКУ', 'СТРУКТУРА reasoning', 'ПРОБІГ ЯК ФАКТОР РІШЕННЯ', 'Оцінка CalCar цього автомобіля становить']) {
    if (src.includes(gone)) errs.push('у головному виклику лишилось правило старого висновку: ' + gone);
  }
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
    /* контекст пробігу тепер їде у Final Conclusion через _meta.decision_inputs */
    if (!/meta\.decision_inputs && isObj\(meta\.decision_inputs\.mileage_context\)/.test(fs.readFileSync('api/conclusion.js', 'utf8'))) errs.push('Final Conclusion не отримує контекст пробігу');

    /* ---- 11. висновок обʼєктивний: контекст рішення лише з фактів про авто ----
       (повні сценарії в objectivereporttest.js) */
    if (objectiveDecisionContext({}) !== null) errs.push('порожній обʼєктивний контекст не дав null');
    const oc = objectiveDecisionContext({ mileage: { band: 'low' }, buyer: { note: 'бюджет 30 тисяч' }, recent: [{ title: 'x' }] });
    if (!oc || Object.keys(oc).join() !== 'mileage') errs.push('обʼєктивний контекст пропустив особисте: ' + JSON.stringify(oc));
    if (/BUYER_CONTEXT|RECENT_REPORTS/.test(src)) errs.push('промпт досі знає про BUYER_CONTEXT/RECENT_REPORTS');
    if (!/ОБʼЄКТИВНІСТЬ ВИСНОВКУ: висновок оцінює ЛИШЕ сам автомобіль/.test(src)) errs.push('нема правила обʼєктивності висновку');

    /* ---- проводка: контекст збирається ДО виклику і їде в промпт ---- */
    if (!/PROMPT\(listing, nhtsa, auction, langDirective, auctionSearch, cvEvidence, spec0\)/.test(src) || /DECISION_CONTEXT|renderDecisionContext/.test(src)) errs.push('контекст старого висновку досі йде в головний виклик');
    if (!/const decisionContext = buildDecision|let decisionContext = null/.test(src)) errs.push('decisionContext не збирається в хендлері');
    if (!/decision_inputs: decisionContext/.test(src)) errs.push('_meta не зберігає входи рішення');
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
  console.log('старий висновок головного виклику прибраний (промпт, схема, обробка) · старі звіти рендерять свій висновок · детектор порад · привід · пробіг у Final Conclusion · обʼєктивність');
  console.log('DECISION TEST PASSED');
})().catch(e => { console.log('FAILED:', e.stack || e.message); process.exit(1); });
