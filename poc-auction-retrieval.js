/* PoC: сходи ретривала аукціонних даних за VIN, від безкоштовного до платного.
   ZenRows це ОСТАННІЙ fallback, не основний шлях. Ключ береться ВИКЛЮЧНО з
   process.env.ZENROWS_API_KEY і ніколи не друкується. Без ключа сходинка
   ZenRows чесно пропускається з поясненням.

   Використання: node poc-auction-retrieval.js <VIN>
   Діагностичний скрипт: у production runtime НЕ інтегрований. */
const VIN = (process.argv[2] || '').toUpperCase();
if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(VIN)) { console.log('Використання: node poc-auction-retrieval.js <VIN>'); process.exit(1); }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
let externalRequests = 0;
let zenrowsRequests = 0;

async function get(url, ms = 25000) {
  externalRequests++;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } });
    const body = await r.text();
    const blocked = r.status === 403 || r.status === 429 || r.status === 503 || r.status === 202
      || /just a moment|cf-chl|captcha|incapsula|attention required/i.test(body.slice(0, 4000));
    return { status: r.status, body, blocked };
  } catch (e) {
    return { status: 'error', body: '', blocked: false, error: String(e.message || e).slice(0, 60) };
  } finally { clearTimeout(t); }
}

/* ZenRows: сирий URL цілі йде параметром, ключ лише з env, у вивід не потрапляє */
async function zenrows(url, opts = '') {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) return { skipped: 'ZENROWS_API_KEY відсутній в environment: сходинка пропущена' };
  zenrowsRequests++;
  externalRequests++;
  const api = 'https://api.zenrows.com/v1/?apikey=' + encodeURIComponent(key) + '&url=' + encodeURIComponent(url) + opts;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(api, { signal: ctl.signal });
    const body = await r.text();
    return { status: r.status, body, blocked: false };
  } catch (e) {
    return { status: 'error', body: '', error: String(e.message || e).slice(0, 60) };
  } finally { clearTimeout(t); }
}

const plainText = html => String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const photoUrls = html => [...new Set([...String(html).matchAll(/https?:\/\/[^"'\s>]+\.(?:jpe?g|webp|png)[^"'\s>]*/gi)].map(m => m[0]))]
  .filter(u => !/logo|icon|flag|sprite|svg/i.test(u));

(async () => {
  console.log('=== PoC ретривала для', VIN, '===');

  /* Крок 0: наявні дані. З локальної машини Supabase недоступний: у проді тут
     читання auction_checks і vehicle_snapshots, зовнішній ретривал не
     запускається, якщо подія вже збережена */
  console.log('\n[0] Кеш: auction_checks ще не створена (міграція очікує рішення), локально пропущено');

  /* Крок 1: безкоштовний discovery. Пошуковий endpoint без браузера */
  console.log('\n[1] Discovery (безкоштовний):');
  const ddg = await get('https://html.duckduckgo.com/html/?q=%22' + VIN + '%22');
  console.log('  html.duckduckgo.com:', ddg.status, ddg.blocked ? 'BLOCKED/challenge' : '');
  const candidates = [];
  if (!ddg.blocked && ddg.status === 200) {
    for (const m of ddg.body.matchAll(/uddg=([^&"]+)/g)) {
      try {
        const u = decodeURIComponent(m[1]);
        if (!/duckduckgo/.test(u) && u.toUpperCase().includes(VIN)) candidates.push(u);
      } catch (e) {}
    }
  }
  /* source-specific шаблони як резерв discovery: точний VIN у URL */
  const templates = [
    ['bid.cars', 'https://bid.cars/app/search/en/vin-lot/' + VIN + '/false'],
    ['bidfax.info', 'https://en.bidfax.info/?do=search&subaction=search&story=' + VIN],
    ['poctra.com', 'https://poctra.com/search/q?searchtext=' + VIN],
    ['americamotors.com', 'https://americamotors.com/en/vin/' + VIN],
  ];
  console.log('  кандидати з пошуку:', candidates.length ? candidates.map(u => u.slice(0, 80)) : 'нема (endpoint заблокований), йдемо шаблонами джерел');

  /* Крок 2: прямий безкоштовний fetch кандидатів і шаблонів */
  console.log('\n[2] Прямий fetch:');
  let free = null;
  const tried = [];
  for (const [name, url] of templates) {
    const r = await get(url);
    const vinHit = r.body.toUpperCase().includes(VIN);
    tried.push({ name, status: r.status, blocked: r.blocked, vin: vinHit });
    console.log('  ' + name + ':', r.status, r.blocked ? 'BLOCKED' : (vinHit ? 'VIN на сторінці' : 'без VIN'));
    if (!r.blocked && r.status === 200 && vinHit && !free) free = { name, url, body: r.body };
  }

  /* Крок 3: безкоштовні дзеркала тієї самої події (пошук інших публічних
     сторінок робиться на discovery; тут повторюємо ті, що відомі відкритими) */
  if (!free) {
    console.log('\n[3] Безкоштовні дзеркала:');
    const mirrors = [['americamotors.com', 'https://americamotors.com/en/tesla/model_y/' + VIN]];
    for (const [name, url] of mirrors) {
      const r = await get(url);
      const vinHit = r.body.toUpperCase().includes(VIN);
      console.log('  ' + name + ':', r.status, r.blocked ? 'BLOCKED' : (vinHit ? 'VIN на сторінці' : 'без VIN'));
      if (!r.blocked && r.status === 200 && vinHit && !free) free = { name, url, body: r.body };
    }
  } else { console.log('\n[3] Дзеркала не потрібні: прямий fetch дав відкриту сторінку'); }

  /* розбір відкритої сторінки */
  let facts = { photos: [], damage: null, airbags: null, odometer: null, house: null };
  if (free) {
    const p = plainText(free.body);
    facts.photos = photoUrls(free.body);
    facts.house = /IAAI|Iaai/i.test(p) ? 'IAAI' : (/Copart/i.test(p) ? 'Copart' : null);
    facts.odometer = (p.match(/(\d[\d\s,.]{2,9})\s*(?:mi|миль|міль)/i) || [])[1] || null;
    facts.damage = (p.match(/(?:Primary damage|Осн\.? повреждения|Основні пошкодження)[:\s]{0,5}([A-Za-zА-Яа-яіїє ,\/]{3,40})/i) || [])[1]?.trim() || null;
    facts.airbags = (p.match(/Airbags?[:\s]{0,5}([A-Za-z ]{3,20})/i) || [])[1]?.trim() || null;
    console.log('\n  ВІДКРИТЕ ДЖЕРЕЛО:', free.name);
    console.log('  дім:', facts.house, '| одометр:', facts.odometer, '| damage:', facts.damage || 'ПОРОЖНЬО', '| airbags:', facts.airbags || 'ПОРОЖНЬО');
    console.log('  фото URL:', facts.photos.length, facts.photos.slice(0, 2).map(u => u.slice(0, 80)));
    if (facts.photos[0]) {
      const ph = await get(facts.photos[0].replace('_ful.jpg', '_hrs.jpg'));
      console.log('  перевірка фото (hi-res):', ph.status, typeof ph.body === 'string' ? ph.body.length + 'b' : '');
    }
  }

  /* Крок 4: ZenRows ЛИШЕ якщо факти чи фото інакше не дістати */
  const gaps = [];
  if (!free) gaps.push('запис');
  if (!facts.photos.length) gaps.push('фото');
  if (!facts.damage) gaps.push('damage-поля');
  if (gaps.length) {
    console.log('\n[4] ZenRows (останній fallback). Незакриті безкоштовно: ' + gaps.join(', '));
    /* один найперспективніший URL, не всі джерела підряд */
    const target = 'https://bid.cars/en/lot/0-42968456/2023-Tesla-Model-Y-' + VIN;
    console.log('  ціль:', target);
    let z = await zenrows(target);
    if (z.skipped) { console.log('  ' + z.skipped); }
    else {
      console.log('  спроба 1 (без js_render):', z.status, (z.body || '').length + 'b');
      if (z.status !== 200 || /just a moment|cf-chl/i.test((z.body || '').slice(0, 3000))) {
        z = await zenrows(target, '&js_render=true&premium_proxy=true');
        console.log('  спроба 2 (js_render + premium):', z.status, (z.body || '').length + 'b');
      }
      if (z.status === 200 && z.body.toUpperCase().includes(VIN)) {
        const p = plainText(z.body);
        const dmg = (p.match(/Damage[:\s]{0,5}([A-Za-z ,\/]{3,50})/i) || [])[1]?.trim() || null;
        const odo = (p.match(/(\d[\d\s,]{2,9})\s*mi/i) || [])[1] || null;
        const bags = (p.match(/Airbags?[:\s]{0,5}([A-Za-z ]{3,20})/i) || [])[1]?.trim() || null;
        const ph = photoUrls(z.body);
        console.log('  EXACT VIN: так | damage:', dmg, '| одометр:', odo, '| airbags:', bags, '| фото:', ph.length);
      } else if (z.status === 200) {
        console.log('  EXACT VIN: НІ, дані не використовуються');
      }
    }
  } else { console.log('\n[4] ZenRows НЕ потрібен: факти і фото дісталися безкоштовно'); }

  console.log('\n=== ПІДСУМОК: зовнішніх запитів', externalRequests, '| із них ZenRows', zenrowsRequests, '===');
})();
