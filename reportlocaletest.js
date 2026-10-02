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
  ok(/runFinalConclusion\(\{ report: parsed, langDirective, callModel,/.test(run), 'Final Conclusion бере не ту саму директиву');
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
  ok(/body: JSON\.stringify\(\{ url, lang: window\.calcarLang\(\) \}\)/.test(ch), 'check.html: старт Check не передає мову інтерфейсу');
  ok((ch.match(/fetch\('\/api\/check',/g) || []).length === 1, 'check.html: Check стартує не з одного місця');
  const resume = ch.slice(ch.indexOf('async function resumePending('), ch.indexOf('async function safeJson('));
  ok(!/\/api\/check'/.test(resume), 'check.html: відновлення аналізу перезапускає Check з новою мовою');

  /* ---- 4. звіт: зміна мови інтерфейсу після збереження ---- */
  const rc = fs.readFileSync('result-check.html', 'utf8');
  ok((rc.match(/translateNow\(/g) || []).length === 1 && /async function translateNow\(\)/.test(rc) && (rc.match(/translateNow\b/g) || []).length === 2, 'result-check.html: переклад викликається не лише кнопкою');
  ok(/if \(!READONLY\) \{ trSetup\(\);/.test(rc), 'result-check.html: плашка перекладу не налаштовується при показі звіту');
  ok(/<div class="trbar" id="trBar" style="display:none">[\s\S]{0,200}This report was created in another language[\s\S]{0,120}id="trBtn"[^>]*>Translate</.test(rc), 'result-check.html: плашки "звіт іншою мовою / перекласти" немає');
  const trSrc = rc.slice(rc.indexOf('function trSetup(){'), rc.indexOf('async function translateNow(){'));
  function page(reportLang, uiLang, translations) {
    const els = {}, calls = { fetch: 0, applied: [] };
    const el = id => els[id] || (els[id] = { style: { display: 'none' }, listeners: [], addEventListener(n, f) { this.listeners.push(n); } });
    const DATA = { vehicle: { title: 'BMW X5' }, final_conclusion: { headline: 'Исходный текст' }, translations, _meta: { lang: reportLang } };
    const before = JSON.stringify(DATA);
    const ctx = vm.createContext({ window: { calcarLang: () => uiLang }, M: DATA._meta, DATA, ROW_ID: 'r1', $: el,
      sessionStorage: { getItem: () => null, setItem() {} }, translateNow() {}, fetch: () => { calls.fetch++; }, boot2: d => calls.applied.push(d) });
    vm.runInContext(trSrc + '\ntrSetup();', ctx);
    return { els, calls, DATA, before };
  }
  for (const [rl, ui] of [['ru', 'ua'], ['ua', 'en'], ['en', 'ru'], ['ru', 'en']]) {
    const p = page(rl, ui, undefined);
    ok(p.els.trBar && p.els.trBar.style.display === '', rl + '->' + ui + ': плашка перекладу не показана');
    ok(p.els.trBtn.listeners.includes('click') && p.calls.fetch === 0 && p.calls.applied.length === 0, rl + '->' + ui + ': переклад запущено без натискання');
    ok(JSON.stringify(p.DATA) === p.before, rl + '->' + ui + ': текст звіту змінився від зміни мови інтерфейсу');
  }
  for (const l of LANGS) {
    const p = page(l, l, undefined);
    ok(!p.els.trBar || p.els.trBar.style.display === 'none', l + ': плашка показана, хоча мова звіту збігається з інтерфейсом');
  }
  /* уже збережений переклад показується з кешу, вихідний звіт не переписується */
  const pc = page('ru', 'en', { en: { final_conclusion: { headline: 'Cached' } } });
  ok(pc.calls.applied.length === 1 && pc.calls.applied[0].final_conclusion.headline === 'Cached' && pc.calls.fetch === 0, 'кешований переклад не застосовано');
  ok(JSON.stringify(pc.DATA) === pc.before, 'кешований переклад переписав вихідний звіт');

  if (errs.length) { console.log('reportlocaletest: FAIL\n- ' + errs.join('\n- ')); process.exit(1); }
  console.log('reportlocaletest: OK (RU, UA, EN: одна локаль на всі етапи; зміна мови інтерфейсу лише показує плашку перекладу)');
})().catch(e => { console.error('reportlocaletest: crashed', e); process.exit(1); });
