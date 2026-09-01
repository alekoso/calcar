/* Мовний фундамент CalCar: English це технічна база, дефолт і фолбек,
   українська і російська це локалізації поверх неї. Обрана локаль CalCar
   є єдиним джерелом правди для всього user-facing контенту: UI, звіт,
   рішення, чат, помилки API. Тест тримає:
   - серверний resolveLocale і locale-aware помилки;
   - ядро i18n у сторінках (пріоритет saved -> browser -> en, t() з
     англійським фолбеком), побайтово однакове на всіх шести сторінках;
   - проводку локалі в усі AI-потоки (Check, Import, Chat, Memory, Translate);
   - повноту англійської бази для кожного ключа, який є в UA/RU. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const errs = [];
const PAGES = ['import.html', 'check.html', 'result.html', 'result-check.html', 'cabinet.html', 'garage.html'];
const read = f => fs.readFileSync(f, 'utf8');

(async () => {
  /* ===== 1. сервер: resolveLocale, директива, помилки ===== */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_locale_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'api', 'locale.js'), read('api/locale.js'));
  const L = await import('file://' + path.join(dir, 'api', 'locale.js'));
  if (L.DEFAULT_LOCALE !== 'en' || L.FALLBACK_LOCALE !== 'en') errs.push('DEFAULT/FALLBACK не en');
  const cases = [
    ['en', 'en'], ['EN', 'en'], ['en-GB', 'en'], ['ua', 'ua'], ['uk', 'ua'], ['uk-UA', 'ua'], ['UA', 'ua'],
    ['ru', 'ru'], ['ru-RU', 'ru'], ['de', 'en'], ['de-DE', 'en'], ['', 'en'], [null, 'en'], [undefined, 'en'],
    [42, 'en'], ['<script>', 'en'], ['  ru  ', 'ru'], ['russian', 'en'], ['ukr', 'en'],
  ];
  for (const [raw, want] of cases) {
    const got = L.resolveLocale(raw);
    if (got !== want) errs.push('resolveLocale(' + JSON.stringify(raw) + ') = ' + got + ', очікувано ' + want);
  }
  for (const key of L.ERROR_KEYS) {
    for (const l of ['en', 'ua', 'ru']) {
      const t = L.errText(l, key);
      if (!t || t === key) errs.push('помилка ' + key + ' без тексту для ' + l);
    }
    const en = L.errText('en', key);
    if (/[а-яіїєґ]/i.test(en)) errs.push('англійська помилка ' + key + ' містить кирилицю');
  }
  if (L.errText('de', 'internal') !== L.errText('en', 'internal')) errs.push('невідома локаль помилки не впала в English');
  if (!/^Internal error: boom$/.test(L.errText(undefined, 'internal', 'boom'))) errs.push('detail не додається: ' + L.errText(undefined, 'internal', 'boom'));
  if (!/Внутрішня помилка/.test(L.errText('ua', 'internal'))) errs.push('ua-помилка не українська');
  if (!/Внутренняя ошибка/.test(L.errText('ru', 'internal'))) errs.push('ru-помилка не російська');
  for (const l of ['en', 'ua', 'ru']) {
    const d = L.languageDirective(l);
    if (!d.includes(L.LANG_NAME[l])) errs.push('директива для ' + l + ' не називає мову');
    if (!/незалежно від мови оголошення/.test(d)) errs.push('директива не відокремлює мову джерела');
  }
  if (!L.languageDirective('xx').includes(L.LANG_NAME.en)) errs.push('директива для невідомої локалі не англійська');

  /* ===== 2. ядро i18n: одне на всі сторінки ===== */
  const coreOf = p => {
    const s = read(p);
    const a = s.indexOf('/* i18n-core:start */'), b = s.indexOf('/* i18n-core:end */');
    return a > -1 && b > a ? s.slice(a, b + '/* i18n-core:end */'.length) : null;
  };
  const cores = PAGES.map(coreOf);
  if (cores.some(c => !c)) errs.push('ядро i18n без маркерів на: ' + PAGES.filter((p, i) => !cores[i]).join(', '));
  else if (new Set(cores).size !== 1) errs.push('ядро i18n НЕ побайтово однакове на шести сторінках: ' + PAGES.filter((p, i) => cores[i] !== cores[0]).join(', '));
  const core = cores[0] || '';
  const dictV = (core.match(/var DICT_V = '([^']+)'/) || [])[1];
  if (!dictV || dictV === '3') errs.push('DICT_V не піднятий після зміни формату словників: ' + dictV);
  if (!/var DEFAULT_LOCALE = 'en'/.test(core) || !/var FALLBACK_LOCALE = 'en'/.test(core)) errs.push('ядро без DEFAULT/FALLBACK en');
  if (/localStorage\.getItem\('calcar_lang'\) \|\| 'ua'/.test(read('check.html'))) errs.push('старий flash-скрипт з фолбеком ua лишився');
  for (const p of PAGES) {
    if ((read(p).match(/i18n-wait body\{visibility:hidden\}/g) || []).length !== 1) errs.push(p + ': стиль i18n-wait не рівно один раз');
    if (/window\.CALCAR_DICT\b[^S]/.test(read(p))) errs.push(p + ': старий window.CALCAR_DICT лишився');
  }

  /* запуск ядра в пісочниці: saved -> browser -> en, t() з англійським фолбеком */
  function runCore({ saved, languages, dicts }) {
    const written = [];
    const store = {};
    if (saved !== undefined && saved !== null) store.calcar_lang = saved;
    const document = {
      documentElement: { className: '', lang: '', classList: { remove() {} } },
      readyState: 'loading',
      write(s) { written.push(s); },
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
      title: '',
    };
    const window = { CALCAR_DICTS: dicts || undefined };
    const ctx = {
      window, document,
      navigator: { languages, language: languages[0] || '' },
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
      setTimeout() {}, NodeFilter: {}, location: {},
    };
    vm.createContext(ctx);
    vm.runInContext(core.replace('/* i18n-core:start */', '').replace('/* i18n-core:end */', ''), ctx);
    return { window, written: written.join(' ') };
  }
  let r = runCore({ saved: 'ru', languages: ['de-DE', 'de'] });
  if (r.window.calcarLang() !== 'ru') errs.push('saved ru + browser de мало дати ru: ' + r.window.calcarLang());
  if (!/\/i18n\/ru\.js/.test(r.written) || !/\/i18n\/en\.js/.test(r.written)) errs.push('для ru не вантажаться ru + en словники: ' + r.written);
  r = runCore({ saved: null, languages: ['de-DE', 'fr'] });
  if (r.window.calcarLang() !== 'en') errs.push('browser de без збереженого вибору мало дати en: ' + r.window.calcarLang());
  if (!/\/i18n\/en\.js/.test(r.written) || /ru\.js|ua\.js/.test(r.written)) errs.push('для en мав вантажитись лише en: ' + r.written);
  r = runCore({ saved: 'xx-garbage', languages: ['uk-UA'] });
  if (r.window.calcarLang() !== 'ua') errs.push('зіпсований saved мав відкинутись на браузерну uk: ' + r.window.calcarLang());
  if (r.written) errs.push('для ua (мова розмітки) словники не мали вантажитись: ' + r.written);
  r = runCore({ saved: 'uk', languages: ['en'] });
  if (r.window.calcarLang() !== 'ua') errs.push('saved uk не нормалізований в ua');
  r = runCore({ saved: null, languages: ['ru-RU'] });
  if (r.window.calcarLang() !== 'ru') errs.push('browser ru-RU мало дати ru');
  r = runCore({ saved: null, languages: [] });
  if (r.window.calcarLang() !== 'en') errs.push('без будь-якої мови мало бути en');
  r = runCore({ saved: 'en', languages: ['uk'] });
  if (r.window.calcarLang() !== 'en') errs.push('явний en слабший за браузерну uk');
  if (r.window.calcarResolveLocale('de') !== 'en' || r.window.calcarResolveLocale('uk') !== 'ua') errs.push('calcarResolveLocale не нормалізує');
  /* t(): обрана мова -> англійська -> вихідна фраза */
  const dicts = { ru: { 'Ключ А': 'ру А' }, en: { 'Ключ А': 'en A', 'Ключ Б': 'en B' } };
  r = runCore({ saved: 'ru', languages: [], dicts });
  if (r.window.t('Ключ А') !== 'ру А') errs.push('t() ru не взяв російський переклад');
  if (r.window.t('Ключ Б') !== 'en B') errs.push('t() ru без перекладу мав взяти англійський, а не ключ: ' + r.window.t('Ключ Б'));
  if (r.window.t('Ключ В') !== 'Ключ В') errs.push('t() без жодного перекладу мав повернути фразу');
  if (r.window.t(' Ключ Б ') !== ' en B ') errs.push('t() не зберіг пробіли по краях');
  r = runCore({ saved: 'en', languages: [], dicts });
  if (r.window.t('Ключ Б') !== 'en B') errs.push('t() en не взяв англійський');
  r = runCore({ saved: 'ua', languages: [], dicts });
  if (r.window.t('Ключ А') !== 'Ключ А') errs.push('t() ua мав повернути вихідну фразу розмітки');

  /* ===== 3. проводка локалі в AI-потоки ===== */
  const chat = read('api/chat.js'), check = read('api/check.js'), analyze = read('api/analyze.js');
  const translate = read('api/check-translate.js'), memory = read('api/memory.js'), lot = read('api/lot.js');
  if (/якою користувач поставив останнє питання/.test(chat)) errs.push('chat: лишилось правило "мовою останнього питання"');
  if (!/const lang = resolveLocale\(req\.body\?\.lang\)/.test(chat)) errs.push('chat: не читає локаль');
  if (!/МОВА ВІДПОВІДІ: \$\{LANG_NAME\[lang\]\}/.test(chat)) errs.push('chat: системний промпт без директиви обраної мови');
  if (!/Мова питання, мова звіту і мова джерел мову відповіді НЕ визначають/.test(chat)) errs.push('chat: нема заборони визначати мову з питання');
  if (!/SYSTEM\(product, memory, wantMemory, turns, refs\.length > 0, quoted, lang\)/.test(chat)) errs.push('chat: lang не переданий у SYSTEM');
  for (const [name, src] of [['check', check], ['analyze', analyze], ['translate', translate], ['memory', memory], ['lot', lot]]) {
    if (!/resolveLocale\(req\.(body|query)\?\.lang\)/.test(src)) errs.push(name + ': локаль не через resolveLocale');
    if (/\? req\.body\.lang : 'ua'/.test(src)) errs.push(name + ': старий фолбек ua лишився');
  }
  if (!/const langDirective = languageDirective\(lang\)/.test(check)) errs.push('check: директива мови не з єдиного резолвера');
  if (!/const langDirective = languageDirective\(lang\)/.test(analyze)) errs.push('analyze: директива мови не з єдиного резолвера');
  if (/відповідай мовою користувача/.test(check)) errs.push('check: few-shot досі просить "мовою користувача"');
  if (!/СВІДОМО: це мова, якою ПЛОЩАДКА віддає сторінку/.test(check)) errs.push('check: accept-language без пояснення, що це мова джерела');
  if (/lang\s*=\s*[^;]*listing\.(country|text|title)/.test(check)) errs.push('check: мова виводиться з оголошення чи країни');
  for (const re of [/SEV_LEX\.ua/, /SEV_ADV\.ua/, /JARGON\.ua/, /PHOTO_LABELS\.ua\b/, /lang = 'ua'/]) {
    if (re.test(check)) errs.push('check: серверний фолбек на ua лишився: ' + re);
  }
  if (!/LANG_NAME_ACC\[lang\]/.test(translate) || /!LANG_NAME\[lang\]/.test(translate)) errs.push('translate: невідома локаль не падає в English');
  /* фронт: кожен AI-потік шле обрану локаль */
  const rc = read('result-check.html'), rs = read('result.html'), im = read('import.html'), ch = read('check.html');
  const bodyOf = (src, api) => { const i = src.indexOf("fetch('" + api + "'"); return i < 0 ? '' : src.slice(i, i + 900); };
  for (const [name, src, api] of [
    ['result-check chat', rc, '/api/chat'], ['result-check memory', rc, '/api/memory'], ['result-check translate', rc, '/api/check-translate'],
    ['result chat', rs, '/api/chat'], ['result memory', rs, '/api/memory'],
    ['import analyze', im, '/api/analyze'], ['import lot', im, '/api/lot'], ['check', ch, '/api/check'],
  ]) {
    if (!/lang: (window\.calcarLang\(\)|ui|\(window\.calcarLang \? calcarLang\(\) : 'en'\))/.test(bodyOf(src, api))) errs.push(name + ': запит без обраної локалі');
  }
  if (/calcarLang\(\) : 'ua'/.test(im)) errs.push('import: фолбек локалі ua лишився');
  /* помилки API: жодного захардкодженого українського тексту */
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
    const src = read('api/' + f);
    const bad = (src.match(/error: '[^']*[а-яіїєґ][^']*'/gi) || []);
    if (bad.length) errs.push('api/' + f + ': українська помилка мимо локалі: ' + bad[0].slice(0, 70));
  }

  /* ===== 4. словники: English повна база ===== */
  const loadDict = code => { const w = { CALCAR_DICTS: {} }; vm.runInNewContext(read('i18n/' + code + '.js'), { window: w }); return w.CALCAR_DICTS[code] || null; };
  const EN = loadDict('en'), RU = loadDict('ru'), UA = loadDict('ua');
  if (!EN || !RU || !UA) errs.push('словники не реєструються у window.CALCAR_DICTS[code]');
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  /* ядро нормалізує ключі (обрізає пробіли по краях), тому ключ на кшталт
     'Не вийшло: ' легітимний. Помилка це ДВА ключі, що нормалізуються в один:
     один із них мертвий і ніколи не читається */
  const normSet = d => { const out = new Set(); for (const k of Object.keys(d || {})) out.add(norm(k)); return out; };
  for (const [code, d] of [['en', EN], ['ru', RU], ['ua', UA]]) {
    const seen = new Map();
    for (const k of Object.keys(d || {})) {
      const n = norm(k);
      if (seen.has(n)) errs.push(code + '.js: два ключі нормалізуються в один (мертвий дубль): "' + seen.get(n) + '" і "' + k + '"');
      seen.set(n, k);
      if (typeof d[k] !== 'string' || !d[k].trim()) errs.push(code + '.js: порожнє значення для "' + k.slice(0, 50) + '"');
    }
  }
  const ENN = normSet(EN), RUN = normSet(RU), UAN = normSet(UA);
  /* кожен ключ UA/RU має English base */
  for (const k of RUN) if (!ENN.has(k)) errs.push('RU-ключ без English base: "' + k.slice(0, 70) + '"');
  for (const k of UAN) if (!ENN.has(k)) errs.push('UA-ключ без English base: "' + k.slice(0, 70) + '"');
  /* кожен t()-ключ і кожна статична фраза розмітки мають English */
  const SWITCHER = new Set(['Українська', 'Русский', 'English']);
  const decode = s => s.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  const cyr = /[а-яёєіїґ]/i;
  const need = new Map();
  for (const p of PAGES) {
    const s = read(p);
    let m; const re = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
    while ((m = re.exec(s))) need.set(norm(m[1].replace(/\\'/g, "'")), p + ' t()');
    const body = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    for (const raw of body.split(/<[^>]*>/)) { const t = norm(decode(raw)); if (t && cyr.test(t) && !SWITCHER.has(t)) need.set(t, p + ' markup'); }
    for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
      const ra = new RegExp(attr + '="([^"]+)"', 'g');
      while ((m = ra.exec(body))) { const t = norm(decode(m[1])); if (t && cyr.test(t)) need.set(t, p + ' @' + attr); }
    }
    const title = (s.match(/<title>([^<]*)<\/title>/) || [])[1];
    if (title && cyr.test(title)) need.set(norm(title), p + ' <title>');
  }
  for (const [k, where] of need) {
    if (!ENN.has(k)) errs.push('English відсутній для "' + k.slice(0, 70) + '" (' + where + ')');
    if (!RUN.has(k)) errs.push('RU-повнота зламана: нема "' + k.slice(0, 70) + '" (' + where + ')');
  }
  if ('Комплектація за VIN ' in RU) errs.push('мертвий ключ із хвостовим пробілом лишився в ru.js');

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('LOCALE TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
  console.log('resolveLocale · помилки трьома мовами · ядро побайтово одне · saved > browser > en · t() з EN-фолбеком · локаль у Check/Import/Chat/Memory/Translate · EN повна база (' + need.size + ' фраз)');
  console.log('LOCALE TEST PASSED');
})().catch(e => { console.log('LOCALE TEST CRASHED:', e.stack || e.message); process.exit(1); });
