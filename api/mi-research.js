/* Model Intelligence: малий веб-пошук усередині Check (Research v1).

   Петля: Check -> наявне MI -> до 3 пошукових запитів і до 4 відкритих
   джерел паралельно зі звичайною роботою Check -> один компактний виклик
   моделі, що шукає 0-2 важливі факти, яких MI ще не знає -> свіжі
   знахідки одразу у контекст ПОТОЧНОГО звіту -> придатне до повторного
   використання знання у наявний конвеєр MI (кандидат -> доказ -> gate ->
   публікація, міграція 028) -> наступний Check починає з багатшого MI.

   Що модуль НЕ робить: не будує нової бази знань, не послаблює gate, не
   вигадує фактів (кожен доказ це цитата, знайдена у тексті джерела), не
   стає залежністю Check: будь-який збій це один рядок логу і звіт як
   раніше. «Нічого нового не знайдено» це нормальний результат, квоти
   на знахідки немає.

   Область знання не точніша за підтверджену ідентичність: знахідка про
   компонент привʼязується лише до розвʼязаного варіанта у ролі, інакше
   лишається на рівні версії чи покоління; знахідки про конкретний VIN у
   MI не пишуться. Сила джерела зберігається до самого тексту звіту:
   офіційне чи регуляторне джерело можна подавати як документований факт,
   фахове як опис проблеми фахівцями, форумне лише як «власники
   повідомляють».

   Вимкнення: env MI_RESEARCH=off. Пошук іде через Serper (той самий ключ,
   що і в пошуку аукціонних записів); без ключа пошуку немає, але наявне
   MI у звіт усе одно потрапляє. */

const MISSING_FUNCTION = new Set(['PGRST202', 'PGRST106', '42883', '3F000']);

export const RESEARCH_LIMITS = {
  queries: 3,
  sources: 4,
  findings: 2,
  source_chars: 7000,
  fetch_timeout_ms: 8000,
  search_timeout_ms: 6000,
  extraction_timeout_ms: 40000,
  /* жорстка стеля всього дослідження: воно живе лише поки живе Check */
  deadline_ms: 75000,
  /* та сама ідентичність не досліджується день за днем */
  cooldown_days: 3,
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

/* Наявне MI і ідентичність: завжди ПЕРЕД пошуком. */
export async function fetchResearchContext(vin, opts = {}) {
  if (!vin || typeof vin !== 'string' || vin.trim().length < 11) return { ok: false, reason: 'no_vin', ms: 0 };
  const r = await rpc('mi_research_context', { p_vin: vin.trim().toUpperCase() }, { ...opts, timeoutMs: opts.timeoutMs || 8000 });
  if (!r.ok) {
    if (r.reason === 'error' || r.reason === 'timeout') logLine('mi_research_context', { reason: r.reason, status: r.status || null, code: r.code || null, error: r.error || null, ms: r.ms });
    return { ok: false, reason: r.reason, ms: r.ms };
  }
  const b = r.body || {};
  return { ok: true, available: b.available === true, reason: b.reason || null, context: b, ms: r.ms };
}

/* ---------- Запити ---------- */

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\s+/g, ' ').trim();

/* Пріоритет областей, яких MI ще не покриває; термін пошуку для кожної */
const AREA_TERMS = [
  ['engine', 'engine problems'],
  ['transmission', 'transmission problems'],
  ['drivetrain', 'transfer case OR driveshaft OR differential problems'],
  ['chassis', 'suspension OR steering problems'],
  ['electrical', 'electrical OR electronics faults'],
  ['body', 'body OR interior known issues'],
];

/* Мітка машини для пошуку: найточніша підтверджена ідентичність, без
   повторів слів. Мотор іде у запит лише коли він розвʼязаний. */
export function identityLabel(ctx) {
  const s = (ctx && ctx.identity_summary) || {};
  const brand = s.brand || (ctx && ctx.brand) || '';
  const version = String(s.version || '').replace(/\s*\([^)]*\)\s*$/, '');
  const engine = (Array.isArray(s.components) ? s.components : [])
    .filter(c => c && c.role === 'engine' && c.variant && /confirmed|assumed_factory/.test(String(c.resolution_status || '')))
    .map(c => String(c.variant).replace(/\s*\([^)]*\)/g, ''))[0] || '';
  const parts = [];
  const seen = new Set();
  for (const raw of [brand, version, engine, s.model_year ? String(s.model_year) : '']) {
    for (const w of String(raw).split(/\s+/)) {
      const k = norm(w);
      if (!k || seen.has(k)) continue;
      seen.add(k); parts.push(w);
    }
  }
  return parts.join(' ').trim();
}

export function buildQueries(ctx, limits = RESEARCH_LIMITS) {
  const label = identityLabel(ctx);
  if (!label) return [];
  const covered = new Set(((ctx && ctx.knowledge) || []).map(k => k && k.area).filter(Boolean));
  const gaps = AREA_TERMS.filter(([area]) => !covered.has(area)).map(([, term]) => term);
  const qs = [label + ' common problems known issues'];
  if (gaps.length) qs.push(label + ' ' + gaps[0]);
  const market = (ctx && ctx.identity_summary && ctx.identity_summary.market_sold) || null;
  if (!market || market === 'US') qs.push(label + ' recall OR service campaign OR technical service bulletin');
  else if (gaps.length > 1) qs.push(label + ' ' + gaps[1]);
  return [...new Set(qs)].slice(0, limits.queries);
}

/* ---------- Джерела ---------- */

const EXCLUDED_HOST = /(^|\.)(youtube|youtu\.be|facebook|instagram|tiktok|pinterest|twitter|x\.com|amazon|ebay|aliexpress|auto\.ria|autoscout24|mobile\.de|olx|cars\.com|autotrader|carfax|carvana|copart|iaai|bidfax|wikipedia|quora|linkedin|google|bing)\b/i;
const OWNER_HOST = /reddit|forum|forums|rennlist|planet-9|6speedonline|bimmerpost|bimmerfest|bimmerforums|teslamotorsclub|hyundai-forums|club|community|board/i;
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
  const slug = norm(brand).replace(/\s+/g, '');
  if (!host) return { host, source_type: 'unknown', quality: null };
  if (LEGAL_HOST.test(host)) return { host, source_type: 'legal', quality: 'primary' };
  if (slug && new RegExp('(^|\\.)(press\\.)?' + slug + '(usa|group|-usa|ag)?\\.(com|de|co\\.uk|ca|net|eu|com\\.ua)$').test(host)) return { host, source_type: 'official', quality: 'primary' };
  if (OWNER_HOST.test(host)) return { host, source_type: 'owner', quality: 'secondary' };
  if (VENDOR_HOST.test(host)) return { host, source_type: 'vendor', quality: 'secondary' };
  if (AGGREGATOR_HOST.test(host)) return { host, source_type: 'aggregator', quality: 'low' };
  return { host, source_type: 'unknown', quality: null };
}

const CLASS_RANK = { official: 0, legal: 0, unknown: 1, owner: 2, aggregator: 3, vendor: 4 };

/* Відбір до 4 джерел з результатів усіх запитів: кращий клас домену
   першим, один хост один раз, без площадок і соцмереж. */
export function pickSources(results, opts = {}) {
  const limits = opts.limits || RESEARCH_LIMITS;
  const excludeHost = opts.excludeHost ? String(opts.excludeHost).replace(/^www\./, '') : null;
  const seen = new Set();
  const out = [];
  let order = 0;
  for (const r of Array.isArray(results) ? results : []) {
    for (const item of Array.isArray(r && r.items) ? r.items : []) {
      const url = String((item && item.link) || '');
      if (!/^https?:\/\//.test(url)) continue;
      const host = hostOf(url);
      if (!host || EXCLUDED_HOST.test(host) || (excludeHost && host.endsWith(excludeHost)) || seen.has(host)) continue;
      seen.add(host);
      const cls = classifySource(url, opts.brand);
      out.push({ url, host, title: String((item && item.title) || '').slice(0, 200), snippet: String((item && item.snippet) || '').slice(0, 300), query: r.query, order: order++, ...cls });
    }
  }
  out.sort((a, b) => (CLASS_RANK[a.source_type] - CLASS_RANK[b.source_type]) || (a.order - b.order));
  return out.slice(0, limits.sources);
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
    const items = (j && Array.isArray(j.organic) ? j.organic : []).map(o => ({ link: o.link, title: o.title, snippet: o.snippet }));
    return { query, ok: true, reason: null, items, ms: Date.now() - started };
  } catch (e) {
    return { query, ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'error', items: [], ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

const BLOCKED = /just a moment|cf-chl|cf-browser-verification|captcha|incapsula|attention required|enable javascript and cookies|verify (that )?you are (a )?human|security verification|robot check|performing security/i;

/* Текст сторінки без розмітки, обрізаний. Заблоковане чи порожнє джерело
   просто випадає: платних обхідних шляхів дослідження не використовує. */
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
    return { ...src, status: 'ok', text, chars: text.length, ms: Date.now() - started };
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

export function extractionResponseFormat(limits = RESEARCH_LIMITS) {
  const schema = OBJ({
    findings: { type: 'array', maxItems: limits.findings, items: OBJ({
      text_en: S('string', 'one precise reusable statement about the model, version or component, in English, no marketing, no prevalence words unless the source states counts'),
      scope: E(['version', 'generation', 'component', 'vehicle']),
      component_role: E(['engine', 'transmission', 'transfer_case', 'suspension_system', 'brake_system', 'battery_pack', 'other', 'none']),
      knowledge_type: E(['known_issue', 'official_fact', 'owner_pattern', 'specialist_practice']),
      novelty: E(['new', 'strengthens_existing', 'contradicts_existing']),
      severity: E(['catastrophic', 'major', 'moderate', 'minor', 'none']),
      buyer_importance: S('integer', '1..5: how much this can change a purchase decision'),
      buyer_implication_en: S('string', 'what a buyer should do or check, one sentence'),
      causal_status: E(['observed_association', 'plausible_mechanism', 'supported_cause', 'unknown']),
      applicability_note: S('string', 'which exact version, engine or years the sources tie this to, and what they do NOT say'),
      evidence: { type: 'array', items: OBJ({
        source_index: S('integer', 'index of the source in SOURCES'),
        excerpt: S('string', 'verbatim excerpt copied from that source text, 25..300 characters'),
        stance: E(['supports', 'contradicts', 'context']),
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

export const EXTRACTION_RULES = `You are the research step of CalCar Model Intelligence. You receive the resolved identity of a specific used car, what CalCar ALREADY knows about this version (KNOWN), and the text of a few web sources (SOURCES).

Your task is NOT to research the model from scratch. Find 0 to 2 IMPORTANT, REUSABLE facts about the model, version or component that CalCar does not already know, or that materially strengthen or contradict an existing item. Zero findings is a valid, common result: never invent a finding to fill the list.

What counts: a documented failure mode of this exact version or component missing from KNOWN; a recall or service campaign; an important component revision or change date; a major drivetrain, engine, battery or transmission weakness; strong evidence that an existing KNOWN item does or does not apply to this exact configuration.
What does not count: generic maintenance advice, statements true of any car, SEO filler, duplicates of KNOWN, single anecdotes without a mechanism, prices.

Rules:
- Every finding needs at least one evidence excerpt copied VERBATIM from a source text (25 to 300 characters). No excerpt, no finding.
- scope: "component" only when the source ties the fact to the exact engine, transmission or other unit AND that unit is resolved in IDENTITY; otherwise "version" or "generation". If the source proves a failure mode only for another engine or version, say so in applicability_note and do NOT attach it to this car.
- scope "vehicle" is for facts about this individual VIN only (its own history). They are not model knowledge.
- knowledge_type: official_fact only from manufacturer or regulator documents; known_issue for technical failure modes described by workshops or documented; owner_pattern for recurring owner reports with mileage or age context; specialist_practice for a workshop practice with a stated cause.
- Do not upgrade owner forum evidence into a fact about prevalence. Report what the sources say, with their strength.
- Classify each source honestly: "specialist primary" only for first-hand technical sources (workshop, engine builder, engineer describing own cases); magazines, blogs and retellings are specialist secondary or review; forums are owner.
Answer only with JSON matching the schema.`;

const compactKnown = (knowledge, max = 24) => (Array.isArray(knowledge) ? knowledge : []).slice(0, max)
  .map((k, i) => `${i + 1}. [${k.kind || 'item'}/${k.area || '-'} ${k.knowledge_type || ''} ${k.status || ''}] ${String(k.text || '').slice(0, 220)}`).join('\n');

export function extractionUserMessage(ctx, sources) {
  const s = (ctx && ctx.identity_summary) || {};
  const comps = (Array.isArray(s.components) ? s.components : []).map(c => `${c.role}: ${c.variant} (${c.resolution_status})`).join('; ') || 'no component resolved';
  const known = compactKnown(ctx && ctx.knowledge);
  const src = sources.map((x, i) => `--- SOURCE ${i} | ${x.host} | domain class: ${x.source_type}${x.quality ? '/' + x.quality : ''} | ${x.title}\n${x.text}`).join('\n\n');
  return `IDENTITY: ${identityLabel(ctx)}\nversion: ${s.version || 'unknown'}; version_market_year: ${s.vmy || 'unknown'}; market sold: ${s.market_sold || 'unknown'}; model year: ${s.model_year || 'unknown'}; mileage km: ${s.mileage_km || 'unknown'}\ncomponents: ${comps}\n\nKNOWN (${(ctx && ctx.knowledge_count) || 0} items CalCar already has for this car):\n${known || '(nothing yet)'}\n\nSOURCES (${sources.length}):\n${src}`;
}

const normText = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/* Валідація відповіді моделі: цитата мусить бути в тексті джерела, клас
   домену сильніший за думку моделі, область компонента лише для
   розвʼязаного варіанта, не більше 2 знахідок. */
export function sanitizeFindings(raw, sources, ctx, limits = RESEARCH_LIMITS) {
  const out = [];
  const classes = new Map();
  for (const c of (raw && Array.isArray(raw.sources)) ? raw.sources : []) {
    if (Number.isInteger(c.source_index) && sources[c.source_index]) classes.set(c.source_index, c);
  }
  const resolvedRoles = new Set(((ctx && ctx.identity_summary && ctx.identity_summary.components) || [])
    .filter(c => c && c.variant && /confirmed|assumed_factory/.test(String(c.resolution_status || ''))).map(c => c.role));
  const normSrc = sources.map(x => normText(x.text));
  for (const f of (raw && Array.isArray(raw.findings)) ? raw.findings : []) {
    if (!f || typeof f !== 'object') continue;
    const text = String(f.text_en || '').trim();
    if (text.length < 20) continue;
    let scope = ['version', 'generation', 'component', 'vehicle'].includes(f.scope) ? f.scope : 'version';
    let role = f.component_role && f.component_role !== 'none' ? f.component_role : null;
    if (scope === 'component' && !(role && resolvedRoles.has(role))) { scope = 'version'; role = null; }
    const evidence = [];
    for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
      const i = e && e.source_index;
      const src = Number.isInteger(i) ? sources[i] : null;
      const excerpt = String((e && e.excerpt) || '').trim();
      if (!src || excerpt.length < 25) continue;
      if (!normSrc[i].includes(normText(excerpt))) continue;
      const cls = classes.get(i) || {};
      const domain = classifySource(src.url, ctx && ctx.identity_summary && ctx.identity_summary.brand);
      let source_type = domain.source_type !== 'unknown' ? domain.source_type
        : (['specialist', 'review', 'market', 'aggregator', 'vendor', 'owner'].includes(cls.source_type) ? cls.source_type : 'review');
      let quality = domain.source_type !== 'unknown' ? domain.quality
        : (['primary', 'secondary', 'low'].includes(cls.quality) ? cls.quality : 'secondary');
      evidence.push({ url: src.url, title: src.title || null, host: src.host, source_type, quality,
        stance: ['supports', 'contradicts', 'context'].includes(e.stance) ? e.stance : 'supports',
        excerpt: excerpt.slice(0, 300), independence_group: src.host });
    }
    if (!evidence.length) continue;
    out.push({
      text_en: text.slice(0, 600), scope, component_role: role,
      knowledge_type: ['known_issue', 'official_fact', 'owner_pattern', 'specialist_practice'].includes(f.knowledge_type) ? f.knowledge_type : 'known_issue',
      novelty: ['new', 'strengthens_existing', 'contradicts_existing'].includes(f.novelty) ? f.novelty : 'new',
      severity: ['catastrophic', 'major', 'moderate', 'minor', 'none'].includes(f.severity) ? f.severity : 'none',
      buyer_importance: Number.isInteger(f.buyer_importance) && f.buyer_importance >= 1 && f.buyer_importance <= 5 ? f.buyer_importance : 3,
      buyer_implication_en: String(f.buyer_implication_en || '').slice(0, 300),
      causal_status: ['observed_association', 'plausible_mechanism', 'supported_cause', 'unknown'].includes(f.causal_status) ? f.causal_status : 'unknown',
      applicability_note: String(f.applicability_note || '').slice(0, 300),
      evidence,
      strength: evidenceStrength(evidence),
    });
    if (out.length >= limits.findings) break;
  }
  return out;
}

/* Сила доказу знахідки: найсильніше джерело серед supports */
export function evidenceStrength(evidence) {
  const sup = (evidence || []).filter(e => e.stance !== 'contradicts');
  if (sup.some(e => e.source_type === 'official' || e.source_type === 'legal')) return 'documented';
  if (sup.some(e => e.source_type === 'specialist' && e.quality === 'primary')) return 'specialist';
  if (sup.some(e => e.source_type === 'specialist' || e.source_type === 'review')) return 'secondary';
  return 'owner';
}

/* ---------- Текст для основного виклику ---------- */

const STRENGTH_WORDING = {
  documented: 'офіційне або регуляторне джерело: можна подавати як документований факт',
  specialist: 'першоджерело фахівців: "фахівці описують", без слів про поширеність',
  secondary: 'вторинне фахове або оглядове джерело: "за даними фахових джерел", без слів про поширеність',
  owner: 'лише власники: тільки "власники повідомляють", "трапляються скарги"; НЕ факт і НЕ "типова проблема"',
};

export function researchBlock(run) {
  if (!run || !run.context || run.context.available !== true) return null;
  const ctx = run.context;
  const known = (ctx.knowledge || []).slice(0, 14);
  const findings = Array.isArray(run.findings) ? run.findings : [];
  if (!known.length && !findings.length) return null;
  const lines = [];
  lines.push('MODEL_INTELLIGENCE (перевірена база знань CalCar про ' + identityLabel(ctx) + '; статус APPLICABLE = стосується цієї машини, CONDITIONAL = залежить від невідомого виміру, тоді формулюй як "варто перевірити", а не як факт):');
  if (known.length) {
    for (const k of known) {
      lines.push('- [' + (k.area || 'version') + ', ' + (k.knowledge_type || '') + ', ' + (k.status || '') + (k.severity ? ', ' + k.severity : '') + '] ' + String(k.text || '').slice(0, 260) + (k.condition ? ' (умова: ' + String(k.condition).slice(0, 120) + ')' : ''));
    }
  } else {
    lines.push('- база знань про цю версію поки порожня');
  }
  if (findings.length) {
    lines.push('');
    lines.push('FRESH_WEB_FINDINGS (свіжий веб-пошук цього Check; це ДОКАЗИ з джерелами, а не перевірене знання CalCar; сила джерела визначає формулювання):');
    findings.forEach((f, i) => {
      const srcs = f.evidence.map(e => e.host + ' (' + e.source_type + '/' + e.quality + (e.stance !== 'supports' ? ', ' + e.stance : '') + ')').join('; ');
      lines.push((i + 1) + '. [' + f.scope + (f.component_role ? ':' + f.component_role : '') + ', ' + f.knowledge_type + (f.severity !== 'none' ? ', ' + f.severity : '') + '] ' + f.text_en
        + '\n   джерела: ' + srcs + '\n   формулювання: ' + STRENGTH_WORDING[f.strength]
        + (f.applicability_note ? '\n   застосовність: ' + f.applicability_note : ''));
    });
  }
  lines.push('');
  lines.push('ЯК КОРИСТУВАТИСЬ: у model_notes.issues спирайся насамперед на MODEL_INTELLIGENCE і FRESH_WEB_FINDINGS про САМЕ ЦЮ версію і її агрегати; важлива дорога поломка (мотор, коробка, привід, батарея) стоїть вище за дрібні загальні слабкості. Джерело кожного пункту зберігай у формулюванні за правилами вище. Не вигадуй поширеність і серйозність: відома МОЖЛИВА поломка не є "типовою" без даних про повторюваність. Знання з приміткою про іншу версію чи мотор до цієї машини не переноси. Нічого з цього блоку не є фактом про конкретний екземпляр: у risks воно потрапляє лише за конкретного сигналу по цій машині.');
  return lines.join('\n');
}

/* ---------- Збереження у MI ---------- */

export function persistPayload(run, token) {
  const findings = (run && Array.isArray(run.findings) ? run.findings : [])
    /* знання про конкретний VIN не є знанням про модель: у MI не йде */
    .filter(f => f.scope !== 'vehicle')
    .map(f => ({
      scope: f.scope, component_role: f.component_role || null, knowledge_type: f.knowledge_type,
      text_en: f.text_en, confidence: f.strength === 'documented' ? 'high' : f.strength === 'owner' ? 'low' : 'medium',
      buyer_importance: f.buyer_importance, buyer_implication_en: f.buyer_implication_en || null,
      causal_status: f.causal_status, applicability_note: f.applicability_note || null,
      evidence: f.evidence.map(e => ({ url: e.url, title: e.title, source_type: e.source_type, quality: e.quality, stance: e.stance, excerpt: e.excerpt, independence_group: e.independence_group, lang: 'en' })),
    }));
  return { check_token: token || null, findings, vehicle_scope_dropped: (run && Array.isArray(run.findings) ? run.findings : []).filter(f => f.scope === 'vehicle').length };
}

export async function persistResearch(vin, payload, opts = {}) {
  if (!payload || !Array.isArray(payload.findings) || !payload.findings.length) return { ok: true, reason: 'nothing_to_persist', published: 0, merged: 0, candidates: 0, skipped: 0 };
  const r = await rpc('mi_research_persist', { p_vin: String(vin || '').trim().toUpperCase(), p_run: { check_token: payload.check_token, findings: payload.findings } }, { ...opts, timeoutMs: opts.timeoutMs || 15000 });
  if (!r.ok) {
    /* збереження знання це критичний шлях MI: збій завжди у лог */
    if (r.reason !== 'no_credentials' && r.reason !== 'not_installed') logLine('mi_research_persist', { reason: r.reason, status: r.status || null, code: r.code || null, error: r.error || null, findings: payload.findings.length, ms: r.ms });
    return { ok: false, reason: r.reason, ms: r.ms };
  }
  const b = r.body || {};
  const results = Array.isArray(b.results) ? b.results : [];
  if (b.ok === false || results.some(x => x.status === 'publish_failed')) logLine('mi_research_persist', { reason: b.reason || 'publish_failed', results: results.filter(x => x.status === 'publish_failed').map(x => x.error).slice(0, 2) });
  return { ok: b.ok !== false, reason: b.reason || null, published: b.published || 0, merged: b.merged || 0, candidates: b.candidates || 0, skipped: b.skipped || 0, fragments_rebuilt: b.fragments_rebuilt || 0, results: results.map(x => ({ status: x.status, scope: x.scope, reason: x.reason || null, gate_failed: x.gate_failed || null })), ms: r.ms };
}

/* ---------- Оркестрація ---------- */

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Повний прохід. Ніколи не кидає. Повертає { status, reason, context,
   queries, sources, findings, ms, timings }. status ok означає, що пошук
   відбувся (навіть з нулем знахідок); skipped означає, що пошуку не було,
   але context (наявне MI) може бути присутнім і піде у звіт. */
export async function runCheckResearch(input = {}, opts = {}) {
  const limits = opts.limits || RESEARCH_LIMITS;
  const started = Date.now();
  const out = { status: 'skipped', reason: null, context: null, queries: [], sources: [], findings: [], ms: 0, timings: {} };
  const done = (status, reason) => { out.status = status; out.reason = reason || null; out.ms = Date.now() - started; return out; };
  try {
    if (!miResearchEnabled(opts.env)) return done('skipped', 'flag_off');
    if (!input.vin) return done('skipped', 'no_vin');
    const signal = opts.signal || null;
    const left = () => limits.deadline_ms - (Date.now() - started);

    /* 1. наявне MI ПЕРЕД пошуком */
    const tc = Date.now();
    const ctxRes = await (opts.fetchContext || fetchResearchContext)(input.vin, opts);
    out.timings.context_ms = Date.now() - tc;
    if (!ctxRes.ok) return done('skipped', ctxRes.reason);
    out.context = ctxRes.context;
    if (!ctxRes.available) return done('skipped', ctxRes.reason || 'identity_unresolved');
    const last = ctxRes.context.last_research_at ? Date.parse(ctxRes.context.last_research_at) : NaN;
    if (Number.isFinite(last) && Date.now() - last < limits.cooldown_days * 86400000) return done('skipped', 'recently_researched');
    if (signal && signal.aborted) return done('aborted', 'check_finished');

    /* 2. до 3 запитів паралельно */
    out.queries = buildQueries(ctxRes.context, limits);
    if (!out.queries.length) return done('skipped', 'no_query');
    const ts = Date.now();
    const search = opts.search || searchSerper;
    const results = await Promise.all(out.queries.map(q => search(q, { ...opts, signal, timeoutMs: Math.min(limits.search_timeout_ms, Math.max(1000, left())) })));
    out.timings.search_ms = Date.now() - ts;
    out.search = results.map(r => ({ query: r.query, ok: r.ok, reason: r.reason, items: (r.items || []).length }));
    if (!results.some(r => r.ok)) return done('skipped', results[0] && results[0].reason || 'search_failed');

    /* 3. до 4 джерел паралельно */
    const picked = pickSources(results, { limits, brand: ctxRes.context.identity_summary && ctxRes.context.identity_summary.brand, excludeHost: input.listingHost || null });
    if (!picked.length) return done('ok', 'no_sources');
    const tf = Date.now();
    const fetched = await Promise.all(picked.map(s => (opts.fetchSource || fetchSourceText)(s, { ...opts, limits, signal, timeoutMs: Math.min(limits.fetch_timeout_ms, Math.max(1000, left())) })));
    out.timings.fetch_ms = Date.now() - tf;
    out.sources = fetched.map(s => ({ url: s.url, host: s.host, source_type: s.source_type, quality: s.quality, status: s.status, chars: s.chars, ms: s.ms }));
    const usable = fetched.filter(s => s.status === 'ok');
    if (!usable.length) return done('ok', 'no_readable_sources');
    if (signal && signal.aborted) return done('aborted', 'check_finished');

    /* 4. один компактний виклик витягу */
    if (typeof opts.callModel !== 'function') return done('skipped', 'no_model');
    const te = Date.now();
    const body = {
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra', max_completion_tokens: 3500, reasoning_effort: 'low',
      response_format: extractionResponseFormat(limits),
      messages: [{ role: 'system', content: EXTRACTION_RULES }, { role: 'user', content: extractionUserMessage(ctxRes.context, usable) }],
    };
    const d = await opts.callModel(body, Math.min(limits.extraction_timeout_ms, Math.max(5000, left())), signal);
    out.timings.extract_ms = Date.now() - te;
    out.ai = d && d.usage ? { model: d.model || body.model, input_tokens: d.usage.prompt_tokens, output_tokens: d.usage.completion_tokens } : null;
    if (!d || d.error) return done('failed', 'extraction_' + String((d && d.error && (d.error.code || d.error.message)) || 'no_response').slice(0, 40));
    let raw = null;
    try { raw = JSON.parse(String(d.choices?.[0]?.message?.content || '')); } catch (e) { return done('failed', 'extraction_invalid_json'); }
    out.findings = sanitizeFindings(raw, usable, ctxRes.context, limits);
    out.nothing_new_reason = out.findings.length ? null : String((raw && raw.nothing_new_reason) || '').slice(0, 200) || null;
    return done('ok', null);
  } catch (e) {
    logLine('run', { error: String((e && e.message) || e).slice(0, 160) });
    return done('failed', 'error');
  }
}

/* Телеметрія для _meta: без текстів джерел, без ключів */
export function researchMeta(run, persist) {
  if (!run) return null;
  const ctx = run.context || {};
  return {
    status: run.status, reason: run.reason || null,
    identity_precision: ctx.identity_precision || null, version: (ctx.identity_summary && ctx.identity_summary.version) || null,
    knowledge_count: ctx.knowledge_count || 0, last_research_at: ctx.last_research_at || null,
    queries: run.queries || [], search: run.search || null,
    sources: (run.sources || []).map(s => ({ host: s.host, source_type: s.source_type, quality: s.quality, status: s.status, chars: s.chars })),
    findings: (run.findings || []).map(f => ({ scope: f.scope, component_role: f.component_role, knowledge_type: f.knowledge_type, strength: f.strength, novelty: f.novelty, text_en: f.text_en.slice(0, 200), sources: f.evidence.map(e => e.host) })),
    nothing_new_reason: run.nothing_new_reason || null,
    ai: run.ai || null, ms: run.ms || 0, timings: run.timings || {},
    persist: persist || null,
  };
}

export { wait as _wait };
