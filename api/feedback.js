/* CalCar: відгук на звіт. POST /api/feedback
   { report_ref, product, verdict: 'positive'|'negative', text?, anon_id?, page? }
   з необовʼязковим Authorization: Bearer <JWT Supabase> (тоді user_id
   перевіряється в Auth і записується). Пише лише сервер через service role;
   на Score і зміст звіту не впливає. Один відгук на звіт з одного
   ідентифікатора (user_id або anon_id) за годину: повторний замінює текст. */

export const config = { maxDuration: 15 };

import { resolveLocale, errText } from './locale.js';

const REF_RE = /^[A-Za-z0-9_-]{4,64}$/;
const ANON_RE = /^[0-9a-f-]{36}$/;

export function sanitizeFeedback(body) {
  const b = body && typeof body === 'object' ? body : {};
  const report_ref = String(b.report_ref || '').trim();
  if (!REF_RE.test(report_ref)) return { error: 'bad_ref' };
  const verdict = b.verdict === 'positive' || b.verdict === 'negative' ? b.verdict : null;
  if (!verdict) return { error: 'bad_verdict' };
  const text = typeof b.text === 'string' ? b.text.replace(/\u2014/g, ',').trim().slice(0, 1000) : '';
  const product = b.product === 'import' ? 'import' : 'check';
  const anon_id = typeof b.anon_id === 'string' && ANON_RE.test(b.anon_id) ? b.anon_id : null;
  const page = typeof b.page === 'string' ? b.page.slice(0, 80) : null;
  return { report_ref, verdict, text: text || null, product, anon_id, page };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const lang = resolveLocale(req.body?.lang);
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  res.setHeader('cache-control', 'no-store');
  if (!base || !key) return res.status(500).json({ error: errText(lang, 'internal') });
  const root = base.replace(/\/$/, '');
  const hdr = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const fb = sanitizeFeedback(req.body);
  if (fb.error) return res.status(400).json({ error: 'bad_request' });
  try {
    /* хто питає: лише коли клієнт надіслав JWT, і лише якщо Auth його підтвердив */
    let user_id = null;
    const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (jwt) {
      const ur = await fetch(root + '/auth/v1/user', { headers: { apikey: key, authorization: 'Bearer ' + jwt } });
      const user = ur.ok ? await ur.json().catch(() => null) : null;
      if (user && user.id) user_id = user.id;
    }
    if (!user_id && !fb.anon_id) return res.status(400).json({ error: 'bad_request' });
    /* повторний відгук того самого відвідувача на той самий звіт протягом години оновлює попередній */
    const who = user_id ? 'user_id=eq.' + encodeURIComponent(user_id) : 'anon_id=eq.' + encodeURIComponent(fb.anon_id);
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const q = await fetch(root + '/rest/v1/report_feedback?report_ref=eq.' + encodeURIComponent(fb.report_ref) + '&' + who + '&created_at=gte.' + encodeURIComponent(since) + '&select=id&limit=1', { headers: hdr });
    const rows = q.ok ? await q.json().catch(() => []) : [];
    const row = { report_ref: fb.report_ref, product: fb.product, user_id, anon_id: user_id ? null : fb.anon_id, verdict: fb.verdict, text: fb.text, lang, page: fb.page };
    let r;
    if (Array.isArray(rows) && rows[0]) {
      r = await fetch(root + '/rest/v1/report_feedback?id=eq.' + encodeURIComponent(rows[0].id), { method: 'PATCH', headers: { ...hdr, prefer: 'return=minimal' }, body: JSON.stringify({ verdict: fb.verdict, text: fb.text }) });
    } else {
      r = await fetch(root + '/rest/v1/report_feedback', { method: 'POST', headers: { ...hdr, prefer: 'return=minimal' }, body: JSON.stringify(row) });
    }
    if (!r.ok) return res.status(500).json({ error: errText(lang, 'internal') });
    return res.status(200).json({ ok: true, updated: !!(Array.isArray(rows) && rows[0]) });
  } catch (e) {
    return res.status(500).json({ error: errText(lang, 'internal', e.message) });
  }
}
