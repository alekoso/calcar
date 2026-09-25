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

const SEARCH_PER_QUERY = 5;     /* до 5 кандидатів на запит, разом до 15 */
const MAX_RESULTS = 6;          /* стільки віддаємо сторінці */
const MIN_DURATION_S = 120;     /* коротше: Shorts і трейлери, не огляд */
const MAX_PER_CHANNEL = 2;      /* не всі слоти одному каналу */
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

/* покоління з площадки буває сміттям ("Base", "Sedan"): беремо лише
   код платформи виду G30, W205, 958.1, TL, F10 */
export function validGeneration(raw) {
  const g = clean(raw).replace(/[«»"']/g, '');
  if (!g || g.length > 12) return null;
  if (!/^[A-Za-z]{0,3}\d{2,3}(?:\.\d)?[A-Za-z]?$|^[A-Z]{2,3}$/.test(g)) return null;
  if (/^(base|sedan|coupe|suv|auto|std)$/i.test(g)) return null;
  return g.toUpperCase();
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

/* Ідентичність для пошуку: нормалізована назва моделі зі звіту (НЕ сирий
   заголовок оголошення) плюс покоління, якщо воно відоме. Рік навмисно не
   додаємо: він звужує пошук і ріже корисні відео сусідніх років. Двигун іде
   лише в запит про проблеми і лише коли код справді відомий. */
export function buildIdentity({ title, make, model, generation, engine_code } = {}) {
  let base = clean(title);
  /* рік у кінці назви ("BMW 530e 2018") прибираємо */
  base = base.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').trim();
  if (!base) base = [clean(make), clean(model)].filter(Boolean).join(' ').trim();
  if (!base) return null;
  const gen = validGeneration(generation);
  if (gen && !new RegExp('(^|\\s)' + gen + '($|\\s)', 'i').test(base)) base += ' ' + gen;
  const eng = validEngineCode(engine_code);
  const withEngine = eng && !new RegExp('(^|\\s)' + eng.replace(/[.\-]/g, '\\$&') + '($|\\s)', 'i').test(base)
    ? base + ' ' + eng : base;
  return { base: base.slice(0, 80), withEngine: withEngine.slice(0, 90), generation: gen, engine_code: eng };
}

export function buildQueries(identity, lang) {
  const tpl = QUERY_TEMPLATES[lang] || QUERY_TEMPLATES.en;
  if (!identity) return [];
  return INTENTS.map(intent => ({
    intent,
    q: tpl[intent].replace('{engineId}', identity.withEngine).replace('{id}', identity.base),
  }));
}

/* ---------- прості детерміновані фільтр і ранжування ---------- */

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function parseDuration(iso) {
  const m = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return null;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

/* токени ідентичності: марка, модель/версія, покоління, двигун */
export function identityTokens(identity) {
  const words = norm(identity.base).split(' ').filter(Boolean);
  const gen = identity.generation ? norm(identity.generation) : null;
  const eng = identity.engine_code ? norm(identity.engine_code) : null;
  const rest = words.filter(w => w !== gen && w !== eng);
  return { make: rest[0] || null, model: rest.slice(1).filter(Boolean), generation: gen, engine: eng };
}

/* 0..1: наскільки заголовок відео справді про цю модель */
export function relevance(video, identity) {
  const tok = identityTokens(identity);
  const hay = norm(video.title + ' ' + (video.channel || ''));
  const has = w => !!w && new RegExp('(^| )' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(hay);
  let got = 0, max = 0;
  max += 0.2; if (has(tok.make)) got += 0.2;
  max += 0.5;
  if (tok.model.length) {
    const hits = tok.model.filter(has).length;
    got += 0.5 * (hits / tok.model.length);
  }
  if (tok.generation) { max += 0.2; if (has(tok.generation)) got += 0.2; }
  if (tok.engine && video.engineQuery) { max += 0.1; if (has(tok.engine)) got += 0.1; }
  return max > 0 ? got / max : 0;
}

/* популярність: логарифм переглядів, щоб вірусне generic-відео не обходило
   точне відео про саме цю версію */
export function popularity(views) {
  const v = typeof views === 'number' && isFinite(views) && views > 0 ? views : 0;
  return Math.max(0, Math.min(1, Math.log10(v + 1) / 7));
}

export function scoreVideo(video, identity) {
  const rel = relevance(video, identity);
  /* те саме відео у кількох запитах це невеликий бонус, не окрема механіка */
  const bonus = Math.min(0.1, 0.05 * Math.max(0, (video.intents || []).length - 1));
  return { ...video, relevance: rel, score: 0.7 * rel + 0.3 * popularity(video.views) + bonus };
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
export function selectVideos(candidates, identity, { max = MAX_RESULTS, minScore = 0.35 } = {}) {
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
    .filter(v => typeof v.duration_s !== 'number' || v.duration_s >= MIN_DURATION_S)
    .filter(v => isRelated(v, identity))
    .map(v => scoreVideo(v, identity))
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
  /* спершу найсильніше відео кожного наміру: огляд, проблеми, досвід */
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
  };
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

  const queries = buildQueries(identity, input.lang);
  const found = new Map();
  const results = await Promise.all(queries.map(q => ytFetch('search', {
    part: 'snippet', type: 'video', q: q.q, maxResults: SEARCH_PER_QUERY,
    videoEmbeddable: 'true', videoSyndicated: 'true',
    relevanceLanguage: input.lang === 'ua' ? 'uk' : input.lang,
  }, key)));
  results.forEach((data, i) => {
    for (const it of (data && data.items) || []) {
      const id = it && it.id && it.id.videoId;
      if (!id) continue;
      const prev = found.get(id);
      if (prev) { prev.intents.push(queries[i].intent); continue; }
      found.set(id, {
        id,
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
  if (!found.size) {
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ videos: [] });
  }

  /* метадані лише для показу і простого ранжування: тривалість, перегляди,
     мініатюра. Коментарі, історія каналу і будь-який додатковий аналіз не
     потрібні */
  const meta = await ytFetch('videos', {
    part: 'snippet,contentDetails,statistics', id: [...found.keys()].slice(0, 15).join(','), maxResults: 15,
  }, key);
  if (!meta) {
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ videos: [] });
  }
  const candidates = [];
  for (const it of (meta.items || [])) {
    const base = found.get(it.id);
    if (!base) continue;
    const th = (it.snippet && it.snippet.thumbnails) || {};
    const pick = th.medium || th.high || th.default || null;
    candidates.push({
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

  const videos = selectVideos(candidates, identity).map(v => ({
    id: v.id, title: v.title, channel: v.channel, thumb: v.thumb,
    duration_s: v.duration_s, published_at: v.published_at, views: v.views,
    intents: v.intents,
  }));
  /* кеш рівня CDN: ключ це сама адреса (ідентичність моделі + мова), 7 днів */
  res.setHeader('cache-control', videos.length
    ? 'public, max-age=3600, s-maxage=' + CACHE_TTL_S + ', stale-while-revalidate=86400'
    : 'no-store');
  return res.status(200).json({ videos, identity: identity.base, query_language: input.lang });
}
