/* CalCar Check: постійне публічне посилання для збереженого звіту кабінету.
   POST /api/share-link  { report_id }  з Authorization: Bearer <JWT Supabase>
   -> { token, slug, path }
   Старий короткий public_id (6 символів з 31-символьного алфавіту, ~30 біт)
   створювався як коротка адреса кабінету, а не як share-секрет, тому звіт
   за ним публічно НЕ віддається. Натомість власник звіту (і лише він:
   JWT перевіряється в Supabase Auth, рядок звіту звіряється з user_id)
   отримує непрозорий 128-бітний токен. Токен записується у сам звіт
   (_meta.share_token) і в check_jobs як готовий read-only job, тож
   /check/r/<slug>/<token> працює так само, як для нових аналізів. */

export const config = { maxDuration: 15 };

import { resolveLocale, errText } from './locale.js';
import { makeJobToken } from './check.js';
import { reportSlug } from './share.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const lang = resolveLocale(req.body?.lang);
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  res.setHeader('cache-control', 'no-store');
  if (!base || !key) return res.status(500).json({ error: errText(lang, 'internal') });
  const root = base.replace(/\/$/, '');
  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const reportId = String(req.body?.report_id || '').trim();
  if (!jwt || !UUID_RE.test(reportId)) return res.status(401).json({ error: 'unauthorized' });
  try {
    /* хто питає: Supabase Auth перевіряє підпис і термін дії JWT */
    const ur = await fetch(root + '/auth/v1/user', { headers: { apikey: key, authorization: 'Bearer ' + jwt } });
    const user = ur.ok ? await ur.json().catch(() => null) : null;
    if (!user || !user.id) return res.status(401).json({ error: 'unauthorized' });
    const hdr = { apikey: key, authorization: 'Bearer ' + key };
    /* лише власний звіт: user_id звіряється сервером, не клієнтом */
    const rr = await fetch(root + '/rest/v1/reports?id=eq.' + encodeURIComponent(reportId) + '&user_id=eq.' + encodeURIComponent(user.id) + '&kind=eq.check&select=id,data,created_at&limit=1', { headers: hdr });
    if (!rr.ok) return res.status(500).json({ error: errText(lang, 'internal') });
    const rows = await rr.json();
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row || !row.data || !row.data.vehicle) return res.status(404).json({ error: 'not found' });
    const data = row.data;
    const meta = (data._meta && typeof data._meta === 'object') ? data._meta : {};
    let token = typeof meta.share_token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(meta.share_token) ? meta.share_token : null;
    /* токен уже є: перевіряємо, що job за ним справді існує */
    if (token) {
      const jr = await fetch(root + '/rest/v1/check_jobs?token=eq.' + encodeURIComponent(token) + '&select=token&limit=1', { headers: hdr });
      const jrows = jr.ok ? await jr.json().catch(() => []) : [];
      if (!Array.isArray(jrows) || !jrows[0]) token = null;
    }
    if (!token) {
      token = makeJobToken();
      const slug = reportSlug(data);
      const report = { ...data, _meta: { ...meta, share_token: token, share_slug: slug } };
      const ins = await fetch(root + '/rest/v1/check_jobs', {
        method: 'POST', headers: { ...hdr, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({
          token, status: 'done', stage: 'done', url: meta.url || 'https://calcar.io/check', vin: meta.vin || null,
          lang: resolveLocale(meta.lang), user_id: user.id, report,
          created_at: row.created_at || new Date().toISOString(), finished_at: new Date().toISOString(),
        }),
      });
      if (!ins.ok) return res.status(500).json({ error: errText(lang, 'internal') });
      /* токен у самому звіті: наступне "Поділитися" повторно нічого не створює */
      await fetch(root + '/rest/v1/reports?id=eq.' + encodeURIComponent(reportId) + '&user_id=eq.' + encodeURIComponent(user.id), {
        method: 'PATCH', headers: { ...hdr, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ data: report }),
      }).catch(() => {});
    }
    const slug = reportSlug(data);
    return res.status(200).json({ token, slug, path: '/check/r/' + slug + '/' + token });
  } catch (e) {
    return res.status(500).json({ error: errText(lang, 'internal', e.message) });
  }
}
