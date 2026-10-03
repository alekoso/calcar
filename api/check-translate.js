/* CalCar Check: переклад готового звіту мовою глядача.

   POST /api/check-translate  { token, lang }
   -> { target, hash, cached, items: [{ id, src, text }], ms_openai, ms_total, usage }

   Звіт сервер читає сам із check_jobs за токеном і бере той самий публічний
   вигляд, що й /api/check-job: клієнт не може підсунути свій текст у
   спільний кеш. Модель отримує лише плаский список рядків, які людина
   бачить (api/report-translate.js), і повертає лише їхній переклад. Звіт
   від моделі назад не приймається: сторінка складає перекладений вигляд з
   ОРИГІНАЛУ, підставляючи рядки за id і звіряючи вихідний текст.

   Спільний кеш: check_jobs.translations[lang] = { v, hash, model, at, texts }.
   hash рахується з усіх вихідних рядків, мови джерела, цільової мови і
   версії правил: змінився звіт чи правила, і старий переклад не
   застосовується. Сам звіт (check_jobs.report) не переписується ніколи.
   Один пакетний виклик, reasoning low, без нового Check і без інших етапів. */

export const config = { maxDuration: 120 };

import crypto from 'node:crypto';
import { resolveLocale, errText } from './locale.js';
import { TOKEN_RE, publicReport } from './share.js';
import { readJobRow } from './check-job.js';
import { extractTranslatable, translationHash, validateTranslated, TRANSLATE_SCHEMA, translateMessages, TRANSLATE_VERSION } from './report-translate.js';

const OPENAI_TIMEOUT_MS = 100000;
const tokenRef = t => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 12);
const log = o => console.log('[translate]', JSON.stringify(o));

async function callModel(model, messages, withEffort, signal) {
  const body = { model, messages, response_format: { type: 'json_schema', json_schema: TRANSLATE_SCHEMA } };
  if (withEffort) body.reasoning_effort = 'low';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('cache-control', 'no-store');
  const t0 = Date.now();
  const lang = resolveLocale(req.body?.lang);
  const token = String(req.body?.token || '').trim();
  if (!TOKEN_RE.test(token)) return res.status(400).json({ error: errText(lang, 'translate_need_report') });
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return res.status(500).json({ error: errText(lang, 'internal') });
  const root = base.replace(/\/$/, '');
  const hdr = { apikey: key, authorization: 'Bearer ' + key };

  try {
    /* 1. оригінальний звіт: той самий публічний вигляд, що бачить сторінка */
    const read = await readJobRow(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token) + '&select=status,lang,report,translations&limit=1', hdr, token);
    if (!read.ok) return res.status(read.transient ? 503 : 500).json({ error: errText(lang, 'internal') });
    const row = Array.isArray(read.rows) ? read.rows[0] : null;
    if (!row || row.status !== 'done' || !row.report) return res.status(404).json({ error: errText(lang, 'translate_need_report') });
    const report = publicReport(row.report);
    const srcLang = resolveLocale(row.lang || (report._meta && report._meta.lang));
    if (srcLang === lang) return res.status(200).json({ target: lang, same: true, cached: true, items: [] });

    /* 2. рядки для перекладу і відбиток джерела */
    const items = extractTranslatable(report);
    const hash = translationHash(items, srcLang, lang);
    const reply = (texts, extra) => res.status(200).json({
      target: lang, hash, items: items.map(it => ({ id: it.id, src: it.text, text: texts[it.id] })), ms_total: Date.now() - t0, ...extra,
    });

    /* 3. спільний кеш: той самий звіт, та сама мова, ті самі правила */
    const cache = row.translations && row.translations[lang];
    if (cache && cache.hash === hash && cache.texts && items.every(it => typeof cache.texts[it.id] === 'string')) {
      log({ op: 'cache_hit', token_ref: tokenRef(token), target: lang, items: items.length, ms: Date.now() - t0 });
      return reply(cache.texts, { cached: true });
    }
    if (!items.length) return reply({}, { cached: false });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: errText(lang, 'ai_not_configured') });

    /* 4. один пакетний виклик: короткі id замість шляхів, щоб модель не
       переписувала службове; reasoning low */
    const short = items.map((it, i) => ({ id: String(i), text: it.text }));
    const model = process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), OPENAI_TIMEOUT_MS);
    const tAi = Date.now();
    let out;
    try {
      out = await callModel(model, translateMessages(short, lang), true, ctl.signal);
      /* модель без reasoning_effort: той самий запит без параметра */
      if (!out.ok && /reasoning_effort|unsupported|unrecognized/i.test(String(out.data?.error?.message || ''))) {
        out = await callModel(model, translateMessages(short, lang), false, ctl.signal);
      }
    } finally {
      clearTimeout(timer);
    }
    const msAi = Date.now() - tAi;
    const usage = out.data?.usage ? {
      prompt_tokens: out.data.usage.prompt_tokens, completion_tokens: out.data.usage.completion_tokens,
      reasoning_tokens: out.data.usage.completion_tokens_details?.reasoning_tokens ?? null,
    } : null;
    if (!out.ok) {
      log({ op: 'openai_error', token_ref: tokenRef(token), target: lang, http_status: out.status, ms: msAi });
      return res.status(502).json({ error: errText(lang, 'translate_failed') });
    }
    let parsed = null;
    try { parsed = JSON.parse(out.data.choices?.[0]?.message?.content || ''); } catch (e) {}
    const v = validateTranslated(short, parsed);
    if (!v.ok) {
      log({ op: 'invalid_translation', token_ref: tokenRef(token), target: lang, reason: v.reason, at: v.at ?? null, items: items.length });
      return res.status(502).json({ error: errText(lang, 'translate_failed') });
    }
    const texts = {};
    items.forEach((it, i) => { texts[it.id] = v.texts[String(i)]; });

    /* 5. у спільний кеш; збій запису перекладу не ламає */
    const merged = { ...(row.translations && typeof row.translations === 'object' ? row.translations : {}),
      [lang]: { v: TRANSLATE_VERSION, hash, model, at: new Date().toISOString(), texts } };
    try {
      const w = await fetch(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token), {
        method: 'PATCH', headers: { ...hdr, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ translations: merged }),
      });
      if (!w.ok) log({ op: 'cache_write_failed', token_ref: tokenRef(token), target: lang, http_status: w.status });
    } catch (e) {
      log({ op: 'cache_write_failed', token_ref: tokenRef(token), target: lang, error: String(e && e.name || 'error') });
    }
    log({ op: 'translated', token_ref: tokenRef(token), target: lang, items: items.length, chars: items.reduce((a, x) => a + x.text.length, 0), ms_openai: msAi, usage });
    return reply(texts, { cached: false, ms_openai: msAi, usage });
  } catch (e) {
    log({ op: 'error', token_ref: tokenRef(token), target: lang, error: String(e && e.name || 'error') });
    return res.status(e && e.name === 'AbortError' ? 504 : 500).json({ error: errText(lang, 'translate_failed') });
  }
}
