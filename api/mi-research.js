/* Model Intelligence: малий веб-пошук усередині Check (Research v1.1).

   Петля: Check -> наявне MI і памʼять дослідження -> послідовні малі
   пакети пошуку, поки Check і так працює (до 5 пакетів, до 15 запитів і
   20 джерел на Check) -> знахідки, завершені до початку фінального
   аналізу, у контекст ПОТОЧНОГО звіту -> кожен завершений пакет одразу у
   конвеєр MI (кандидат -> доказ -> gate -> публікація, міграції 028/029)
   -> звіт готовий, решта дослідження обривається -> наступний Check
   починає з багатшого MI.

   Холодний старт. Придатність до дослідження і застосовність публікації
   це різні питання: пошук іде з канонічної ідентичності Check (бренд,
   ряд, покоління, версія і мотор лише з декодера, рік), навіть коли
   каталог MI цієї версії ще не знає. Слабша за покоління ідентичність
   дослідження не запускає. Знання привʼязується не точніше і не ширше за
   підтверджене: без субʼєкта у каталозі знахідка лишається холодним
   кандидатом і публікуватись не може.

   Актуальність, а не кількість згадок. Для кожної знахідки витягується
   життєвий цикл проблеми (постійна вразливість конструкції, вік і знос,
   разова кампанія, виправлена ревізією, залежить від обслуговування),
   ліки і спосіб перевірки саме на цій машині, період доказів окремо від
   дати сторінки. Актуальність для звіту (active, verify, resolved,
   not_applicable) ставить детермінований код поверх оцінки моделі: разова
   кампанія без підтвердження виконання це лише verify. Ранг у слабких
   місцях рахується з застосовності, актуальності, ціни помилки, якості і
   незалежності доказів і свіжості реального досвіду; згадки не рахуються.
   Один форумний анекдот лишається підказкою для перевірки, а не типовим
   слабким місцем.

   Модуль ніколи не є залежністю Check: будь-який збій це рядок логу і
   звіт як раніше. «Нічого нового» це нормальний результат. Вимкнення:
   env MI_RESEARCH=off. Пошук через Serper (той самий ключ, що в пошуку
   аукціонних записів). */

const MISSING_FUNCTION = new Set(['PGRST202', 'PGRST106', '42883', '3F000']);

export const RESEARCH_LIMITS = {
  /* на пакет */
  queries_per_batch: 3,
  sources_per_batch: 4,
  findings_per_batch: 2,
  /* на Check */
  max_batches: 5,
  max_queries: 15,
  max_sources: 20,
  empty_batches_to_stop: 2,
  source_chars: 7000,
  fetch_timeout_ms: 8000,
  search_timeout_ms: 6000,
  extraction_timeout_ms: 40000,
  /* жорстка стеля всього дослідження: воно живе лише поки живе Check */
  deadline_ms: 240000,
  /* старша за це машина отримує пакет про сучасну актуальність */
  old_vehicle_years: 6,
};

export function miResearchEnabled(env) {
  const raw = String(((env || process.env) || {}).MI_RESEARCH || '').trim().toLowerCase();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

/* ---------- PostgREST ---------- */

async function rpc(name, args, opts = {}) {
  const base = opts.base || process.env.SUPABASE_URL;
  const key = opts.key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const doFetch = opts.fetch || fetch;
  if (!base || !key) return { ok: false, reason: 'no_credentials', body: null, ms: 0 };
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || 6000);
  try {
    const res = await doFetch(base.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST', signal: ac.signal,
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    const ms = Date.now() - started;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = body && (body.code || body.error_code);
      if (res.status === 404 || MISSING_FUNCTION.has(code)) return { ok: false, reason: 'not_installed', body: null, ms };
      return { ok: false, reason: 'error', status: res.status, code: code || null, body: null, ms };
    }
    return { ok: true, reason: null, body, ms };
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'error', error: String((e && e.message) || e).slice(0, 160), body: null, ms: Date.now() - started };
  } finally { clearTimeout(timer); }
}

const logLine = (op, extra) => console.log('[mi-research]', JSON.stringify({ op, ...extra }));

/* ---------- Ідентичність ---------- */

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\s+/g, ' ').trim();
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

/* Канонічна ідентичність Check для дослідження. Версія і мотор лише з
   декодера чи MI, ніколи з заголовка продавця. Достатня ідентичність це
   бренд + ряд + покоління (або версія каталогу MI). */
export function researchIdentity(src = {}) {
  const id = {
    brand: clean(src.brand) || null,
    model_line: clean(src.model_line) || null,
    generation: clean(src.generation) || null,
    version_text: clean(src.version_text) || null,
    engine_text: clean(src.engine_text) || null,
    model_year: Number.isInteger(Number(src.model_year)) && Number(src.model_year) > 1950 ? Number(src.model_year) : null,
    mileage_km: Number.isFinite(Number(src.mileage_km)) && Number(src.mileage_km) > 0 ? Math.round(Number(src.mileage_km)) : null,
    market: clean(src.market) || null,
  };
  id.label = identityLabelFrom(id);
  id.sufficient = !!(id.brand && id.model_line && id.generation);
  return id;
}

function identityLabelFrom(id) {
  const parts = []; const seen = new Set();
  for (const raw of [id.brand, id.model_line, id.generation, id.version_text, id.engine_text, id.model_year ? String(id.model_year) : '']) {
    for (const w of String(raw || '').split(/\s+/)) {
      const k = norm(w);
      if (!k || seen.has(k)) continue;
      seen.add(k); parts.push(w);
    }
  }
  return parts.join(' ').trim();
}

/* Мітка для пошуку: версія і мотор з MI, коли MI їх знає, інакше з
   канонічної ідентичності Check. */
export function identityLabel(ctx, identity) {
  const s = (ctx && ctx.identity_summary) || {};
  const id = identity || {};
  if (s.version) {
    const engine = (Array.isArray(s.components) ? s.components : [])
      .filter(c => c && c.role === 'engine' && c.variant && /confirmed|assumed_factory/.test(String(c.resolution_status || '')))
      .map(c => String(c.variant).replace(/\s*\([^)]*\)/g, ''))[0] || '';
    return identityLabelFrom({ brand: id.brand || s.brand || '', model_line: '', generation: '',
      version_text: String(s.version).replace(/\s*\([^)]*\)\s*$/, ''), engine_text: engine || id.engine_text || '',
      model_year: s.model_year || id.model_year || null });
  }
  return id.label || '';
}

/* ---------- Контекст ---------- */

export async function fetchResearchContext(vin, identity, opts = {}) {
  const r = await rpc('mi_research_context', { p_vin: vin ? String(vin).trim().toUpperCase() : null, p_identity: identity ? {
    brand: identity.brand, model_line: identity.model_line, generation: identity.generation, label: identity.label } : null }, { ...opts, timeoutMs: opts.timeoutMs || 8000 });
  if (!r.ok) {
    if (r.reason === 'error' || r.reason === 'timeout') logLine('mi_research_context', { reason: r.reason, status: r.status || null, code: r.code || null, error: r.error || null, ms: r.ms });
    return { ok: false, reason: r.reason, ms: r.ms };
  }
  const b = r.body || {};
  return { ok: true, available: b.available === true, reason: b.reason || null, context: b, ms: r.ms };
}

/* ---------- Планування пакетів ---------- */

/* Область знання і термін пошуку. Область знахідки виводиться з ролі
   компонента або тексту, щоб не шукати те саме двічі. */
export const AREA_TERMS = [
  ['engine', 'engine problems failure'],
  ['transmission', 'transmission gearbox problems'],
  ['drivetrain', 'transfer case OR driveshaft OR differential OR all-wheel-drive problems'],
  ['cooling', 'coolant leak OR cooling system OR overheating problems'],
  ['chassis', 'suspension OR air suspension OR steering problems'],
  ['electrical', 'electrical OR electronics OR module faults'],
  ['body', 'body OR interior OR water leak known issues'],
];
const AREA_HINTS = {
  engine: /engine|cylinder|bore|piston|timing|camshaft|turbo|injector|oil consumption|head gasket|misfire|variocam|vanos/i,
  transmission: /transmission|gearbox|dsg|pdk|tiptronic|clutch|torque converter|mechatronic|shift/i,
  drivetrain: /transfer case|driveshaft|propshaft|differential|awd|all-wheel|4wd|axle|cv joint/i,
  cooling: /coolant|cooling|radiator|thermostat|water pump|overheat|coolant pipe/i,
  chassis: /suspension|air spring|strut|shock|damper|control arm|steering|pdcc|compressor|level sensor/i,
  electrical: /electrical|electronic|module|wiring|sensor|battery drain|software|infotainment|pcm|display|screen/i,
  body: /leak|water ingress|sunroof|panoramic|drain|rust|corrosion|door|seat|trim|interior/i,
};
export function findingArea(f) {
  const role = f && f.component_role;
  if (role === 'engine') return 'engine';
  if (role === 'transmission') return 'transmission';
  if (role === 'transfer_case') return 'drivetrain';
  if (role === 'suspension_system' || role === 'brake_system') return 'chassis';
  if (role === 'battery_pack') return 'electrical';
  const t = String((f && f.text_en) || '');
  for (const [area, rx] of Object.entries(AREA_HINTS)) if (rx.test(t)) return area;
  return 'other';
}
export function knowledgeArea(k) {
  if (k && k.area && k.area !== 'vehicle_wide' && k.area !== 'version' && k.area !== 'generation' && k.area !== 'entitlements') return k.area;
  return findingArea({ text_en: k && k.text });
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'on', 'in', 'to', 'for', 'is', 'are', 'and', 'or', 'this', 'that', 'with', 'at', 'by', 'from', 'can', 'may', 'be', 'its', 'it', 'as', 'vehicles', 'reported', 'cause', 'causes', 'between', 'km', 'miles']);
const keywords = (text, n = 6) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ').split(/\s+/)
  .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)).slice(0, n).join(' ');

/* Наступний пакет із того, що CalCar уже знає: наявне MI, знахідки цього
   Check, відкриті кандидати, вже використані запити. Порядок: спершу
   загальний огляд, потім посилення слабких кандидатів, потім області без
   знання; для старої машини один пакет свідомо шукає сучасні докази.
   null означає, що змістовних прогалин не лишилось. */
export function planBatch(state, limits = RESEARCH_LIMITS) {
  const { context, identity, findings, batches, queries } = state;
  const label = identityLabel(context, identity);
  if (!label) return null;
  const done = new Set(batches.map(b => b.area));
  const used = new Set(queries.map(norm));
  const year = state.reportYear || new Date().getFullYear();
  const age = identity && identity.model_year ? year - identity.model_year : null;
  const market = (context && context.identity_summary && context.identity_summary.market_sold) || identity.market || null;
  const fresh = qs => [...new Set(qs.map(clean).filter(Boolean))].filter(q => !used.has(norm(q))).slice(0, limits.queries_per_batch);

  if (!done.has('general')) {
    const qs = [label + ' common problems known issues'];
    if (!market || market === 'US') qs.push(label + ' recall OR service campaign OR technical service bulletin');
    else qs.push(label + ' known faults buyers guide');
    return { area: 'general', queries: fresh(qs) };
  }

  /* Посилення: відкритий кандидат без достатніх доказів шукається саме
     як він сформульований, а не як «ще одна проблема». */
  const weak = ((context && context.open_candidates) || []).filter(c => c && c.id && (c.evidence_count || 0) < 3 && !state.strengthened.has(c.id));
  if (weak.length && !done.has('strengthen')) {
    const c = weak[0];
    state.strengthened.add(c.id);
    const qs = [label + ' ' + keywords(c.text, 5), label + ' ' + keywords(c.text, 3) + ' owners forum experience'];
    return { area: 'strengthen', target_candidate: c.id, queries: fresh(qs) };
  }

  /* Сучасна актуальність для старої машини: чи бачать проблему сьогодні. */
  if (age != null && age >= limits.old_vehicle_years && !done.has('recent_relevance')) {
    const qs = [label + ' problems still ' + (year - 1) + ' ' + year + ' owners today',
      label + ' what to check before buying ' + year + ' high mileage'];
    return { area: 'recent_relevance', queries: fresh(qs) };
  }

  /* Області без знання: ні в MI, ні у знахідках цього Check. */
  const covered = new Set([...((context && context.knowledge) || []).map(knowledgeArea), ...findings.map(findingArea)]);
  for (const [area, term] of AREA_TERMS) {
    if (covered.has(area) || done.has(area)) continue;
    const qs = [label + ' ' + term];
    if (age != null && age >= limits.old_vehicle_years) qs.push(label + ' ' + term.split(' OR ')[0] + ' ' + (year - 1) + ' ' + year);
    const q = fresh(qs);
    if (q.length) return { area, queries: q };
  }
  return null;
}

/* ---------- Джерела ---------- */

const EXCLUDED_HOST = /(^|\.)(youtube|youtu\.be|facebook|instagram|tiktok|pinterest|twitter|x\.com|amazon|ebay|aliexpress|auto\.ria|autoscout24|mobile\.de|olx|cars\.com|autotrader|carfax|carvana|copart|iaai|bidfax|wikipedia|quora|linkedin|google|bing)\b/i;
const OWNER_HOST = /reddit|forum|forums|rennlist|planet-9|6speedonline|bimmerpost|bimmerfest|bimmerforums|teslamotorsclub|hyundai-forums|vwvortex|audizine|audiworld|club|community|board/i;
const VENDOR_HOST = /pelicanparts|fcpeuro|ecstuning|turnermotorsport|rockauto|autodoc|-parts|parts\.|shop|store/i;
const AGGREGATOR_HOST = /carcomplaints|repairpal|kbb\.com|edmunds|cargurus|consumerreports|jdpower|autoevolution|motorbiscuit|hotcars/i;
const LEGAL_HOST = /\.gov$|\.gov\.|nhtsa|recalls|kba\.de|\.europa\.eu|rapex|transport\.canada/i;

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
}

/* Детермінована класифікація за доменом. Те, чого домен не каже, вирішує
   модель, але піднести джерело до official чи legal вона не може. */
export function classifySource(url, brand) {
  const host = hostOf(url);
  const slug = norm(brand).replace(/[\s.-]+/g, '');
  if (!host) return { host, source_type: 'unknown', quality: null };
  if (LEGAL_HOST.test(host)) return { host, source_type: 'legal', quality: 'primary' };
  if (slug && new RegExp('(^|\\.)(press\\.)?' + slug + '(usa|group|-usa|ag)?\\.(com|de|co\\.uk|ca|net|eu|com\\.ua)$').test(host)) return { host, source_type: 'official', quality: 'primary' };
  if (OWNER_HOST.test(host)) return { host, source_type: 'owner', quality: 'secondary' };
  if (VENDOR_HOST.test(host)) return { host, source_type: 'vendor', quality: 'secondary' };
  if (AGGREGATOR_HOST.test(host)) return { host, source_type: 'aggregator', quality: 'low' };
  return { host, source_type: 'unknown', quality: null };
}

const CLASS_RANK = { official: 0, legal: 0, unknown: 1, owner: 2, aggregator: 3, vendor: 4 };

/* Відбір джерел пакета: кращий клас домену першим, один хост один раз, без
   уже прочитаних адрес і без площадок і соцмереж. */
export function pickSources(results, opts = {}) {
  const limits = opts.limits || RESEARCH_LIMITS;
  const max = opts.max != null ? opts.max : limits.sources_per_batch;
  const excludeHost = opts.excludeHost ? String(opts.excludeHost).replace(/^www\./, '') : null;
  const seenUrl = new Set((opts.seenUrls || []).map(u => String(u).replace(/[#?].*$/, '')));
  const seenHost = new Set(opts.seenHosts || []);
  const out = [];
  let order = 0;
  for (const r of Array.isArray(results) ? results : []) {
    for (const item of Array.isArray(r && r.items) ? r.items : []) {
      const url = String((item && item.link) || '');
      if (!/^https?:\/\//.test(url)) continue;
      const host = hostOf(url);
      if (!host || EXCLUDED_HOST.test(host) || (excludeHost && host.endsWith(excludeHost)) || seenHost.has(host) || seenUrl.has(url.replace(/[#?].*$/, ''))) continue;
      seenHost.add(host);
      const cls = classifySource(url, opts.brand);
      out.push({ url, host, title: String((item && item.title) || '').slice(0, 200), snippet: String((item && item.snippet) || '').slice(0, 300), query: r.query, order: order++, ...cls });
    }
  }
  out.sort((a, b) => (CLASS_RANK[a.source_type] - CLASS_RANK[b.source_type]) || (a.order - b.order));
  return out.slice(0, Math.max(0, max));
}

export async function searchSerper(query, opts = {}) {
  const key = opts.key || process.env.SERPER_API_KEY;
  const doFetch = opts.fetch || fetch;
  const started = Date.now();
  if (!key) return { query, ok: false, reason: 'no_search_key', items: [], ms: 0 };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || RESEARCH_LIMITS.search_timeout_ms);
  const onAbort = () => ac.abort();
  if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await doFetch(opts.endpoint || 'https://google.serper.dev/search', {
      method: 'POST', signal: ac.signal,
      headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10 }),
    });
    if (!r.ok) return { query, ok: false, reason: 'http_' + r.status, items: [], ms: Date.now() - started };
    const j = await r.json().catch(() => null);
    const items = (j && Array.isArray(j.organic) ? j.organic : []).map(o => ({ link: o.link, title: o.title, snippet: o.snippet, date: o.date || null }));
    return { query, ok: true, reason: null, items, ms: Date.now() - started };
  } catch (e) {
    return { query, ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'error', items: [], ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

const BLOCKED = /just a moment|cf-chl|cf-browser-verification|captcha|incapsula|attention required|enable javascript and cookies|verify (that )?you are (a )?human|security verification|robot check|performing security/i;

export function pageText(html, maxChars = RESEARCH_LIMITS.source_chars) {
  const t = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return t.slice(0, maxChars);
}

/* Дата сторінки з розмітки: лише те, що є; вгадувань немає. Це дата
   ПУБЛІКАЦІЇ, а не дата досвіду, про який сторінка розповідає. */
export function pageDate(html) {
  const h = String(html || '').slice(0, 200000);
  const m = /<meta[^>]+(?:property|name)=["'](?:article:published_time|article:modified_time|datePublished|dateModified|og:updated_time|date)["'][^>]+content=["'](\d{4}-\d{2}-\d{2})/i.exec(h)
    || /"(?:datePublished|dateModified)"\s*:\s*"(\d{4}-\d{2}-\d{2})/i.exec(h)
    || /<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})/i.exec(h);
  return m ? m[1] : null;
}

export async function fetchSourceText(src, opts = {}) {
  const doFetch = opts.fetch || fetch;
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs || RESEARCH_LIMITS.fetch_timeout_ms);
  const onAbort = () => ac.abort();
  if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const r = await doFetch(src.url, {
      signal: ac.signal, redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
    });
    const html = (await r.text()).slice(0, 600000);
    const blocked = r.status === 403 || r.status === 429 || r.status === 503 || BLOCKED.test(html.slice(0, 4000));
    if (!r.ok || blocked) return { ...src, status: blocked ? 'blocked' : 'http_' + r.status, text: '', chars: 0, ms: Date.now() - started };
    const text = pageText(html, (opts.limits || RESEARCH_LIMITS).source_chars);
    if (text.length < 400) return { ...src, status: 'empty', text: '', chars: text.length, ms: Date.now() - started };
    return { ...src, status: 'ok', text, chars: text.length, source_date: pageDate(html), ms: Date.now() - started };
  } catch (e) {
    return { ...src, status: e && e.name === 'AbortError' ? 'timeout' : 'error', text: '', chars: 0, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

/* ---------- Витяг ---------- */

const S = (type, description) => description ? { type, description } : { type };
const E = values => ({ type: 'string', enum: values });
const OBJ = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });

export const LIFECYCLES = ['persistent_design_susceptibility', 'age_or_wear_related', 'campaign_or_one_time_fix', 'superseded_by_revision', 'maintenance_dependent', 'unknown'];
export const RELEVANCE = ['active', 'verify', 'resolved', 'not_applicable'];

export function extractionResponseFormat(limits = RESEARCH_LIMITS) {
  const schema = OBJ({
    findings: { type: 'array', maxItems: limits.findings_per_batch, items: OBJ({
      text_en: S('string', 'one precise reusable statement about the model, version or component, in English; no prevalence words unless the source states counts'),
      scope: E(['version', 'generation', 'component', 'vehicle']),
      component_role: E(['engine', 'transmission', 'transfer_case', 'suspension_system', 'brake_system', 'battery_pack', 'other', 'none']),
      knowledge_type: E(['known_issue', 'official_fact', 'owner_pattern', 'specialist_practice']),
      novelty: E(['new', 'strengthens_existing', 'strengthens_candidate', 'contradicts_existing']),
      candidate_id: S('string', 'id of the OPEN CANDIDATE this finding strengthens or contradicts, else empty string'),
      severity: E(['catastrophic', 'major', 'moderate', 'minor', 'none']),
      buyer_importance: S('integer', '1..5: how much this can change a purchase decision; consequence, not frequency'),
      buyer_implication_en: S('string', 'what a buyer should do or check, one sentence'),
      causal_status: E(['observed_association', 'plausible_mechanism', 'supported_cause', 'unknown']),
      affected_scope: S('string', 'model years, production dates, engine, revision, configuration the sources tie this to; what they do NOT say'),
      lifecycle: E(LIFECYCLES),
      remedy: S('string', 'official remedy, campaign, revised part, software update or repair that closes the issue; empty if none known'),
      verify_on_vehicle: S('string', 'how to tell whether this issue still applies to THIS car: VIN campaign check, invoice, part number, production date, inspection, borescope, diagnostics; or "no reliable verification"'),
      evidence_period: S('string', 'years of the underlying real-world experience the sources describe, e.g. "2011-2014" or "2023-2025"; "unknown" if not stated'),
      current_relevance: E(RELEVANCE),
      relevance_reason: S('string', 'why this relevance for a car of this age and mileage in the report year'),
      evidence: { type: 'array', items: OBJ({
        source_index: S('integer', 'index of the source in SOURCES'),
        excerpt: S('string', 'verbatim excerpt copied from that source text, 25..300 characters'),
        stance: E(['supports', 'contradicts', 'context']),
        evidence_date: S('string', 'year or period of the experience described in this excerpt, or "unknown"'),
      }) },
    }) },
    sources: { type: 'array', items: OBJ({
      source_index: S('integer'),
      source_type: E(['official', 'legal', 'specialist', 'owner', 'review', 'market', 'vendor', 'aggregator']),
      quality: E(['primary', 'secondary', 'low']),
      note: S('string', 'why: first-hand workshop or engine builder = specialist primary; magazine or blog retelling = specialist secondary or review'),
    }) },
    nothing_new_reason: S('string', 'when findings is empty: why, one sentence; otherwise empty string'),
  });
  return { type: 'json_schema', json_schema: { name: 'calcar_mi_research', strict: true, schema } };
}

export const EXTRACTION_RULES = `You are the research step of CalCar Model Intelligence. You receive the resolved identity of a specific used car, what CalCar ALREADY knows (KNOWN), open unpublished CANDIDATES with their evidence gaps, findings already made earlier in THIS check (FOUND_THIS_CHECK), and the text of a few web sources (SOURCES).

Your task is NOT to research the model from scratch. Find 0 to 2 IMPORTANT, REUSABLE facts about the model, version or component that CalCar does not already know, or that materially strengthen, narrow or contradict an existing KNOWN item or CANDIDATE. Zero findings is a valid, common result: never invent a finding to fill the list. Never restate a KNOWN item or a FOUND_THIS_CHECK item as new.

What counts: a documented failure mode of this exact version or component missing from KNOWN; a recall or service campaign; an important component revision or change date; a major drivetrain, engine, battery, cooling or transmission weakness; stronger or independent evidence for an open CANDIDATE (set novelty strengthens_candidate and candidate_id); evidence that an existing item does or does not apply to this exact configuration; evidence about whether an old issue still shows up on cars in service today.
What does not count: generic maintenance advice, statements true of any car, SEO filler, duplicates, single anecdotes without a mechanism, prices.

Rules:
- Every finding needs at least one evidence excerpt copied VERBATIM from a source text (25 to 300 characters). No excerpt, no finding.
- scope: "component" only when the source ties the fact to the exact engine, transmission or other unit AND that unit is resolved in IDENTITY; otherwise "version" or "generation". If the source proves a failure mode only for another engine or version, say so in affected_scope and do NOT attach it to this car. "vehicle" is for facts about this individual VIN only.
- knowledge_type: official_fact only from manufacturer or regulator documents; known_issue for technical failure modes documented or described by workshops; owner_pattern for recurring owner reports with mileage or age context; specialist_practice for a workshop practice with a stated cause.
- lifecycle: persistent_design_susceptibility (the installed design stays susceptible), age_or_wear_related (grows with age and mileage), campaign_or_one_time_fix (a recall or campaign closes it on a given car), superseded_by_revision (a later part or software fixed it), maintenance_dependent, unknown.
- current_relevance for THIS car in the REPORT YEAR: active = still relevant today; verify = historically applicable but completion of the remedy, revision or replacement on this car is unknown; resolved = evidence shows it was permanently addressed for this configuration; not_applicable = this car is outside the affected scope. A campaign whose completion on this VIN is unknown is verify, never active. An old official document stays valid evidence of existence; what changes is current relevance. Recent real-world evidence matters for relevance but one isolated recent post does not outweigh many credible earlier reports.
- Separate the page date from the period of the experience it describes: a 2026 article retelling a 2012 recall is historical evidence.
- Do not upgrade owner forum evidence into a fact about prevalence. Avoid "most common", "#1 problem", "almost all cars" unless a source gives counts.
- Classify each source honestly: "specialist primary" only for first-hand technical sources (workshop, engine builder, engineer describing own cases); magazines, blogs and retellings are specialist secondary or review; forums are owner.
Answer only with JSON matching the schema.`;

const compactKnown = (knowledge, max = 24) => (Array.isArray(knowledge) ? knowledge : []).slice(0, max)
  .map((k, i) => `${i + 1}. [${k.kind || 'item'}/${k.area || '-'} ${k.knowledge_type || ''} ${k.status || ''}] ${String(k.text || '').slice(0, 220)}`).join('\n');
const compactCandidates = (cands, max = 12) => (Array.isArray(cands) ? cands : []).slice(0, max)
  .map(c => `- candidate_id ${c.id} [${c.knowledge_type || ''}${c.lifecycle ? ', ' + c.lifecycle : ''}] ${String(c.text || '').slice(0, 220)} | evidence: ${c.evidence_count || 0} from ${(c.hosts || []).join(', ') || 'none'} | gate gaps: ${(c.gate_failed || []).join(', ') || 'none'}`).join('\n');
const compactFound = (findings, max = 10) => (Array.isArray(findings) ? findings : []).slice(0, max)
  .map((f, i) => `${i + 1}. [${f.scope}${f.component_role ? ':' + f.component_role : ''} ${f.knowledge_type} ${f.lifecycle || ''} ${f.current_relevance || ''}] ${String(f.text_en || '').slice(0, 200)}`).join('\n');

export function extractionUserMessage(state, batch, sources) {
  const ctx = state.context || {};
  const id = state.identity || {};
  const s = ctx.identity_summary || {};
  const year = state.reportYear || new Date().getFullYear();
  const age = id.model_year ? year - id.model_year : null;
  const comps = (Array.isArray(s.components) ? s.components : []).map(c => `${c.role}: ${c.variant} (${c.resolution_status})`).join('; ') || 'no component resolved: do not attach findings to a specific engine or unit';
  const src = sources.map((x, i) => `--- SOURCE ${i} | ${x.host} | domain class: ${x.source_type}${x.quality ? '/' + x.quality : ''} | page date: ${x.source_date || 'unknown'} | ${x.title}\n${x.text}`).join('\n\n');
  return `IDENTITY: ${identityLabel(ctx, id)}\nbrand: ${id.brand || s.brand || 'unknown'}; model line: ${id.model_line || 'unknown'}; generation/platform: ${id.generation || 'unknown'}; catalogue version: ${s.version || 'not in catalogue yet'}; version_market_year: ${s.vmy || 'unknown'}; market sold: ${s.market_sold || id.market || 'unknown'}; model year: ${id.model_year || s.model_year || 'unknown'}; mileage km: ${id.mileage_km || s.mileage_km || 'unknown'}\nREPORT YEAR: ${year}${age != null ? '; vehicle age: ' + age + ' years' : ''}\ncomponents: ${comps}\nBATCH FOCUS: ${batch.area}${batch.target_candidate ? ' (look for stronger or independent evidence for candidate_id ' + batch.target_candidate + ')' : ''}\n\nKNOWN (${ctx.knowledge_count || 0} items CalCar already has):\n${compactKnown(ctx.knowledge) || '(nothing yet)'}\n\nCANDIDATES (open, unpublished; strengthen with candidate_id rather than restating):\n${compactCandidates(ctx.open_candidates) || '(none)'}\n\nFOUND_THIS_CHECK (earlier batches; do not repeat):\n${compactFound(state.findings) || '(none)'}\n\nSOURCES (${sources.length}):\n${src}`;
}

const normText = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/* Детермінована актуальність поверх оцінки моделі: разова кампанія чи
   залежність від обслуговування без підтвердження на цій машині це лише
   verify; постійна вразливість і знос лишаються active, поки машина у
   зоні дії; "resolved" без доказу про саме цю машину стає verify. */
export function applyRelevanceRules(f) {
  let r = RELEVANCE.includes(f.current_relevance) ? f.current_relevance : 'verify';
  const lc = LIFECYCLES.includes(f.lifecycle) ? f.lifecycle : 'unknown';
  if (r === 'not_applicable') return { relevance: r, lifecycle: lc };
  if (lc === 'campaign_or_one_time_fix' || lc === 'maintenance_dependent') r = 'verify';
  else if (lc === 'superseded_by_revision') r = r === 'active' ? 'verify' : r;
  else if (lc === 'persistent_design_susceptibility' || lc === 'age_or_wear_related') r = r === 'resolved' ? 'verify' : 'active';
  if (r === 'resolved') r = 'verify';
  return { relevance: r, lifecycle: lc };
}

/* Сила доказу знахідки: найсильніше джерело серед supports */
export function evidenceStrength(evidence) {
  const sup = (evidence || []).filter(e => e.stance !== 'contradicts');
  if (sup.some(e => e.source_type === 'official' || e.source_type === 'legal')) return 'documented';
  if (sup.some(e => e.source_type === 'specialist' && e.quality === 'primary')) return 'specialist';
  if (sup.some(e => e.source_type === 'specialist' || e.source_type === 'review')) return 'secondary';
  return 'owner';
}

/* Мінімум доказів для помітного слабкого місця: офіційне або сильне
   фахове джерело, або кілька незалежних нижчих. Інакше лише підказка. */
export function prominence(f) {
  const hosts = new Set((f.evidence || []).filter(e => e.stance !== 'contradicts').map(e => e.independence_group || e.host));
  if (f.strength === 'documented' || f.strength === 'specialist') return 'weak_spot';
  return hosts.size >= 2 ? 'weak_spot' : 'lead';
}

const yearOf = s => { const m = /(20\d{2}|19\d{2})(?!.*(20\d{2}|19\d{2}))/.exec(String(s || '')); return m ? Number(m[1]) : null; };

/* Ранг для слабких місць: застосовність і актуальність, ціна помилки,
   якість і незалежність доказів, свіжість реального досвіду. Кількість
   згадок і позиція у пошуку не рахуються. */
export function rankScore(f, reportYear) {
  const rel = f.current_relevance === 'active' ? 3 : f.current_relevance === 'verify' ? 2 : 0;
  if (!rel) return 0;
  const sev = { catastrophic: 4, major: 3, moderate: 2, minor: 1, none: 0.5 }[f.severity] || 0.5;
  const q = { documented: 3, specialist: 2, secondary: 1, owner: 0.5 }[f.strength] || 0.5;
  const hosts = new Set((f.evidence || []).filter(e => e.stance !== 'contradicts').map(e => e.independence_group || e.host)).size;
  const conf = Math.min(hosts, 3);
  const latest = Math.max(...[(f.evidence || []).map(e => yearOf(e.evidence_date)), yearOf(f.evidence_period)].flat().filter(Boolean), 0);
  const fresh = latest && reportYear && latest >= reportYear - 3 ? 1 : 0;
  const lc = f.lifecycle === 'persistent_design_susceptibility' || f.lifecycle === 'age_or_wear_related' ? 1 : 0;
  return rel * 2 + sev * 1.5 + q + conf + fresh + lc;
}

/* Валідація відповіді моделі: цитата мусить бути в тексті джерела, клас
   домену сильніший за думку моделі, область компонента лише для
   розвʼязаного варіанта, актуальність за правилами, не більше 2 знахідок. */
export function sanitizeFindings(raw, sources, state, limits = RESEARCH_LIMITS) {
  const ctx = (state && state.context) || {};
  const out = [];
  const classes = new Map();
  for (const c of (raw && Array.isArray(raw.sources)) ? raw.sources : []) {
    if (Number.isInteger(c.source_index) && sources[c.source_index]) classes.set(c.source_index, c);
  }
  const resolvedRoles = new Set(((ctx.identity_summary && ctx.identity_summary.components) || [])
    .filter(c => c && c.variant && /confirmed|assumed_factory/.test(String(c.resolution_status || ''))).map(c => c.role));
  const openIds = new Set(((ctx.open_candidates) || []).map(c => String(c.id)));
  const known = new Set([...(ctx.knowledge || []).map(k => normText(k.text)), ...((state && state.findings) || []).map(f => normText(f.text_en))]);
  const normSrc = sources.map(x => normText(x.text));
  const brand = (state && state.identity && state.identity.brand) || (ctx.identity_summary && ctx.identity_summary.brand);
  for (const f of (raw && Array.isArray(raw.findings)) ? raw.findings : []) {
    if (!f || typeof f !== 'object') continue;
    const text = String(f.text_en || '').trim();
    if (text.length < 20 || known.has(normText(text))) continue;
    let scope = ['version', 'generation', 'component', 'vehicle'].includes(f.scope) ? f.scope : 'version';
    let role = f.component_role && f.component_role !== 'none' ? f.component_role : null;
    if (scope === 'component' && !(role && resolvedRoles.has(role))) { scope = 'version'; }
    const evidence = [];
    for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
      const i = e && e.source_index;
      const src = Number.isInteger(i) ? sources[i] : null;
      const excerpt = String((e && e.excerpt) || '').trim();
      if (!src || excerpt.length < 25) continue;
      if (!normSrc[i].includes(normText(excerpt))) continue;
      const cls = classes.get(i) || {};
      const domain = classifySource(src.url, brand);
      const source_type = domain.source_type !== 'unknown' ? domain.source_type
        : (['specialist', 'review', 'market', 'aggregator', 'vendor', 'owner'].includes(cls.source_type) ? cls.source_type : 'review');
      const quality = domain.source_type !== 'unknown' ? domain.quality
        : (['primary', 'secondary', 'low'].includes(cls.quality) ? cls.quality : 'secondary');
      evidence.push({ url: src.url, title: src.title || null, host: src.host, source_type, quality,
        stance: ['supports', 'contradicts', 'context'].includes(e.stance) ? e.stance : 'supports',
        excerpt: excerpt.slice(0, 300), independence_group: src.host,
        source_date: src.source_date || null, evidence_date: e.evidence_date && e.evidence_date !== 'unknown' ? String(e.evidence_date).slice(0, 40) : null });
    }
    if (!evidence.length) continue;
    const rel = applyRelevanceRules(f);
    const item = {
      text_en: text.slice(0, 600), scope, component_role: scope === 'component' ? role : null,
      knowledge_type: ['known_issue', 'official_fact', 'owner_pattern', 'specialist_practice'].includes(f.knowledge_type) ? f.knowledge_type : 'known_issue',
      novelty: ['new', 'strengthens_existing', 'strengthens_candidate', 'contradicts_existing'].includes(f.novelty) ? f.novelty : 'new',
      candidate_id: f.candidate_id && openIds.has(String(f.candidate_id)) ? String(f.candidate_id) : null,
      severity: ['catastrophic', 'major', 'moderate', 'minor', 'none'].includes(f.severity) ? f.severity : 'none',
      buyer_importance: Number.isInteger(f.buyer_importance) && f.buyer_importance >= 1 && f.buyer_importance <= 5 ? f.buyer_importance : 3,
      buyer_implication_en: String(f.buyer_implication_en || '').slice(0, 300),
      causal_status: ['observed_association', 'plausible_mechanism', 'supported_cause', 'unknown'].includes(f.causal_status) ? f.causal_status : 'unknown',
      affected_scope: String(f.affected_scope || '').slice(0, 300),
      lifecycle: rel.lifecycle,
      remedy: String(f.remedy || '').slice(0, 300),
      verify_on_vehicle: String(f.verify_on_vehicle || '').slice(0, 300),
      evidence_period: String(f.evidence_period || '').slice(0, 60),
      current_relevance: rel.relevance,
      model_relevance: RELEVANCE.includes(f.current_relevance) ? f.current_relevance : null,
      relevance_reason: String(f.relevance_reason || '').slice(0, 300),
      evidence,
      strength: evidenceStrength(evidence),
    };
    item.prominence = prominence(item);
    item.rank = rankScore(item, state && state.reportYear);
    out.push(item);
    if (out.length >= limits.findings_per_batch) break;
  }
  return out;
}

/* ---------- Текст для основного виклику ---------- */

const STRENGTH_WORDING = {
  documented: 'офіційне або регуляторне джерело: можна подавати як документований факт',
  specialist: 'першоджерело фахівців: "фахівці описують", без слів про поширеність',
  secondary: 'вторинне фахове або оглядове джерело: "за даними фахових джерел", без слів про поширеність',
  owner: 'лише власники: тільки "власники повідомляють", "трапляються скарги"; НЕ факт і НЕ "типова проблема"',
};
const RELEVANCE_WORDING = {
  active: 'АКТУАЛЬНО сьогодні для цієї машини',
  verify: 'ПЕРЕВІРИТИ: історично стосується, але невідомо, чи ліки/ревізія/заміна виконані саме на цій машині; формулюй як пункт перевірки, не як несправність',
  resolved: 'ЗАКРИТО: докази кажуть, що усунено для цієї конфігурації; у слабкі місця НЕ виносити',
  not_applicable: 'НЕ ПРО ЦЮ МАШИНУ: поза зоною дії; у слабкі місця НЕ виносити',
};
const LIFECYCLE_WORDING = {
  persistent_design_susceptibility: 'постійна вразливість конструкції: лишається, поки стоїть той самий вузол',
  age_or_wear_related: 'вік і знос: з роками і пробігом стає актуальнішою',
  campaign_or_one_time_fix: 'разова кампанія або відклик: закривається на конкретній машині після виконання',
  superseded_by_revision: 'виправлено пізнішою ревізією деталі чи ПЗ',
  maintenance_dependent: 'залежить від виконаного обслуговування',
  unknown: 'життєвий цикл невідомий',
};

/* Блок для основного виклику зі знімка: наявне MI і знахідки, завершені
   ДО фінального аналізу, відсортовані за рангом, а не за кількістю згадок. */
export function researchBlock(snapshot) {
  if (!snapshot || !snapshot.context || snapshot.context.available !== true) return null;
  const ctx = snapshot.context;
  const known = (ctx.knowledge || []).slice(0, 14);
  const all = Array.isArray(snapshot.findings) ? snapshot.findings.slice() : [];
  if (!known.length && !all.length) return null;
  const year = snapshot.reportYear || new Date().getFullYear();
  const current = all.filter(f => f.current_relevance === 'active' || f.current_relevance === 'verify').sort((a, b) => rankScore(b, year) - rankScore(a, year));
  const closed = all.filter(f => f.current_relevance === 'resolved' || f.current_relevance === 'not_applicable');
  const lines = [];
  lines.push('MODEL_INTELLIGENCE (перевірена база знань CalCar про ' + identityLabel(ctx, snapshot.identity) + '; статус APPLICABLE = стосується цієї машини, CONDITIONAL = залежить від невідомого виміру, тоді формулюй як "варто перевірити", а не як факт):');
  if (known.length) {
    for (const k of known) {
      lines.push('- [' + (k.area || 'version') + ', ' + (k.knowledge_type || '') + ', ' + (k.status || '') + (k.severity ? ', ' + k.severity : '') + '] ' + String(k.text || '').slice(0, 260) + (k.condition ? ' (умова: ' + String(k.condition).slice(0, 120) + ')' : ''));
    }
  } else {
    lines.push('- база знань про цю версію поки порожня');
  }
  if (current.length || closed.length) {
    lines.push('');
    lines.push('FRESH_WEB_FINDINGS (свіжий веб-пошук цього Check, завершений до аналізу; це ДОКАЗИ з джерелами, а не перевірене знання CalCar; порядок за важливістю для покупця у ' + year + ' році, НЕ за кількістю згадок):');
    current.forEach((f, i) => {
      const srcs = f.evidence.map(e => e.host + ' (' + e.source_type + '/' + e.quality + (e.evidence_date ? ', досвід ' + e.evidence_date : '') + (e.stance !== 'supports' ? ', ' + e.stance : '') + ')').join('; ');
      lines.push((i + 1) + '. [' + f.scope + (f.component_role ? ':' + f.component_role : '') + ', ' + f.knowledge_type + (f.severity !== 'none' ? ', ' + f.severity : '') + '] ' + f.text_en
        + '\n   актуальність: ' + RELEVANCE_WORDING[f.current_relevance] + '; цикл: ' + LIFECYCLE_WORDING[f.lifecycle]
        + (f.remedy ? '\n   ліки: ' + f.remedy : '') + (f.verify_on_vehicle ? '\n   як перевірити на цій машині: ' + f.verify_on_vehicle : '')
        + (f.affected_scope ? '\n   зона дії: ' + f.affected_scope : '')
        + '\n   джерела: ' + srcs + '\n   формулювання: ' + STRENGTH_WORDING[f.strength]
        + (f.prominence === 'lead' ? '\n   ДОКАЗІВ МАЛО (одне слабке джерело): лише пункт для перевірки, НЕ типове слабке місце' : ''));
    });
    if (closed.length) {
      lines.push('Знайдено, але НЕ актуально для цієї машини (у слабкі місця не виносити, можна згадати як закрите):');
      for (const f of closed) lines.push('- [' + RELEVANCE_WORDING[f.current_relevance].split(':')[0] + '] ' + f.text_en + (f.relevance_reason ? ' (' + f.relevance_reason + ')' : ''));
    }
  }
  lines.push('');
  lines.push('ЯК КОРИСТУВАТИСЬ: у model_notes.issues спирайся насамперед на MODEL_INTELLIGENCE і FRESH_WEB_FINDINGS про САМЕ ЦЮ версію і її агрегати. Туди йде лише АКТУАЛЬНЕ і корисне ПЕРЕВІРИТИ; закрите і не про цю машину не виносити. Поширеність не дорівнює важливості: рідша, але катастрофічна поломка мотора важить більше за часту дрібницю; важлива дорога поломка (мотор, коробка, привід, батарея, охолодження) стоїть вище за дрібні загальні слабкості. Джерело кожного пункту зберігай у формулюванні за правилами вище; ярликів "найчастіша", "проблема номер один", "майже всі" без даних про повторюваність не пиши. Разову кампанію без підтвердження виконання подавай як "перевірити по VIN, чи виконана", а не як активну поломку. Знання з приміткою про іншу версію чи мотор до цієї машини не переноси. Нічого з цього блоку не є фактом про конкретний екземпляр: у risks воно потрапляє лише за конкретного сигналу по цій машині.');
  return lines.join('\n');
}

/* ---------- Збереження у MI ---------- */

export function persistPayload(findings, identity, token) {
  const list = Array.isArray(findings) ? findings : [];
  return {
    check_token: token || null,
    identity: identity ? { label: identity.label || null, brand: identity.brand || null, model_line: identity.model_line || null, generation: identity.generation || null } : null,
    /* знання про конкретний VIN не є знанням про модель: у MI не йде */
    findings: list.filter(f => f.scope !== 'vehicle').map(f => ({
      scope: f.scope, component_role: f.component_role || null, knowledge_type: f.knowledge_type,
      text_en: f.text_en, confidence: f.strength === 'documented' ? 'high' : f.strength === 'owner' ? 'low' : 'medium',
      buyer_importance: f.buyer_importance, buyer_implication_en: f.buyer_implication_en || null,
      causal_status: f.causal_status, applicability_note: f.affected_scope || null, candidate_id: f.candidate_id || null,
      lifecycle: f.lifecycle, current_relevance: f.current_relevance, remedy: f.remedy || null, verify_on_vehicle: f.verify_on_vehicle || null,
      affected_scope: f.affected_scope || null, evidence_period: f.evidence_period || null,
      evidence: f.evidence.map(e => ({ url: e.url, title: e.title, source_type: e.source_type, quality: e.quality, stance: e.stance, excerpt: e.excerpt, independence_group: e.independence_group, lang: 'en', source_date: e.source_date || null, evidence_date: e.evidence_date || null })),
    })),
    vehicle_scope_dropped: list.filter(f => f.scope === 'vehicle').length,
  };
}

export async function persistResearch(vin, payload, opts = {}) {
  if (!payload || !Array.isArray(payload.findings) || !payload.findings.length) return { ok: true, reason: 'nothing_to_persist', published: 0, merged: 0, candidates: 0, staged_cold: 0, skipped: 0 };
  const r = await rpc('mi_research_persist', { p_vin: vin ? String(vin).trim().toUpperCase() : null, p_run: { check_token: payload.check_token, identity: payload.identity, findings: payload.findings } }, { ...opts, timeoutMs: opts.timeoutMs || 15000 });
  if (!r.ok) {
    /* збереження знання це критичний шлях MI: збій завжди у лог */
    if (r.reason !== 'no_credentials' && r.reason !== 'not_installed') logLine('mi_research_persist', { reason: r.reason, status: r.status || null, code: r.code || null, error: r.error || null, findings: payload.findings.length, ms: r.ms });
    return { ok: false, reason: r.reason, ms: r.ms };
  }
  const b = r.body || {};
  const results = Array.isArray(b.results) ? b.results : [];
  if (b.ok === false || results.some(x => x.status === 'publish_failed')) logLine('mi_research_persist', { reason: b.reason || 'publish_failed', results: results.filter(x => x.status === 'publish_failed').map(x => x.error).slice(0, 2) });
  return { ok: b.ok !== false, reason: b.reason || null, published: b.published || 0, merged: b.merged || 0, candidates: b.candidates || 0, staged_cold: b.staged_cold || 0, skipped: b.skipped || 0, fragments_rebuilt: b.fragments_rebuilt || 0,
    results: results.map(x => ({ status: x.status, scope: x.scope, reason: x.reason || null, gate_failed: x.gate_failed || null, strengthened: x.strengthened || false })), ms: r.ms };
}

/* ---------- Оркестрація ---------- */

/* Запуск дослідження. Повертає контролер, а не результат: Check читає
   знімок у момент фінального аналізу, дочекується збережень у кінці і
   обриває решту. Нічого тут не кидає. */
export function startCheckResearch(input = {}, opts = {}) {
  const limits = opts.limits || RESEARCH_LIMITS;
  const t0 = opts.t0 || Date.now();
  const at = () => Date.now() - t0;
  const state = {
    status: 'running', reason: null, identity: researchIdentity(input.identity || {}), context: null,
    batches: [], findings: [], queries: [], urls: [], hosts: [], totals: { queries: 0, sources: 0 },
    strengthened: new Set(), reportYear: opts.reportYear || new Date().getFullYear(),
    started_at: at(), context_at: null, cutoff_at: null, aborted_at: null, finished_at: null,
    persists: [], current: null,
  };
  const abort = new AbortController();
  const signal = abort.signal;
  if (opts.signal) { if (opts.signal.aborted) abort.abort(); else opts.signal.addEventListener('abort', () => abort.abort(), { once: true }); }
  const persist = opts.persist || persistResearch;

  const finish = (status, reason) => { state.status = status; state.reason = reason || null; state.finished_at = at(); return state; };

  async function runBatch(plan) {
    const b = { n: state.batches.length + 1, area: plan.area, target_candidate: plan.target_candidate || null, queries: plan.queries, sources: [], findings: [], status: 'running', started_at: at(), ended_at: null, timings: {}, ai: null };
    state.batches.push(b);
    state.current = b;
    const left = () => limits.deadline_ms - at();
    /* пошук */
    const ts = Date.now();
    const search = opts.search || searchSerper;
    const results = await Promise.all(plan.queries.map(q => search(q, { ...opts, signal, timeoutMs: Math.min(limits.search_timeout_ms, Math.max(1000, left())) })));
    b.timings.search_ms = Date.now() - ts;
    state.totals.queries += plan.queries.length;
    state.queries.push(...plan.queries);
    b.search = results.map(r => ({ query: r.query, ok: r.ok, reason: r.reason, items: (r.items || []).length }));
    if (signal.aborted) { b.status = 'aborted'; b.ended_at = at(); return b; }
    if (!results.some(r => r.ok)) { b.status = 'search_failed'; b.reason = (results[0] && results[0].reason) || 'search_failed'; b.ended_at = at(); return b; }
    /* джерела: не більше за пакет і не більше за решту стелі Check */
    const maxSrc = Math.min(limits.sources_per_batch, limits.max_sources - state.totals.sources);
    const picked = pickSources(results, { limits, max: maxSrc, brand: state.identity.brand || (state.context && state.context.identity_summary && state.context.identity_summary.brand), excludeHost: input.listingHost || null, seenUrls: state.urls, seenHosts: state.hosts });
    if (!picked.length) { b.status = 'no_sources'; b.ended_at = at(); return b; }
    const tf = Date.now();
    const fetched = await Promise.all(picked.map(s => (opts.fetchSource || fetchSourceText)(s, { ...opts, limits, signal, timeoutMs: Math.min(limits.fetch_timeout_ms, Math.max(1000, left())) })));
    b.timings.fetch_ms = Date.now() - tf;
    state.totals.sources += fetched.length;
    for (const s of fetched) { state.urls.push(s.url); state.hosts.push(s.host); }
    b.sources = fetched.map(s => ({ url: s.url, host: s.host, source_type: s.source_type, quality: s.quality, status: s.status, chars: s.chars, source_date: s.source_date || null, ms: s.ms }));
    const usable = fetched.filter(s => s.status === 'ok');
    if (!usable.length) { b.status = 'no_readable_sources'; b.ended_at = at(); return b; }
    if (signal.aborted) { b.status = 'aborted'; b.ended_at = at(); return b; }
    /* один витяг */
    if (typeof opts.callModel !== 'function') { b.status = 'no_model'; b.ended_at = at(); return b; }
    const te = Date.now();
    const body = {
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', max_completion_tokens: 4000, reasoning_effort: 'low',
      response_format: extractionResponseFormat(limits),
      messages: [{ role: 'system', content: EXTRACTION_RULES }, { role: 'user', content: extractionUserMessage(state, b, usable) }],
    };
    const d = await opts.callModel(body, Math.min(limits.extraction_timeout_ms, Math.max(5000, left())), signal);
    b.timings.extract_ms = Date.now() - te;
    b.ai = d && d.usage ? { model: d.model || body.model, input_tokens: d.usage.prompt_tokens, output_tokens: d.usage.completion_tokens } : null;
    if (signal.aborted) { b.status = 'aborted'; b.ended_at = at(); return b; }
    if (!d || d.error) { b.status = 'failed'; b.reason = 'extraction_' + String((d && d.error && (d.error.code || d.error.message)) || 'no_response').slice(0, 40); b.ended_at = at(); return b; }
    let raw = null;
    try { raw = JSON.parse(String(d.choices?.[0]?.message?.content || '')); } catch (e) { b.status = 'failed'; b.reason = 'extraction_invalid_json'; b.ended_at = at(); return b; }
    b.findings = sanitizeFindings(raw, usable, state, limits);
    b.nothing_new_reason = b.findings.length ? null : String((raw && raw.nothing_new_reason) || '').slice(0, 200) || null;
    b.status = 'ok';
    b.ended_at = at();
    return b;
  }

  const promise = (async () => {
    try {
      if (!miResearchEnabled(opts.env)) return finish('skipped', 'flag_off');
      /* 1. наявне MI і памʼять дослідження ПЕРЕД пошуком */
      const tc = Date.now();
      const ctxRes = await (opts.fetchContext || fetchResearchContext)(input.vin || null, state.identity, opts);
      state.context_ms = Date.now() - tc;
      state.context_at = at();
      if (ctxRes.ok) state.context = ctxRes.context;
      const miScope = (state.context && state.context.mi_scope) || 'none';
      /* достатня ідентичність: версія каталогу MI або бренд + ряд + покоління з Check */
      if (!ctxRes.ok && !state.identity.sufficient) return finish('skipped', ctxRes.reason || 'context_unavailable');
      if (miScope === 'none' && !state.identity.sufficient) return finish('skipped', 'identity_too_weak');
      if (!state.context) state.context = { available: true, mi_scope: 'none', knowledge: [], knowledge_count: 0, open_candidates: [], cold: true, context_error: ctxRes.reason || null };
      state.context.available = true;
      state.eligibility = miScope === 'version' ? 'mi_version' : miScope === 'generation' ? 'mi_generation' : 'check_identity';
      if (signal.aborted) return finish('aborted', 'check_finished');

      /* 2. послідовні пакети, поки є прогалини, бюджет і Check ще працює */
      let empty = 0;
      while (state.batches.length < limits.max_batches && state.totals.queries < limits.max_queries && state.totals.sources < limits.max_sources) {
        if (signal.aborted) return finish('aborted', 'check_finished');
        if (at() > limits.deadline_ms) return finish('stopped', 'deadline');
        const plan = planBatch(state, limits);
        if (!plan || !plan.queries.length) { state.stop_reason = 'no_gaps'; break; }
        if (state.totals.queries + plan.queries.length > limits.max_queries) plan.queries = plan.queries.slice(0, limits.max_queries - state.totals.queries);
        const b = await runBatch(plan);
        state.current = null;
        if (b.status === 'aborted') return finish('aborted', 'check_finished');
        if (b.status === 'no_model' || b.status === 'search_failed' && state.batches.length === 1) { state.stop_reason = b.reason || b.status; break; }
        /* завершений пакет одразу у знання і у MI: пізніший обрив його не втратить */
        if (b.findings.length) {
          state.findings.push(...b.findings);
          const p = Promise.resolve(persist(input.vin || null, persistPayload(b.findings, state.identity, input.token), opts))
            .then(r => { b.persist = r; return r; })
            .catch(e => { b.persist = { ok: false, reason: 'error', error: String((e && e.message) || e).slice(0, 120) }; return b.persist; });
          state.persists.push(p);
          empty = 0;
        } else {
          empty++;
          if (empty >= limits.empty_batches_to_stop) { state.stop_reason = 'two_empty_batches'; break; }
        }
      }
      if (!state.stop_reason) state.stop_reason = state.batches.length >= limits.max_batches ? 'max_batches' : state.totals.queries >= limits.max_queries ? 'max_queries' : 'max_sources';
      /* ok: хоч один пакет дійшов до витягу; failed: витяг чи модель впали;
         skipped: пошук не відбувся взагалі (немає ключа, 403, без джерел) */
      return finish(state.batches.some(b => b.status === 'ok') ? 'ok'
        : state.batches.some(b => b.status === 'failed') ? 'failed' : 'skipped', state.stop_reason);
    } catch (e) {
      logLine('run', { error: String((e && e.message) || e).slice(0, 160) });
      return finish('failed', 'error');
    }
  })();

  /* Знімок у момент фінального аналізу: лише завершені знахідки. */
  const cutoff = () => {
    state.cutoff_at = at();
    state.cutoff_findings = state.findings.length;
    state.cutoff_batches = state.batches.filter(b => b.ended_at != null).length;
    return { context: state.context, identity: state.identity, findings: state.findings.slice(), reportYear: state.reportYear, status: state.status, reason: state.reason, batches: state.cutoff_batches };
  };
  /* Чекати завершення поточного пакета не довше ms (або кінця дослідження). */
  const waitBatch = ms => new Promise(resolve => {
    const b = state.current;
    if (!b || state.finished_at != null) return resolve(false);
    const start = Date.now();
    const timer = setInterval(() => {
      if (b.ended_at != null || state.finished_at != null || Date.now() - start >= ms) { clearInterval(timer); resolve(b.ended_at != null); }
    }, 50);
  });
  const persistDone = ms => Promise.race([Promise.allSettled(state.persists), new Promise(r => setTimeout(() => r('timeout'), ms))]);
  const stop = () => { if (!state.aborted_at) state.aborted_at = at(); abort.abort(); };

  return { promise, state, cutoff, waitBatch, persistDone, abort: stop };
}

/* Телеметрія для _meta: хронологія пакетів, без текстів джерел і ключів */
export function researchMeta(state) {
  if (!state) return null;
  const ctx = state.context || {};
  const brief = f => ({ scope: f.scope, component_role: f.component_role, knowledge_type: f.knowledge_type, strength: f.strength, prominence: f.prominence, lifecycle: f.lifecycle, current_relevance: f.current_relevance, model_relevance: f.model_relevance, severity: f.severity, rank: Math.round((f.rank || 0) * 10) / 10, novelty: f.novelty, candidate_id: f.candidate_id, text_en: f.text_en.slice(0, 200), remedy: f.remedy ? f.remedy.slice(0, 120) : null, verify_on_vehicle: f.verify_on_vehicle ? f.verify_on_vehicle.slice(0, 120) : null, evidence_period: f.evidence_period || null, sources: f.evidence.map(e => e.host + (e.evidence_date ? '@' + e.evidence_date : '')) });
  return {
    status: state.status, reason: state.reason || null, stop_reason: state.stop_reason || null, eligibility: state.eligibility || null,
    identity: state.identity ? { label: state.identity.label, sufficient: state.identity.sufficient, generation: state.identity.generation, model_year: state.identity.model_year } : null,
    mi_scope: ctx.mi_scope || null, identity_precision: ctx.identity_precision || null, version: (ctx.identity_summary && ctx.identity_summary.version) || null,
    knowledge_count: ctx.knowledge_count || 0, open_candidates: ctx.open_candidates_count || 0,
    totals: { batches: state.batches.length, queries: state.totals.queries, sources: state.totals.sources, findings: state.findings.length },
    timeline: { started_at: state.started_at, context_at: state.context_at, cutoff_at: state.cutoff_at, cutoff_findings: state.cutoff_findings != null ? state.cutoff_findings : null, aborted_at: state.aborted_at, finished_at: state.finished_at },
    batches: state.batches.map(b => ({ n: b.n, area: b.area, target_candidate: b.target_candidate, status: b.status, reason: b.reason || null, started_at: b.started_at, ended_at: b.ended_at, queries: b.queries, search: b.search || null,
      sources: (b.sources || []).map(s => ({ host: s.host, source_type: s.source_type, quality: s.quality, status: s.status, chars: s.chars, source_date: s.source_date || null })),
      findings: (b.findings || []).map(brief), nothing_new_reason: b.nothing_new_reason || null, ai: b.ai || null, timings: b.timings || {},
      persist: b.persist ? { ok: b.persist.ok, reason: b.persist.reason || null, published: b.persist.published || 0, merged: b.persist.merged || 0, candidates: b.persist.candidates || 0, staged_cold: b.persist.staged_cold || 0, skipped: b.persist.skipped || 0, results: b.persist.results || null } : null })),
  };
}
