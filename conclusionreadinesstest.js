/* Conclusion readiness invariant (api/conclusion.js conclusionReadiness,
   api/check.js attach + readiness, result-check.html render, api/share.js).

   A finished CalCar Check with a numeric Score is never shown without a
   conclusion. BMW X5 M60i 2023 (VIN 5UX33EU06R9T12665, 2026-10-09): Claude
   produced a valid conclusion, the consistency gate hid the whole block
   over a counterfactual headline ("priced as if there had been no
   accident"), the page then hid the card although the verdict summary was
   there. Failure modes:
   A structured present -> structured render;
   B structured missing + verdict summary -> card visible with the summary;
   C structured invalid + verdict summary -> safe fallback;
   D neither -> explicit "could not form" state, never a hidden card;
   E primary provider fails, OpenAI fallback ok -> structured;
   F both providers fail + verdict summary -> fallback;
   G gate hides the structured text -> no blank ready report; the X5
     counterfactual headline is not a no-accident claim (rc-v3.2);
   H optional field (headline, checks) missing -> not blocking;
   I public Share carries the same fields;
   J old reports with only a legacy verdict render as before;
   K no second model call is introduced.
   Run: node conclusionreadinesstest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const clone = o => JSON.parse(JSON.stringify(o));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_fcready_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

const SUMMARY = 'Це BMW X5 M60i 2023 року з пробігом 56 тис. км. Історія підтверджує ДТП у США 2025 року, на архівних кадрах помітне пошкодження передка. Ціна близька до середньої.';
const REPORT = () => ({
  vehicle: { title: 'BMW X5 2023', year: 2023, engine: '4.4 petrol V8, 530 hp', fuel: 'petrol' },
  verdict: { score: 7.3, summary: SUMMARY },
  score_breakdown: { score_version: 'v4', final: 7.3, score_available: true, items: [], inputs: { mileage_rollback: { status: 'clean', available: true }, accident_history: { status: 'recorded', available: true } }, events: [{ v4_category: 'medium', zone: 'front', year: 2025, source: 'auction' }] },
  confidence: { overall_internal: 95, text_key: 'Studied in detail', caps_applied: [], domains: {} },
  risks: [], checklist: ['Front end: check panel gaps and paint thickness.'], discrepancies: [],
  final_conclusion: null,
  _meta: { lang: 'ru', vin: '5UX33EU06R9T12665', price: 97900, currency: 'USD', history_facts: { accident_recorded: true, owners_count: 1 }, vehicle_spec: { fields: { fuel: { value: 'petrol', strength: 'strong', conflict: false } }, conflicts: [], unknown: [] }, final_conclusion: { status: 'error', reason: 'timeout', provider: 'anthropic', fallback_reason: 'timeout' } },
});
const FC = () => ({ headline: 'Топовый X5 M60i, чья цена держится так, будто аварии не было', body: 'Это самая мощная версия X5. Кузов выглядит ухоженным.\n\nГлавное в истории: ДТП в США в 2025 году, передок был заметно разбит. Качество ремонта решает всё.\n\nЦена близка к средней.' });
const CHECKS = [{ text: 'Front end on a lift: check the crash boxes and rails behind the bumper, since the 2025 accident hit the front.', area: 'structure', refines: 1 }];
const claudeOk = (headline = 'Claude headline', paragraphs = ['Claude one.', 'Claude two.']) => ({ type: 'message', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ headline, paragraphs, checks: CHECKS }) }], usage: { input_tokens: 10, output_tokens: 10 } });
const openaiOk = { choices: [{ message: { content: JSON.stringify({ headline: 'OpenAI headline', paragraphs: ['OpenAI one.', 'OpenAI two.'], checks: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 }, model: 'gpt-6.1-sol' };
const ENV = { ANTHROPIC_API_KEY: 'sk-ant-READY-TEST', OPENAI_API_KEY: 'sk-READY-TEST', FINAL_CONCLUSION: 'on', CONCLUSION_PROVIDER: 'anthropic' };

(async () => {
  const F = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const P = await import('file://' + path.join(dir, 'api', 'conclusion-provider.js'));
  const CHK = await import('file://' + path.join(dir, 'api', 'check.js'));
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const SH = await import('file://' + path.join(dir, 'api', 'share.js'));
  const page = fs.readFileSync('result-check.html', 'utf8');
  const render = page.slice(page.indexOf("const fcGen = !!D && Object.prototype.hasOwnProperty.call(D, 'final_conclusion');"), page.indexOf('renderScoreBlock(D);', page.indexOf("const fcGen = !!D")));
  const realLog = console.log; const logs = []; console.log = (...a) => { logs.push(a.join(' ')); };

  /* ---------- A. structured present ---------- */
  {
    const r = REPORT(); r.final_conclusion = FC(); r._meta.final_conclusion = { status: 'ok', provider: 'anthropic' };
    const ready = F.conclusionReadiness(r);
    ok('A1. structured conclusion is what is visible; no fallback flags', ready.visible === 'structured' && ready.fallback_used === false && ready.fallback_source === null && ready.fallback_cause === null, JSON.stringify(ready));
    ok('A2. meta keeps the provider fields and adds the readiness fields', r._meta.final_conclusion.provider === 'anthropic' && r._meta.final_conclusion.visible === 'structured' && r._meta.final_conclusion.fallback_used === false);
    ok('A3. page: a structured body shows the structured block and hides the summary', /if \(fc && typeof fc\.body === 'string' && fc\.body\.trim\(\)\) \{/.test(render) && /dataset\.conclusion = 'structured'/.test(render) && /\$\('pdBlock'\)\.style\.display = '';\s*\$\('vText'\)\.style\.display = 'none';/.test(render));
  }

  /* ---------- B. structured missing + verdict summary ---------- */
  {
    const r = REPORT();
    const ready = F.conclusionReadiness(r);
    ok('B1. the verdict summary becomes the visible conclusion, with the cause of the loss', ready.visible === 'verdict_summary' && ready.fallback_used === true && ready.fallback_source === 'verdict_summary' && ready.fallback_cause === 'timeout', JSON.stringify(ready));
    ok('B2. the summary itself is untouched and no text is invented', r.verdict.summary === SUMMARY && r.final_conclusion === null);
    ok('B3. page: a new-generation report without a structured conclusion still shows the card with the summary', /\} else if \(fcGen\) \{/.test(render) && /dataset\.conclusion = hasSummary \? 'verdict_summary' : 'none'/.test(render) && /\$\('verdictCard'\)\.style\.display = '';\s*\$\('pdBlock'\)\.style\.display = 'none';\s*\$\('vText'\)\.style\.display = '';/.test(render));
    ok('B4. page: the summary text is written into the visible element in every branch', /if \(vd && vd\.summary\) \{[\s\S]*?\$\('vText'\)\.textContent = clean\(vd\.summary\);/.test(render));
  }

  /* ---------- C. structured invalid + verdict summary ---------- */
  {
    const r = REPORT();
    for (const bad of [{ headline: 'H', body: '' }, { headline: 'H' }, { body: 42 }, 'text', {}]) {
      const rr = clone(r); rr.final_conclusion = bad;
      ok('C1. invalid structured object (' + JSON.stringify(bad) + ') falls back to the summary', F.conclusionReadiness(rr).visible === 'verdict_summary');
    }
    const fcBad = { status: 'ok', conclusion: { headline: 'H', body: '   ' }, version: 'fc-v2.5' };
    const rr = clone(r);
    ok('C2. attach refuses a conclusion without text and leaves the report whole', CHK.attachFinalConclusion(rr, fcBad, 'ru') === false && rr.final_conclusion === null && rr.verdict.summary === SUMMARY);
    ok('C3. sanitizer: no paragraphs is null, a body string instead of paragraphs is accepted', F.sanitizeConclusion({ headline: 'H', paragraphs: [] }) === null && F.sanitizeConclusion({ headline: 'H', body: 'A.' }).body === 'A.');
  }

  /* ---------- D. neither ---------- */
  {
    const r = REPORT(); r.verdict.summary = '';
    const ready = F.conclusionReadiness(r);
    ok('D1. no structured text and no summary: visible none, cause recorded', ready.visible === 'none' && ready.fallback_used === true && ready.fallback_source === null && ready.fallback_cause === 'timeout', JSON.stringify(ready));
    ok('D2. page: the "none" state shows the card with an explicit message instead of hiding it', /if \(!hasSummary\) \$\('vText'\)\.textContent = t\('CalCar could not form the conclusion for this report\. The score and the sections below are complete\.'\);/.test(render));
    const dicts = { CALCAR_DICTS: {} };
    const vm = require('vm');
    for (const f of ['i18n/ru.js', 'i18n/ua.js']) vm.runInNewContext(fs.readFileSync(f, 'utf8'), { window: dicts });
    ok('D3. the message is translated (ru, ua)', ['ru', 'ua'].every(l => dicts.CALCAR_DICTS[l]['CalCar could not form the conclusion for this report. The score and the sections below are complete.']));
    ok('D4. page: the card is never left hidden for a new-generation report (every branch of the else-if chain shows it)', (render.match(/\$\('verdictCard'\)\.style\.display = '';/g) || []).length >= 4 && !/\$\('verdictCard'\)\.style\.display = 'none'/.test(render));
    const src = fs.readFileSync('api/check.js', 'utf8');
    ok('D5. check.js: the job still finishes (no throw, no hang) and the readiness log names the cause', /const ready = conclusionReadiness\(parsed\);/.test(src) && /op: 'readiness', visible: ready\.visible, fallback_cause: ready\.fallback_cause/.test(src) && src.indexOf('const ready = conclusionReadiness(parsed);') > src.indexOf('const rc = enforceReportConsistency(parsed, { lang });') && src.indexOf('const ready = conclusionReadiness(parsed);') < src.indexOf('return res.status(200).json(parsed);', src.indexOf('const rc = enforceReportConsistency')));
  }

  /* ---------- E. primary fails, OpenAI fallback ok ---------- */
  {
    const r = REPORT();
    const out = await P.runProductionConclusion({ report: r, env: ENV, timeoutMs: 150000, callModel: async () => openaiOk, callAnthropic: async () => ({ error: { type: 'overloaded_error', message: 'Overloaded' } }) });
    const attached = CHK.attachFinalConclusion(r, out, 'ru');
    const ready = F.conclusionReadiness(r);
    ok('E1. Claude failed, OpenAI fallback produced the conclusion, it is attached and visible as structured', out.status === 'ok' && out.provider === 'openai_fallback' && attached === true && r.final_conclusion.body === 'OpenAI one.\n\nOpenAI two.' && ready.visible === 'structured', JSON.stringify([out.status, out.provider, out.reason, ready]));
  }

  /* ---------- F. both fail + verdict summary ---------- */
  {
    const r = REPORT();
    const out = await P.runProductionConclusion({ report: r, env: ENV, timeoutMs: 150000, callModel: async () => ({ error: { message: 'boom' } }), callAnthropic: async () => ({ error: { type: 'api_error', message: 'down' } }) });
    const attached = CHK.attachFinalConclusion(r, out, 'ru');
    if (!attached) { r.final_conclusion = null; r._meta.final_conclusion = { status: out.status || 'error', reason: out.reason || null, provider: out.provider || null, fallback_reason: out.fallback_reason || null }; }
    const ready = F.conclusionReadiness(r);
    ok('F1. both providers failed: the verdict summary is the visible conclusion, the provider chain is recorded', out.status === 'error' && attached === false && ready.visible === 'verdict_summary' && r._meta.final_conclusion.provider === 'openai_fallback' && r._meta.final_conclusion.fallback_used === true && typeof r._meta.final_conclusion.fallback_cause === 'string', JSON.stringify(r._meta.final_conclusion));
  }

  /* ---------- G. gate ---------- */
  {
    /* the X5 headline: counterfactual, the accident is recorded */
    const r = REPORT(); r.final_conclusion = FC(); r._meta.final_conclusion = { status: 'ok', provider: 'anthropic', version: 'fc-v2.5' };
    const out = RC.enforceReportConsistency(r, { lang: 'ru' });
    ok('G1. rc-v3.2: "as if there had been no accident" is not a no-accident claim: the X5 conclusion survives the gate', r.final_conclusion && r.final_conclusion.headline === FC().headline && !out.hidden.includes('final_conclusion'), JSON.stringify(out.violations));
    for (const h of ['Priced as if there had been no accident', 'Ціна така, ніби аварії не було', 'Продаётся так, словно ДТП не было', 'Looks like there was no accident at all']) {
      const rr = REPORT(); rr.final_conclusion = { headline: h, body: FC().body }; rr._meta.final_conclusion = { status: 'ok' };
      RC.enforceReportConsistency(rr, { lang: 'ru' });
      ok('G2. counterfactual headline kept: "' + h + '"', !!rr.final_conclusion);
    }
    for (const h of ['Чистый X5 без аварий в истории', 'No accidents recorded for this X5', 'Аварії не було']) {
      const rr = REPORT(); rr.final_conclusion = { headline: h, body: FC().body }; rr._meta.final_conclusion = { status: 'ok' };
      RC.enforceReportConsistency(rr, { lang: 'ru' });
      ok('G3. a real no-accident claim against a recorded accident still hides the block: "' + h + '"', rr.final_conclusion === null);
    }
    /* the gate hides the block: readiness still gives the summary, and the cause names the gate */
    const rh = REPORT(); rh.final_conclusion = { headline: 'Чистый X5 без аварий в истории', body: FC().body }; rh._meta.final_conclusion = { status: 'ok', provider: 'anthropic', version: 'fc-v2.5' };
    RC.enforceReportConsistency(rh, { lang: 'ru' });
    const ready = F.conclusionReadiness(rh);
    ok('G4. a hidden structured conclusion leaves a visible summary with the gate as the cause', rh.final_conclusion === null && ready.visible === 'verdict_summary' && ready.fallback_cause === 'consistency_headline' && rh._meta.final_conclusion.provider === 'anthropic' && rh._meta.final_conclusion.status === 'error', JSON.stringify(rh._meta.final_conclusion));
    /* the fallback goes through the same gate: a contradicting sentence of the summary is removed too */
    const rs = REPORT(); rs.verdict.summary = 'Авто без ДТП в истории. Кузов ухожен.'; rs.final_conclusion = null;
    RC.enforceReportConsistency(rs, { lang: 'ru' });
    ok('G5. the summary fallback is gated the same way: the contradicting sentence is gone, the rest stays', rs.verdict.summary === 'Кузов ухожен.' && F.conclusionReadiness(rs).visible === 'verdict_summary', JSON.stringify(rs.verdict));
    ok('G6. gate version bumped', RC.CONSISTENCY_VERSION === 'rc-v3.2');
  }

  /* ---------- H. optional fields ---------- */
  {
    const r = REPORT();
    const noHead = { status: 'ok', conclusion: { headline: '', body: 'Text only.\n\nSecond paragraph.' }, version: 'fc-v2.5', provider: 'anthropic' };
    ok('H1. attach accepts a conclusion without headline', CHK.attachFinalConclusion(r, noHead, 'ru') === true && r.final_conclusion.body === 'Text only.\n\nSecond paragraph.' && r.final_conclusion.headline === '');
    const ready = F.conclusionReadiness(r);
    ok('H2. it is visible as structured and the missing headline is only noted', ready.visible === 'structured' && ready.headline_missing === true && ready.fallback_used === false);
    ok('H3. page: an empty headline hides the lead element and keeps the text', /\$\('pdHeadline'\)\.style\.display = fcHead \? '' : 'none';/.test(render));
    ok('H4. sanitizer keeps a response without headline and without checks', (() => { const s = F.sanitizeConclusion({ headline: '', paragraphs: ['Only text.'] }); return s && s.body === 'Only text.' && !('checks' in s); })());
    const rr = REPORT(); rr.final_conclusion = { headline: '', body: 'Only text.' };
    RC.enforceReportConsistency(rr, { lang: 'ru' });
    ok('H5. gate: an empty headline has no claims and does not hide the block', !!rr.final_conclusion);
  }

  /* ---------- I. share ---------- */
  {
    const r = REPORT(); r.final_conclusion = FC();
    const pub = SH.publicReport(r);
    ok('I1. the public report carries final_conclusion and verdict, the two fields the invariant reads', pub.final_conclusion.body === FC().body && pub.verdict.summary === SUMMARY && Object.prototype.hasOwnProperty.call(pub, 'final_conclusion'));
    const pub2 = SH.publicReport(REPORT());
    ok('I2. a public report without a structured conclusion keeps the key (null) and the summary, so the page takes the fallback branch', Object.prototype.hasOwnProperty.call(pub2, 'final_conclusion') && pub2.final_conclusion === null && pub2.verdict.summary === SUMMARY);
  }

  /* ---------- J. old reports ---------- */
  {
    const old = { vehicle: { title: 'Old' }, verdict: { score: 6.1, summary: 'Old summary.' }, purchase_decision: { recommendation: 'go_see', headline: 'Old decision', summary_short: 'Short.', reasoning: 'Why.' } };
    const ready = F.conclusionReadiness(old);
    ok('J1. a legacy report without the key still counts the summary as visible and gets no _meta written', ready.visible === 'verdict_summary' && !('_meta' in old));
    ok('J2. page: the legacy decision branch is unchanged and shown only for reports without the key', /\} else if \(!fcGen && pd && pd\.headline\) \{/.test(render) && /if \(!fcGen && !\(pd && pd\.headline\)\) \$\('verdictCard'\)\.style\.display = '';/.test(render));
  }

  /* ---------- K. no second model call ---------- */
  {
    const src = fs.readFileSync('api/check.js', 'utf8');
    const fcSrc = fs.readFileSync('api/conclusion.js', 'utf8');
    const readiness = fcSrc.slice(fcSrc.indexOf('export function conclusionReadiness'), fcSrc.indexOf('/* ---------- виклик ---------- */'));
    ok('K1. the readiness helper calls no model and no network', readiness.length > 200 && !/callModel|fetch\(|runFinalConclusion|runAnthropic|openai|anthropic/i.test(readiness));
    ok('K2. check.js still calls the production conclusion chain exactly once', (src.match(/runProductionConclusion\(/g) || []).length === 1 && !/runFinalConclusion\(/.test(src.replace(/import[^\n]*\n/g, '')));
  }

  console.log = realLog;
  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('CONCLUSION READINESS TEST FAILED:\n  - ' + errs.join('\n  - ')); process.exit(1); }
  console.log(`conclusion readiness: ${checks} checks · structured first · verdict summary fallback through the same gate · explicit none · X5 counterfactual headline kept · provider fallback · share · legacy · no second model call`);
})().catch(e => { console.log('CONCLUSION READINESS TEST CRASHED:', e && e.stack || e); process.exit(1); });
