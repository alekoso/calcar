/* Final Conclusion shadow A/B (OpenAI control vs Anthropic shadow).
   Contract, not text quality:
   - the Anthropic body carries the same rules, the same user message and
     the same schema (fc-v2.5, with the checks field) as the production
     call, nothing else;
   - the control call is byte-for-byte what runFinalConclusion sends on its
     own, and the pair proves identical input with the hash of what each
     provider was actually sent (rules, user message, schema);
   - the checks each provider returns go through the production checklist
     merge on a copy of the report, never on the report itself;
   - provider failures (refusal, max_tokens, API error, timeout) are
     recorded, retried only when transient, never hidden, never fallen
     back to another model;
   - no secret reaches a result or a log; api/check.js never imports the
     shadow modules; the bench endpoint stays read-only;
   - the invariant checks flag the obvious regressions and leave reported
     speech, hedges and negations alone;
   - the blind artifact carries no provider signal. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
const ok = (c, m) => { if (!c) errs.push(m); };
const DASH = String.fromCharCode(0x2014);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_fcshadow_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

/* a finished report of the current pipeline generation: Final Conclusion key, canonical vehicle spec */
const REPORT = {
  vehicle: { title: 'Audi A4 2013', trim: null, year: 2013, engine: '2.0 petrol, 220 hp', transmission: 'automatic', drive: null, fuel: 'petrol' },
  verdict: { score: 8.2, summary: 'old summary' },
  final_conclusion: { headline: 'Stored headline', body: 'Stored body one.\n\nStored body two.' },
  score_breakdown: { score_version: 'v4', final: 8.2, score_available: true, vehicle_age: { age_years: 13 }, items: [{ key: 'input8:owners', amount: 0.3, label_key: 'Number of owners' }],
    inputs: { mileage_rollback: { status: 'clean', available: true }, accident_history: { status: 'clean', available: true } },
    events: [{ v4_category: 'light', category_basis: ['panels'], zone_classes: ['rear'], airbags: false, repair_status: 'repaired' }], vehicle_owners: { status: 'applied', owners_count: 3 } },
  confidence: { overall_internal: 62, text_key: 'Partially checked', caps_applied: [], domains: { history: { status: 'partial', inputs: [{ key: 'registry', state: 'verified' }] } } },
  history: [{ date: '04.2014', event: 'First registration.', gap: null }],
  historical_visual: { summary: 'Rear bumper damage.', visible_severity: 'minor', damage_depth: 'exterior_panels_only', visible_damage_zones: ['rear'], srs_visual_status: 'no_deployment_visible', possible_structural_damage: false },
  photo_findings: [{ status: 'ok', text: 'No visible defects.' }],
  risks: [{ title: 'Timing chain', level: 'medium', kind: 'latent', note: 'Known weak point.', action: 'listen on cold start' }],
  checklist: ['Do a cold start and listen to the engine.', 'Check the service book for regular oil changes.'],
  equipment_v2: [{ name: 'Adaptive cruise', value_tier: 'high_value', retrofit: false, confidence_level: 'vehicle_data' }],
  seller_disclosures: [{ unit: 'engine', quote: 'Engine is fine.', negated: true, vague: false }],
  market_value: { liquidity: { level: 'medium', reasons: ['Popular model.'] } },
  _meta: {
    lang: 'ru', country: 'UA', domain: 'auto.ria.com', vin: 'WAUZZZ8K0DA000001', price: 12500, currency: 'USD', odometer_km: 180000, seller_text: 'Good car, one owner in Ukraine.',
    history_facts: { owners_count: 3, owner_events: [{ date: '2014-04-01', ordinal: 1 }, { date: '2019-05-02', ordinal: 2 }, { date: '2024-01-10', ordinal: 3 }], registry_present: true, past_listings: 2, mileage_points: [{ km: 120000, date: '2019-05-02', source: 'registry' }] },
    decision_inputs: { mileage_context: { band: 'normal', age_years: 13, annual_km: 14000, reference_km_year: 15000, current_km: 180000, historical_points: [] }, personal_context: 'excluded' },
    price_context: { currency: 'USD', average_price: 13000, delta_percent: -4, source_name: 'AUTO.RIA' },
    vehicle_spec: { fields: {
      fuel: { value: 'petrol', strength: 'strong', conflict: false },
      forced_induction: { value: 'turbo', strength: 'strong', conflict: false },
      drivetrain: { value: null, strength: null, conflict: false },
      transmission: { value: 'automatic', strength: 'strong', conflict: false },
      transmission_type: { value: 'automatic', exact: false, candidates: [{ value: 'cvt' }, { value: 'automatic' }] },
      version: { value: null, strength: null, conflict: true, candidates: [{ value: 'Premium', raw: 'Premium' }, { value: 'S line', raw: 'S line' }] },
      power_hp: { value: 220, strength: 'strong', conflict: false },
    }, conflicts: ['version'], unknown: ['drivetrain'], decoder: { present: true, strong: true } },
    final_conclusion: { version: 'fc-v2.3', model: 'gpt-6.1-sol' },
    timings: { final_conclusion: { ms: 17462, status: 'executed', ai: { model: 'gpt-6.1-sol', input_tokens: 6953, output_tokens: 1020, reasoning_tokens: 430 } } },
  },
};
const CONTROL_CHECKS = [{ text: 'Do a cold start and listen for timing chain rattle in the first seconds, since chain stretch is the known concern of this engine.', area: 'powertrain', refines: 1 }];
const SHADOW_CHECKS = [{ text: 'Ask for invoices of the timing chain work the seller reports, to confirm what was replaced.', area: 'service_history', refines: null }, { text: 'Check the paint thickness on the doors.', area: 'cosmetic', refines: null }];
const OPENAI_GOOD = { choices: [{ message: { content: JSON.stringify({ headline: 'Control headline', paragraphs: ['Control one.', 'Control two.'], checks: CONTROL_CHECKS }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 30 } }, model: 'gpt-6.1-sol' };
const anthropicGood = (over = {}) => ({ type: 'message', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ headline: 'Shadow headline', paragraphs: ['Shadow one.', 'Shadow two.'], checks: SHADOW_CHECKS }) }], usage: { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, http_status: 200, ...over });
const ENV = { ANTHROPIC_API_KEY: 'sk-ant-TEST-SECRET', OPENAI_API_KEY: 'sk-TEST-SECRET', FINAL_CONCLUSION: 'on' };

(async () => {
  const A = await import('file://' + path.join(dir, 'api', 'conclusion-anthropic.js'));
  const S = await import('file://' + path.join(dir, 'api', 'conclusion-shadow.js'));
  const C = await import('file://' + path.join(dir, 'api', 'conclusion-checks.js'));
  const F = await import('file://' + path.join(dir, 'api', 'conclusion.js'));

  /* ---------- Anthropic body: same rules, same user message, same schema ---------- */
  const body = A.anthropicConclusionBody({ system: 'RULES', user: 'USER', model: 'claude-opus-5-5', effort: 'medium' });
  ok(body.model === 'claude-opus-5-5' && body.max_tokens === 12000, 'model or output budget differ from the production call');
  ok(Array.isArray(body.system) && body.system.length === 1 && body.system[0].text === 'RULES' && body.system[0].cache_control && body.system[0].cache_control.type === 'ephemeral', 'rules are not the system block with a cache breakpoint');
  ok(body.messages.length === 1 && body.messages[0].role === 'user' && body.messages[0].content === 'USER', 'user message is not the single user turn');
  ok(body.output_config && body.output_config.effort === 'medium' && body.output_config.format.type === 'json_schema' && JSON.stringify(body.output_config.format.schema) === JSON.stringify(F.conclusionResponseFormat().json_schema.schema), 'schema or effort differ from the production call');
  ok(F.CONCLUSION_VERSION === 'fc-v2.5' && body.output_config.format.schema.required.join() === 'headline,paragraphs,checks' && body.output_config.format.schema.properties.checks.items.required.join() === 'text,area,refines', 'shadow schema is not the fc-v2.5 schema with checks');
  for (const k of ['thinking', 'temperature', 'top_p', 'tools', 'tool_choice', 'fallbacks', 'stream', 'metadata']) ok(!(k in body), 'unexpected request field ' + k);
  const cfg = A.anthropicConclusionModel({});
  ok(cfg.model === 'claude-opus-5-5' && cfg.effort === 'medium', 'defaults are not claude-opus-5-5 medium');
  ok(A.anthropicConclusionModel({ CONCLUSION_ANTHROPIC_MODEL: 'claude-sonnet-5-5', CONCLUSION_ANTHROPIC_EFFORT: 'high' }).model === 'claude-sonnet-5-5' && A.anthropicConclusionModel({ CONCLUSION_ANTHROPIC_EFFORT: 'high' }).effort === 'high', 'env does not switch the shadow model or effort');
  ok(A.anthropicConclusionModel({ CONCLUSION_ANTHROPIC_MODEL: 'gpt-6.1-sol', CONCLUSION_ANTHROPIC_EFFORT: 'turbo' }).model === 'claude-opus-5-5' && A.anthropicConclusionModel({ CONCLUSION_ANTHROPIC_EFFORT: 'turbo' }).effort === 'medium', 'invalid env values are not ignored');

  /* ---------- run: success, usage, failures, retries, no fallback ---------- */
  const seen = [];
  const r1 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async (b, ms, signal) => { seen.push([b, ms, signal]); return anthropicGood(); } });
  ok(r1.status === 'ok' && r1.conclusion.headline === 'Shadow headline' && r1.conclusion.body === 'Shadow one.\n\nShadow two.', 'successful call gives no conclusion: ' + JSON.stringify(r1));
  ok(Array.isArray(r1.conclusion.checks) && r1.conclusion.checks.length === 2 && r1.conclusion.checks[0].area === 'service_history', 'shadow checks are lost by the parser');
  ok(r1.ai.provider === 'anthropic' && r1.ai.model === 'claude-opus-5-5' && r1.ai.input_tokens === 120 && r1.ai.output_tokens === 60 && r1.ai.cached_tokens === 100 && r1.ai.reasoning_tokens === null && r1.ai.reasoning_effort === 'medium', 'usage mapping wrong: ' + JSON.stringify(r1.ai));
  ok(seen.length === 1 && typeof seen[0][1] === 'number' && seen[0][1] > 0 && r1.attempts.length === 1 && r1.attempts[0].ok === true && r1.attempts[0].http_status === 200, 'single successful attempt not recorded');
  ok(!JSON.stringify(r1).includes('SECRET') && !JSON.stringify(seen[0][0]).includes('SECRET'), 'the key leaked into the result or the body');
  const r2 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async () => anthropicGood({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }) });
  ok(r2.status === 'error' && r2.reason === 'refusal:cyber' && r2.attempts.length === 1 && r2.conclusion === null, 'refusal is not recorded as a failure without retry: ' + JSON.stringify(r2));
  const r3 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async () => anthropicGood({ stop_reason: 'max_tokens' }) });
  ok(r3.status === 'error' && r3.reason === 'max_tokens' && r3.attempts.length === 1, 'max_tokens is not a failure');
  let n4 = 0;
  const r4 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async () => { n4++; return { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' }, http_status: 529 }; } });
  ok(r4.status === 'error' && n4 === 2 && r4.attempts.length === 2 && /^api_error:overloaded_error/.test(r4.reason) && r4.attempts.every(a => a.model === 'claude-opus-5-5'), 'transient error is not retried once on the same model: ' + JSON.stringify(r4.attempts));
  let n5 = 0;
  const r5 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async () => { n5++; return { type: 'error', error: { type: 'invalid_request_error', message: 'bad' }, http_status: 400 }; } });
  ok(r5.status === 'error' && n5 === 1 && /^api_error:invalid_request_error/.test(r5.reason), 'a 400 is retried or hidden');
  let n6 = 0;
  const r6 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async () => { n6++; throw new Error('socket hang up'); } });
  ok(r6.status === 'error' && n6 === 2 && r6.reason === 'socket hang up', 'network failure not retried once or reason lost');
  const r7 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } });
  ok(r7.status === 'error' && r7.reason === 'timeout' && r7.attempts.length === 1, 'timeout is retried or mislabelled');
  const r8 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, callModel: async () => anthropicGood({ content: [{ type: 'text', text: 'not json' }] }) });
  ok(r8.status === 'error' && r8.reason === 'invalid_output' && r8.attempts.length === 1, 'invalid output is not a failure');
  const r9 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: { FINAL_CONCLUSION: 'on' } });
  ok(r9.status === 'skipped' && r9.reason === 'no_key', 'missing key does not skip');
  const r10 = await A.runAnthropicConclusion({ system: '', user: 'USER', env: ENV, callModel: async () => anthropicGood() });
  ok(r10.status === 'skipped' && r10.reason === 'no_input', 'empty input is sent');
  const r11 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, model: 'claude-sonnet-5-5', effort: 'high', callModel: async b => { seen.push([b]); return anthropicGood({ model: 'claude-sonnet-5-5' }); } });
  ok(r11.status === 'ok' && seen[seen.length - 1][0].model === 'claude-sonnet-5-5' && seen[seen.length - 1][0].output_config.effort === 'high' && r11.ai.model === 'claude-sonnet-5-5', 'explicit model or effort override ignored');
  const r12 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, model: 'gpt-4', callModel: async b => { seen.push([b]); return anthropicGood(); } });
  ok(seen[seen.length - 1][0].model === 'claude-opus-5-5' && r12.status === 'ok', 'a non-Anthropic model id is accepted for the shadow call');
  /* max_tokens: a benchmark may raise the ceiling, never lower it */
  ok(A.anthropicMaxTokens(null) === 12000 && A.anthropicMaxTokens(32000) === 32000 && A.anthropicMaxTokens(4000) === 12000 && A.anthropicMaxTokens(999999) === 12000 && A.anthropicMaxTokens('32000') === 12000, 'max_tokens ceiling not validated');
  const r13 = await A.runAnthropicConclusion({ system: 'RULES', user: 'USER', env: ENV, effort: 'max', maxTokens: 32000, callModel: async b => { seen.push([b]); return anthropicGood(); } });
  ok(seen[seen.length - 1][0].stream === true && !('stream' in A.anthropicConclusionBody({ system: 'R', user: 'U', model: 'claude-opus-5-5', effort: 'medium' })), 'a raised ceiling is not streamed or the default call streams');
  /* streaming: SSE is assembled into the same message shape; thinking deltas dropped */
  const SSE = [
    { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 300, cache_read_input_tokens: 7000, cache_creation_input_tokens: 0, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'SECRET THOUGHT' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"headline":"Max headline","paragraphs":["Max one."],' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '"checks":[]}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5400 } },
    { type: 'message_stop' },
  ];
  const asm = A.assembleAnthropicEvents(SSE);
  ok(asm.stop_reason === 'end_turn' && asm.model === 'claude-opus-5-5' && asm.content.length === 1 && asm.content[0].text.includes('Max headline') && !JSON.stringify(asm).includes('SECRET THOUGHT') && asm.usage.output_tokens === 5400 && asm.usage.cache_read_input_tokens === 7000, 'SSE assembly wrong: ' + JSON.stringify(asm));
  ok(A.assembleAnthropicEvents(SSE.slice(0, 5)).type === 'error' && A.assembleAnthropicEvents([...SSE.slice(0, 2), { type: 'error', error: { type: 'overloaded_error', message: 'x' } }]).error.type === 'overloaded_error', 'a cut or failed stream is not an error');
  const sseText = SSE.map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(sseText, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const streamed = await A.callAnthropic(A.anthropicConclusionBody({ system: 'R', user: 'U', model: 'claude-opus-5-5', effort: 'max', maxTokens: 32000, stream: true }), 5000, null, ENV);
  globalThis.fetch = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  const streamedErr = await A.callAnthropic(A.anthropicConclusionBody({ system: 'R', user: 'U', model: 'claude-opus-5-5', effort: 'max', maxTokens: 32000, stream: true }), 5000, null, ENV);
  globalThis.fetch = realFetch;
  const pStream = A.parseAnthropicConclusion(streamed);
  ok(streamed.http_status === 200 && pStream.clean && pStream.clean.headline === 'Max headline' && A.anthropicUsage(streamed, { model: 'claude-opus-5-5' }, 'max').output_tokens === 5400, 'streamed response not parsed into a conclusion');
  ok(streamedErr.http_status === 400 && /invalid_request_error/.test(A.parseAnthropicConclusion(streamedErr).error), 'an HTTP error on a streamed call is not reported');
  ok(r13.status === 'ok' && r13.max_tokens === 32000 && seen[seen.length - 1][0].max_tokens === 32000 && seen[seen.length - 1][0].output_config.effort === 'max' && r13.ai.reasoning_effort === 'max', 'effort max or raised ceiling does not reach the request');

  /* ---------- frozen input and the pair ---------- */
  const fz = S.freezeConclusionInput({ report: REPORT, langDirective: 'LANG.' });
  ok(fz && fz.system === F.CONCLUSION_RULES && fz.user === F.conclusionUserMessage({ langDirective: 'LANG.', context: F.buildConclusionContext(REPORT) }), 'frozen input is not built by the production functions');
  ok(JSON.stringify(fz.schema) === JSON.stringify(F.conclusionResponseFormat().json_schema.schema) && fz.input_hash === S.inputHash(fz.system, fz.user, fz.schema) && fz.input_hash !== S.inputHash(fz.system, fz.user, null), 'input hash does not cover the output schema');
  ok(fz.user.includes('"checklist":[{"n":1,"text":"Do a cold start and listen to the engine."}') && JSON.stringify(fz.checklist_snapshot) === JSON.stringify(REPORT.checklist), 'the numbered checklist does not reach the frozen input');
  ok(fz.input_hash === S.freezeConclusionInput({ report: REPORT, langDirective: 'LANG.' }).input_hash && fz.input_hash.length === 64 && fz.context_chars === fz.user.length && fz.rules_version === F.CONCLUSION_VERSION, 'input hash is not deterministic');
  const altered = JSON.parse(JSON.stringify(REPORT)); altered._meta.price = 12600;
  ok(S.freezeConclusionInput({ report: altered, langDirective: 'LANG.' }).input_hash !== fz.input_hash && S.freezeConclusionInput({ report: REPORT, langDirective: 'OTHER.' }).input_hash !== fz.input_hash, 'a changed report or directive keeps the same hash');
  ok(S.freezeConclusionInput({ report: null }) === null && S.freezeConclusionInput({ report: { vehicle: {} } }) === null, 'empty report is frozen');
  ok(!fz.user.includes('WAUZZZ8K0DA000001') && !fz.user.includes('Stored headline') && !fz.user.includes('old summary'), 'frozen input carries VIN or the stored conclusion');

  ok(S.shadowAvailability(REPORT).tier === 1, 'current-generation report is not tier 1');
  const noSpec = JSON.parse(JSON.stringify(REPORT)); delete noSpec._meta.vehicle_spec;
  ok(S.shadowAvailability(noSpec).available === true && S.shadowAvailability(noSpec).tier === 2, 'report without vehicle spec is not tier 2');
  const merged = JSON.parse(JSON.stringify(REPORT)); merged._meta.checklist_merge = { version: 'cm-v1', added: [{ source: 'final_conclusion', text: 'x' }], refined: [] };
  ok(S.shadowAvailability(merged).tier === 2 && S.shadowAvailability(merged).reason === 'checklist_after_merge', 'a report whose checklist was already merged is tier 1');
  const noFc = JSON.parse(JSON.stringify(REPORT)); delete noFc.final_conclusion;
  ok(S.shadowAvailability(noFc).available === false && S.shadowAvailability(noFc).reason === 'pre_final_conclusion_pipeline' && S.shadowAvailability(null).available === false, 'pre-Final-Conclusion report is not marked unavailable');
  const st = S.storedConclusionInfo(REPORT);
  ok(st.present === true && st.model === 'gpt-6.1-sol' && st.latency_ms === 17462 && st.input_tokens === 6953 && st.reasoning_tokens === 430, 'stored production call diagnostics not read');

  const openaiBodies = [], anthBodies = [];
  const pair = await S.runShadowPair({
    token: 'tok1', report: REPORT, lang: 'ru', langDirective: 'LANG.', env: ENV,
    callOpenAI: async b => { openaiBodies.push(b); return OPENAI_GOOD; },
    callAnthropic: async b => { anthBodies.push(b); return anthropicGood(); },
    applyLanguage: (t) => ({ headline: t.headline + ' [L]', body: t.body + ' [L]' }),
    directiveHits: () => [],
  });
  ok(pair.status === 'ok' && pair.schema === 'fc-shadow-pair-v2' && pair.report_id === 'tok1' && pair.vehicle.title === 'Audi A4 2013' && pair.vehicle.vin === 'WAUZZZ8K0DA000001' && pair.lang === 'ru', 'pair envelope wrong: ' + JSON.stringify({ s: pair.status, r: pair.reason }));
  ok(openaiBodies.length === 1 && anthBodies.length === 1, 'each provider is not called exactly once');
  ok(openaiBodies[0].messages[0].role === 'system' && openaiBodies[0].messages[0].content === fz.system && openaiBodies[0].messages[1].content === fz.user, 'control did not get the frozen input');
  ok(anthBodies[0].system[0].text === fz.system && anthBodies[0].messages[0].content === fz.user, 'shadow did not get the same bytes as the control');
  ok(pair.input.input_hash === fz.input_hash && pair.input.control_sent_hash === fz.input_hash && pair.input.shadow_sent_hash === fz.input_hash && pair.input.identical_input === true && pair.input.rules_version === 'fc-v2.5' && pair.input.schema_hash === fz.schema_hash && pair.input.control_attempts_sent === 1 && pair.input.shadow_attempts_sent === 1 && pair.input.checklist_snapshot_items === 2, 'pair does not prove identical input: ' + JSON.stringify(pair.input));
  /* a shadow that is sent something else is caught */
  const pairBad = await S.runShadowPair({ token: 'tokx', report: REPORT, lang: 'ru', langDirective: 'LANG.', env: ENV, callOpenAI: async () => OPENAI_GOOD,
    callAnthropic: async b => anthropicGood(), shadowModel: null });
  ok(pairBad.input.identical_input === true, 'identical input not proven for an unmodified shadow');
  const capBad = S.captureTransport(async () => anthropicGood());
  await capBad(A.anthropicConclusionBody({ system: fz.system, user: fz.user + ' ', model: 'claude-opus-5-5', effort: 'medium' }), 1000);
  ok(capBad.firstHash() !== fz.input_hash, 'a changed user message keeps the input hash');
  const capSchema = S.captureTransport(async () => anthropicGood());
  const bodyNoChecks = A.anthropicConclusionBody({ system: fz.system, user: fz.user, model: 'claude-opus-5-5', effort: 'medium' }); bodyNoChecks.output_config.format.schema = { type: 'object' };
  await capSchema(bodyNoChecks, 1000);
  ok(capSchema.firstHash() !== fz.input_hash, 'a changed schema keeps the input hash');
  /* shadow-only variant: the control is not called, the stored control is paired by hash */
  let openaiCalls = 0;
  const so = await S.runShadowPair({ token: 'tok1', report: REPORT, lang: 'ru', langDirective: 'LANG.', env: ENV, callOpenAI: async () => { openaiCalls++; return OPENAI_GOOD; }, callAnthropic: async () => anthropicGood(), shadowEffort: 'max', shadowMaxTokens: 32000, skipControl: true });
  ok(openaiCalls === 0 && so.control === null && so.status === 'ok' && so.input.control_skipped === true && so.input.identical_input === true && so.input.shadow_sent_hash === fz.input_hash && so.shadow.effort === 'max' && so.shadow.max_tokens === 32000 && so.checks.control === null, 'shadow-only run calls the control or loses the hash: ' + JSON.stringify(so.input));
  const comb = S.combineReusedControl(pair, so);
  ok(comb.status === 'ok' && comb.input.identical_input === true && comb.input.control_sent_hash === fz.input_hash && comb.input.shadow_sent_hash === fz.input_hash && comb.control === pair.control && comb.shadow === so.shadow && comb.checks.control === pair.checks.control, 'stored control and new shadow are not combined by hash');
  const otherReport = JSON.parse(JSON.stringify(REPORT)); otherReport._meta.price = 9999;
  const soOther = await S.runShadowPair({ token: 'tok1', report: otherReport, lang: 'ru', langDirective: 'LANG.', env: ENV, callOpenAI: async () => OPENAI_GOOD, callAnthropic: async () => anthropicGood(), skipControl: true });
  const combBad = S.combineReusedControl(pair, soOther);
  ok(combBad.input.identical_input === false && combBad.status === 'input_mismatch' && combBad.reason === 'input_hash_mismatch', 'a shadow on a different input is combined as identical');
  ok(S.combineReusedControl(null, so).status === 'unavailable' && S.combineReusedControl(pair, { ...so, report_id: 'other' }).input.identical_input === false, 'missing control or another report is combined');

  /* control unchanged: the body the pair sent is the body runFinalConclusion sends on its own */
  const alone = [];
  await F.runFinalConclusion({ report: REPORT, langDirective: 'LANG.', env: ENV, callModel: async b => { alone.push(b); return OPENAI_GOOD; } });
  ok(JSON.stringify(alone[0]) === JSON.stringify(openaiBodies[0]), 'control request differs from the production call');
  ok(pair.control.provider === 'openai' && pair.control.model === 'gpt-6.1-sol' && pair.control.requested_model === 'gpt-6.1-sol' && pair.control.effort === 'medium' && pair.control.prompt_version === F.CONCLUSION_VERSION && pair.control.status === 'ok', 'control record wrong: ' + JSON.stringify(pair.control));
  ok(pair.control.output.headline === 'Control headline [L]' && pair.control.output.body === 'Control one.\n\nControl two. [L]' && pair.control.input_tokens === 100 && pair.control.output_tokens === 50 && pair.control.cached_tokens === 80 && pair.control.reasoning_tokens === 30 && typeof pair.control.latency_ms === 'number' && pair.control.retries === 0, 'control output or usage wrong');
  ok(pair.shadow.provider === 'anthropic' && pair.shadow.model === 'claude-opus-5-5' && pair.shadow.effort === 'medium' && pair.shadow.prompt_version === F.CONCLUSION_VERSION && pair.shadow.status === 'ok' && pair.shadow.output.headline === 'Shadow headline [L]' && pair.shadow.input_tokens === 120 && pair.shadow.cached_tokens === 100 && pair.shadow.reasoning_tokens === null && pair.shadow.stop_reason === 'end_turn', 'shadow record wrong: ' + JSON.stringify(pair.shadow));
  ok(pair.checks && pair.checks.control && typeof pair.checks.control.total === 'number' && pair.checks.shadow && typeof pair.checks.shadow.total === 'number' && pair.checks.control.gate && pair.checks.shadow.gate, 'checks missing for a side');
  /* checks preview: the production sanitizer and merge on a copy */
  const cpC = pair.control.checks_preview, cpS = pair.shadow.checks_preview;
  ok(pair.control.output.checks.length === 1 && cpC && cpC.raw.length === 1 && cpC.accepted.length === 1 && cpC.refined.length === 1 && cpC.refined[0].from === REPORT.checklist[0] && cpC.checklist_after[0] === CONTROL_CHECKS[0].text, 'control refinement is not previewed: ' + JSON.stringify(cpC));
  ok(cpS && cpS.raw.length === 2 && cpS.accepted.length === 1 && cpS.rejected.length === 1 && cpS.rejected[0].reason === 'not_material' && cpS.added.length === 1 && cpS.added[0].text === SHADOW_CHECKS[0].text && cpS.checklist_after.includes(SHADOW_CHECKS[0].text), 'shadow additions or rejections are not previewed: ' + JSON.stringify(cpS));
  ok(JSON.stringify(REPORT.checklist) === JSON.stringify(['Do a cold start and listen to the engine.', 'Check the service book for regular oil changes.']), 'the merge preview mutated the stored report');
  ok(pair.stored_conclusion.present === true && pair.availability.tier === 1, 'pair lost the stored call diagnostics or availability');
  ok(!JSON.stringify(pair).includes('SECRET'), 'a key leaked into the pair');
  const pairFail = await S.runShadowPair({ token: 'tok2', report: REPORT, lang: 'ru', langDirective: 'LANG.', env: ENV, callOpenAI: async () => OPENAI_GOOD, callAnthropic: async () => ({ type: 'error', error: { type: 'authentication_error', message: 'bad key' }, http_status: 401 }) });
  ok(pairFail.status === 'partial' && pairFail.control.status === 'ok' && pairFail.shadow.status === 'error' && /authentication_error/.test(pairFail.shadow.reason) && pairFail.shadow.output === null && pairFail.checks.shadow === null && pairFail.checks.control, 'shadow failure is not isolated: ' + JSON.stringify({ s: pairFail.status, r: pairFail.shadow.reason }));
  const pairUn = await S.runShadowPair({ token: 'tok3', report: noFc, lang: 'ru', langDirective: 'LANG.', env: ENV, callOpenAI: async () => OPENAI_GOOD, callAnthropic: async () => anthropicGood() });
  ok(pairUn.status === 'unavailable' && pairUn.reason === 'pre_final_conclusion_pipeline' && pairUn.control === null && pairUn.shadow === null, 'unavailable report is run anyway');
  const anth2 = [];
  await S.runShadowPair({ token: 'tok4', report: REPORT, lang: 'ru', langDirective: 'LANG.', env: ENV, callOpenAI: async () => OPENAI_GOOD, callAnthropic: async b => { anth2.push(b); return anthropicGood(); }, shadowModel: 'claude-sonnet-5-5', shadowEffort: 'high' });
  ok(anth2[0].model === 'claude-sonnet-5-5' && anth2[0].output_config.effort === 'high', 'shadow model/effort override does not reach the request');

  /* ---------- deterministic checks ---------- */
  const ctx = F.buildConclusionContext(REPORT);
  const chk = (body, report = REPORT, c = ctx, directive = null) => C.conclusionInvariantChecks({ text: { headline: 'H', body }, report, context: c, directiveHits: directive });
  const kinds = r => r.violations.map(v => v.check + ':' + v.domain + ':' + v.found + '>' + v.canonical);
  ok(chk('A tidy sedan with a known history.').total === 0, 'clean text is flagged: ' + JSON.stringify(kinds(chk('A tidy sedan with a known history.'))));
  ok(kinds(chk('This is the S line version, which adds sport seats.')).includes('gate:identity_conflict:S line>conflict'), 'a candidate picked from an identity conflict is not flagged');
  ok(kinds(chk('This car is a diesel with a frugal engine.')).includes('gate:fuel:diesel>petrol'), 'changed resolved identity is not flagged');
  ok(kinds(chk('The car is all-wheel drive, which helps in winter.')).includes('gate:identity_unknown:awd>unknown'), 'unknown turned into fact is not flagged');
  ok(kinds(chk('Airbags deployed in the rear collision.')).includes('gate:airbags:deployed>not_deployed'), 'airbag contradiction is not flagged');
  ok(kinds(chk('The seller says the car is a diesel.')).length === 0 && kinds(chk('It may be the S line version.')).length === 0, 'reported speech or a hedge is treated as a claim');
  ok(kinds(chk('CalCar score 7.5/10 reflects this.')).includes('score:score:7.5>8.2') && kinds(chk('The score of 8.2 out of 10 is fair.')).length === 0, 'score contradiction not flagged or the right score flagged');
  ok(kinds(chk('The check is 80% complete.')).includes('confidence:confidence:80>62') && kinds(chk('Priced 4% below the marketplace average.')).length === 0, 'confidence contradiction not flagged or a price percent flagged');
  ok(kinds(chk('The car had one owner from new.')).includes('owners:owners:1>3') && kinds(chk('Three owners are recorded in the registry.')).length === 0 && kinds(chk('The seller claims one owner.')).length === 0, 'owners contradiction wrong');
  const ctxNoOwners = JSON.parse(JSON.stringify(ctx)); delete ctxNoOwners.ownership;
  ok(kinds(chk('The car had two owners.', REPORT, ctxNoOwners)).includes('owners:owners:2>unknown'), 'owners stated without a registry count is not flagged');
  ok(kinds(chk('The car survived a severe accident with structural damage.')).includes('severity:accident_severity:heavy>light'), 'overstated severity is not flagged');
  ok(kinds(chk('Signs of flood damage in the cabin.')).includes('not_in_input:flood:flood>absent_from_input'), 'critical problem absent from the input is not flagged');
  ok(kinds(chk('There are no signs of flood damage.')).length === 0 && kinds(chk('Check the cabin for flood damage before buying.')).length === 0, 'negated or hedged critical term is flagged');
  const ctxFire = JSON.parse(JSON.stringify(ctx)); ctxFire.accidents = { events: [{ severity: 'light', fire: true }] };
  ok(kinds(chk('The fire damage was repaired.', REPORT, ctxFire)).length === 0, 'a fire present in the input is flagged');
  const dres = chk('Buy it.', REPORT, ctx, () => [{ field: 'reasoning', phrase: 'Buy it' }]);
  ok(dres.directive.length === 1 && dres.total === 1 && dres.counts.directive === 1, 'directive detector result is not counted');
  const inChecks = C.conclusionInvariantChecks({ text: { headline: 'H', body: 'A tidy sedan.', checks: ['Confirm the diesel injectors were serviced.', 'Ask whether the S line package is fitted.'] }, report: REPORT, context: ctx });
  ok(inChecks.violations.some(v => v.where === 'checks' && v.check === 'gate' && v.domain === 'fuel' && v.found === 'diesel') && inChecks.violations.every(v => v.where === 'checks'), 'a check line contradicting canonical identity is not flagged as checks: ' + JSON.stringify(inChecks.violations));
  ok(C.conclusionInvariantChecks({ text: { headline: 'H', body: 'Body.', checks: ['Score 7/10 means trouble.'] }, report: REPORT, context: ctx }).violations.filter(v => v.check === 'score').length === 1, 'one score figure is flagged twice');
  ok(kinds(chk('Следов затопления не видно.')).length === 0, 'a postpositive negation is flagged');
  /* fc-checks-v1.1: tenure with one owner is not the total count (real Santa Fe output, registry 3) */
  ok(kinds(chk('С 2019 года она уже семь с половиной лет у одного хозяина.')).length === 0 && kinds(chk('It has been with one owner since 2019.')).length === 0, 'tenure with one owner is flagged as an owners count');
  /* fc-checks-v1.2: a year is not an owners figure (real Prado output: "с 2007 года один владелец") */
  ok(!kinds(chk('По реестру у машины с 2007 года три владельца.')).some(k => k.startsWith('owners:owners:7')) && kinds(chk('По реестру у машины с 2007 года один владелец.')).includes('owners:owners:1>3'), 'a year is read as an owners count');
  ok(kinds(chk('У машины был один владелец.')).includes('owners:owners:1>3') && kinds(chk('Машина сменила двух владельцев.')).includes('owners:owners:2>3') && kinds(chk('Зарегистрированы три владельца.')).length === 0, 'Russian owner counts are not read');
  ok(C.conclusionInvariantChecks({ text: null }).total === 0 && C.conclusionInvariantChecks({ text: { headline: 'H', body: '' } }).total === 0, 'empty text is not a clean result');

  /* ---------- blind artifact ---------- */
  const pairs = [pair, await S.runShadowPair({ token: 'tok5', report: REPORT, lang: 'ru', langDirective: 'LANG.', env: ENV, callOpenAI: async () => OPENAI_GOOD, callAnthropic: async () => anthropicGood() })];
  const coins = [true, false];
  const { blind, key } = S.blindPairs(pairs, () => coins.shift());
  ok(blind.length === 2 && key.length === 2 && key[0].A === 'control' && key[0].B === 'shadow' && key[1].A === 'shadow' && key[1].B === 'control', 'A/B assignment does not follow the coin');
  ok(blind[0].A.output.headline === 'Control headline [L]' && blind[1].A.output.headline === 'Shadow headline', 'blind sides do not match the key');
  const bj = JSON.stringify(blind);
  ok(!S.PROVIDER_WORDS.test(bj) && !/latency|tokens|model|provider|attempts|openai|anthropic/i.test(bj), 'blind payload carries a provider signal');
  ok(blind[0].A.flags && typeof blind[0].A.flags.total === 'number' && blind[0].input_hash === fz.input_hash && blind[0].identical_input === true, 'blind payload lost the flags or the hash');
  ok(blind[0].A.checks && blind[0].A.checks.returned.length === 1 && blind[0].A.checks.refined.length === 1 && blind[1].A.checks.added.length === 1 && blind[1].A.checks.rejected.length === 1, 'blind payload lost the returned checks');
  ok(S.blindPairs([pairUn]).blind.length === 0, 'an unavailable pair enters the blind set');

  /* ---------- wiring: production path untouched, endpoint read-only, no secrets in logs ---------- */
  const checkSrc = fs.readFileSync('api/check.js', 'utf8');
  ok(!/conclusion-anthropic|conclusion-shadow|conclusion-checks|anthropic/i.test(checkSrc), 'api/check.js reaches the shadow modules');
  const benchSrc = fs.readFileSync('api/conclusion-bench.js', 'utf8');
  ok(/mode === 'shadow'/.test(benchSrc) && /mode === 'input'/.test(benchSrc) && /['"]input['"], ['"]shadow['"]\]\.includes\(b\.mode\)/.test(benchSrc), 'bench has no input/shadow modes');
  ok(/export async function callModel/.test(benchSrc), 'bench transport is not reusable by the local runner');
  ok(/schema_hash: frozen\.schema_hash/.test(benchSrc), 'bench input mode does not expose the schema hash');
  ok(/export const config = \{ maxDuration: 800 \};/.test(benchSrc) && /const shadowTimeout = skipControl && Number\.isInteger\(b\.shadow_timeout_ms\)/.test(benchSrc) && /: 270000;/.test(benchSrc) && /timeoutMs: shadowTimeout/.test(benchSrc), 'only a shadow-only bench run may use the longer budget');
  const bench = await import('file://' + path.join(dir, 'api', 'conclusion-bench.js'));
  ok(bench.SHADOW_ONLY_TIMEOUT_MS.max === 780000 && bench.SHADOW_ONLY_TIMEOUT_MS.max < bench.config.maxDuration * 1000, 'shadow-only budget does not fit the function limit');
  ok(/if \(shadowTimeout > 270000\) \{/.test(benchSrc) && /res\.write\(' '\);/.test(benchSrc) && /finally \{ if \(beat\) clearInterval\(beat\); \}/.test(benchSrc) && /if \(beat\) return res\.end\(JSON\.stringify/.test(benchSrc) && /if \(res\.headersSent\) return res\.end/.test(benchSrc) && bench.HEARTBEAT_MS <= 30000, 'a long shadow-only run does not keep the connection alive or leaks the timer');
  ok(JSON.parse('   ' + JSON.stringify({ ok: true })).ok === true, 'leading heartbeat spaces break the JSON answer');
  /* the handler end to end: shadow-only with a long budget streams spaces, then a parseable pair; OpenAI is never called */
  {
    const saved = { ...process.env };
    Object.assign(process.env, { BENCH_KEY: 'bench-test-key', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc-test', OPENAI_API_KEY: 'sk-TEST-SECRET', ANTHROPIC_API_KEY: 'sk-ant-TEST-SECRET' });
    const calls = [];
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('/rest/v1/check_jobs')) return new Response(JSON.stringify([{ report: JSON.parse(JSON.stringify(REPORT)), lang: 'ru' }]), { status: 200, headers: { 'content-type': 'application/json' } });
      if (String(url).includes('api.anthropic.com')) return new Response(sseText, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return new Response('{}', { status: 500 });
    };
    const chunks = []; let ended = false;
    const res = { statusCode: 0, headers: {}, get headersSent() { return chunks.length > 0; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, write(c) { chunks.push(String(c)); }, end(c) { if (c) chunks.push(String(c)); ended = true; }, status(code) { this.statusCode = code; return this; }, json(o) { chunks.push(JSON.stringify(o)); ended = true; return this; } };
    await bench.default({ method: 'POST', headers: { 'x-calcar-bench': 'bench-test-key' }, body: { job_token: 'abcdefghijklmnop1234', mode: 'shadow', skip_control: true, shadow_effort: 'max', shadow_max_tokens: 32000, shadow_timeout_ms: 780000 } }, res);
    globalThis.fetch = realFetch2;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    const raw = chunks.join('');
    let parsed = null; try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    ok(ended && chunks[0] === ' ' && res.headers['content-type'].startsWith('application/json') && parsed && parsed.status === 'ok' && parsed.control === null && parsed.input.control_skipped === true && parsed.input.identical_input === true && parsed.shadow.effort === 'max' && parsed.shadow.max_tokens === 32000 && parsed.shadow.output.headline === 'Max headline', 'shadow-only heartbeat answer is not a parseable pair: ' + raw.slice(0, 300));
    ok(!calls.some(u => u.includes('api.openai.com')) && calls.filter(u => u.includes('api.anthropic.com')).length === 1 && !raw.includes('SECRET'), 'shadow-only handler called OpenAI, retried Anthropic or leaked a key');
  }
  ok(/const skipControl = b\.skip_control === true;/.test(benchSrc) && /shadowMaxTokens, skipControl/.test(benchSrc) && /Number\.isInteger\(b\.shadow_max_tokens\)/.test(benchSrc), 'bench does not pass the shadow-only options');
  ok((benchSrc.match(/method: 'POST'/g) || []).length === 1 && !/method: 'P(?:ATCH|UT)'|method: 'DELETE'|writeFile|\/rest\/v1\/reports/.test(benchSrc), 'bench writes somewhere');
  ok(benchSrc.indexOf('benchAllowed(req, process.env)') < benchSrc.indexOf("mode === 'shadow'") && /callAnthropic: null/.test(benchSrc) && /applyLanguage: applyConclusionLanguage, directiveHits: directiveVerdictHits/.test(benchSrc), 'shadow mode is reachable without the key or skips production post-processing');
  ok(!/ANTHROPIC_API_KEY/.test(benchSrc.replace(/!!process\.env\.ANTHROPIC_API_KEY/g, '')), 'bench exposes more than the presence of the key');
  const anthSrc = fs.readFileSync('api/conclusion-anthropic.js', 'utf8');
  ok(!/export default/.test(anthSrc) && !/export default/.test(fs.readFileSync('api/conclusion-shadow.js', 'utf8')) && !/export default/.test(fs.readFileSync('api/conclusion-checks.js', 'utf8')), 'a shadow module became a Vercel function');
  ok((anthSrc.match(/ANTHROPIC_API_KEY/g) || []).length === 2 && !/console\.log\([^)]*ANTHROPIC/.test(anthSrc) && !/fallbacks|server-side-fallback/.test(anthSrc), 'the key is used outside the transport or a fallback model is configured');
  ok(/anthropic-version['"]?: ANTHROPIC_VERSION/.test(anthSrc) && /x-api-key/.test(anthSrc), 'required Messages API headers missing');
  for (const f of ['api/conclusion-anthropic.js', 'api/conclusion-shadow.js', 'api/conclusion-checks.js', 'api/conclusion-bench.js', 'fc-shadow-bench.js', 'fcshadowtest.js']) ok(!fs.readFileSync(f, 'utf8').includes(DASH), 'em dash in ' + f);
  const runnerSrc = fs.readFileSync('fc-shadow-bench.js', 'utf8');
  ok(!/\/rest\/v1\/|supabase/i.test(runnerSrc) && /mode: 'shadow'/.test(runnerSrc) && /x-calcar-bench/.test(runnerSrc) && /key\.json/.test(runnerSrc) && /blind\.html/.test(runnerSrc), 'runner touches the database or lacks the blind artifact');

  if (errs.length) { console.log('FC SHADOW TEST FAILED:'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('fc shadow: same rules, user message and schema on both providers · control request byte-identical to production · input hash proven from what was sent · refusal/max_tokens/API/timeout recorded, transient retried once, no fallback model · no key in results · invariant checks flag conflicts, identity, airbags, score, confidence, owners, severity, absent problems · blind artifact without provider signal · check.js untouched, bench read-only');
})().catch(e => { console.log('FC SHADOW TEST CRASHED:', e); process.exit(1); });
