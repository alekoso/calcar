/* CalCar Check: shadow A/B of the Final Conclusion, one frozen input for
   two providers.

   The control is the production OpenAI Final Conclusion exactly as
   api/check.js runs it (runFinalConclusion, CONCLUSION_RULES, production
   model and effort, the same json_schema with the fc-v2.5 checks field).
   The shadow is the Anthropic provider (api/conclusion-anthropic.js). Both
   receive the same rules, the same report context and the same schema:
   - freezeConclusionInput() builds them from the stored report with the
     production functions and hashes all three (input_hash);
   - captureTransport() wraps each provider's transport and records what
     the call actually sent, so the pair carries proof
     (control_sent_hash === shadow_sent_hash === input_hash) instead of an
     assumption.
   The checks each provider returns are run through the production
   checklist merge (checklist-merge.js) on a copy of the report, so the
   pair shows the final checklist each provider would have produced.

   Nothing is written anywhere: callers persist the returned pair. Not a
   Vercel function. */

import { createHash } from 'node:crypto';
import { CONCLUSION_RULES, CONCLUSION_VERSION, buildConclusionContext, conclusionUserMessage, conclusionModel, conclusionResponseFormat, runFinalConclusion } from './conclusion.js';
import { runAnthropicConclusion, anthropicConclusionModel, callAnthropic as realCallAnthropic } from './conclusion-anthropic.js';
import { conclusionInvariantChecks } from './conclusion-checks.js';
import { sanitizeFcChecks, mergeChecklist, CHECKLIST_MERGE_VERSION } from './checklist-merge.js';

export const SHADOW_PAIR_SCHEMA = 'fc-shadow-pair-v2';
export const SHADOW_TIMEOUT_MS = 270000;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);

export const sha256 = s => createHash('sha256').update(String(s), 'utf8').digest('hex');
/* the hash covers everything the model is given: rules, user message, output schema */
export function inputHash(system, user, schema) { return sha256(JSON.stringify([String(system), String(user), schema === undefined ? null : schema])); }

/* the checklist snapshot the conclusion is shown, derived exactly like runFinalConclusion */
export function checklistSnapshot(report) {
  return (isObj(report) && Array.isArray(report.checklist) ? report.checklist : []).filter(t => typeof t === 'string' && t.trim()).slice(0, 8).map(t => t.trim());
}

export function freezeConclusionInput({ report, langDirective = '' } = {}) {
  let context = null;
  try { context = buildConclusionContext(report); } catch (e) { context = null; }
  if (!context || !context.vehicle) return null;
  const system = CONCLUSION_RULES;
  const user = conclusionUserMessage({ langDirective, context });
  const schema = conclusionResponseFormat().json_schema.schema;
  return {
    system, user, schema, context, checklist_snapshot: checklistSnapshot(report),
    input_hash: inputHash(system, user, schema), rules_version: CONCLUSION_VERSION, rules_hash: sha256(system), schema_hash: sha256(JSON.stringify(schema)), context_chars: user.length,
  };
}

/* rules, user message and schema of a request body, for either provider's wire format */
export function sentInput(body) {
  if (!isObj(body)) return null;
  if (Array.isArray(body.messages) && body.messages.some(m => m && m.role === 'system')) {
    /* OpenAI chat completions */
    const sys = body.messages.find(m => m && m.role === 'system');
    const usr = body.messages.find(m => m && m.role === 'user');
    const schema = body.response_format && body.response_format.json_schema ? body.response_format.json_schema.schema : null;
    return { system: sys && typeof sys.content === 'string' ? sys.content : null, user: usr && typeof usr.content === 'string' ? usr.content : null, schema };
  }
  /* Anthropic Messages API */
  const system = Array.isArray(body.system) ? body.system.filter(b => b && b.type === 'text').map(b => b.text).join('') : (typeof body.system === 'string' ? body.system : null);
  const usr = arr(body.messages).find(m => m && m.role === 'user');
  const schema = body.output_config && body.output_config.format ? body.output_config.format.schema : null;
  return { system, user: usr && typeof usr.content === 'string' ? usr.content : null, schema };
}

/* wraps a transport; `sent` keeps what every attempt carried */
export function captureTransport(call) {
  const sent = [];
  const wrapped = (body, ms, signal) => {
    const s = sentInput(body) || {};
    sent.push({ model: body && body.model, effort: (body && (body.reasoning_effort || (body.output_config && body.output_config.effort))) || null, ...s });
    return call(body, ms, signal);
  };
  wrapped.sent = sent;
  wrapped.firstHash = () => (sent.length && sent[0].system !== null && sent[0].user !== null ? inputHash(sent[0].system, sent[0].user, sent[0].schema === undefined ? null : sent[0].schema) : null);
  /* every attempt (retries, fallback model) must carry the same input */
  wrapped.allSame = () => sent.length > 0 && sent.every(x => inputHash(x.system, x.user, x.schema === undefined ? null : x.schema) === wrapped.firstHash());
  return wrapped;
}

/* checks of one provider -> what production would do with them: the
   sanitizer, then the checklist merge on a copy of the report */
export function checksPreview(conclusion, report, snapshot, lang) {
  const raw = isObj(conclusion) && Array.isArray(conclusion.checks) ? conclusion.checks : [];
  const fcc = sanitizeFcChecks(raw, snapshot.length);
  const copy = JSON.parse(JSON.stringify({ checklist: isObj(report) && Array.isArray(report.checklist) ? report.checklist : [], risks: isObj(report) && Array.isArray(report.risks) ? report.risks : [], _meta: { vehicle_spec: isObj(report) && isObj(report._meta) ? report._meta.vehicle_spec || null : null } }));
  const log = mergeChecklist(copy, { fcChecks: fcc.checks, snapshot, lang });
  return {
    version: CHECKLIST_MERGE_VERSION,
    raw: raw.map(c => (isObj(c) ? { text: typeof c.text === 'string' ? c.text : null, area: c.area || null, refines: c.refines === undefined ? null : c.refines } : null)).filter(Boolean),
    accepted: fcc.checks, rejected: fcc.rejected,
    refined: log.refined, added: log.added.filter(a => a.source === 'final_conclusion'), skipped: log.skipped.filter(s => s.source === 'final_conclusion'),
    checklist_after: copy.checklist,
  };
}

/* one provider's run -> the stored record (no secrets, no raw bodies) */
export function providerRecord(run, { provider, requested_model, effort, prompt_version }) {
  const r = isObj(run) ? run : { status: 'error', reason: 'no_result', attempts: [] };
  const ai = isObj(r.ai) ? r.ai : {};
  const attempts = arr(r.attempts);
  return {
    provider,
    model: ai.model || (attempts[0] && attempts[0].model) || requested_model || null,
    requested_model: requested_model || null,
    effort: ai.reasoning_effort || effort || null,
    prompt_version,
    status: r.status || 'error',
    reason: r.reason || null,
    output: r.status === 'ok' && isObj(r.conclusion) ? { headline: r.conclusion.headline, body: r.conclusion.body, truncated: r.conclusion.truncated === true, checks: Array.isArray(r.conclusion.checks) ? r.conclusion.checks : [] } : null,
    latency_ms: typeof r.ms === 'number' ? r.ms : null,
    attempts: attempts.map(a => ({ model: a.model, effort: a.effort || null, ms: a.ms, ok: !!a.ok, error: a.error || null, http_status: a.http_status || null, stop_reason: a.stop_reason || null })),
    retries: Math.max(0, attempts.length - 1),
    input_tokens: typeof ai.input_tokens === 'number' ? ai.input_tokens : null,
    output_tokens: typeof ai.output_tokens === 'number' ? ai.output_tokens : null,
    cached_tokens: typeof ai.cached_tokens === 'number' ? ai.cached_tokens : null,
    cache_creation_tokens: typeof ai.cache_creation_tokens === 'number' ? ai.cache_creation_tokens : null,
    reasoning_tokens: typeof ai.reasoning_tokens === 'number' ? ai.reasoning_tokens : null,
    stop_reason: r.stop_reason || null,
  };
}

/* the historical production call of this report, from the stored diagnostics */
export function storedConclusionInfo(report) {
  const meta = isObj(report) && isObj(report._meta) ? report._meta : {};
  const fc = isObj(meta.final_conclusion) ? meta.final_conclusion : {};
  const t = isObj(meta.timings) && isObj(meta.timings.final_conclusion) ? meta.timings.final_conclusion : {};
  const ai = isObj(t.ai) ? t.ai : {};
  return {
    present: isObj(report) && isObj(report.final_conclusion) && typeof report.final_conclusion.body === 'string',
    version: fc.version || null, model: fc.model || ai.model || null, status: fc.status || (fc.version ? 'ok' : null), reason: fc.reason || null,
    latency_ms: typeof t.ms === 'number' ? t.ms : null,
    input_tokens: typeof ai.input_tokens === 'number' ? ai.input_tokens : null, output_tokens: typeof ai.output_tokens === 'number' ? ai.output_tokens : null,
    reasoning_tokens: typeof ai.reasoning_tokens === 'number' ? ai.reasoning_tokens : null, cached_tokens: typeof ai.cached_tokens === 'number' ? ai.cached_tokens : null,
  };
}

/* availability of a stored report for this benchmark: the input must be
   rebuilt from frozen facts only, so a report has to come from the same
   pipeline generation as production (Final Conclusion era, canonical
   vehicle spec present). Older reports are flagged, not silently adapted.
   A report whose checklist was already merged with a conclusion's checks
   (fc-v2.5+) no longer holds the checklist that conclusion was shown */
export function shadowAvailability(report) {
  if (!isObj(report) || !isObj(report.vehicle)) return { available: false, tier: null, reason: 'no_report' };
  if (!Object.prototype.hasOwnProperty.call(report, 'final_conclusion')) return { available: false, tier: null, reason: 'pre_final_conclusion_pipeline' };
  const meta = isObj(report._meta) ? report._meta : {};
  if (!isObj(meta.vehicle_spec) || !isObj(meta.vehicle_spec.fields)) return { available: true, tier: 2, reason: 'no_vehicle_spec_identity_block_absent' };
  if (!isObj(report.score_breakdown) || !isObj(report.confidence)) return { available: true, tier: 2, reason: 'score_or_confidence_missing' };
  const cm = isObj(meta.checklist_merge) ? meta.checklist_merge : null;
  if (cm && (arr(cm.added).length || arr(cm.refined).length)) return { available: true, tier: 2, reason: 'checklist_after_merge' };
  return { available: true, tier: 1, reason: null };
}

/* Runs control and shadow on one stored report. `callOpenAI` is the
   production transport (the same function api/check.js and the bench use),
   `callAnthropic` the shadow transport or null for the real one.
   `applyLanguage` and `directiveHits` are the production post-processing
   and directive detector from api/check.js, applied to both outputs alike */
/* skipControl: benchmark variant of the shadow alone (a new model or effort
   against control outputs already collected); the control is not called and
   combineReusedControl() pairs the result with the stored control by hash */
export async function runShadowPair({ token, report, lang = 'en', langDirective = '', callOpenAI, callAnthropic = null, env = null, timeoutMs = SHADOW_TIMEOUT_MS, applyLanguage = null, directiveHits = null, shadowModel = null, shadowEffort = null, shadowMaxTokens = null, skipControl = false, signal = null } = {}) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const t0 = Date.now();
  const meta = isObj(report) && isObj(report._meta) ? report._meta : {};
  const avail = shadowAvailability(report);
  const base = {
    schema: SHADOW_PAIR_SCHEMA, created_at: new Date(t0).toISOString(), report_id: token || null,
    vehicle: isObj(report) && isObj(report.vehicle) ? { title: report.vehicle.title || null, year: report.vehicle.year || null, vin: meta.vin || null } : null,
    lang, availability: avail, stored_conclusion: storedConclusionInfo(report),
  };
  if (!avail.available) return { ...base, status: 'unavailable', reason: avail.reason, input: null, control: null, shadow: null, checks: null };
  const frozen = freezeConclusionInput({ report, langDirective });
  if (!frozen) return { ...base, status: 'unavailable', reason: 'no_context', input: null, control: null, shadow: null, checks: null };
  const cfg = conclusionModel(e);
  const acfg = anthropicConclusionModel(e);
  const capC = captureTransport(callOpenAI);
  const capS = captureTransport(callAnthropic || ((b, ms, s) => realCallAnthropic(b, ms, s, e)));
  const onFail = ex => ({ status: 'error', reason: String((ex && ex.message) || ex).slice(0, 160), conclusion: null, ms: Date.now() - t0, ai: null, attempts: [] });
  const shadowRun = !callAnthropic && !e.ANTHROPIC_API_KEY
    ? Promise.resolve({ status: 'skipped', reason: 'no_key', conclusion: null, ms: 0, ai: null, attempts: [] })
    : Promise.resolve().then(() => runAnthropicConclusion({ system: frozen.system, user: frozen.user, callModel: capS, timeoutMs, model: shadowModel, effort: shadowEffort, maxTokens: shadowMaxTokens, env: e, signal })).catch(onFail);
  const [control, shadow] = await Promise.all([
    skipControl ? Promise.resolve(null) : Promise.resolve().then(() => runFinalConclusion({ report, langDirective, callModel: capC, timeoutMs, env: { ...e, FINAL_CONCLUSION: 'on' }, signal })).catch(onFail),
    shadowRun,
  ]);
  const controlSent = capC.firstHash();
  const shadowSent = capS.firstHash();
  const finish = run => {
    if (!run || run.status !== 'ok' || !isObj(run.conclusion)) return null;
    const txt = { headline: run.conclusion.headline, body: run.conclusion.body };
    return typeof applyLanguage === 'function' ? applyLanguage(txt, report, lang) : txt;
  };
  const controlText = finish(control);
  const shadowText = finish(shadow);
  const controlRec = skipControl ? null : providerRecord(control, { provider: 'openai', requested_model: cfg.model, effort: cfg.effort, prompt_version: CONCLUSION_VERSION });
  const shadowRec = providerRecord(shadow, { provider: 'anthropic', requested_model: shadowModel || acfg.model, effort: shadowEffort || acfg.effort, prompt_version: CONCLUSION_VERSION });
  shadowRec.max_tokens = shadow && shadow.max_tokens ? shadow.max_tokens : null;
  const snapshot = frozen.checklist_snapshot;
  if (controlText && controlRec) { controlRec.output = { ...controlRec.output, ...controlText }; controlRec.checks_preview = checksPreview(control.conclusion, report, snapshot, lang); }
  if (shadowText) { shadowRec.output = { ...shadowRec.output, ...shadowText }; shadowRec.checks_preview = checksPreview(shadow.conclusion, report, snapshot, lang); }
  const checkOf = (txt, rec) => (txt ? conclusionInvariantChecks({ text: { ...txt, checks: rec.checks_preview ? rec.checks_preview.accepted.map(c => c.text) : [] }, report, context: frozen.context, directiveHits }) : null);
  return {
    ...base,
    status: (skipControl || controlRec.status === 'ok') && shadowRec.status === 'ok' ? 'ok' : 'partial',
    reason: null,
    input: {
      input_hash: frozen.input_hash, rules_version: frozen.rules_version, rules_hash: frozen.rules_hash, schema_hash: frozen.schema_hash,
      context_chars: frozen.context_chars, lang_directive: !!langDirective, checklist_snapshot_items: snapshot.length,
      control_sent_hash: controlSent, shadow_sent_hash: shadowSent,
      control_attempts_sent: capC.sent.length, shadow_attempts_sent: capS.sent.length,
      control_attempts_same_input: capC.allSame(), shadow_attempts_same_input: capS.allSame(),
      control_skipped: !!skipControl,
      identical_input: skipControl
        ? shadowSent === frozen.input_hash && capS.allSame()
        : controlSent !== null && controlSent === frozen.input_hash && shadowSent === frozen.input_hash && capC.allSame() && capS.allSame(),
    },
    control: controlRec,
    shadow: shadowRec,
    checks: { control: checkOf(controlText, controlRec), shadow: checkOf(shadowText, shadowRec) },
    ms: Date.now() - t0,
  };
}

/* a shadow-only pair + the stored pair that holds the control output of the
   same report -> one comparison pair. identical_input holds only when the
   stored control was sent exactly the frozen input and the new shadow was
   sent the same hash */
export function combineReusedControl(controlPair, shadowPair) {
  const okC = isObj(controlPair) && isObj(controlPair.input) && isObj(controlPair.control);
  const okS = isObj(shadowPair) && isObj(shadowPair.input) && isObj(shadowPair.shadow);
  if (!okC || !okS) return { schema: SHADOW_PAIR_SCHEMA, report_id: (okS && shadowPair.report_id) || (okC && controlPair.report_id) || null, status: 'unavailable', reason: !okC ? 'no_control_pair' : 'no_shadow_pair', input: null, control: null, shadow: null, checks: null };
  const ci = controlPair.input, si = shadowPair.input;
  const sameReport = controlPair.report_id === shadowPair.report_id;
  const controlProven = ci.input_hash === ci.control_sent_hash && ci.control_attempts_same_input !== false;
  const shadowProven = si.input_hash === si.shadow_sent_hash && si.shadow_attempts_same_input !== false;
  const identical = sameReport && controlProven && shadowProven && ci.input_hash === si.input_hash;
  return {
    schema: SHADOW_PAIR_SCHEMA, created_at: shadowPair.created_at, report_id: shadowPair.report_id, vehicle: shadowPair.vehicle, lang: shadowPair.lang,
    availability: shadowPair.availability, stored_conclusion: shadowPair.stored_conclusion,
    status: identical && controlPair.control.status === 'ok' && shadowPair.shadow.status === 'ok' ? 'ok' : (identical ? 'partial' : 'input_mismatch'),
    reason: identical ? null : 'input_hash_mismatch',
    input: {
      ...si,
      control_sent_hash: ci.control_sent_hash, control_attempts_sent: ci.control_attempts_sent, control_attempts_same_input: ci.control_attempts_same_input,
      control_input_hash: ci.input_hash, control_reused_from: controlPair.created_at || null, control_skipped: false,
      identical_input: identical,
    },
    control: controlPair.control,
    shadow: shadowPair.shadow,
    checks: { control: controlPair.checks ? controlPair.checks.control : null, shadow: shadowPair.checks ? shadowPair.checks.shadow : null },
  };
}

/* ---------- blind view ---------- */
/* strips every provider signal (name, model, tokens, latency, attempts) and
   assigns A/B by the caller's coin; the key is returned separately so the
   comparison artifact can be exported without it */
export const PROVIDER_WORDS = /openai|anthropic|claude|gpt-|opus|sonnet|terra|\bsol\b/i;
export function blindPairs(pairs, coin = () => Math.random() < 0.5) {
  const blind = [];
  const key = [];
  for (const p of arr(pairs)) {
    if (!isObj(p) || !isObj(p.control) || !isObj(p.shadow)) continue;
    const aIsControl = !!coin();
    const a = aIsControl ? p.control : p.shadow;
    const b = aIsControl ? p.shadow : p.control;
    const ca = aIsControl ? (p.checks && p.checks.control) : (p.checks && p.checks.shadow);
    const cb = aIsControl ? (p.checks && p.checks.shadow) : (p.checks && p.checks.control);
    const side = (rec, chk) => ({
      status: rec.status,
      output: rec.output ? { headline: rec.output.headline, body: rec.output.body } : null,
      checks: rec.checks_preview ? {
        returned: rec.checks_preview.raw.map(c => ({ text: c.text, area: c.area, refines: c.refines })),
        refined: rec.checks_preview.refined.map(r => ({ from: r.from, to: r.to })),
        added: rec.checks_preview.added.map(a => a.text),
        rejected: rec.checks_preview.rejected.map(r => ({ reason: r.reason, text: r.text })),
        skipped: rec.checks_preview.skipped.map(s => ({ reason: s.reason, text: s.text })),
      } : null,
      flags: chk ? { total: chk.total, counts: chk.counts, violations: arr(chk.violations).map(v => ({ check: v.check, domain: v.domain, found: v.found, canonical: v.canonical, where: v.where || null, text: v.text })), directive: chk.directive, gate: chk.gate } : null,
    });
    blind.push({ report_id: p.report_id, vehicle: p.vehicle ? { title: p.vehicle.title, year: p.vehicle.year } : null, lang: p.lang, input_hash: p.input ? p.input.input_hash : null, identical_input: p.input ? p.input.identical_input : null, A: side(a, ca), B: side(b, cb) });
    key.push({ report_id: p.report_id, A: aIsControl ? 'control' : 'shadow', B: aIsControl ? 'shadow' : 'control' });
  }
  return { blind, key };
}
