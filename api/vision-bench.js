/* CalCar Check: Phase 0 benchmark-ендпоінт Current Vehicle Vision v2.
   Окремий standalone-виклик Vision по ФІКСОВАНОМУ набору поточних кадрів
   уже виконаного Check (той самий набір, що бачив main). До production
   Check НЕ підключений: check.js його не імпортує; звіти, Score, Vehicle
   Memory і БД не змінює, нічого не пише.
   Захист від зловживання: кадри беруться ЛИШЕ з рядка check_jobs за
   непрозорим токеном (128 біт), довільні URL не приймаються; максимум 24
   кадри; reasoning_effort лише low.

   POST /api/vision-bench
   { job_token, source?: 'meta' | 'snapshot', detail?: 'high'|'mixed'|'low', label? }
   source meta: _meta.photos за індексами _meta.photo_selection.picked
     (gallery_index = індекс у галереї, high = _meta.photo_selection.high);
   source snapshot: vehicle_snapshots.photo_items за VIN звіту (для галерей,
     де _meta.photos обрізані), gallery_index = позиція в галереї.
   Дублікати одного фізичного кадру (photoIdentity) відкидаються.
   -> { ok, ms, model, usage, fingerprint, frames, raw, current_visual, gate } */

export const config = { maxDuration: 150 };

import { TOKEN_RE } from './share.js';
import { CURRENT_VISUAL_RULES, currentVisualResponseFormat, frameContent, normalizeFrames, frameSetFingerprint, gateCurrentVisual, CURRENT_VISUAL_VERSION } from './current-visual.js';

async function rest(root, hdr, path) {
  const r = await fetch(root + '/rest/v1/' + path, { headers: hdr });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

export function framesFromMeta(meta) {
  const photos = Array.isArray(meta && meta.photos) ? meta.photos : [];
  const sel = meta && meta.photo_selection ? meta.photo_selection : {};
  const picked = Array.isArray(sel.picked) ? sel.picked : photos.map((_, i) => i);
  const high = new Set(Array.isArray(sel.high) ? sel.high : []);
  return picked.filter(i => typeof photos[i] === 'string').map(i => ({ gallery_index: i, url: photos[i], high: high.has(i) }));
}

export function framesFromSnapshot(items) {
  return (Array.isArray(items) ? items : [])
    .filter(x => x && typeof x.url === 'string')
    .map(x => ({ gallery_index: Number.isInteger(x.i) ? x.i : parseInt(x.i, 10), url: x.url, high: true }));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('cache-control', 'no-store');
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.OPENAI_API_KEY || !base || !key) return res.status(500).json({ error: 'not configured' });
  const hdr = { apikey: key, authorization: 'Bearer ' + key };
  const root = base.replace(/\/$/, '');
  const body = req.body || {};
  const token = String(body.job_token || '').trim();
  if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'not found' });
  const rows = await rest(root, hdr, 'check_jobs?token=eq.' + encodeURIComponent(token) + '&status=eq.done&select=vin,report&limit=1');
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row || !row.report || !row.report._meta) return res.status(404).json({ error: 'not found' });
  const meta = row.report._meta;
  let source = body.source === 'snapshot' ? 'snapshot' : 'meta';
  let list = [];
  if (source === 'snapshot') {
    const vin = row.vin || meta.vin;
    const snaps = vin ? await rest(root, hdr, 'vehicle_snapshots?select=photo_items,first_seen_at,vehicles!inner(vin)&vehicles.vin=eq.' + encodeURIComponent(vin) + '&order=first_seen_at.desc&limit=1') : null;
    list = framesFromSnapshot(snaps && snaps[0] ? snaps[0].photo_items : null);
  } else {
    list = framesFromMeta(meta);
  }
  const frames = normalizeFrames(list);
  if (!frames.length) return res.status(400).json({ error: 'no frames for this job', source });
  const detail = ['high', 'mixed', 'low'].includes(body.detail) ? body.detail : 'high';
  const reqBody = {
    model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
    max_completion_tokens: 12000,
    reasoning_effort: 'low',
    response_format: currentVisualResponseFormat(),
    messages: [
      { role: 'system', content: CURRENT_VISUAL_RULES },
      { role: 'user', content: frameContent(frames, detail) },
    ],
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  const t0 = Date.now();
  let data = null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: ctl.signal, method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify(reqBody),
    });
    data = await r.json();
  } catch (e) {
    clearTimeout(timer);
    return res.status(502).json({ ok: false, error: String(e.message || e), ms: Date.now() - t0 });
  }
  clearTimeout(timer);
  const ms = Date.now() - t0;
  if (data && data.error) return res.status(502).json({ ok: false, error: data.error.message || 'AI error', ms });
  let raw = null;
  try { raw = JSON.parse(String(data?.choices?.[0]?.message?.content || '')); } catch (e) { raw = null; }
  const gated = raw ? gateCurrentVisual(raw, frames) : null;
  const u = data && data.usage ? data.usage : {};
  return res.status(200).json({
    ok: !!raw, ms, label: typeof body.label === 'string' ? body.label.slice(0, 40) : null, source,
    model: (data && data.model) || reqBody.model, version: CURRENT_VISUAL_VERSION, detail, reasoning_effort: 'low',
    usage: {
      input_tokens: u.prompt_tokens ?? null, cached_tokens: u.prompt_tokens_details?.cached_tokens ?? null,
      output_tokens: u.completion_tokens ?? null, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
    },
    fingerprint: frameSetFingerprint(frames),
    frames: frames.map(f => ({ gallery_index: f.gallery_index, photo_identity: f.identity, high: f.high })),
    raw, current_visual: gated ? gated.current_visual : null, gate: gated ? gated.stats : null,
    finish_reason: data?.choices?.[0]?.finish_reason || null,
  });
}
