/* CalCar: швидкий переклад звіту (api/check-translate.js, api/report-translate.js,
   блок перекладу в result-check.html). Без мережі: fetch і таймери підмінені.
   Тримає: модель бачить лише рядки для людини; звіт від моделі назад не
   приймається; структура, числа, Score, Confidence, коди лишаються
   оригінальними; оригінал не змінюється; спільний кеш за токеном, мовою і
   відбитком джерела; один виклик OpenAI з reasoning low; жодного етапу Check;
   банер показує прошедший час і не запускає дубль. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };

(async () => {
  const dir = path.join(__dirname, 'api');
  const RT = await import('file://' + path.join(dir, 'report-translate.js'));

  /* ---------- фікстура: усе, що буває у звіті ---------- */
  const REPORT = () => ({
    vehicle: { title: 'Mercedes-Benz GL-Class 2014', drive: 'полный', fuel: 'petrol', trim: 'GL63 AMG', generation: 'X166', year: 2014,
      engine: '5,5 л бензин V8, 557 л.с.', transmission: 'автоматическая, 7G AMG', mileage_note: '106 000 км' },
    final_conclusion: { headline: 'Для этого GL63 история обслуживания важнее внешнего вида', body: 'Первый абзац о машине.\n\nВторой абзац: цена 32 000 USD и пробег 106 000 км.' },
    verdict: { summary: 'Это Mercedes-Benz GL63 AMG поколения X166.' },
    risks: [{ title: 'Пневмоподвеска', level: 'high', kind: 'latent', note: 'Компрессор и стойки дорогие.', action: 'проверить компрессор', source_ref: 'listing_1' },
      /* коди, схожі на текст: їх тримає лише список службових ключів */
      { title: 'Коробка', level: 'вище середнього', kind: 'прихований ризик', status: 'не перевірено', source_ref: 'опис продавця', note: 'Текст.' }],
    discrepancies: [{ title: 'Версия не подтверждается VIN', severity: 'med', detail: 'Продавец называет GL63 S.', sources: ['объявление', 'VIN'] }],
    history: [{ date: '08.2014', gap: '3 месяца', event: 'Первичная регистрация.', owner_ordinal: 1, owner_ordinal_source: 'registry' }],
    history_note: 'История содержит семь записей.',
    photo_findings: [{ status: 'ok', text: 'Явных следов ремонта нет.' }],
    checklist: ['Двигатель M157: проверить течи'],
    equipment_v2: [
      { name: 'Адаптивный круиз-контроль', category: 'assist', value_tier: 'notable', confidence_level: 'listing_data', factory_status: 'unknown',
        evidence: [{ ref: 'структурированные опции AUTO.RIA', sign: 'Указан адаптивный круиз-контроль.', source: 'listing_data' }, { ref: 'photo_17', sign: 'Кнопка на руле.', source: 'current_photos' }],
        provenance: [{ ref: 'структурированные опции AUTO.RIA', type: 'listing_data', evidence: 'Указан адаптивный круиз-контроль.', marketplace: 'autoria' }] },
      { name: 'Sunroof', category: 'комфорт салону', value_tier: 'висока цінність', factory_status: 'заводська опція', confidence_level: 'дані оголошення', evidence: [] },
    ],
    market_value: { liquidity: { level: 'low', reasons: ['Мощный AMG сужает круг покупателей.'] }, why_price: { reasons: ['Высокий расход топлива.'] }, price_story: 'depreciation', retention_state: 'heavy_depreciation', value_loss: 'high' },
    score_breakdown: { final: 8.4, items: [{ key: 'input5:mileage', amount: -0.6, label_key: 'Mileage', evidence: [{ source: 'registry', unit_raw: 'km', note: 'пробег по реестру' }] }] },
    score_breakdown_v2: { final: 8.4 },
    confidence: { overall_internal: 62, text_key: 'Enough data', domains: { history: { earned: 18, note: 'реестр ответил' } } },
    auction: { summary: 'Аукцион не найден.', findings: [{ text: 'Архивных фото нет.', status: 'unknown' }], lot_url: 'https://www.copart.com/lot/1' },
    _meta: { lang: 'ru', vin: 'WDC1668741A000001', seller_text: 'Продаю свой GL63, всё сделано.' },
    _chat: [{ role: 'user', content: 'приватная переписка' }],
  });

  /* ---------- 1. у модель лише текст для людини ---------- */
  const src = REPORT();
  const items = RT.extractTranslatable(src);
  const ids = items.map(x => x.id);
  for (const want of ['final_conclusion.headline', 'final_conclusion.body', 'verdict.summary', 'risks.0.title', 'risks.0.note', 'risks.0.action',
    'discrepancies.0.sources.0', 'history.0.event', 'history_note', 'photo_findings.0.text', 'checklist.0', 'equipment_v2.0.name',
    'equipment_v2.0.evidence.0.ref', 'equipment_v2.0.evidence.0.sign', 'equipment_v2.1.name', 'market_value.liquidity.reasons.0',
    'market_value.why_price.reasons.0', 'vehicle.drive', 'vehicle.engine', 'vehicle.transmission', 'vehicle.mileage_note', 'auction.summary', 'auction.findings.0.text']) {
    ok(ids.includes(want), '1: не перекладається текст для людини ' + want);
  }
  for (const bad of [/^score_breakdown/, /^confidence/, /^_meta/, /^_chat/, /\.unit_raw$/, /\.level$/, /\.kind$/, /\.severity$/, /\.status$/, /\.source$/, /\.source_ref$/,
    /\.category$/, /\.value_tier$/, /\.confidence_level$/, /\.factory_status$/, /provenance/, /\.date$/, /\.gap$/, /owner_ordinal/, /^vehicle\.(title|fuel|trim|generation)$/,
    /price_story|retention_state|value_loss/, /lot_url/]) {
    ok(!ids.some(i => bad.test(i)), '1: у модель іде службове поле ' + bad);
  }
  ok(!ids.includes('discrepancies.0.sources.1') && !ids.includes('equipment_v2.0.evidence.1.ref'), '1: VIN чи id кадру пішли в переклад');
  ok(!items.some(x => /seller|Продаю/.test(x.text)), '1: опис продавця пішов у переклад');
  const all = JSON.stringify(Object.fromEntries(Object.entries(src).filter(([k]) => k !== '_meta')));
  const sent = items.reduce((a, x) => a + x.text.length, 0);
  ok(sent < all.length / 2, '1: у модель іде більша частина звіту (' + sent + ' з ' + all.length + ')');

  /* ---------- 2. перевірка відповіді моделі ---------- */
  const short = items.map((it, i) => ({ id: String(i), text: it.text }));
  const good = { items: short.map(x => ({ id: x.id, text: 'T:' + x.text })) };
  ok(RT.validateTranslated(short, good).ok, '2: правильна відповідь відхилена');
  ok(RT.validateTranslated(short, { items: good.items.slice(1) }).reason === 'missing_items', '2: пропущений рядок не відхилено');
  ok(RT.validateTranslated(short, { items: good.items.concat([{ id: 'x', text: 'y' }]) }).reason === 'extra_items', '2: зайвий рядок не відхилено');
  const swapped = good.items.slice(); swapped[0] = { id: 'zz', text: 'a' };
  ok(RT.validateTranslated(short, { items: swapped }).reason === 'id_mismatch', '2: чужий id не відхилено');
  const empty = good.items.slice(); empty[1] = { id: '1', text: ' ' };
  ok(RT.validateTranslated(short, { items: empty }).reason === 'empty_text', '2: порожній переклад не відхилено');
  ok(!RT.validateTranslated(short, null).ok && !RT.validateTranslated(short, { report: {} }).ok, '2: звіт замість списку прийнято');
  ok(RT.validateTranslated([{ id: '0', text: 'a' }], { items: [{ id: '0', text: 'x \u2014 y' }] }).texts['0'] === 'x, y', '2: довге тире пройшло');

  /* ---------- 3. перекладений вигляд з оригіналу ---------- */
  const before = JSON.stringify(src);
  const texts = Object.fromEntries(items.map(it => [it.id, 'EN(' + it.text + ')']));
  const { view, applied } = RT.applyTranslations(src, items, texts);
  ok(JSON.stringify(src) === before, '3: оригінальний звіт змінився');
  ok(applied === items.length, '3: підставлено не всі рядки');
  const shape = v => Array.isArray(v) ? v.map(shape) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k])])) : typeof v;
  ok(JSON.stringify(shape(view)) === JSON.stringify(shape(src)), '3: структура звіту змінилась');
  const nums = v => Array.isArray(v) ? v.flatMap(nums) : (v && typeof v === 'object') ? Object.values(v).flatMap(nums) : (typeof v === 'number' ? [v] : []);
  ok(JSON.stringify(nums(view)) === JSON.stringify(nums(src)), '3: числа змінились');
  for (const k of ['score_breakdown', 'score_breakdown_v2', 'confidence', '_meta', '_chat']) ok(JSON.stringify(view[k]) === JSON.stringify(src[k]), '3: ' + k + ' змінився');
  ok(view.score_breakdown.items[0].evidence[0].unit_raw === 'km' && view.risks[0].level === 'high' && view.risks[0].kind === 'latent'
    && view.equipment_v2[0].value_tier === 'notable' && view.equipment_v2[1].factory_status === 'заводська опція' && view.risks[1].kind === 'прихований ризик' && view.vehicle.fuel === 'petrol' && view.history[0].date === '08.2014', '3: коди чи перелічення змінились');
  ok(view.final_conclusion.headline.startsWith('EN(') && view.equipment_v2[1].name === 'EN(Sunroof)', '3: текст не підставлено');
  /* розбіжність вихідного тексту: рядок не підміняється */
  const drift = REPORT(); drift.risks[0].title = 'Інший текст';
  ok(RT.applyTranslations(drift, items, texts).view.risks[0].title === 'Інший текст', '3: переклад ліг на інший вихідний текст');

  /* ---------- 4. відбиток джерела ---------- */
  const h = RT.translationHash(items, 'ru', 'en');
  ok(h === RT.translationHash(RT.extractTranslatable(REPORT()), 'ru', 'en'), '4: відбиток нестабільний');
  ok(h !== RT.translationHash(RT.extractTranslatable(drift), 'ru', 'en'), '4: змінений звіт має той самий відбиток');
  ok(h !== RT.translationHash(items, 'ru', 'ua') && h !== RT.translationHash(items, 'ua', 'en'), '4: відбиток не залежить від мов');

  /* ---------- 5. ендпоінт: один виклик, кеш, нічого з Check ---------- */
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.OPENAI_API_KEY = 'test';
  delete process.env.CHAT_MODEL; process.env.OPENAI_MODEL = 'm-test';
  const { default: handler } = await import('file://' + path.join(dir, 'check-translate.js'));
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
  function server(opts = {}) {
    const st = { row: { status: 'done', lang: opts.srcLang || 'ru', report: opts.report || REPORT(), translations: opts.translations || null }, calls: [], ai: [], patches: [] };
    global.fetch = async (url, init = {}) => {
      url = String(url); st.calls.push(url);
      if (url.startsWith('https://db.test/rest/v1/check_jobs') && (!init.method || init.method === 'GET')) {
        return { ok: true, status: 200, json: async () => [JSON.parse(JSON.stringify(st.row))] };
      }
      if (url.startsWith('https://db.test/rest/v1/check_jobs') && init.method === 'PATCH') {
        const b = JSON.parse(init.body); st.patches.push(b); Object.assign(st.row, b); return { ok: true, status: 204, json: async () => ({}) };
      }
      if (url === 'https://api.openai.com/v1/chat/completions') {
        const b = JSON.parse(init.body); st.ai.push(b);
        const list = JSON.parse(b.messages[1].content).items;
        const out = opts.reply ? opts.reply(list) : { items: list.map(x => ({ id: x.id, text: '[' + opts.target + ']' + x.text })) };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 0 } } }) };
      }
      throw new Error('unexpected fetch ' + url);
    };
    st.call = async (lang, headers = {}) => {
      const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
      const logBak = console.log; console.log = () => {};
      try { await handler({ method: 'POST', headers, body: { token: TOKEN, lang } }, res); } finally { console.log = logBak; }
      return res;
    };
    return st;
  }
  for (const [srcLang, target] of [['ua', 'en'], ['en', 'ua'], ['ru', 'en']]) {
    const s = server({ srcLang, target });
    const r1 = await s.call(target);
    ok(r1.code === 200 && r1.body.cached === false && Array.isArray(r1.body.items), srcLang + '->' + target + ': переклад не повернувся');
    ok(s.ai.length === 1, srcLang + '->' + target + ': викликів OpenAI ' + s.ai.length + ' замість одного');
    const ai = s.ai[0];
    ok(ai.reasoning_effort === 'low' && ai.model === 'm-test' && ai.response_format.type === 'json_schema', srcLang + '->' + target + ': не reasoning low або без схеми');
    ok(ai.messages.length === 2 && /translate/i.test(ai.messages[0].content) && ai.messages[0].content.includes({ en: 'English', ua: 'Ukrainian', ru: 'Russian' }[target]), srcLang + '->' + target + ': промпт не переклад або не та мова');
    ok(!/score_breakdown|confidence|unit_raw|_meta|WDC1668741A000001|Продаю|приватная/.test(ai.messages[1].content), srcLang + '->' + target + ': у модель пішло службове чи приватне');
    ok(JSON.parse(ai.messages[1].content).items.every((x, i) => x.id === String(i)), srcLang + '->' + target + ': модель отримує довгі шляхи замість коротких id');
    ok(s.calls.every(u => u.startsWith('https://db.test/rest/v1/check_jobs') || u === 'https://api.openai.com/v1/chat/completions'), srcLang + '->' + target + ': зайвий виклик ' + s.calls.join(', '));
    ok(s.patches.length === 1 && Object.keys(s.patches[0]).join() === 'translations' && s.patches[0].translations[target].hash === r1.body.hash, srcLang + '->' + target + ': кеш записано не туди або переписано звіт');
    ok(JSON.stringify(s.row.report) === JSON.stringify(REPORT()), srcLang + '->' + target + ': збережений звіт змінився');
    ok(r1.body.items.every(x => typeof x.src === 'string' && x.text.startsWith('[' + target + ']')), srcLang + '->' + target + ': відповідь без вихідного тексту');
    /* наступний глядач, гість і власник: той самий спільний кеш без OpenAI */
    const guest = await s.call(target);
    const owner = await s.call(target, { authorization: 'Bearer owner-jwt' });
    ok(guest.body.cached === true && owner.body.cached === true && s.ai.length === 1, srcLang + '->' + target + ': повтор пішов в OpenAI');
    ok(JSON.stringify(guest.body.items) === JSON.stringify(r1.body.items), srcLang + '->' + target + ': кеш дав інший переклад');
  }
  /* та сама мова: OpenAI не викликається */
  let s = server({ srcLang: 'ru', target: 'ru' });
  let r = await s.call('ru');
  ok(r.code === 200 && r.body.same === true && s.ai.length === 0 && s.patches.length === 0, 'та сама мова викликала переклад');
  /* звіт змінився: старий кеш не застосовується */
  s = server({ srcLang: 'ru', target: 'en' });
  await s.call('en');
  const stale = s.row.translations;
  s = server({ srcLang: 'ru', target: 'en', report: drift, translations: stale });
  r = await s.call('en');
  ok(r.body.cached === false && s.ai.length === 1, 'кеш застосовано до зміненого звіту');
  /* модель загубила чи додала рядок: відмова, кеш не пишеться */
  for (const [name, reply] of [['missing', l => ({ items: l.slice(1).map(x => ({ id: x.id, text: x.text })) })], ['extra', l => ({ items: l.concat([{ id: '999', text: 'x' }]) })], ['report', () => ({ report: {} })]]) {
    s = server({ srcLang: 'ru', target: 'en', reply });
    r = await s.call('en');
    ok(r.code === 502 && s.patches.length === 0, name + ': невалідна відповідь моделі прийнята');
  }
  /* збій OpenAI: помилка, звіт цілий */
  s = server({ srcLang: 'ru', target: 'en' });
  global.fetch = (orig => async (url, init) => url === 'https://api.openai.com/v1/chat/completions' ? { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) } : orig(url, init))(global.fetch);
  r = await s.call('en');
  ok(r.code === 502 && s.patches.length === 0 && JSON.stringify(s.row.report) === JSON.stringify(REPORT()), 'збій OpenAI зіпсував звіт або кеш');
  /* джерело ендпоінта: жодного етапу Check */
  const ep = fs.readFileSync('api/check-translate.js', 'utf8');
  ok(!/from '\.\/(check|conclusion|current-visual|mi-research|mi-equipment|value|vehicle-memory|youtube)\.js'/.test(ep), 'ендпоінт перекладу тягне етапи Check');
  ok(!/report:\s*translated|data\.report/.test(ep), 'ендпоінт приймає звіт від моделі');

  /* ---------- 6. сторінка: вигляд з оригіналу, кеш, перебіг, дубль ---------- */
  const page = fs.readFileSync('result-check.html', 'utf8');
  const block = page.slice(page.indexOf('const TR = { view: null'), page.indexOf('/* ---------- ринкова вартість'));
  const offerSrc = page.slice(page.indexOf('function trOffer('), page.indexOf('function reportLocaleTag('));
  ok(/<span class="tr-spin" id="trSpin" hidden aria-hidden="true"><\/span>/.test(page) && /<span id="trMsg">This report was created in another language<\/span><span class="tr-hint" id="trHint" hidden><\/span>/.test(page), 'банер без спінера чи підказки');
  function client(opts = {}) {
    let now = 1000000;
    const timers = [];
    let seq = 0;
    const add = (fn, ms, every) => { const id = ++seq; timers.push({ id, at: now + ms, fn, every }); return id; };
    const clear = id => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); };
    const advance = ms => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; now = t.at; if (t.every) t.at += t.every; else timers.shift(); t.fn(); } now = end; };
    const el = () => ({ hidden: true, disabled: false, textContent: '', style: { display: 'none' }, onclick: null });
    const els = { trBtn: el(), trMsg: el(), trHint: el(), trSpin: el(), trBar: el(), trClose: el() };
    const DATA = REPORT();
    const before = JSON.stringify(DATA);
    const store = Object.assign({}, opts.session || {});
    const st = { fetches: [], rendered: [], pending: null };
    const dict = { 'Translating the report… {n} sec': 'Переводим отчёт… {n} сек.' };
    const ctx = vm.createContext({
      console: { warn() {}, log() {} }, JSON, Math, Array, Object, String, Number, Error,
      Date: { now: () => now },
      setTimeout: (fn, ms) => add(fn, ms), clearTimeout: clear, setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: clear,
      $: id => els[id], DATA, M: DATA._meta, OPEN_TOKEN: 'AbCdEfGhIjKlMnOpQrStUv', ROW_ID: null, REPORT_LOCALE: 'ru',
      window: { calcarLang: () => opts.viewer || 'en', calcarResolveLocale: x => ({ uk: 'ua', ua: 'ua', ru: 'ru' }[String(x)] || 'en'), t: s => dict[s] || s },
      sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      localizeReportStatic: l => st.rendered.push('static:' + l), boot2: d => st.rendered.push(d === DATA ? 'original' : 'translated:' + d.final_conclusion.headline),
      ensureShareToken: async () => null,
      fetch: (url, init) => { st.fetches.push({ url, body: JSON.parse(init.body) }); return new Promise(res => { st.pending = res; }); },
    });
    vm.runInContext(offerSrc + block + '\nthis.trClick = trClick; this.translateNow = translateNow; this.trSetup = trSetup; this.TRs = () => TR;', ctx);
    const respond = (code, body) => st.pending({ ok: code === 200, status: code, json: async () => body });
    const serverItems = RT.extractTranslatable(REPORT()).map(it => ({ id: it.id, src: it.text, text: 'EN:' + it.text }));
    return { ctx, els, st, advance, respond, serverItems, store, DATA, before, flush: () => new Promise(r => setImmediate(r)) };
  }
  /* таймер стартує із запитом, +1 щосекунди, >20 с інша підказка, зупиняється на успіху */
  let c = client();
  c.ctx.trSetup();
  ok(c.els.trBar.style.display === '' && typeof c.els.trBtn.onclick === 'function', '6: банер не показано');
  c.els.trBtn.onclick(); await c.flush();
  c.els.trBtn.onclick(); await c.flush();
  ok(c.st.fetches.length === 1 && c.st.fetches[0].url === '/api/check-translate' && c.st.fetches[0].body.token === 'AbCdEfGhIjKlMnOpQrStUv' && c.st.fetches[0].body.lang === 'en' && !c.st.fetches[0].body.report, '6: запит перекладу не той або дубль (' + c.st.fetches.length + ')');
  ok(c.els.trBtn.disabled === true, '6: кнопка не вимкнена під час перекладу');
  ok(c.els.trSpin.hidden === true, '6: перебіг блимнув до затримки');
  c.advance(400);
  ok(c.els.trSpin.hidden === false && c.els.trMsg.textContent === 'Переводим отчёт… 1 сек.' && c.els.trHint.textContent === 'Usually this takes about 15-30 seconds.', '6: перебіг не почався з 1 с: ' + c.els.trMsg.textContent);
  c.advance(1000);
  ok(c.els.trMsg.textContent === 'Переводим отчёт… 2 сек.', '6: лічильник не +1 за секунду: ' + c.els.trMsg.textContent);
  c.advance(1000);
  ok(c.els.trMsg.textContent === 'Переводим отчёт… 3 сек.', '6: лічильник не +1 за секунду: ' + c.els.trMsg.textContent);
  c.advance(17000);
  ok(c.els.trMsg.textContent === 'Переводим отчёт… 20 сек.' && c.els.trHint.textContent === 'Usually this takes about 15-30 seconds.', '6: звичайна підказка зникла до кінця звичного часу');
  c.advance(11000);
  ok(c.els.trMsg.textContent === 'Переводим отчёт… 31 сек.' && c.els.trHint.textContent === 'Large reports can take a little longer.', '6: після звичного часу (30 с) підказка не змінилась');
  c.respond(200, { items: c.serverItems }); await c.flush(); await c.flush();
  const shownAt = c.els.trMsg.textContent;
  c.advance(5000);
  ok(shownAt === 'The report has been translated into English' && c.els.trMsg.textContent === shownAt && c.els.trSpin.hidden === true && c.els.trBtn.textContent === 'Show original' && c.els.trBtn.disabled === false, '6: після успіху таймер не зупинився або немає "Показати оригінал"');
  ok(c.st.rendered.slice(-2).join() === 'static:en,translated:EN:' + REPORT().final_conclusion.headline, '6: перекладений вигляд не показано: ' + c.st.rendered.slice(-2).join());
  ok(JSON.stringify(c.DATA) === c.before, '6: оригінал DATA змінився');
  /* "Показати оригінал" миттєво без API, повторний переклад з памʼяті */
  c.els.trBtn.onclick(); await c.flush();
  ok(c.st.fetches.length === 1 && c.st.rendered.slice(-1)[0] === 'original' && c.els.trBtn.textContent === 'Translate', '6: "Показати оригінал" не миттєвий або викликав API');
  c.els.trBtn.onclick(); await c.flush();
  ok(c.st.fetches.length === 1 && c.st.rendered.slice(-1)[0].startsWith('translated:'), '6: повтор перекладу пішов на сервер');
  /* кеш вкладки: без запиту і без перебігу */
  c = client({ session: { ['calcarTr:AbCdEfGhIjKlMnOpQrStUv:en']: JSON.stringify(RT.extractTranslatable(REPORT()).map(it => ({ id: it.id, src: it.text, text: 'EN:' + it.text }))) } });
  c.ctx.trSetup(); c.els.trBtn.onclick(); await c.flush(); await c.flush(); c.advance(3000);
  ok(c.st.fetches.length === 0 && c.els.trSpin.hidden === true && c.els.trMsg.textContent === 'The report has been translated into English', '6: кеш вкладки пішов на сервер або показав таймер');
  /* швидка відповідь сервера (спільний кеш): перебіг не зʼявляється */
  c = client(); c.ctx.trSetup(); c.els.trBtn.onclick(); await c.flush();
  c.advance(150); c.respond(200, { items: c.serverItems, cached: true }); await c.flush(); await c.flush(); c.advance(2000);
  ok(c.els.trSpin.hidden === true && !/сек/.test(c.els.trMsg.textContent), '6: кешована відповідь показала довгий перебіг');
  /* помилка: таймер стоп, оригінал, можна повторити */
  c = client(); c.ctx.trSetup(); c.els.trBtn.onclick(); await c.flush(); c.advance(3400);
  c.respond(502, { error: 'x' }); await c.flush(); await c.flush();
  const errMsg = c.els.trMsg.textContent; c.advance(4000);
  ok(errMsg === 'Could not translate the report.' && c.els.trMsg.textContent === errMsg && c.els.trBtn.textContent === 'Try again' && c.els.trBtn.disabled === false && c.els.trSpin.hidden === true, '6: помилка не зупинила таймер або не дає повторити');
  ok(!c.st.rendered.some(x => String(x).startsWith('translated')) && JSON.stringify(c.DATA) === c.before, '6: після помилки показано не оригінал');
  c.els.trBtn.onclick(); await c.flush();
  ok(c.st.fetches.length === 2, '6: повтор після помилки не запускає переклад');
  /* сервер повернув рядок, якого в цьому звіті немає: не змішуємо мови */
  c = client(); c.ctx.trSetup(); c.els.trBtn.onclick(); await c.flush();
  const bad = c.serverItems.slice(); bad[0] = Object.assign({}, bad[0], { src: 'інший текст' });
  c.respond(200, { items: bad }); await c.flush(); await c.flush();
  ok(c.els.trMsg.textContent === 'Could not translate the report.' && !c.st.rendered.some(x => String(x).startsWith('translated')), '6: розбіжний переклад застосовано');
  /* та сама мова: банера і запиту немає */
  c = client({ viewer: 'ru' }); c.ctx.trSetup(); await c.ctx.translateNow();
  ok(c.els.trBar.style.display === 'none' && c.st.fetches.length === 0, '6: та сама мова показала банер або пішла в API');

  if (errs.length) { console.log('TRANSLATE TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('translate: у модель лише текст для людини · id/порядок/кількість перевіряються · вигляд з оригіналу, Score/Confidence/коди/числа незмінні · спільний кеш токен+мова+відбиток (гість і власник) · один виклик, reasoning low, без етапів Check · банер: прошедший час, >20 с інша підказка, стоп на успіху і помилці, без дубля, оригінал без API');
  console.log('TRANSLATE TEST PASSED');
})().catch(e => { console.error('TRANSLATE TEST CRASHED', e); process.exit(1); });
