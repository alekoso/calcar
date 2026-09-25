/* CalCar: відео про модель авто. Необовʼязкове збагачення звіту Check.

   Пошук НЕ входить у критичний шлях Check: сторінка звіту сама викликає цей
   ендпоінт уже після рендера. Нічого не вирішує і ні на що не впливає:
   ні Score, ні Confidence, ні вердикт, ні Model Intelligence, ні Vehicle
   Memory. Будь-яка невдача це порожній список і схований блок.

   Рекомендації тут МОДЕЛЬНІ, не про конкретний VIN, тому відповідь кешує
   CDN Vercel за адресою запиту (ідентичність моделі + мова) на 7 днів:
   другий такий самий BMW M550i G30 квоту YouTube уже не витрачає. Окремого
   сховища під це не заводимо.

   Ключ YOUTUBE_API_KEY живе лише на сервері. */

export const config = { maxDuration: 20 };

const SEARCH_PER_QUERY = 10;    /* до 10 кандидатів на запит, разом до 30 */
const MAX_RESULTS = 15;         /* стільки максимум віддаємо сторінці */
const MIN_DURATION_S = 120;     /* коротше: Shorts і кліпи, не огляд */
const SUBSTANTIAL_S = 300;      /* від 5 хвилин це вже розмова по суті */
const MAX_PER_CHANNEL = 3;      /* не всі слоти одному каналу */
const CACHE_TTL_S = 7 * 24 * 3600;
const FETCH_TIMEOUT_MS = 5000;

/* шаблони запитів: детерміновані, без жодного виклику моделі */
const QUERY_TEMPLATES = {
  ru: { review: '{id} обзор', problems: '{engineId} проблемы', ownership: '{id} опыт владения' },
  ua: { review: '{id} огляд', problems: '{engineId} проблеми', ownership: '{id} досвід володіння' },
  en: { review: '{id} review', problems: '{engineId} common problems', ownership: '{id} ownership review' },
};
export const INTENTS = ['review', 'problems', 'ownership'];

const clean = s => String(s == null ? '' : s).replace(/\u2014/g, ',').replace(/\s+/g, ' ').trim();

/* покоління з площадки буває сміттям ("Base", "Sedan", "XSE", "AWD"):
   беремо лише код платформи виду G30, W205, XV80, 958.1, TL, F10.

   Форму коду проходять і короткі торгові позначення (версія, привід,
   паливо, сімʼя двигунів), тому вони відсіюються переліком. Хибне
   покоління гірше за відсутнє: сумнівне значення це null. */
const NOT_GENERATION = new Set([
  /* тип кузова і загальні слова */
  'base', 'sedan', 'coupe', 'suv', 'auto', 'std', 'van', 'mpv', 'cuv',
  /* привід */
  'awd', 'fwd', 'rwd', '2wd', '4wd',
  /* торгові версії, що вкладаються у 2-3 літери */
  'xse', 'xle', 'xls', 'xlt', 'xlе', 'se', 'sel', 'sle', 'slt', 'le', 'ltz', 'lt',
  'ls', 'ex', 'exl', 'lx', 'dx', 'gl', 'gls', 'gle', 'sv', 'sl', 'sr', 'srt',
  'st', 'rs', 'gt', 'gts', 'ti', 'tsi', 'tdi', 'gdi', 'fsi', 'mpi', 'hdi', 'crd',
  'ltd', 'prm', 'trd', 'amg', 'gti', 'gtd',
]);
export function validGeneration(raw) {
  const g = clean(raw).replace(/[«»"']/g, '');
  if (!g || g.length > 12) return null;
  if (!/^[A-Za-z]{0,3}\d{2,3}(?:\.\d)?[A-Za-z]?$|^[A-Z]{2,3}$/.test(g)) return null;
  if (NOT_GENERATION.has(g.toLowerCase())) return null;
  return g.toUpperCase();
}

/* код платформи з готової назви ідентичності Model Intelligence
   ("BMW 540i G30", "Porsche Cayenne GTS 958.1"). Беремо лише токени з
   цифрами: чисто літерний код ("TL") у назві не відрізнити від бренда
   ("BMW") чи сімʼї двигунів ("GDI"), а вгадувати тут не можна. */
export function generationFromLabel(raw) {
  const text = clean(raw);
  if (!text) return null;
  for (const tok of text.split(/[\s,/]+/)) {
    if (!/\d/.test(tok)) continue;
    if (!/^[A-Za-z]{0,3}\d{2,3}(?:\.\d)?$/.test(tok)) continue;
    const g = validGeneration(tok);
    if (g) return g;
  }
  return null;
}

/* Одне значення покоління зі сходинок джерел у порядку надійності:
   поле площадки -> те, що вже знає Model Intelligence -> висновок
   основного аналізу. Перше, що проходить перевірку форми, і виграє;
   нічого не пройшло: null, бо хибне покоління гірше за відсутнє.
   Другого поля покоління у звіті не існує, тут рахується канонічне. */
export function resolveGeneration(sources) {
  for (const src of Array.isArray(sources) ? sources : []) {
    if (!src) continue;
    const g = validGeneration(src.value);
    if (!g) continue;
    /* версія комплектації, переказана як покоління, не приймається навіть
       у правильній формі: "XSE" біля trim "XSE" це trim */
    if (src.notTrim && validGeneration(src.notTrim) === g) continue;
    return { generation: g, source: src.source || null };
  }
  return { generation: null, source: null };
}

/* код двигуна лише зі структурного декодера (NHTSA EngineModel): вигадувати
   його з назви моделі не можна */
export function validEngineCode(raw) {
  const e = clean(raw).toUpperCase();
  if (!e || e.length < 2 || e.length > 12) return null;
  if (!/^[A-Z0-9][A-Z0-9.\- ]{1,11}$/.test(e)) return null;
  if (!/[A-Z]/.test(e) || !/\d/.test(e)) return null;
  return e;
}

/* Тип силової установки в запит іде лише коли він справді розрізняє версії:
   гібрид, електро і дизель шукаються інакше, ніж звичайний бензин. */
const POWERTRAIN_WORD = {
  hybrid: 'Hybrid', phev: 'Hybrid', 'plug-in hybrid': 'Hybrid', 'plug-in': 'Hybrid',
  electric: 'Electric', bev: 'Electric', ev: 'Electric', diesel: 'Diesel',
};
export function validPowertrain(raw) {
  const p = clean(raw).toLowerCase();
  if (!p) return null;
  for (const k of Object.keys(POWERTRAIN_WORD)) if (p === k || p.includes(k)) return POWERTRAIN_WORD[k];
  return null;
}

/* Ідентичність для пошуку.

   ГОЛОВНИЙ ключ це покоління/кузов: Toyota Camry XV80, BMW 5 Series G30,
   Mercedes-Benz C-Class W205. Торгова версія (XSE, xDrive) головною не буває:
   вона не відрізняє покоління і звужує пошук до випадкових відео.
   Покоління відоме -> рік НЕ додаємо: він ріже корисні відео сусідніх років.
   Покоління невідоме -> запасний ключ це рік: Toyota Camry 2025.
   Двигун лишається тільки в запиті про проблеми і тільки коли код відомий.
   Нічого тут заново не визначається: значення приходять зі звіту. */
export function buildIdentity({ title, make, model, generation, engine_code, year, powertrain } = {}) {
  const mk = clean(make), md = clean(model);
  let base = (mk && md) ? (mk + ' ' + md) : clean(title).replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim();
  if (!base) base = [mk, md].filter(Boolean).join(' ').trim();
  if (!base) return null;
  const has = (text, token) => new RegExp('(^|\\s)' + String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)', 'i').test(text);
  const gen = validGeneration(generation);
  const yr = /^(19|20)\d{2}$/.test(String(year || '').trim()) ? String(year).trim() : null;
  if (gen) { if (!has(base, gen)) base += ' ' + gen; }
  else if (yr && !has(base, yr)) base += ' ' + yr;
  const pw = validPowertrain(powertrain);
  const withPower = pw && !has(base, pw) ? base + ' ' + pw : base;
  const eng = validEngineCode(engine_code);
  const withEngine = eng && !has(withPower, eng) ? withPower + ' ' + eng : withPower;
  return {
    base: base.slice(0, 80), withPower: withPower.slice(0, 90), withEngine: withEngine.slice(0, 100),
    generation: gen, engine_code: eng, powertrain: pw, year: gen ? null : yr,
  };
}

export function buildQueries(identity, lang) {
  const tpl = QUERY_TEMPLATES[lang] || QUERY_TEMPLATES.en;
  if (!identity) return [];
  /* огляд і проблеми уточнюються типом установки, досвід володіння лишається
     ширшим: там корисні і сусідні версії того самого покоління */
  const forIntent = { review: identity.withPower, problems: identity.withEngine, ownership: identity.base };
  return INTENTS.map(intent => ({
    intent,
    q: tpl[intent].replace('{engineId}', identity.withEngine).replace('{id}', forIntent[intent]),
  }));
}

/* ---------- прості детерміновані фільтр і ранжування ---------- */

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function parseDuration(iso) {
  const m = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

/* ---------- чуже покоління ----------
   Популярне відео про інший кузов не має права обійти менш популярне про
   потрібний. Тому явний конфлікт коду це відмова, а не мінус до балу.
   Перевірка навмисно вузька: порівнюємо лише коди ТІЄЇ САМОЇ сімʼї
   (однакова літерна частина і довжина числа), плюс звичний числовий
   псевдонім після назви моделі ("Camry 70" проти XV80). Жодної глобальної
   онтології поколінь: коду в заголовку немає -> відео не відкидається. */
const GEN_TOKEN_RE = /\b([A-Z]{1,3})[\s-]?(\d{2,3})(?:\.(\d))?\b/g;

export function generationConflict(title, identity) {
  const gen = identity && identity.generation;
  if (!gen) return false;
  const m = /^([A-Z]{0,3})(\d{2,3})(?:\.(\d))?$/.exec(gen);
  if (!m) return false;
  const prefix = m[1], num = m[2], sub = m[3] || null;
  const text = ' ' + String(title || '').toUpperCase() + ' ';
  if (prefix) {
    GEN_TOKEN_RE.lastIndex = 0;
    let t;
    while ((t = GEN_TOKEN_RE.exec(text))) {
      if (t[1] !== prefix) continue;
      if (t[2].length !== num.length) continue;
      if (t[2] !== num) return true;                 /* XV70 при цілі XV80 */
      if (sub && t[3] && t[3] !== sub) return true;  /* 958.2 при цілі 958.1 */
    }
  }
  /* суто числове покоління з фазою (Porsche 958.1): інша фаза це конфлікт.
     Без фази ("958") нічого не відкидаємо: 958.2 це те саме сімейство */
  if (!prefix && sub) {
    const re = new RegExp('\\b' + num + '\\.(\\d)\\b', 'g');
    let ph;
    while ((ph = re.exec(text))) if (ph[1] !== sub) return true;
  }
  /* числовий псевдонім покоління відразу після назви моделі: "Camry 70" */
  if (num.length === 2) {
    const model = (identityTokens(identity).model || []).filter(w => /^[a-z]+$/i.test(w)).pop();
    if (model) {
      const re = new RegExp('\\b' + model.toUpperCase() + '\\s+(\\d{2})\\b', 'g');
      let a;
      while ((a = re.exec(text))) if (a[1] !== num) return true;
    }
  }
  return false;
}

/* ---------- цінність відео для покупця ----------
   Відсікаємо те, де немає розбору: Shorts, покатушки від першої особи,
   розгін і максималка, звук вихлопу, нічні поїздки, оголошення автосалону.
   "Тест-драйв" і "test drive" НЕ відкидаємо: так називають якісні огляди. */
const LOW_VALUE_RE = /#?shorts\b|\bpov\b|\bпов\b|0\s*-\s*(?:100|60)|\b(?:0|нуль)\s*до\s*100|acceleration|launch control|разгон|прискорення|top speed|максималк|макс\.?\s*скорость|exhaust (?:sound|note)|звук выхлопа|звук вихлопу|выхлоп\b|вихлоп\b|night drive|ночная поездка|нічна поїздка|нарезка|подборка|for sale\b|в наличии|в наявності|продам\b|цена в салоне|дрифт|drift|burnout|gymkhana|asmr|pure sound|walkaround only/i;
const USEFUL_RE = /обзор|огляд|review|тест-?драйв|test[\s-]?drive|опыт владения|досвід володіння|ownership|long[\s-]?term|проблем|problem|надеж|надій|reliab|болячк|слабые места|слабкі місця|стоит ли брать|чи варто|buying guide|what to look|before you buy|характеристик|comparison|сравнение|порівняння/i;

export function lowValue(video) {
  const title = String((video && video.title) || '');
  if (LOW_VALUE_RE.test(title)) return true;
  const d = video && video.duration_s;
  /* дуже коротке відео без ознак розбору користі не дає */
  if (typeof d === 'number' && d < MIN_DURATION_S) return true;
  if (typeof d === 'number' && d < SUBSTANTIAL_S && !USEFUL_RE.test(title)) return true;
  return false;
}

/* токени ідентичності: марка, модель/версія, покоління, двигун */
export function identityTokens(identity) {
  const words = norm(identity.base).split(' ').filter(Boolean);
  const gen = identity.generation ? norm(identity.generation) : null;
  const eng = identity.engine_code ? norm(identity.engine_code) : null;
  const rest = words.filter(w => w !== gen && w !== eng);
  return { make: rest[0] || null, model: rest.slice(1).filter(Boolean), generation: gen, engine: eng };
}

/* 0..1: наскільки заголовок відео справді про ЦЕ покоління цієї моделі.
   Покоління важить найбільше: саме воно відрізняє потрібне відео від
   схожого про попередній кузов */
export function relevance(video, identity) {
  const tok = identityTokens(identity);
  const hay = norm(video.title + ' ' + (video.channel || ''));
  const has = w => !!w && new RegExp('(^| )' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(hay);
  let got = 0, max = 0;
  max += 0.15; if (has(tok.make)) got += 0.15;
  max += 0.35;
  if (tok.model.length) {
    const hits = tok.model.filter(has).length;
    got += 0.35 * (hits / tok.model.length);
  }
  if (tok.generation) { max += 0.35; if (has(tok.generation)) got += 0.35; }
  if (identity.powertrain) { max += 0.1; if (has(norm(identity.powertrain))) got += 0.1; }
  if (tok.engine && video.engineQuery) { max += 0.05; if (has(tok.engine)) got += 0.05; }
  return max > 0 ? got / max : 0;
}

/* популярність: логарифм переглядів, щоб вірусне generic-відео не обходило
   точне відео про саме цю версію */
export function popularity(views) {
  const v = typeof views === 'number' && isFinite(views) && views > 0 ? views : 0;
  return Math.max(0, Math.min(1, Math.log10(v + 1) / 7));
}

export function scoreVideo(video, identity, { primaryLang = null } = {}) {
  const rel = relevance(video, identity);
  /* те саме відео у кількох запитах це невеликий бонус, не окрема механіка */
  const bonus = Math.min(0.06, 0.03 * Math.max(0, (video.intents || []).length - 1));
  /* змістовний розбір корисніший за нарізку тієї ж довжини */
  const useful = USEFUL_RE.test(String(video.title || '')) ? 0.06 : 0;
  const substantial = typeof video.duration_s === 'number' && video.duration_s >= SUBSTANTIAL_S ? 0.03 : 0;
  /* мова звіту виграє лише серед схожих за силою, а не сама по собі */
  const langBonus = primaryLang && video.lang === primaryLang ? 0.05 : 0;
  return {
    ...video, relevance: rel,
    score: 0.72 * rel + 0.22 * popularity(video.views) + bonus + useful + substantial + langBonus,
  };
}

/* модель має бути в заголовку: інакше це відео "згадало" авто побіжно */
export function isRelated(video, identity) {
  const tok = identityTokens(identity);
  if (!tok.model.length) return relevance(video, identity) >= 0.5;
  const hay = norm(video.title + ' ' + (video.channel || ''));
  return tok.model.some(w => new RegExp('(^| )' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(hay));
}

/* фільтр + ранжування + мінімальна різноманітність. Слабке відео у добірку
   не заштовхуємо: краще показати менше */
export function selectVideos(candidates, identity, { max = MAX_RESULTS, minScore = 0.35, primaryLang = null } = {}) {
  const byId = new Map();
  for (const c of candidates || []) {
    if (!c || !c.id) continue;
    const prev = byId.get(c.id);
    if (prev) { prev.intents = [...new Set([...(prev.intents || []), ...(c.intents || [])])]; continue; }
    byId.set(c.id, { ...c, intents: [...(c.intents || [])] });
  }
  const seenTitle = new Set();
  const pool = [...byId.values()]
    .filter(v => v.live !== true)
    /* чуже покоління не проходить узагалі, скільки б переглядів не мало */
    .filter(v => !generationConflict(v.title, identity))
    .filter(v => !lowValue(v))
    .filter(v => isRelated(v, identity))
    .map(v => scoreVideo(v, identity, { primaryLang }))
    .filter(v => v.score >= minScore)
    .sort((a, b) => b.score - a.score)
    /* очевидні перезаливи: той самий заголовок */
    .filter(v => { const k = norm(v.title).slice(0, 60); if (seenTitle.has(k)) return false; seenTitle.add(k); return true; });

  const out = [], perChannel = new Map();
  const take = v => {
    const ch = v.channel_id || v.channel || '';
    if ((perChannel.get(ch) || 0) >= MAX_PER_CHANNEL) return false;
    perChannel.set(ch, (perChannel.get(ch) || 0) + 1);
    out.push(v);
    return true;
  };
  /* спершу найсильніше відео кожного наміру: огляд, проблеми, досвід.
     Слабке відео заради категорії не беремо */
  for (const intent of INTENTS) {
    const best = pool.find(v => !out.includes(v) && (v.intents || []).includes(intent));
    if (best && out.length < max) take(best);
  }
  for (const v of pool) {
    if (out.length >= max) break;
    if (out.includes(v)) continue;
    take(v);
  }
  return out.slice(0, max).sort((a, b) => b.score - a.score);
}

/* ---------- YouTube Data API ---------- */

async function ytFetch(path, params, key) {
  const u = new URL('https://www.googleapis.com/youtube/v3/' + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('key', key);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(u.toString(), { signal: ctl.signal });
    if (!r.ok) {
      console.error(JSON.stringify({ op: 'youtube_api', path, status: r.status }));
      return null;
    }
    return await r.json().catch(() => null);
  } catch (e) {
    console.error(JSON.stringify({ op: 'youtube_api', path, error: String((e && e.name) || e).slice(0, 60) }));
    return null;
  } finally { clearTimeout(t); }
}

export function sanitizeQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  const str = (v, n) => clean(v).replace(/[<>"']/g, '').slice(0, n) || null;
  const lang = ['ru', 'ua', 'en'].includes(String(q.lang || '')) ? String(q.lang) : 'en';
  return {
    lang,
    title: str(q.title, 80),
    make: str(q.make, 30),
    model: str(q.model, 40),
    generation: str(q.generation, 12),
    engine_code: str(q.engine_code, 12),
    year: str(q.year, 4),
    powertrain: str(q.powertrain, 24),
  };
}

/* один прохід пошуку однією мовою: 3 наміри по SEARCH_PER_QUERY кандидатів */
async function searchLang(identity, lang, key, seen) {
  const queries = buildQueries(identity, lang);
  const results = await Promise.all(queries.map(q => ytFetch('search', {
    part: 'snippet', type: 'video', q: q.q, maxResults: SEARCH_PER_QUERY,
    videoEmbeddable: 'true', videoSyndicated: 'true',
    relevanceLanguage: lang === 'ua' ? 'uk' : lang,
  }, key)));
  const found = new Map();
  results.forEach((data, i) => {
    for (const it of (data && data.items) || []) {
      const id = it && it.id && it.id.videoId;
      if (!id || seen.has(id)) continue;
      const prev = found.get(id);
      if (prev) { prev.intents.push(queries[i].intent); continue; }
      found.set(id, {
        id, lang,
        title: clean(it.snippet && it.snippet.title),
        channel: clean(it.snippet && it.snippet.channelTitle),
        channel_id: (it.snippet && it.snippet.channelId) || null,
        published_at: (it.snippet && it.snippet.publishedAt) || null,
        live: (it.snippet && it.snippet.liveBroadcastContent) === 'live',
        engineQuery: queries[i].intent === 'problems',
        intents: [queries[i].intent],
      });
    }
  });
  return found;
}

/* метадані для показу і простого ранжування: тривалість, перегляди,
   мініатюра. Коментарі, історія каналу і будь-який інший аналіз не потрібні */
async function withMeta(found, key) {
  const ids = [...found.keys()].slice(0, 50);
  if (!ids.length) return [];
  const meta = await ytFetch('videos', {
    part: 'snippet,contentDetails,statistics', id: ids.join(','), maxResults: 50,
  }, key);
  if (!meta) return null;
  const out = [];
  for (const it of (meta.items || [])) {
    const base = found.get(it.id);
    if (!base) continue;
    const th = (it.snippet && it.snippet.thumbnails) || {};
    const pick = th.medium || th.high || th.default || null;
    out.push({
      ...base,
      title: clean(it.snippet && it.snippet.title) || base.title,
      channel: clean(it.snippet && it.snippet.channelTitle) || base.channel,
      thumb: pick ? pick.url : null,
      duration_s: parseDuration(it.contentDetails && it.contentDetails.duration),
      views: it.statistics && it.statistics.viewCount ? parseInt(it.statistics.viewCount, 10) || 0 : null,
      published_at: (it.snippet && it.snippet.publishedAt) || base.published_at,
      live: (it.snippet && it.snippet.liveBroadcastContent) === 'live',
    });
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const input = sanitizeQuery(req.query);
  const identity = buildIdentity(input);
  const key = process.env.YOUTUBE_API_KEY;
  /* нема ключа або нема з чого будувати запит: тихо порожньо, блок ховається */
  if (!identity) return res.status(200).json({ videos: [] });
  if (!key) {
    console.error(JSON.stringify({ op: 'youtube_block', reason: 'no_api_key' }));
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ videos: [] });
  }

  const seen = new Set();
  const primary = await searchLang(identity, input.lang, key, seen);
  let candidates = primary.size ? await withMeta(primary, key) : [];
  if (candidates === null) {
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ videos: [] });
  }
  let videos = selectVideos(candidates, identity, { primaryLang: input.lang });
  /* добір англійською: мовою звіту хороших відео менше, ніж місць. Для
     української резервна мова саме англійська, а не російська */
  let fallbackUsed = false;
  if (videos.length < MAX_RESULTS && input.lang !== 'en') {
    candidates.forEach(v => seen.add(v.id));
    const extra = await searchLang(identity, 'en', key, seen);
    const extraMeta = extra.size ? await withMeta(extra, key) : [];
    if (extraMeta && extraMeta.length) {
      fallbackUsed = true;
      candidates = candidates.concat(extraMeta);
      videos = selectVideos(candidates, identity, { primaryLang: input.lang });
    }
  }

  const payload = videos.map(v => ({
    id: v.id, title: v.title, channel: v.channel, thumb: v.thumb,
    duration_s: v.duration_s, published_at: v.published_at, views: v.views,
    intents: v.intents, lang: v.lang,
  }));
  /* кеш рівня CDN: ключ це сама адреса (ідентичність моделі + мова), 7 днів */
  res.setHeader('cache-control', payload.length
    ? 'public, max-age=3600, s-maxage=' + CACHE_TTL_S + ', stale-while-revalidate=86400'
    : 'no-store');
  return res.status(200).json({
    videos: payload, identity: identity.base, query_language: input.lang,
    fallback_language: fallbackUsed ? 'en' : null,
  });
}
