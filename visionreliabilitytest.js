/* Надійність Current Vision: ретрай, передзавантаження кадрів, gate
   фіналізації числового балу. Технічний збій Vision ніколи не дає
   готовий звіт із балом без кузова і салону. */
const fs = require('fs');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };
const eq = (a, b, m) => { if (a !== b) errs.push(m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); };

(async () => {
  const R = await import('./api/vision-reliability.js');
  const V4 = await import('./api/score-v4.js');
  const { withVisionRetry, prefetchFrames, visionGate, isRetryableVisionError } = R;
  const noSleep = { sleep: async () => {} };
  const seq = results => { let i = 0; const calls = []; const run = async a => { calls.push(a); const r = results[Math.min(i++, results.length - 1)]; if (r instanceof Error) throw r; return r; }; return { run, calls }; };
  const TIMEOUT = { status: 'failed', error: 'Unable to download content from the provided URL before the timeout.' };

  /* 1. придатні кадри + Vision ok -> фіналізується */
  {
    const s = seq([{ status: 'ok' }]);
    const r = await withVisionRetry(s.run, noSleep);
    eq(r.status, 'ok', '1: status'); eq(s.calls.length, 1, '1: one call');
    eq(visionGate({ usablePhotos: 18, expected: true, status: r.status }).finalize, true, '1: finalize');
  }
  /* 2. перший таймаут, ретрай успішний -> фіналізується */
  {
    const s = seq([TIMEOUT, { status: 'ok' }]);
    const r = await withVisionRetry(s.run, noSleep);
    eq(r.status, 'ok', '2: status'); eq(r.attempts.length, 2, '2: attempts');
    eq(visionGate({ usablePhotos: 18, expected: true, status: r.status }).finalize, true, '2: finalize');
  }
  /* 3. два технічні збої (таймаут, abort), третя спроба успішна */
  {
    const s = seq([TIMEOUT, new Error('This operation was aborted'), { status: 'ok' }]);
    const r = await withVisionRetry(s.run, noSleep);
    eq(r.status, 'ok', '3: status'); eq(s.calls.length, 3, '3: three calls');
  }
  /* 4. усі спроби провалились -> бал не фіналізується */
  {
    const s = seq([TIMEOUT, TIMEOUT, TIMEOUT]);
    const r = await withVisionRetry(s.run, noSleep);
    eq(r.status, 'failed', '4: status'); eq(s.calls.length, 3, '4: bounded to 3');
    const g = visionGate({ usablePhotos: 18, expected: true, status: r.status });
    eq(g.finalize, false, '4: must not finalize'); eq(g.reason, 'vision_technical_failure', '4: reason');
    eq(visionGate({ usablePhotos: 18, expected: true, status: 'timeout' }).finalize, false, '4: wait timeout does not finalize either');
  }
  /* 5. придатних кадрів нема -> не технічний збій */
  {
    eq(visionGate({ usablePhotos: 0, expected: true, status: null }).finalize, true, '5: no photos finalize');
    eq(visionGate({ usablePhotos: 3, expected: true, status: 'not_applicable' }).finalize, true, '5: not_applicable finalize');
    eq(visionGate({ usablePhotos: 12, expected: false, status: null }).finalize, true, '5: Vision disabled is not a failure');
    ok(!isRetryableVisionError({ status: 'not_applicable', error: 'no_usable_photos' }), '5: no photos is not retried');
  }
  /* 6. один битий кадр не валить усю перевірку */
  {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const fakeFetch = async url => {
      if (/broken/.test(url)) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (/gone/.test(url)) return { ok: false, status: 404, headers: { get: () => 'text/html' } };
      return { ok: true, status: 200, headers: { get: () => 'image/webp' }, arrayBuffer: async () => png };
    };
    const frames = [0, 1, 2, 3].map(i => ({ gallery_index: i, url: 'https://cdn.example/' + (i === 1 ? 'broken' : i === 3 ? 'gone' : 'ok') + i + '.webp', identity: 'id' + i }));
    const p = await prefetchFrames(frames, { fetchImpl: fakeFetch });
    eq(p.transport, 'inline_bytes', '6: transport');
    eq(p.frames.length, 2, '6: two usable frames kept');
    eq(p.dropped.map(d => d.gallery_index).join(','), '1,3', '6: only broken frames dropped');
    ok(p.frames.every(f => /^data:image\/webp;base64,/.test(f.send_url) && /^https:/.test(f.url) && f.identity), '6: bytes sent, original url and identity kept');
    const allBad = await prefetchFrames(frames.map(f => ({ ...f, url: f.url.replace(/ok\d/, 'broken') })), { fetchImpl: fakeFetch });
    eq(allBad.transport, 'remote_urls', '6: nothing downloaded -> fall back to links');
    eq(allBad.frames.length, 4, '6: fallback keeps all frames');
  }
  /* 7. ретрай не створює дубльованих записів: один термінальний результат,
     а gate повертає відповідь ДО запису знань, Vehicle Memory і _meta */
  {
    const s = seq([TIMEOUT, { status: 'ok', marker: 'final' }]);
    const r = await withVisionRetry(s.run, noSleep);
    eq(r.marker, 'final', '7: single terminal result object');
    const src = fs.readFileSync('api/check.js', 'utf8');
    const gateAt = src.indexOf("op: 'vision_gate'");
    ok(gateAt > 0, '7: gate present in check.js');
    for (const later of ['await writeKnowledge(parsed, listing', 'parsed._meta = {', 'computeScoreV4({']) {
      const at = src.indexOf(later);
      ok(at > gateAt, '7: gate must precede ' + later);
    }
    ok(/const \{ current_visual, stats \} = gateCurrentVisual\(raw, sent\)/.test(src), '7: findings built once, from frames the model saw');
    ok(/const cvFinal = cvTerminal;/.test(src) && /const cvC = cvTerminal;/.test(src), '7: Score v4 and coverage use the same terminal Vision result');
    ok(/prefetchFrames\(plan\.frames\)/.test(src) && /withVisionRetry\(/.test(src), '7: prefetch and retry wired');
  }
  /* 8. той самий успішний результат Vision -> той самий Score v4 */
  {
    const cv = { zones: { sufficient: ['front', 'rear', 'left_side', 'right_side', 'driver_area'], partial: [], not_visible: [] },
      condition_findings: [{ zone: 'front', kind: 'dent', severity: 'moderate', confidence: 'high', photo: 2, sign: 'помітна вмʼятина на капоті', component: 'panel' }] };
    const inp = { findings: [], currentVisual: cv, vehicle: { odometer_km: 150000, age_months: 100, powertrain_class: 'petrol' },
      evidence: { identity_confirmed: true, basics_known: true, photos_count: 18, seller_text_chars: 300, registry_present: true, cv_status: 'ok', cv_zones_sufficient: 5 }, listingText: 'опис' };
    const a = V4.computeScoreV4(inp), b = V4.computeScoreV4(JSON.parse(JSON.stringify(inp)));
    eq(a.final, b.final, '8: same Vision -> same Score'); eq(JSON.stringify(a.items), JSON.stringify(b.items), '8: same items');
  }
  /* неретраябельна помилка і вичерпаний бюджет */
  {
    const s = seq([{ status: 'failed', error: 'invalid_schema: response_format rejected' }, { status: 'ok' }]);
    const r = await withVisionRetry(s.run, noSleep);
    eq(s.calls.length, 1, 'permanent error not retried'); eq(r.status, 'failed', 'permanent error stays failed');
    const s2 = seq([TIMEOUT, { status: 'ok' }]);
    const r2 = await withVisionRetry(s2.run, { ...noSleep, budgetLeft: () => 10000 });
    eq(s2.calls.length, 1, 'no retry without budget'); ok(r2.attempts.some(x => x.error === 'budget_exhausted'), 'budget exhaustion recorded');
    ok(isRetryableVisionError({ status: 'failed', error: 'x', http_status: 503 }), '5xx retryable');
    ok(isRetryableVisionError({ status: 'failed', error: 'invalid_json' }), 'broken model JSON retryable');
  }
  /* локалізована людська помилка без технічних деталей */
  {
    const loc = fs.readFileSync('api/locale.js', 'utf8');
    ok(/vision_failed: \{[\s\S]*?en: [\s\S]*?ua: [\s\S]*?ru: /.test(loc), 'vision_failed error in three languages');
    ok(/errText\(lang, 'vision_failed'\)/.test(fs.readFileSync('api/check.js', 'utf8')), 'check.js returns vision_failed');
  }

  if (errs.length) { console.error('VISION RELIABILITY TEST FAILED:'); for (const e of errs) console.error('  - ' + e); process.exit(1); }
  console.log('vision reliability: ретрай 3 спроби з backoff · битий кадр виключається сам · gate не фіналізує бал при технічному збої · нема кадрів не є збоєм · один термінальний результат · той самий Vision -> той самий Score');
})().catch(e => { console.error('VISION RELIABILITY TEST CRASHED:', e); process.exit(1); });
