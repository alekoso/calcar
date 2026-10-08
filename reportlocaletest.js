/* Мова звіту Check: одна локаль на весь звіт.
   Локаль фіксується один раз при старті Check (сторінка надсилає поточну
   мову інтерфейсу), сервер приводить її до одного значення, і саме воно
   йде в усі етапи: основний аналіз, Vision поточних фото, історичний візуал,
   Final Conclusion, Market Value / Liquidity / Why-price, рядок job,
   _meta.lang і лист "звіт готовий". Повний прогін моделі тут неможливий,
   тому перевіряються: (1) серверна проводка локалі без другого джерела,
   (2) для RU, UA і EN кожен етап отримує директиву саме цієї мови, а
   текст, який пише сам код, не містить літер іншої мови, (3) сторінка
   звіту: зміна мови інтерфейсу після збереження не чіпає текст звіту і
   показує наявну плашку "звіт іншою мовою / перекласти". */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const errs = [];
const ok = (cond, msg) => { if (!cond) errs.push(msg); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_locale_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
const LANGS = ['ru', 'ua', 'en'];
/* літери, яких у тексті цієї мови бути не може */
const FOREIGN = { en: /[А-Яа-яЁёІіЇїЄєҐґ]/, ru: /[іїєґІЇЄҐ]/, ua: /[ыэъёЫЭЪЁ]/ };
const NAME = { ru: 'російською', ua: 'українською', en: 'англійською (English)' };

(async () => {
  const L = await import('file://' + path.join(dir, 'api', 'locale.js'));
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const F = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const V = await import('file://' + path.join(dir, 'api', 'value.js'));
  const CV = await import('file://' + path.join(dir, 'api', 'current-visual.js'));
  const E = await import('file://' + path.join(dir, 'api', 'check-email.js'));
  const src = fs.readFileSync('api/check.js', 'utf8');
  const run = src.slice(src.indexOf('async function runCheck('));

  /* ---- 1. серверна проводка: одне джерело локалі на весь Check ---- */
  ok(/const jobLang = resolveLocale\(req\.body\?\.lang\);/.test(src) && /jobCreate\(\{ token, status: 'queued', stage: 'queued', url: jobUrl\.split\('#'\)\[0\], lang: jobLang,/.test(src), 'job: локаль рядка не з запиту старту');
  ok((run.match(/const lang = resolveLocale\(req\.body\?\.lang\);/g) || []).length === 1, 'runCheck: локаль має фіксуватися рівно один раз');
  ok((run.match(/\blang\s*=[^=>]/g) || []).length === 1, 'runCheck: локаль перепризначається під час аналізу');
  ok((src.match(/languageDirective\(/g) || []).length === 1 && /const langDirective = languageDirective\(lang\);/.test(run), 'check.js: директива мови має будуватись один раз з lang');
  ok(/PROMPT\(listing, nhtsa, auction, langDirective,/.test(run), 'основний аналіз без директиви мови звіту');
  ok(/text: langDirective \+ '\\n\\n' \+ SIDE_RULE/.test(run), 'історичний візуал без директиви мови звіту');
  ok(/content: \[\{ type: 'text', text: currentVisualLanguageNote\(lang\) \}/.test(run), 'Vision поточних фото без мови пояснень звіту');
  ok(/valueResearch\.analyze\(\{\s*langDirective,/.test(run), 'Market Value / Liquidity без директиви мови звіту');
  ok(/runProductionConclusion\(\{ report: parsed, langDirective, callModel,/.test(run), 'Final Conclusion бере не ту саму директиву');
  ok(/attachFinalConclusion\(parsed, fc, lang\)/.test(run), 'постобробка Final Conclusion не з мовою звіту');
  ok(/parsed\._meta = \{\s*kind: 'check',\s*lang,/.test(run), '_meta.lang не зберігає локаль звіту');
  ok(/const lang = resolveLocale\(row\.lang\);/.test(fs.readFileSync('api/check-email.js', 'utf8')), 'лист бере мову не з рядка job');
  ok(!/process\.env\.\w*LANG|DEFAULT_LOCALE/.test(fs.readFileSync('api/conclusion.js', 'utf8')), 'Final Conclusion має власну мову за замовчуванням');

  /* ---- 2. кожна мова: кожен етап отримує директиву саме цієї мови ---- */
  const REPORT = { vehicle: { title: 'BMW X5 2019', year: 2019 }, verdict: { score: 7 }, score_breakdown: { final: 7.1 }, risks: [], _meta: { lang: 'en' } };
  for (const lang of LANGS) {
    const dirv = L.languageDirective(lang);
    ok(dirv.includes(NAME[lang]), lang + ': директива називає іншу мову');
    /* Final Conclusion: саме ця директива в повідомленні моделі */
    const calls = [];
    const fc = await F.runFinalConclusion({ report: REPORT, langDirective: dirv, env: { FINAL_CONCLUSION: 'on', CONCLUSION_MODEL: 'm', OPENAI_MODEL: 'm' },
      callModel: async body => { calls.push(body); return { error: { message: 'offline' } }; } });
    ok(calls.length > 0, lang + ': Final Conclusion не дійшов до моделі (' + fc.reason + ')');
    for (const b of calls) {
      const user = b.messages.find(m => m.role === 'user').content;
      ok(user.startsWith(dirv), lang + ': Final Conclusion отримав іншу директиву мови');
      for (const other of LANGS.filter(x => x !== lang)) ok(!user.includes(L.languageDirective(other)), lang + ': у Final Conclusion директива ' + other);
    }
    /* Market Value / Liquidity / Why-price */
    const vu = V.valueUserMessage({ langDirective: dirv, vehicle: { make: 'BMW', model: 'X5', year: 2019 }, market: { country: 'UA', currency: 'USD' }, results: [], modelContext: null });
    ok(vu.includes(dirv), lang + ': Market Value без директиви цієї мови');
    /* Vision поточних фото: пояснення мовою звіту, назви для словника не чіпаються */
    const note = CV.currentVisualLanguageNote(lang);
    ok(note.includes('пиши ' + NAME[lang]) && /normalized_name/.test(note) && /дослівно/.test(note), lang + ': мова пояснень Vision');
    /* текст, який пише сам код, теж мовою звіту */
    const parsed = { vehicle: { title: 'X5' }, _meta: {} };
    C.attachFinalConclusion(parsed, { status: 'ok', version: 'v', conclusion: { headline: { ru: 'Состояние выглядит ухоженным', ua: 'Стан виглядає доглянутим', en: 'The car looks well kept' }[lang], body: { ru: 'История подтверждена.', ua: 'Історія підтверджена.', en: 'The history is confirmed.' }[lang] } }, lang);
    ok(!FOREIGN[lang].test(JSON.stringify(parsed.final_conclusion)), lang + ': постобробка Final Conclusion вставила іншу мову: ' + JSON.stringify(parsed.final_conclusion));
    for (const d of ['AWD', 'FWD', 'RWD', '4WD', 'all wheel drive']) ok(!FOREIGN[lang].test(C.localizeDrive(d, lang)), lang + ': привід ' + d + ' не тією мовою: ' + C.localizeDrive(d, lang));
    const mail = E.buildReportEmail({ lang, title: 'BMW X5', link: 'https://calcar.io/check/ABC234?src=email' });
    ok(!FOREIGN[lang].test(mail.subject + mail.text), lang + ': лист не тією мовою');
    for (const k of ['internal', 'check_timeout', 'bad_email', 'email_unavailable']) ok(!FOREIGN[lang].test(L.errText(lang, k)), lang + ': помилка ' + k + ' не тією мовою');
  }
  /* ознака Vision тепер мовою звіту: сумнів розпізнається на всіх трьох мовах */
  for (const s of ['Здається, інший відтінок дверей', 'Кажется, оттенок двери другой', 'Похоже на блик', 'Seems like a different shade', 'Возможно, отражение']) ok(CV.SOFT_SIGN_RE.test(s), 'SOFT_SIGN_RE не розпізнає сумнів: ' + s);
  ok(!CV.SOFT_SIGN_RE.test('Чітко видно різний відтінок дверей') && !CV.SOFT_SIGN_RE.test('Отчётливо виден другой оттенок двери'), 'SOFT_SIGN_RE спрацював на впевнену ознаку');

  /* ---- 3. сторінка: локаль фіксується на старті ---- */
  const ch = fs.readFileSync('check.html', 'utf8');
  ok(/const reqLang = window\.calcarLang\(\);/.test(ch) && /body: JSON\.stringify\(\{ url, lang: reqLang \}\)/.test(ch), 'check.html: старт Check не передає мову інтерфейсу');
  ok(/pendingSet\(\{ token, url, at: Date\.now\(\), lang: reqLang \}\);/.test(ch), 'check.html: задача, що триває, не памʼятає мову, якою її запущено');
  ok((ch.match(/fetch\('\/api\/check',/g) || []).length === 1, 'check.html: Check стартує не з одного місця');
  const resume = ch.slice(ch.indexOf('async function resumePending('), ch.indexOf('async function safeJson('));
  ok(!/\/api\/check'/.test(resume), 'check.html: відновлення аналізу перезапускає Check з новою мовою');

  /* ---- 3b. поведінка сторінки: мова звіту = мова інтерфейсу в момент старту ----
     Регресія: Check запущено мовою з браузера (UA), людина явно перемкнула
     мову (меню перезавантажує сторінку), а resumePending() підхопив стару
     UA-задачу, і RU-користувач отримав UA-звіт з плашкою перекладу.
     Мову оголошення і країну майданчика сторінка не дивиться взагалі. */
  {
    const fnSrc = name => { const i = ch.indexOf('async function ' + name + '('); return ch.slice(i, ch.indexOf('\n}\n', i) + 3); };
    const helpers = ch.slice(ch.indexOf("const PENDING_KEY = 'calcar_pending_check';"), ch.indexOf('function pendingSet(')) + ch.slice(ch.indexOf('function pendingSet('), ch.indexOf('\n', ch.indexOf('function pendingSet(')));
    const LISTINGS = {
      ua: 'https://auto.ria.com/uk/auto_volkswagen_touareg_38000001.html',
      ru: 'https://www.avito.ru/moskva/avtomobili/bmw_x5_2020_1234567890',
      de: 'https://suchen.mobile.de/fahrzeuge/details.html?id=412345678',
      pl: 'https://www.otomoto.pl/osobowe/oferta/audi-a6-ID6Gabc1.html',
    };
    function sandbox(uiLang, pending) {
      const store = {}, calls = { bodies: [], timers: 0, polled: [], href: null };
      if (pending) store.calcar_pending_check = JSON.stringify(pending);
      const ctx = vm.createContext({
        window: { calcarLang: () => uiLang, __forceReanalyze: false },
        localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
        input: { value: '', blur() {} }, btn: { disabled: false }, statusEl: { className: '' }, location: {},
        document: { getElementById: () => null },
        t: s => s, setStatus() {}, esc: s => s, marketplaceOf: () => 'x', checkIndex: () => [],
        loadingStart: () => 1, loadingFinish: async () => {}, loadingError() {}, emailBoxShow() {}, emailBoxHide() {},
        trackCompleted() {}, findExistingCheck: async () => { calls.existing = true; return null; },
        fetch: async (u, o) => { calls.bodies.push(JSON.parse(o.body)); return { ok: true, status: 202, json: async () => ({ job: 'tok-new-' + calls.bodies.length }) }; },
        safeJson: r => r.json(),
        pollJob: async tok => { calls.polled.push(tok); return { _meta: { lang: JSON.parse(store.calcar_pending_check || '{}').lang } }; },
        finalizeReport: async (d, tok) => '/check/r/x/' + tok,
        setTimeout: f => { calls.timers++; f(); },
      });
      vm.runInContext(helpers + '\n' + fnSrc('run') + '\n' + fnSrc('resumePending'), ctx);
      return { ctx, store, calls };
    }
    const settle = () => new Promise(r => setImmediate(r));

    /* старт: мова запиту = мова інтерфейсу, незалежно від мови/країни оголошення */
    for (const [ui, listing] of [['ru', 'ua'], ['ua', 'ru'], ['en', 'de'], ['en', 'ua'], ['en', 'pl'], ['ru', 'de']]) {
      const sb = sandbox(ui, null);
      sb.ctx.input.value = LISTINGS[listing];
      await sb.ctx.run();
      const pj = JSON.parse(sb.store.calcar_pending_check || '{}');
      ok(sb.calls.bodies.length === 1 && sb.calls.bodies[0].lang === ui, 'UI ' + ui + ' + оголошення ' + listing + ': Check стартував мовою ' + (sb.calls.bodies[0] || {}).lang);
      ok(pj.lang === ui, 'UI ' + ui + ' + оголошення ' + listing + ': задача збережена без мови інтерфейсу');
      ok(L.resolveLocale(sb.calls.bodies[0] && sb.calls.bodies[0].lang) === ui, 'UI ' + ui + ': сервер привів мову запиту до іншої');
      ok(sb.ctx.location.href === '/check/r/x/tok-new-1', 'UI ' + ui + ': після старту не відкрито новий звіт');
    }

    /* відновлення тією самою мовою: стара задача, без нового Check */
    for (const l of LANGS) {
      const sb = sandbox(l, { token: 'tok-old', url: LISTINGS.ua, at: Date.now(), lang: l });
      ok(await sb.ctx.resumePending() === true, l + ': задача тією самою мовою не відновилась');
      ok(sb.calls.bodies.length === 0 && sb.calls.polled[0] === 'tok-old' && sb.ctx.location.href === '/check/r/x/tok-old', l + ': задача тією самою мовою перезапущена замість відновлення');
    }

    /* явна зміна мови між стартом і відновленням: нова задача мовою інтерфейсу */
    for (const [was, now] of [['ua', 'ru'], ['ru', 'ua'], ['ua', 'en'], ['en', 'ru']]) {
      const sb = sandbox(now, { token: 'tok-old', url: LISTINGS.ua, at: Date.now(), lang: was });
      ok(await sb.ctx.resumePending() === true, was + '->' + now + ': сторінка не взяла задачу на себе');
      await settle(); await settle();
      ok(!sb.calls.polled.includes('tok-old'), was + '->' + now + ': підхоплено стару задачу мовою ' + was);
      ok(sb.calls.timers === 1 && sb.calls.bodies.length === 1 && sb.calls.bodies[0].lang === now && sb.calls.bodies[0].url === LISTINGS.ua, was + '->' + now + ': новий Check не стартував мовою інтерфейсу');
      ok(!sb.calls.existing, was + '->' + now + ': перезапуск зупинився на "вже перевіряв"');
      ok(JSON.parse(sb.store.calcar_pending_check || '{}').lang === now && JSON.parse(sb.store.calcar_pending_check || '{}').token === 'tok-new-1', was + '->' + now + ': у сховищі лишилась стара задача');
      ok(sb.ctx.location.href === '/check/r/x/tok-new-1', was + '->' + now + ': відкрито не новий звіт');
    }

    /* старі записи без мови (до виправлення): відновлюються як раніше */
    {
      const sb = sandbox('ru', { token: 'tok-legacy', url: LISTINGS.ua, at: Date.now() });
      await sb.ctx.resumePending();
      ok(sb.calls.bodies.length === 0 && sb.calls.polled[0] === 'tok-legacy', 'запис без мови перезапущено замість відновлення');
    }
    /* прострочена задача: нічого не відновлюється і не стартує */
    {
      const sb = sandbox('ru', { token: 'tok-stale', url: LISTINGS.ua, at: Date.now() - 21 * 60 * 1000, lang: 'ua' });
      ok(await sb.ctx.resumePending() === false && sb.calls.bodies.length === 0 && sb.calls.polled.length === 0 && !sb.store.calcar_pending_check, 'прострочена задача відновилась або перезапустилась');
    }
    /* сервер: мова лише з запиту; ні визначення мови тексту, ні країни майданчика */
    ok(!/franc|langdetect|detectLang|guessLang|detectLanguage/i.test(src), 'check.js: зʼявилось визначення мови з тексту оголошення');
    ok(!/lang\s*[:=][^\n;]*\b(marketplace|country|host)\b/i.test(run), 'runCheck: мова звіту залежить від майданчика чи країни');
  }

  /* ---- 4. звіт: зміна мови інтерфейсу після збереження ---- */
  const rc = fs.readFileSync('result-check.html', 'utf8');
  ok((rc.match(/\btranslateNow\b/g) || []).length === 2 && /async function translateNow\(\)\{/.test(rc) && /function trClick\(\)\{\n  if \(TR\.busy\) return;\n  if \(TR\.shown === 'translated'\) \{ showOriginal\(\); return; \}\n  translateNow\(\);\n\}/.test(rc), 'result-check.html: переклад викликається не лише кнопкою банера');
  ok(/\n  trSetup\(\);\n  if \(!READONLY\) chatInit\(\);/.test(rc), 'result-check.html: плашка перекладу не налаштовується при показі звіту (і гостю теж)');
  ok(!/body\.readonly #trBar/.test(rc), 'result-check.html: гість за публічним посиланням не бачить пропозиції перекладу');
  ok(/<div class="trbar" id="trBar" style="display:none">[\s\S]{0,200}This report was created in another language[\s\S]{0,120}id="trBtn"[^>]*>Translate</.test(rc), 'result-check.html: плашки "звіт іншою мовою / перекласти" немає');
  const trSrc = rc.slice(rc.indexOf('function trOffer('), rc.indexOf('function reportLocaleTag(')) + rc.slice(rc.indexOf('const TR = { view: null'), rc.indexOf('/* ---------- ринкова вартість'));
  const RES = x => { const n = String(x || '').toLowerCase(); return n === 'uk' || n === 'ua' ? 'ua' : n === 'ru' ? 'ru' : 'en'; };
  function page(reportLang, uiLang, translations) {
    const els = {}, calls = { fetch: 0, applied: [] };
    const el = id => els[id] || (els[id] = { style: { display: 'none' }, listeners: [], addEventListener(n, f) { this.listeners.push(n); } });
    const DATA = { vehicle: { title: 'BMW X5' }, final_conclusion: { headline: 'Исходный текст' }, translations, _meta: { lang: reportLang } };
    const before = JSON.stringify(DATA);
    const ctx = vm.createContext({ window: { calcarLang: () => uiLang, calcarResolveLocale: RES, t: s => s }, M: DATA._meta, DATA, ROW_ID: 'r1', $: el,
      REPORT_LOCALE: reportLang, localizeReportStatic: l => { calls.static = l; },
      sessionStorage: { getItem: () => null, setItem() {} }, fetch: () => { calls.fetch++; }, boot2: d => calls.applied.push(d) });
    vm.runInContext(trSrc + '\ntrSetup();\nthis.translateNow = translateNow;', ctx);
    return { els, calls, DATA, before, ctx };
  }
  for (const [rl, ui] of [['ru', 'ua'], ['ua', 'en'], ['en', 'ru'], ['ru', 'en']]) {
    const p = page(rl, ui, undefined);
    ok(p.els.trBar && p.els.trBar.style.display === '', rl + '->' + ui + ': плашка перекладу не показана');
    ok(typeof p.els.trBtn.onclick === 'function' && p.calls.fetch === 0 && p.calls.applied.length === 0, rl + '->' + ui + ': переклад запущено без натискання');
    ok(JSON.stringify(p.DATA) === p.before, rl + '->' + ui + ': текст звіту змінився від зміни мови інтерфейсу');
  }
  for (const l of LANGS) {
    const p = page(l, l, undefined);
    ok(!p.els.trBar || p.els.trBar.style.display === 'none', l + ': плашка показана, хоча мова звіту збігається з інтерфейсом');
  }
  /* старий повний переклад від моделі (DATA.translations) не застосовується
     ніколи: перекладений вигляд складається лише з оригіналу і рядків за id
     (translatetest.js); без натискання нічого не перекладається */
  const pc = page('ru', 'en', { en: { final_conclusion: { headline: 'Cached' } } });
  ok(pc.calls.applied.length === 0 && pc.calls.fetch === 0 && pc.els.trBar.style.display === '', 'збережений переклад підставлено без натискання');
  ok(!/DATA\.translations/.test(rc) && !/function applyTranslation\(/.test(rc), 'сторінка знову бере повний звіт-переклад від моделі');
  /* старий звіт без _meta.lang: без плашки, як і раніше */
  const pOld = page(undefined, 'ua', undefined);
  ok(!pOld.els.trBar || pOld.els.trBar.style.display === 'none', 'звіт без мови показав плашку перекладу');

  /* ---- 5. звіт цілком мовою створення: підписи, контролі, числа ---- */
  {
    const main = rc.slice(rc.indexOf('<script>\n/* ---------- мова самого звіту'));
    ok(/^<script>\n\/\* ---------- мова самого звіту[\s\S]{0,900}?\nlet REPORT_LOCALE = null;\nconst t = \(s, l\) => window\.t\(s, l \|\| REPORT_LOCALE \|\| undefined\);/.test(main), 'код звіту перекладає мовою глядача, а не звіту');
    ok(/el\.closest\('#trBar,script,style,template,noscript,textarea'\)/.test(rc), 'плашка перекладу переходить на мову звіту');
    ok(/document\.querySelector\('\.wrap'\), document\.getElementById\('ytModal'\), document\.getElementById\('sellerSheet'\), document\.getElementById\('miPop'\)/.test(rc), 'не всі частини звіту перекладаються мовою звіту');
    ok(/if \(document\.readyState === 'loading'\) \{ document\.addEventListener\('DOMContentLoaded', boot, \{ once: true \}\); return; \}\n  M = DATA\._meta \|\| \{\};\n  REPORT_LOCALE = M\.lang \? window\.calcarResolveLocale\(M\.lang\) : null;\n  ensureDict\(REPORT_LOCALE\)\.then\(bootRender\);/.test(rc), 'звіт рендериться до ядра i18n або без мови звіту');
    ok(/function bootRender\(\)\{\n  localizeReportStatic\(REPORT_LOCALE \|\| window\.calcarLang\(\)\);\n  boot2\(DATA\);/.test(rc), 'підписи звіту не переводяться на мову звіту перед рендером');
    ok(/const nf = n => Number\(n\)\.toLocaleString\(reportLocaleTag\(\)\);/.test(rc), 'числа звіту форматуються мовою глядача');
    const trSetSrc = rc.slice(rc.indexOf('function trSet(state){'), rc.indexOf('function trStop('));
    ok(/window\.t\('Translating the report… \{n\} sec'\)/.test(trSetSrc) && /btn\.textContent = window\.t\('Translate'\)/.test(trSetSrc) && !/[^.\w]t\(/.test(trSetSrc), 'плашка перекладу пише мовою звіту, а не глядача');
    /* поведінка: глядач UA, звіт EN -> тексти звіту англійською, плашка українською */
    const dict = { ua: { Mileage: 'Пробіг', Translate: 'Перекласти' }, ru: { Mileage: 'Пробег', Translate: 'Перевести' } };
    for (const [report, viewer, want] of [['en', 'ua', 'Mileage'], ['ua', 'en', 'Пробіг'], ['ru', 'ru', 'Пробег']]) {
      const c = vm.createContext({ window: { calcarLang: () => viewer, calcarResolveLocale: RES, t: (s, l) => ((dict[l || viewer] || {})[s] || s) } });
      vm.runInContext(main.slice(main.indexOf('let REPORT_LOCALE = null;'), main.indexOf('function reportLocaleTag(')) + rc.slice(rc.indexOf('function localizeReportStatic('), rc.indexOf('const SB = (typeof supabase')) + '\nconst REPORT_TEXT = [];\nREPORT_LOCALE = ' + JSON.stringify(report) + ';\nthis.t = t; this.trOffer = trOffer; this.localize = localizeReportStatic; this.RT = REPORT_TEXT;', c);
      ok(c.t('Mileage') === want, report + ' звіт, ' + viewer + ' глядач: текст звіту "' + c.t('Mileage') + '", а не мовою звіту');
      ok(c.window.t('Translate') === (viewer === 'en' ? 'Translate' : dict[viewer].Translate), report + '/' + viewer + ': оболонка не мовою глядача');
      ok(c.trOffer(report, viewer) === (report !== viewer), report + '/' + viewer + ': пропозиція перекладу ' + (report !== viewer ? 'відсутня' : 'зайва'));
      /* статичний підпис розмітки: з англійської вихідної фрази мовою звіту */
      const node = { isConnected: true, nodeValue: 'вже мовою глядача' };
      c.RT.push([node, null, 'Mileage']);
      c.localize(report);
      ok(node.nodeValue === want, report + '/' + viewer + ': підпис розмітки "' + node.nodeValue + '"');
    }
  }

  if (errs.length) { console.log('reportlocaletest: FAIL\n- ' + errs.join('\n- ')); process.exit(1); }
  console.log('reportlocaletest: OK (RU, UA, EN: одна локаль на всі етапи; зміна мови інтерфейсу лише показує плашку перекладу)');
})().catch(e => { console.error('reportlocaletest: crashed', e); process.exit(1); });
