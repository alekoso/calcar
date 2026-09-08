/* Публічні юридичні сторінки: /privacy і /terms.

   Обидві збираються зі спільних блоків check.html (ядро i18n, шапка,
   лаунчер, тур, футер) і мають лишатися побайтово в них, інакше шапка
   розійдеться. Вони публічні: без стіни входу і без client-side редиректу,
   бо їх читає і Google OAuth verification, і людина без акаунта. Політика
   мусить описувати реальну архітектуру (Supabase, Google OAuth, Vercel,
   OpenAI, PostHog/GA4, маскування replay, Vehicle Memory, памʼять помічника,
   cookies) і не вигадувати юрособу. Умови: інформаційний сервіс, дані можуть
   бути неповними, відсутність запису не є доказом, Score це не гарантія. */
const fs = require('fs');
const errs = [];
const LEGAL = ['privacy.html', 'terms.html'];
const S = Object.fromEntries([...LEGAL, 'check.html', 'import.html', 'result.html', 'result-check.html'].map(p => [p, fs.readFileSync(p, 'utf8')]));
const chk = S['check.html'];

/* ---------- 1. маршрути і файли ---------- */
const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
for (const [src, dst] of [['/privacy', '/privacy.html'], ['/terms', '/terms.html']]) {
  if (!v.rewrites.some(r => r.source === src && r.destination === dst)) errs.push('нема маршруту ' + src + ' -> ' + dst);
}

/* ---------- 2. спільні блоки побайтово ті самі, що на check.html ---------- */
const BLOCKS = {
  'ядро i18n': s => s.split('</script>\n', 1)[0].split('<script>\n', 2)[1],
  'блок шапки': s => (s.match(/<script>\n\/\* Спільна поведінка шапки[\s\S]*?<\/script>/) || [''])[0],
  'тур': s => (s.match(/<script>\n\/\* Перший запуск CalCar: тур із двох кроків[\s\S]*?<\/script>/) || [''])[0],
  'лаунчер JS': s => (s.match(/<script>\n\/\* Лаунчер продуктів CalCar: спільний блок[\s\S]*?<\/script>/) || [''])[0],
  'панель лаунчера': s => (s.match(/<div class="lnc-backdrop"[\s\S]*?\n<\/div>\n/) || [''])[0],
  'футер': s => (s.match(/<footer>[\s\S]*?<\/footer>/) || [''])[0],
  'CSS шапки і лаунчера': s => { const a = s.indexOf('  :root{'), b = s.indexOf('@keyframes lnc-up{'); return a > 0 && b > a ? s.slice(a, b) : ''; },
};
for (const p of LEGAL) {
  for (const [name, get] of Object.entries(BLOCKS)) {
    const mine = get(S[p]), ref = get(chk);
    if (!mine) errs.push(p + ': нема блоку "' + name + '"');
    else if (mine !== ref) errs.push(p + ': блок "' + name + '" відрізняється від check.html');
  }
  /* шапка та сама, лише без назви продукту: юридична сторінка не є продуктом */
  const hdr = (S[p].match(/<header>[\s\S]*?<\/header>/) || [''])[0];
  if (hdr !== (chk.match(/<header>[\s\S]*?<\/header>/) || [''])[0].replace('      <span class="prod" data-prod="Check" aria-hidden="true"></span>\n', '')) errs.push(p + ': шапка відрізняється від check.html');
}

/* ---------- 3. публічність: без стіни входу і редиректів ---------- */
for (const p of LEGAL) {
  const s = S[p];
  if (/signInWithOAuth|signInWithOtp|location\.replace\(|location\.href = '\/cabinet/.test(s)) errs.push(p + ': на публічній сторінці є вхід або редирект');
  if (!/<main class="legal">[\s\S]*<h1>[^<]+<\/h1>/.test(s)) errs.push(p + ': текст не в розмітці (не читається без JS)');
  if (!/<html lang="en">/.test(s)) errs.push(p + ': html lang не en');
  if (!/<meta name="viewport" content="width=device-width, initial-scale=1.0">/.test(s)) errs.push(p + ': нема viewport');
  if (!/@media\(max-width:620px\)\{\.legal\{/.test(s)) errs.push(p + ': нема мобільних правил тексту');
  if ((s.match(/<h2>/g) || []).length < 8) errs.push(p + ': замало розділів');
  /* контакт: Telegram із завдання власника; email лише з публічного конфігу */
  /* контакт без канцеляриту: просто "Contact" посиланням на Telegram; право запросити видалення лишається в тексті політики */
  if (!s.includes('<p class="legal-contact"><a href="https://t.me/calcar_ai" target="_blank" rel="noopener">Contact</a><span id="legalEmail"></span></p>')) errs.push(p + ': контакт не простим "Contact" на Telegram або нема гнізда для email з конфігу');
  if (/Questions and deletion requests|Questions about these terms/.test(s)) errs.push(p + ': лишилось канцелярське формулювання контакту');
  if (/@calcar\.io|@gmail\.com/.test(s)) errs.push(p + ': захардкоджений email');
  /* нічого вигаданого про юрособу */
  if (/\b(LLC|Ltd\.?|Inc\.?|GmbH|ТОВ|ФОП|LLP)\b|registered (office|address) (is|at)|governed by the laws of/.test(s)) errs.push(p + ': вигадані юридичні реквізити');
  if (/\u2014/.test(s)) errs.push(p + ': довге тире');
}

/* ---------- 4. зміст політики відповідає архітектурі ---------- */
{
  const s = S['privacy.html'];
  const text = s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  for (const need of ['What CalCar collects', 'Analytics', 'Authentication and infrastructure', 'AI processing', 'Vehicle data', 'Assistant memory', 'Feedback', 'Cookies and browser storage', 'Who receives your data', 'Retention and deletion', 'Google user data', 'Contact']) {
    if (!text.includes('<h2>' + need + '</h2>')) errs.push('privacy: нема розділу "' + need + '"');
  }
  if (!text.includes('contact us using the details below; we will remove the account')) errs.push('privacy: зникло право запросити видалення даних');
  for (const need of ['PostHog', 'Google Analytics (GA4)', 'Supabase Auth', 'Google OAuth', 'Vercel', 'OpenAI', 'all form inputs are masked', 'the assistant panel, the memory editor and the sign-in form are excluded from recording',
    'anonymous browser identifier', 'UTM parameters', 'VIN, listings, prices, mileage readings, seller descriptions, photos, auction and historical records', 'describes the vehicle, not you',
    'erase it completely', 'authentication session', 'anonymous analytics identifier', 'onboarding state', 'does not sell your personal data', 'Google API Services User Data Policy', 'Limited Use', 'delete your account']) {
    if (!text.includes(need)) errs.push('privacy: нема "' + need + '"');
  }
  if (/never (receives|shares|sends)/.test(text) && !/does not claim that any provider never receives/.test(text)) errs.push('privacy: обіцянка "ніколи не передає", якої код не тримає');
  /* реальні провайдери з коду: OpenAI єдиний AI-провайдер в api/ */
  const api = fs.readdirSync('api').filter(f => f.endsWith('.js')).map(f => fs.readFileSync('api/' + f, 'utf8')).join('\n');
  if (/api\.anthropic\.com|generativelanguage\.googleapis/.test(api)) errs.push('privacy: у коді зʼявився інший AI-провайдер, політика згадує лише OpenAI');
  if (!/api\.openai\.com/.test(api)) errs.push('privacy: політика згадує OpenAI, а код його не викликає');
}

/* ---------- 5. зміст умов відповідає продукту ---------- */
{
  const s = S['terms.html'];
  const text = s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  for (const need of ['What CalCar is', 'Nature of the results', 'Third-party data', 'Accounts', 'Acceptable use', 'Content and intellectual property', 'Limitation of liability', 'Paid services', 'Changes to these terms', 'Contact']) {
    if (!text.includes('<h2>' + need + '</h2>')) errs.push('terms: нема розділу "' + need + '"');
  }
  for (const need of ['information and analytics service', 'Data may be incomplete, outdated or wrong', 'does not mean that the event never happened', 'is not a guarantee of the car\'s technical condition',
    'does not replace a physical inspection', 'The decision to buy a car, and its consequences, are yours', 'CalCar Score and the verdict are an informational assessment', 'own limitations, errors and terms',
    'disrupt or overload the service', 'Reports shared with a public link can be viewed by anyone', 'To the extent permitted by applicable law', 'free during its early testing period', 'We may update these terms']) {
    if (!text.includes(need)) errs.push('terms: нема "' + need + '"');
  }
}

/* ---------- 6. футер публічних сторінок: Privacy, Terms, Telegram з конфігу ---------- */
for (const p of ['check.html', 'import.html', 'result.html', 'result-check.html', ...LEGAL]) {
  const foot = (S[p].match(/<footer>[\s\S]*?<\/footer>/) || [''])[0];
  if (!foot.includes('<div class="ft-col"><b>Legal</b><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>')) errs.push(p + ': у футері нема Privacy/Terms');
  if (!foot.includes('<div class="ft-col" id="ftContacts" hidden><b>Contact</b></div>')) errs.push(p + ': у футері нема колонки контактів');
}
const pub = fs.readFileSync('calcar-public.js', 'utf8');
if (!/telegram: 'https:\/\/t\.me\/calcar_ai'/.test(pub)) errs.push('calcar-public.js: Telegram не t.me/calcar_ai, футер лишиться без контакту');

/* ---------- 7. словники: кожен рядок тексту має UA і RU (повніше перевіряє localetest) ---------- */
for (const d of ['i18n/ua.js', 'i18n/ru.js']) {
  const t = fs.readFileSync(d, 'utf8');
  for (const k of ['Privacy Policy', 'Terms of Service', 'Legal', 'Privacy', 'Terms', 'Google user data', 'Nature of the results', 'Last updated: 8 September 2026']) if (!t.includes("'" + k + "':")) errs.push(d + ': нема ключа "' + k + '"');
}

if (errs.length) { console.log('LEGAL TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
console.log('юридичні сторінки: маршрути · спільні блоки побайтово з check.html · без стіни входу · політика за архітектурою · умови за продуктом · футер Privacy/Terms/Telegram · словники');
console.log('LEGAL TEST PASSED');
