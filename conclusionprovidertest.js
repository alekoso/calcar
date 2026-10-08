/* Production provider of the Final Conclusion (api/conclusion-provider.js).
   1. CONCLUSION_PROVIDER=anthropic (and unset) calls Claude, never OpenAI on success;
   2. Claude runs claude-opus-5-5 / medium with the production output budget;
   3. Claude gets exactly the rules, user message and schema the OpenAI path sends;
   4. structured checks reach the checklist merge (same code path as check.js);
   5. the consistency gate still runs after it and still repairs Claude text;
   6. a Claude failure triggers exactly one OpenAI fallback;
   7. the fallback gives a normal report with provider openai_fallback;
   8. CONCLUSION_PROVIDER=openai keeps the old request byte for byte;
   9. no double generation on a normal Check;
   10. no API key reaches results, meta or logs. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };
const DASH = String.fromCharCode(0x2014);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_fcprov_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

const REPORT = () => ({
  vehicle: { title: 'Audi A4 2013', year: 2013, engine: '2.0 petrol, 220 hp', transmission: 'automatic', fuel: 'petrol' },
  verdict: { score: 8.2 },
  score_breakdown: { score_version: 'v4', final: 8.2, score_available: true, items: [], inputs: { mileage_rollback: { status: 'clean', available: true }, accident_history: { status: 'clean', available: true } }, events: [{ v4_category: 'light', zone_classes: ['rear'], airbags: false }] },
  confidence: { overall_internal: 62, text_key: 'Partially checked', caps_applied: [], domains: {} },
  historical_visual: { summary: 'Rear bumper damage.', visible_severity: 'minor', damage_depth: 'exterior_panels_only', srs_visual_status: 'no_deployment_visible' },
  risks: [{ title: 'Timing chain', level: 'medium', kind: 'latent', note: 'Known weak point.', action: 'listen on cold start' }],
  checklist: ['Do a cold start and listen to the engine.', 'Check the service book for regular oil changes.'],
  _meta: {
    lang: 'en', vin: 'WAUZZZ8K0DA000001', price: 12500, currency: 'USD', odometer_km: 180000,
    history_facts: { owners_count: 3, registry_present: true },
    vehicle_spec: { fields: { fuel: { value: 'petrol', strength: 'strong', conflict: false }, transmission: { value: 'automatic', strength: 'strong', conflict: false }, drivetrain: { value: null, conflict: false }, version: { value: null, conflict: true, candidates: [{ value: 'Premium', raw: 'Premium' }, { value: 'S line', raw: 'S line' }] } }, conflicts: ['version'], unknown: ['drivetrain'] },
  },
});
const CHECKS = [{ text: 'Do a cold start and listen for timing chain rattle in the first seconds, since chain stretch is the known concern of this engine.', area: 'powertrain', refines: 1 }, { text: 'Ask for invoices of the timing chain work the seller reports, to confirm what was replaced.', area: 'service_history', refines: null }];
const claudeOk = (paragraphs = ['Claude one.', 'Claude two.']) => ({ type: 'message', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ headline: 'Claude headline', paragraphs, checks: CHECKS }) }], usage: { input_tokens: 4000, output_tokens: 2000, cache_read_input_tokens: 7800, cache_creation_input_tokens: 0 }, http_status: 200 });
const openaiOk = { choices: [{ message: { content: JSON.stringify({ headline: 'OpenAI headline', paragraphs: ['OpenAI one.', 'OpenAI two.'], checks: [CHECKS[0]] }) } }], usage: { prompt_tokens: 7500, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 300 } }, model: 'gpt-6.1-sol' };
const KEYS = { ANTHROPIC_API_KEY: 'sk-ant-PROVIDER-TEST-SECRET', OPENAI_API_KEY: 'sk-PROVIDER-TEST-SECRET' };

(async () => {
  const P = await import('file://' + path.join(dir, 'api', 'conclusion-provider.js'));
  const F = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const CHK = await import('file://' + path.join(dir, 'api', 'check.js'));
  const CM = await import('file://' + path.join(dir, 'api', 'checklist-merge.js'));
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };

  /* selector */
  ok(P.conclusionProvider({}) === 'anthropic' && P.conclusionProvider({ CONCLUSION_PROVIDER: 'anthropic' }) === 'anthropic' && P.conclusionProvider({ CONCLUSION_PROVIDER: ' OpenAI ' }) === 'openai' && P.conclusionProvider({ CONCLUSION_PROVIDER: 'gemini' }) === 'anthropic', 'provider selector wrong');

  /* 1, 2, 3, 9: anthropic success */
  const aBodies = [], oBodies = [];
  const env = { ...KEYS, FINAL_CONCLUSION: 'on', CONCLUSION_PROVIDER: 'anthropic' };
  const r1 = await P.runProductionConclusion({ report: REPORT(), langDirective: 'LANG.', env, timeoutMs: 150000, callModel: async b => { oBodies.push(b); return openaiOk; }, callAnthropic: async b => { aBodies.push(b); return claudeOk(); } });
  ok(r1.status === 'ok' && r1.provider === 'anthropic' && r1.fallback_reason === null && aBodies.length === 1 && oBodies.length === 0, '1/9: Claude success still calls OpenAI or calls Claude twice: ' + JSON.stringify({ s: r1.status, p: r1.provider, a: aBodies.length, o: oBodies.length }));
  ok(aBodies[0].model === 'claude-opus-5-5' && aBodies[0].output_config.effort === 'medium' && aBodies[0].max_tokens === 12000 && !aBodies[0].stream && r1.effort === 'medium' && r1.ai.model === 'claude-opus-5-5' && r1.ai.input_tokens === 4000 && r1.ai.output_tokens === 2000, '2: not claude-opus-5-5 / medium with the production budget');
  const ref = [];
  await F.runFinalConclusion({ report: REPORT(), langDirective: 'LANG.', env: { ...env, CONCLUSION_PROVIDER: 'openai' }, callModel: async b => { ref.push(b); return openaiOk; } });
  ok(aBodies[0].system[0].text === ref[0].messages[0].content && aBodies[0].system[0].text === F.CONCLUSION_RULES && aBodies[0].messages[0].content === ref[0].messages[1].content && aBodies[0].messages[0].content === F.conclusionUserMessage({ langDirective: 'LANG.', context: F.buildConclusionContext(REPORT()) }), '3: Claude input differs from the OpenAI input');
  ok(JSON.stringify(aBodies[0].output_config.format.schema) === JSON.stringify(ref[0].response_format.json_schema.schema) && F.CONCLUSION_VERSION === 'fc-v2.5' && r1.version === 'fc-v2.5' && aBodies[0].output_config.format.schema.required.join() === 'headline,paragraphs,checks', '3: schema is not the fc-v2.5 schema with checks');
  ok(r1.conclusion.headline === 'Claude headline' && Array.isArray(r1.conclusion.checks) && r1.conclusion.checks.length === 2 && JSON.stringify(r1.checklist_snapshot) === JSON.stringify(REPORT().checklist) && r1.context_chars === aBodies[0].messages[0].content.length, 'Claude result lacks checks, snapshot or context size');
  /* an env model or effort override reaches the call */
  const ov = [];
  await P.runProductionConclusion({ report: REPORT(), env: { ...env, CONCLUSION_ANTHROPIC_EFFORT: 'high' }, callModel: async () => openaiOk, callAnthropic: async b => { ov.push(b); return claudeOk(); } });
  ok(ov[0].output_config.effort === 'high', 'CONCLUSION_ANTHROPIC_EFFORT is ignored');

  /* 4, 5: the downstream path of check.js on the Claude result */
  const rep = REPORT();
  ok(CHK.attachFinalConclusion(rep, r1, 'en') === true, '4: Claude result is not attached');
  const m = rep._meta.final_conclusion;
  ok(m.provider === 'anthropic' && m.model === 'claude-opus-5-5' && m.effort === 'medium' && m.version === 'fc-v2.5' && m.fallback_reason === null && typeof m.ms === 'number' && m.input_tokens === 4000 && m.output_tokens === 2000 && m.cached_tokens === 7800, 'meta does not record provider, model, effort, latency or tokens: ' + JSON.stringify(m));
  const fcc = CM.sanitizeFcChecks(r1.conclusion.checks, r1.checklist_snapshot.length);
  const cm = CM.mergeChecklist(rep, { fcChecks: fcc.checks, snapshot: r1.checklist_snapshot, lang: 'en' });
  ok(cm.refined.length === 1 && cm.refined[0].to === CHECKS[0].text && cm.added.some(a => a.source === 'final_conclusion' && a.text === CHECKS[1].text) && rep.checklist[0] === CHECKS[0].text, '4: Claude checks do not reach the checklist merge: ' + JSON.stringify(cm));
  const bad = REPORT();
  const rBad = await P.runProductionConclusion({ report: bad, env, callModel: async () => openaiOk, callAnthropic: async () => claudeOk(['This is the S line version with sport seats. The car is otherwise tidy.', 'Second paragraph here. It stays.']) });
  CHK.attachFinalConclusion(bad, rBad, 'en');
  const rc = RC.enforceReportConsistency(bad, { lang: 'en' });
  ok(rc.violations.some(v => String(v.section).startsWith('final_conclusion') && v.domain === 'identity_conflict') && bad.final_conclusion && !/S line/.test(bad.final_conclusion.body), '5: the consistency gate does not repair Claude text');
  const src = fs.readFileSync('api/check.js', 'utf8');
  const iRun = src.indexOf('runProductionConclusion({ report: parsed'), iAtt = src.indexOf('const attached = attachFinalConclusion(parsed, fc, lang);'), iMerge = src.indexOf('const cm = mergeChecklist(parsed, { fcChecks: fcc.checks, snapshot, lang });'), iGate = src.indexOf('const rc = enforceReportConsistency(parsed, { lang });');
  ok(iRun > 0 && iRun < iAtt && iAtt < iMerge && iMerge < iGate && /sanitizeFcChecks\(fcOut\.conclusion\.checks/.test(src) && /fcOut\.checklist_snapshot/.test(src), '4/5: check.js order provider -> attach -> merge -> gate is broken');
  ok((src.match(/runProductionConclusion\(/g) || []).length === 1 && !/runFinalConclusion\(/.test(src) && !/conclusion-shadow|runShadowPair|conclusion-checks|runAnthropicConclusion/.test(src), '9: check.js generates more than once or runs the shadow');

  /* 6, 7: Claude failure -> exactly one OpenAI fallback */
  for (const [label, transport] of [
    ['overloaded twice', async () => ({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' }, http_status: 529 })],
    ['refusal', async () => ({ type: 'message', model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [], http_status: 200 })],
    ['invalid output', async () => ({ ...claudeOk(), content: [{ type: 'text', text: 'not json' }] })],
    ['timeout', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }],
  ]) {
    const oCalls = [];
    const rf = await P.runProductionConclusion({ report: REPORT(), langDirective: 'LANG.', env, timeoutMs: 150000, callModel: async b => { oCalls.push(b); return openaiOk; }, callAnthropic: transport });
    ok(rf.status === 'ok' && rf.provider === 'openai_fallback' && rf.fallback_reason && oCalls.length === 1 && oCalls[0].model === 'gpt-6.1-sol' && rf.conclusion.headline === 'OpenAI headline', '6: ' + label + ' does not give exactly one OpenAI fallback: ' + JSON.stringify({ s: rf.status, p: rf.provider, r: rf.fallback_reason, o: oCalls.length }));
    ok(rf.attempts.some(a => a.provider === 'anthropic') && rf.attempts.some(a => a.provider === 'openai') && Array.isArray(rf.checklist_snapshot), '6: ' + label + ' fallback loses the attempt log or the snapshot');
    if (label === 'overloaded twice') {
      const rr = REPORT();
      ok(CHK.attachFinalConclusion(rr, rf, 'en') === true && rr.final_conclusion.headline === 'OpenAI headline' && rr._meta.final_conclusion.provider === 'openai_fallback' && /overloaded_error/.test(rr._meta.final_conclusion.fallback_reason) && rr._meta.final_conclusion.model === 'gpt-6.1-sol', '7: fallback report is not a normal report with provider openai_fallback');
      ok(logs.some(l => l.includes('"op":"fallback"') && l.includes('overloaded_error')), 'fallback is not logged');
    }
  }
  /* no key: fallback, not an error */
  const oNoKey = [];
  const rNoKey = await P.runProductionConclusion({ report: REPORT(), env: { OPENAI_API_KEY: 'sk-x', FINAL_CONCLUSION: 'on' }, callModel: async b => { oNoKey.push(b); return openaiOk; } });
  ok(rNoKey.provider === 'openai_fallback' && rNoKey.fallback_reason === 'no_key' && oNoKey.length === 1 && rNoKey.status === 'ok', 'missing Anthropic key does not fall back to OpenAI');
  /* both fail: one of each, no loop */
  let aN = 0, oN = 0;
  const rBoth = await P.runProductionConclusion({ report: REPORT(), env: { ...env, OPENAI_MODEL: 'gpt-6.1-sol' }, callModel: async () => { oN++; return { error: { message: 'boom' } }; }, callAnthropic: async () => { aN++; return { type: 'error', error: { type: 'invalid_request_error', message: 'bad' }, http_status: 400 }; } });
  ok(rBoth.status === 'error' && rBoth.provider === 'openai_fallback' && aN === 1 && oN === 1, 'both providers failing loops or hides: ' + JSON.stringify({ a: aN, o: oN, s: rBoth.status }));
  /* Claude leaves the fallback its reserve */
  let budget = null;
  await P.runProductionConclusion({ report: REPORT(), env, timeoutMs: 150000, callModel: async () => openaiOk, callAnthropic: async (b, ms) => { budget = ms; return claudeOk(); } });
  ok(budget !== null && budget <= 150000 - P.FALLBACK_RESERVE_MS && budget >= 15000, 'Claude takes the time the fallback needs: ' + budget);
  /* disabled stage and empty report do not call anything */
  let any = 0;
  const rOff = await P.runProductionConclusion({ report: REPORT(), env: { ...env, FINAL_CONCLUSION: 'off' }, callModel: async () => { any++; return openaiOk; }, callAnthropic: async () => { any++; return claudeOk(); } });
  const rEmpty = await P.runProductionConclusion({ report: null, env, callModel: async () => { any++; return openaiOk; }, callAnthropic: async () => { any++; return claudeOk(); } });
  ok(rOff.status === 'skipped' && rOff.reason === 'disabled' && rEmpty.reason === 'no_context' && any === 0, 'disabled stage or empty report calls a model');

  /* 8: openai provider keeps the old path */
  const aNever = [], oOld = [];
  const r8 = await P.runProductionConclusion({ report: REPORT(), langDirective: 'LANG.', env: { ...env, CONCLUSION_PROVIDER: 'openai' }, timeoutMs: 150000, callModel: async b => { oOld.push(b); return openaiOk; }, callAnthropic: async b => { aNever.push(b); return claudeOk(); } });
  const plain = [];
  await F.runFinalConclusion({ report: REPORT(), langDirective: 'LANG.', env: { ...env, CONCLUSION_PROVIDER: 'openai' }, timeoutMs: 150000, callModel: async b => { plain.push(b); return openaiOk; } });
  ok(r8.provider === 'openai' && r8.status === 'ok' && aNever.length === 0 && oOld.length === 1 && JSON.stringify(oOld[0]) === JSON.stringify(plain[0]) && r8.fallback_reason === null, '8: openai provider is not the old request');

  /* 10: keys never leave */
  const everything = JSON.stringify([r1, rBad, rNoKey, rBoth, r8, rep._meta, logs]);
  ok(!everything.includes('PROVIDER-TEST-SECRET'), '10: an API key leaked into a result, meta or log');
  const provSrc = fs.readFileSync('api/conclusion-provider.js', 'utf8');
  ok(!/ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(provSrc) && !/export default/.test(provSrc), '10: provider module reads keys itself or became a Vercel function');
  const benchSrc = fs.readFileSync('api/conclusion-bench.js', 'utf8');
  ok(/if \(mode === 'production'\)/.test(benchSrc) && /runProductionConclusion\(\{ report: rep/.test(benchSrc) && /const rep = JSON\.parse\(JSON\.stringify\(report\)\)/.test(benchSrc) && benchSrc.indexOf('benchAllowed(req, process.env)') < benchSrc.indexOf("mode === 'production'"), 'bench production smoke is not a keyed, read-only copy');
  for (const f of ['api/conclusion-provider.js', 'conclusionprovidertest.js', 'api/check.js', 'api/conclusion-bench.js']) ok(!fs.readFileSync(f, 'utf8').includes(DASH), 'em dash in ' + f);

  console.log = realLog;
  if (errs.length) { console.log('CONCLUSION PROVIDER TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('conclusion provider: Claude opus-5-5/medium alone on success · same rules, user message and fc-v2.5 schema · checks reach the merge · gate repairs Claude text · one OpenAI fallback on error, refusal, invalid output, timeout, no key · openai provider unchanged · no double generation · no keys');
})().catch(e => { console.log('CONCLUSION PROVIDER TEST CRASHED:', e); process.exit(1); });
