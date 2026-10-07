/* Final Conclusion ("Висновок CalCar"): окремий synthesis-виклик по готовому
   звіту. Перевіряється контракт, а не якість тексту:
   - контекст збирається з фінального звіту і НЕ містить старого висновку;
   - Score, Confidence, власники, ДТП, ціна доходять до моделі;
   - відповідь зберігає абзаци і не ріжеться посеред фрази;
   - збій виклику звіт не ламає (fallback на модель Check, потім пусто);
   - етап стоїть після Score, Confidence і ринкової вартості;
   - сторінка показує headline і весь текст. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };
const DASH = String.fromCharCode(0x2014);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_fc_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

const OLD_HEADLINE = 'СТАРИЙ_ЗАГОЛОВОК_PURCHASE_DECISION';
const OLD_SUMMARY = 'СТАРИЙ_ВЕРДИКТ_SUMMARY';
const REPORT = {
  vehicle: { title: 'Porsche Panamera 2010', trim: '4 3.6 PDK', year: 2010, generation: '970', engine: '3.6 л бензин, 300 к.с.', transmission: 'робот', drive: 'повний', fuel: 'petrol', mileage_note: '130 000 км' },
  verdict: { score: 8.2, summary: OLD_SUMMARY },
  purchase_decision: { recommendation: 'skip', headline: OLD_HEADLINE, summary_short: OLD_HEADLINE + ' short', reasoning: OLD_HEADLINE + ' reasoning', questions_for_seller: [], value_context: null, missing_but_important: [] },
  score_breakdown: {
    score_version: 'v4', final: 8.2, score_available: true,
    vehicle_age: { age_years: 16.25 },
    items: [{ key: 'input8:owners', input: 'vehicle_owners', amount: 0.9, label_key: 'Number of owners', evidence: [{ ref: 'x', description: 'DOKAZ_EVIDENCE' }] }],
    inputs: { mileage_rollback: { status: 'clean', available: true }, vehicle_owners: { status: 'applied', available: true }, body_condition: { status: 'clean', available: false } },
    events: [{ v4_category: 'heavy', category_basis: ['structural'], zone_classes: ['front'], airbags: true, airbags_visible_parts: ['driver'], repair_status: 'unknown', evidence: [{ description: 'DOKAZ_EVIDENCE' }] }],
    vehicle_owners: { status: 'applied', owners_count: 10 },
  },
  score_breakdown_shadow: { score_version: 'v3', final: 7.9 },
  confidence: {
    overall_internal: 46, text_key: 'Partially checked', caps_applied: [{ name: 'weak_history', binding: true }, { name: 'other', binding: false }],
    domains: { history: { status: 'partial', inputs: [{ key: 'auction_history', state: 'verified' }, { key: 'registry', state: 'unavailable' }, { key: 'previous_listings', state: 'checked_absent' }] } },
  },
  history: [{ date: '03.2011', event: 'Перша реєстрація.', gap: null }],
  history_note: 'Зафіксовано 10 власників.',
  auction: { found: true, summary: 'Аукціон у США.', findings: [{ status: 'bad', text: 'Розкрита подушка водія.' }] },
  historical_visual: { summary: 'Сильний удар спереду.', visible_severity: 'severe', damage_depth: 'structural', visible_damage_zones: ['передок'], srs_visual_status: 'deployed_visible', possible_structural_damage: true, evidence: [{ description: 'DOKAZ_EVIDENCE' }] },
  photo_findings: [{ status: 'ok', text: 'Явних дефектів не видно.' }],
  risks: [{ title: 'Пневмопідвіска', level: 'high', kind: 'latent', note: 'Дорогий вузол.', action: 'перевірити просідання', source_ref: 'x' }],
  discrepancies: [{ severity: 'high', title: 'Пробіг', detail: 'Не сходиться.', sources: ['a'] }],
  equipment_v2: [
    { name: 'Пневмопідвіска', value_tier: 'high_value', retrofit: false, confidence_level: 'vehicle_data', evidence: [{ sign: 'DOKAZ_EVIDENCE' }] },
    { name: 'Диски 21', value_tier: 'notable', retrofit: true, confidence_level: 'visual' },
    { name: 'Підлокітник', value_tier: 'standard', retrofit: false, confidence_level: 'visual' },
  ],
  seller_disclosures: [{ unit: 'transmission', quote: 'Коробка без зауважень.', negated: true, vague: false }],
  model_notes: { issues: [{ unit: 'двигун', title: 'Задири', detail: 'Відомий ризик.', severity: 'high', seller_serviced: false, source_ref: 'MI' }] },
  market_value: { liquidity: { level: 'low', reasons: ['Вузьке коло покупців.'] }, why_price: { value_loss: 'high', reasons: ['Дороге утримання.'] } },
  _meta: {
    lang: 'ua', country: 'UA', domain: 'auto.ria.com', vin: 'WP0ZZZ97ZAL000001', url: 'https://auto.ria.com/x', price: 38000, currency: 'USD', odometer_km: 130000,
    seller_text: 'Авто у відмінному стані.',
    history_facts: { owners_count: 10, owner_events: [{ date: '2011-03-04', ordinal: 1 }, { date: '2026-05-21', ordinal: 10 }], imported_used: true, registry_present: true, past_listings: 6,
      mileage_points: [{ km: 89000, date: '2016-03-10', source: 'registry' }, { km: 89000, date: '2016-03-10', source: 'registry' }, { km: 127000, date: '2026-05-21', source: 'past_listing' }] },
    decision_inputs: { mileage_context: { band: 'low', age_years: 16.3, annual_km: 8000, reference_km_year: 15000, current_km: 130000, confirmed_by_history: true, historical_points: [] }, personal_context: 'excluded' },
    price_context: { currency: 'USD', average_price: 28000, delta_percent: 36, source_name: 'AUTO.RIA', listing_price: 38000 },
    value_curve: { new_price: { value: 90000, basis: 'source_msrp', msrp: { exact: { version: 'Panamera 4' } } }, retention: { state: 'heavy_depreciation', observed_retention: 0.3, expected_retention: 0.4 }, future: { value: 20000, years: 5 }, points: [1, 2, 3] },
    current_visual_shadow: { current_visual: { summary: 'Кузов без помітних пошкоджень [gallery_index=23].', coverage: { note: 'Днище не показане.', frames_usable: 10 }, zones: { underbody: { visibility: 'not_visible' }, front: { visibility: 'sufficient' } }, dashboard: { warning_lights: ['check engine'], readable_messages: [{ text: 'Stop/Start inactive', gallery_index: 6, photo_identity: 'cdn/y.webp' }] } }, odometer_vs_listing: { status: 'no_visual_reading' } },
    timings: { main_analysis: { ms: 1 } }, photos: ['https://cdn/x.jpg'],
  },
};

(async () => {
  const fcMod = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const { buildConclusionContext, prune, sanitizeConclusion, cutAtBoundary, runFinalConclusion, CONCLUSION_RULES, conclusionUserMessage, conclusionResponseFormat, conclusionModel, CONCLUSION_LIMITS } = fcMod;

  /* ---------- контекст ---------- */
  const ctx = buildConclusionContext(REPORT);
  const flat = JSON.stringify(ctx);
  ok(!flat.includes(OLD_HEADLINE) && !flat.includes(OLD_SUMMARY), 'старий purchase_decision або verdict.summary потрапив у контекст');
  ok(!/"recommendation"/.test(flat), 'у контексті є внутрішня категорія recommendation');
  ok(!flat.includes('DOKAZ_EVIDENCE'), 'у контекст потрапили масиви evidence');
  ok(!/timings|cdn\/x\.jpg|WP0ZZZ97ZAL000001/.test(flat), 'у контекст потрапили службові поля, фото або VIN');
  ok(!flat.includes(DASH), 'довге тире в контексті');
  ok(ctx.calcar_score.value === 8.2 && ctx.calcar_score.penalties[0].what === 'Number of owners', 'Score і його штрафи не доходять до висновку');
  ok(ctx.calcar_score.not_assessed.includes('body_condition'), 'неоцінені входи Score не названі');
  ok(ctx.confidence.percent === 46 && ctx.confidence.level === 'Partially checked', 'Confidence не доходить до висновку');
  ok(ctx.confidence.limited_by.length === 1 && ctx.confidence.limited_by[0] === 'weak_history', 'у причини Confidence йдуть лише binding caps');
  ok(ctx.confidence.domains.history.missing.includes('registry') && ctx.confidence.domains.history.have.includes('auction_history') && ctx.confidence.domains.history.checked_and_empty.includes('previous_listings'), 'домени Confidence не розкладені на є / нема');
  ok(ctx.ownership.owners_count === 10 && ctx.ownership.owner_change_dates.length === 2, 'власники не доходять до висновку');
  ok(ctx.mileage.usage_band === 'low' && ctx.mileage.km_per_year === 8000 && ctx.mileage.known_points.length === 2, 'пробіг: смуга, темп або точки (без дублів) не доходять');
  ok(ctx.accidents.events[0].severity === 'heavy' && ctx.accidents.events[0].airbags_deployed === true, 'вирішена тяжкість ДТП не доходить');
  ok(ctx.accidents.archive_photos.possible_structural_damage === true, 'архівний візуал не доходить');
  ok(ctx.current_condition.zones_not_shown.join() === 'underbody' && ctx.current_condition.dashboard_warning_lights.length === 1, 'нинішній стан за Vision не доходить');
  ok(ctx.current_condition.dashboard_messages[0] === 'Stop/Start inactive' && !/gallery_index|photo_identity/.test(flat), 'службові посилання на кадри потрапили в контекст');
  ok(ctx.equipment.expensive_desirable.length === 1 && /retrofit/.test(ctx.equipment.notable[0]) && !flat.includes('Підлокітник'), 'комплектація: лише вагомі опції, retrofit позначений');
  ok(ctx.price_and_market.listing_price.amount === 38000 && ctx.price_and_market.marketplace_average.listing_vs_average_percent === 36, 'ціна оголошення і середня площадки не доходять');
  ok(ctx.price_and_market.price_when_new.amount_usd === 90000 && ctx.price_and_market.liquidity.level === 'low' && ctx.price_and_market.why_this_price.reasons.length === 1, 'ціна нової, ліквідність або why-price не доходять');
  ok(!flat.includes('[1,2,3]'), 'точки кривої вартості у контексті');
  ok(ctx.model_knowledge_from_report[0].title === 'Задири' && ctx.key_risks[0].kind === 'latent' && ctx.discrepancies.length === 1 && ctx.seller.claims.length === 1, 'ризики, знання про модель, розбіжності або заяви продавця не доходять');
  ok(flat.length < 12000, 'контекст завеликий: ' + flat.length);
  ok(prune({ a: null, b: '', c: [], d: {}, e: { f: null }, g: 0, h: false }) && JSON.stringify(prune({ a: null, b: '', c: [], d: {}, e: { f: null }, g: 0, h: false })) === '{"g":0,"h":false}', 'prune не прибирає порожнє або зʼїдає 0/false');
  ok(JSON.stringify(buildConclusionContext({ vehicle: { title: 'X' } })) === '{"vehicle":{"title":"X"}}', 'порожній звіт дає сміття в контексті');
  ok(buildConclusionContext(null) === null, 'null-звіт не обробляється');

  /* ---------- правила ---------- */
  ok(!CONCLUSION_RULES.includes(DASH), 'довге тире у правилах висновку');
  /* fc-v2.2: English internal rules, output language from the report locale */
  for (const k of ['OUTPUT LANGUAGE', 'CONNECT FACTS AND EXPLAIN CONSEQUENCES', 'Always distinguish a known weakness of this version from a confirmed defect of this exact vehicle', 'Owners.', 'Resale.', 'What we know and what we do not.', 'Bad tone:', 'The conclusion is not a "buy" or "do not buy" directive', 'an empty model_knowledge_from_report does not mean', 'Before drafting, explicitly consider', 'Do not target four paragraphs', 'Do not introduce service campaigns, TSBs, recall-like technical details or campaign numbers unless their applicability']) {
    ok(CONCLUSION_RULES.includes(k), 'у правилах висновку нема: ' + k);
  }
  ok(!/МАКСИМУМ \d+ символів|рівно \d+ речен|один плюс|один мінус/i.test(CONCLUSION_RULES), 'у правилах лишилась жорстка стара структура');
  ok(!/[А-Яа-яІіЇїЄєҐґ]/.test(CONCLUSION_RULES) && fcMod.CONCLUSION_VERSION === 'fc-v2.4', 'production rules are not the English fc-v2.4');
  /* fc-v2.3: powertrain step weighs a genuine strength like a weakness (bench A/B 2026-10-03) */
  ok(CONCLUSION_RULES.includes('4. Powertrain step (always do this before drafting, silently): look at the relevant powertrain of this exact vehicle.')
    && CONCLUSION_RULES.includes('consider both sides: whether one has a well-established strength that genuinely matters for ownership, and whether one has a well-established weakness that materially affects this purchase.')
    && CONCLUSION_RULES.includes('Strengths are weighed the same way.')
    && CONCLUSION_RULES.includes('a well-regarded powertrain must not be represented solely by its one weakness')
    && CONCLUSION_RULES.includes('Do not invent praise, do not hand every powertrain a compliment, and do not require both a strength and a weakness in every conclusion'), 'fc-v2.3 powertrain rule missing');
  ok(!CONCLUSION_RULES.includes('4. Model-specific step (always do this before drafting, silently)'), 'old weakness-only step 4 still present');
  ok(!/exactly \d+ sentences|one plus|one minus|four paragraphs\./i.test(CONCLUSION_RULES.replace('Do not target four paragraphs', '')), 'rigid old structure in the rules');
  const fmt = conclusionResponseFormat();
  ok(fmt.json_schema.strict === true && fmt.json_schema.schema.required.join() === 'headline,paragraphs', 'схема відповіді не headline + paragraphs');
  const um = conclusionUserMessage({ langDirective: 'LANG_DIRECTIVE.', context: ctx });
  ok(um.startsWith('LANG_DIRECTIVE.') && um.includes('"calcar_score"'), 'повідомлення без мовної директиви або контексту');

  /* ---------- відповідь моделі ---------- */
  const s1 = sanitizeConclusion({ headline: 'Багатий GL63 ' + DASH + ' але історія складна.', paragraphs: ['Перший абзац ' + DASH + ' з думкою.\n\nДругий абзац.', '- третій абзац', '', 42] });
  ok(s1 && s1.headline === 'Багатий GL63, але історія складна' && s1.body === 'Перший абзац, з думкою.\n\nДругий абзац.\n\nтретій абзац', 'абзаци не збережені або тире не прибране: ' + JSON.stringify(s1));
  ok(sanitizeConclusion({ headline: '', paragraphs: ['x'] }) === null && sanitizeConclusion({ headline: 'x', paragraphs: [] }) === null && sanitizeConclusion(null) === null, 'неповна відповідь не відхиляється');
  ok(sanitizeConclusion({ headline: 'H', body: 'A.\n\nB.' }).body === 'A.\n\nB.', 'body рядком не приймається');
  const longPara = ('Речення про машину. ').repeat(120).trim();
  const many = sanitizeConclusion({ headline: 'H', paragraphs: [longPara, longPara, longPara, longPara] });
  ok(many && many.truncated === true && many.body.length <= CONCLUSION_LIMITS.body && /\.$/.test(many.body) && many.body.split('\n\n').every(p => p === longPara), 'runaway-ліміт ріже посеред абзацу');
  const cut = cutAtBoundary('Перше речення тут. Друге речення значно довше і не влізе у ліміт', 30);
  ok(cut === 'Перше речення тут.', 'обрізання не по межі речення: ' + cut);
  ok(!/\s$/.test(cutAtBoundary('слово '.repeat(40), 50)) && cutAtBoundary('слово '.repeat(40), 50).split(' ').every(w => w === 'слово'), 'обрізання посеред слова');

  /* ---------- виклик ---------- */
  const good = { choices: [{ message: { content: JSON.stringify({ headline: 'Заголовок', paragraphs: ['Абзац один.', 'Абзац два.'] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 30 } }, model: 'strong-1' };
  const calls = [];
  const r1 = await runFinalConclusion({ report: REPORT, langDirective: 'L.', env: { FINAL_CONCLUSION: 'on', CONCLUSION_MODEL: 'strong-1', OPENAI_MODEL: 'base-1' }, callModel: async (body) => { calls.push(body); return good; } });
  ok(r1.status === 'ok' && r1.conclusion.body === 'Абзац один.\n\nАбзац два.' && r1.ai.reasoning_tokens === 30, 'успішний виклик не дає висновку');
  ok(calls.length === 1 && calls[0].model === 'strong-1' && calls[0].reasoning_effort === 'medium' && calls[0].messages[0].content === CONCLUSION_RULES, 'виклик не на сильній моделі з medium reasoning');
  ok(!JSON.stringify(calls[0]).includes(OLD_HEADLINE) && !JSON.stringify(calls[0]).includes(OLD_SUMMARY), 'старий висновок потрапив у запит до моделі');
  ok(!calls[0].messages.some(m => Array.isArray(m.content)), 'у фінальний виклик пішли зображення');

  const seq = [];
  const r2 = await runFinalConclusion({ report: REPORT, env: { FINAL_CONCLUSION: 'on', CONCLUSION_MODEL: 'strong-1', OPENAI_MODEL: 'base-1' }, callModel: async (body) => { seq.push([body.model, body.reasoning_effort || null]); return body.model === 'strong-1' ? { error: { message: 'The model strong-1 does not exist' } } : good; } });
  ok(r2.status === 'ok' && JSON.stringify(seq) === '[["strong-1","medium"],["base-1","medium"]]', 'нема fallback на модель основного Check: ' + JSON.stringify(seq));
  const seq3 = [];
  const r3 = await runFinalConclusion({ report: REPORT, env: { FINAL_CONCLUSION: 'on', OPENAI_MODEL: 'base-1' }, callModel: async (body) => { seq3.push(body.reasoning_effort || null); return body.reasoning_effort ? { error: { message: 'Unsupported parameter: reasoning_effort' } } : good; } });
  ok(r3.status === 'ok' && JSON.stringify(seq3) === '["medium",null]', 'нема повтору без reasoning_effort: ' + JSON.stringify(seq3));
  const r4 = await runFinalConclusion({ report: REPORT, env: { FINAL_CONCLUSION: 'on', OPENAI_MODEL: 'base-1' }, callModel: async () => { throw new Error('network down'); } });
  ok(r4.status === 'error' && r4.conclusion === null && r4.reason === 'network down', 'збій транспорту кидає або губить причину');
  const r5 = await runFinalConclusion({ report: REPORT, env: { FINAL_CONCLUSION: 'on', OPENAI_MODEL: 'base-1' }, callModel: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
  ok(r5.status === 'error' && r5.reason === 'invalid_output', 'невалідна відповідь не стає помилкою');
  let called = false;
  const r6 = await runFinalConclusion({ report: REPORT, env: { FINAL_CONCLUSION: 'off' }, callModel: async () => { called = true; return good; } });
  ok(r6.status === 'skipped' && r6.reason === 'disabled' && !called, 'вимикач FINAL_CONCLUSION=off не працює');
  const cm = conclusionModel({ OPENAI_MODEL: 'base-1' });
  ok(cm.model === 'gpt-6.1-sol' && cm.effort === 'medium' && cm.fallback_model === 'base-1', 'типові model/effort етапу не ті');
  ok(conclusionModel({ CONCLUSION_MODEL: 'm', CONCLUSION_EFFORT: 'high' }).model === 'm' && conclusionModel({ CONCLUSION_EFFORT: 'high' }).effort === 'high', 'env не перемикає модель або reasoning етапу');
  ok(fcMod.conclusionEnabled({}) === true && fcMod.conclusionEnabled({ FINAL_CONCLUSION: 'off' }) === false, 'етап не ввімкнений типово або не вимикається env');
  ok(Date.parse(fs.readFileSync('api/conclusion-bench.js', 'utf8').match(/OPEN_UNTIL = '([^']+)'/)[1]) < Date.now(), 'benchmark-ендпоінт лишився відкритим без ключа');

  /* ---------- вбудовування в Check ---------- */
  const src = fs.readFileSync('api/check.js', 'utf8');
  const iConf = src.indexOf('parsed.confidence = computeConfidenceV1');
  const iScore = src.indexOf('parsed.verdict.score = ');
  const iValue = src.indexOf("mark('value_section'");
  const iMv = src.indexOf('parsed.market_value = composeMarketValue');
  const iMeta = src.indexOf('parsed._meta = {');
  const iFc = src.indexOf('runFinalConclusion({ report: parsed');
  const iRet = src.indexOf('return res.status(200).json(parsed);');
  ok(iFc > 0 && [iConf, iScore, iValue, iMv, iMeta].every(i => i > 0 && i < iFc) && iFc < iRet, 'Final Conclusion стартує не після Score, Confidence, ринкової вартості і _meta');
  ok(/const attached = attachFinalConclusion\(parsed, fc, lang\);/.test(src) && (src.match(/parsed\.final_conclusion = null;/g) || []).length === 2 && /parsed\._meta\.final_conclusion = \{ status: fc\.status \|\| 'error', reason: fc\.reason \|\| null/.test(src), 'результат етапу не додається у звіт або збій кроку не ізольований');
  ok(/mark\('final_conclusion'/.test(src) && /no_time_budget/.test(src), 'нема таймінгу етапу або захисту бюджету часу');
  ok(!/purchase_decision/.test(fs.readFileSync('api/conclusion.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), 'conclusion.js читає purchase_decision');
  const chk = await import('file://' + path.join(dir, 'api', 'check.js'));
  const lang1 = chk.applyConclusionLanguage({ headline: 'Стан SRS важливий', body: 'Перевірка SRS потрібна.' }, { score_breakdown: null }, 'ua');
  ok(!/SRS/.test(lang1.headline + lang1.body), 'внутрішні позначки не знімаються з фінального висновку');
  const rep1 = { vehicle: {}, _meta: {} };
  ok(chk.attachFinalConclusion(rep1, { status: 'ok', version: 'v', ai: { model: 'm' }, conclusion: { headline: 'H', body: 'A.\n\nB.' } }, 'ru') === true
    && JSON.stringify(rep1.final_conclusion) === '{"headline":"H","body":"A.\\n\\nB."}' && rep1._meta.final_conclusion.model === 'm', 'звіт не отримує final_conclusion {headline, body}');
  const rep2 = { vehicle: {}, _meta: {} };
  ok(chk.attachFinalConclusion(rep2, { status: 'error', conclusion: null }, 'ru') === false && !('final_conclusion' in rep2) && chk.attachFinalConclusion(rep2, null, 'ru') === false, 'невдалий етап лишає слід у звіті');
  /* регресія: словесне калібрування тяжкості ламало заперечення у тексті висновку */
  const neg = 'На фото значительных повреждений и следов сильного удара не видно.';
  const lang2 = chk.applyConclusionLanguage({ headline: 'H', body: neg }, { score_breakdown: { score_version: 'v4' }, score_breakdown_shadow: { accident_events: [{ resolved_severity: 'minor' }], events: [{ severity: 'minor' }] } }, 'ru');
  ok(lang2.body === neg, 'код переписує слова про тяжкість у фінальному висновку: ' + lang2.body);

  /* ---------- публічний звіт, сторінка, чат ---------- */
  const share = await import('file://' + path.join(dir, 'api', 'share.js'));
  const pub = share.publicReport({ vehicle: {}, final_conclusion: { headline: 'H', body: 'B' }, _meta: { timings: { final_conclusion: {} }, final_conclusion: { version: 'x' } } });
  ok(pub.final_conclusion && pub.final_conclusion.body === 'B' && !pub._meta.timings && !pub._meta.final_conclusion, 'публічний звіт без final_conclusion або з діагностикою етапу');
  const page = fs.readFileSync('result-check.html', 'utf8');
  ok(/const fc = D\.final_conclusion;/.test(page) && /clean\(fc\.body\)\.split\(\/\\n\\s\*\\n\/\)/.test(page), 'сторінка не рендерить final_conclusion абзацами');
  /* новий звіт без висновку не воскрешає старий: purchase_decision лише у старих збережених звітах */
  ok(/\} else if \(!fcGen && pd && pd\.headline\) \{/.test(page) && /if \(!fcGen && !\(pd && pd\.headline\)\) \$\('verdictCard'\)\.style\.display = ''/.test(page), 'звіт нового покоління без висновку показує старий висновок');
  ok(!/purchase_decision/.test(src.replace(/delete parsed\.purchase_decision;/, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'check.js досі генерує чи обробляє purchase_decision');
  ok(/final_conclusion: d\.final_conclusion \|\| null, purchase_decision: Object\.prototype\.hasOwnProperty\.call\(d, 'final_conclusion'\) \? null :/.test(page), 'чат отримує не той висновок, який бачить людина');

  /* ---------- benchmark-ендпоінт ---------- */
  const bench = await import('file://' + path.join(dir, 'api', 'conclusion-bench.js'));
  const open = Date.parse(bench.OPEN_UNTIL);
  ok(bench.benchAllowed({ headers: {} }, {}, open - 1000) === true && bench.benchAllowed({ headers: {} }, {}, open + 1000) === false, 'benchmark не закривається сам після OPEN_UNTIL');
  ok(bench.benchAllowed({ headers: { 'x-calcar-bench': 'k' } }, { BENCH_KEY: 'k' }, open + 1000) === true && bench.benchAllowed({ headers: { 'x-calcar-bench': 'z' } }, { BENCH_KEY: 'k' }, open + 1000) === false, 'benchmark після закриття не відкривається ключем');
  ok(bench.MODEL_RE.test('gpt-5.6-terra') && !bench.MODEL_RE.test('http://x') && !bench.MODEL_RE.test('claude'), 'benchmark приймає довільну назву моделі');
  /* кандидатні правила A/B: лише всередині bench-виклику, production-правила незмінні */
  ok(bench.candidateRules('x'.repeat(300)) !== null && bench.candidateRules('short') === null && bench.candidateRules('x'.repeat(bench.RULES_LIMITS.max + 1)) === null && bench.candidateRules({}) === null, 'bench приймає непридатні кандидатні правила');
  const seen = [];
  const base = async body => { seen.push(body); return good; };
  ok(bench.withRules(base, null) === base, 'без кандидатних правил транспорт має лишатись production');
  const CAND = 'КАНДИДАТ '.repeat(40);
  const rc = await runFinalConclusion({ report: REPORT, langDirective: 'L.', env: { FINAL_CONCLUSION: 'on' }, callModel: bench.withRules(base, CAND) });
  ok(rc.status === 'ok' && seen.length === 1 && seen[0].messages[0].content === CAND && seen[0].messages[1].role === 'user' && seen[0].messages[1].content.includes('"calcar_score"'), 'кандидатні правила не підміняють system або псують контекст');
  ok(seen[0].model === 'gpt-6.1-sol' && seen[0].reasoning_effort === 'medium' && seen[0].response_format.json_schema.name === 'calcar_final_conclusion', 'bench з кандидатними правилами змінює модель, reasoning або схему');
  ok(fcMod.CONCLUSION_RULES !== CAND && !fcMod.CONCLUSION_RULES.includes('КАНДИДАТ'), 'кандидатні правила змінили production-правила');
  const benchSrc = fs.readFileSync('api/conclusion-bench.js', 'utf8');
  ok(/if \(!benchAllowed\(req, process\.env\)\) return res\.status\(404\)/.test(benchSrc) && benchSrc.indexOf('benchAllowed(req, process.env)') < benchSrc.indexOf('candidateRules(b.rules)'), 'кандидатні правила доступні без BENCH_KEY');
  ok(!/CONCLUSION_RULES\s*=/.test(benchSrc) && !/writeFile|\/rest\/v1\/reports/.test(benchSrc), 'bench змінює production-правила або пише у звіти');
  ok(!/method: 'P(?:ATCH|UT)'|method: 'DELETE'/.test(benchSrc) && (benchSrc.match(/method: 'POST'/g) || []).length === 1, 'benchmark щось пише');

  for (const f of ['api/conclusion.js', 'api/conclusion-bench.js', 'conclusiontest.js']) ok(!fs.readFileSync(f, 'utf8').includes(DASH), 'довге тире у ' + f);

  if (errs.length) { console.log('FINAL CONCLUSION TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('final conclusion: контекст з готового звіту без старого висновку · Score, Confidence, власники, ДТП, ціна доходять · абзаци цілі · fallback і вимикач · етап після Score/Confidence/Value · сторінка, чат і публічний звіт');
})().catch(e => { console.log('FINAL CONCLUSION TEST CRASHED:', e); process.exit(1); });
