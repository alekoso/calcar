/* MI Research v1.1 (api/mi-research.js, міграції 028/029): тест без бази.

   Що доводиться:
   1. холодна модель: дослідження іде з канонічної ідентичності Check без
      версії каталогу; слабша за покоління ідентичність пропускається;
   2. наявне MI і памʼять кандидатів читаються ПЕРЕД пошуком і передаються
      витягу; той самий факт не відкривається двічі, а посилює кандидата;
   3. послідовні пакети: після першого пакета дослідження триває, поки є
      прогалини; стелі 5 пакетів, 15 запитів, 20 джерел; два порожні
      пакети поспіль зупиняють; запити і адреси не повторюються;
   4. знімок у момент фінального аналізу: пізніші знахідки у звіт не
      потрапляють, але зберігаються у MI; обрив після готовності звіту;
      ранні пакети не втрачаються від пізнішого збою чи обриву;
   5. збої, вимикач, VIN-знахідки, невигаданий fitment;
   6. життєвий цикл і актуальність: кампанія стає verify, не active;
      постійна вразливість і знос лишаються active; ранг не з кількості
      згадок; один свіжий анекдот не переважує сильніші докази; дорога
      застосовна проблема не витісняється частішою; один слабкий доказ це
      лише підказка, не типове слабке місце;
   7. модуль без захардкоджених фактів; проводка в api/check.js.

   Запуск: node miresearchtest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const ID_COLD = { brand: 'Volkswagen', model_line: 'Golf', generation: 'MK6', version_text: null, engine_text: '2.0 L Gasoline 200 hp', model_year: 2010, mileage_km: 210000 };
const ID_WEAK = { brand: 'Volkswagen', model_line: 'Golf', generation: null, model_year: 2010 };
const CTX_COLD = { available: true, mi_scope: 'none', catalog_brand: false, knowledge: [], knowledge_count: 0, open_candidates: [], open_candidates_count: 0 };
const CTX_MI = {
  available: true, mi_scope: 'version', catalog_brand: true, identity_precision: 'partial',
  identity_summary: { brand: 'Porsche', version: 'Porsche Cayenne GTS 958.1', model_year: '2013',
    components: [{ role: 'engine', variant: 'Porsche M48.02 (4.8 V8)', resolution_status: 'assumed_factory' }] },
  knowledge_count: 2,
  knowledge: [
    { kind: 'issues', area: 'drivetrain', text: 'The transfer case of this generation degrades badly enough that the maker extended its warranty.', knowledge_type: 'known_issue', status: 'CONDITIONAL', severity: 'major', condition: 'transfer case must be the factory unit' },
    { kind: 'issues', area: 'chassis', text: 'Air suspension struts leak with age.', knowledge_type: 'owner_pattern', status: 'APPLICABLE' },
  ],
  open_candidates: [{ id: 398, text: 'Internal transfer-case wear is reported to cause jerking or stuttering at low RPM.', knowledge_type: 'known_issue', evidence_count: 1, hosts: ['armotors.ae'], gate_failed: ['known_issue_evidence'], lifecycle: 'age_or_wear_related' }],
  open_candidates_count: 1,
};
const ID_MI = { brand: 'Porsche', model_line: 'Cayenne', generation: '958.1', model_year: 2013, mileage_km: 140000 };

const items = (...links) => links.map((l, i) => ({ link: l, title: 'T' + i, snippet: 's' }));
const TEXT = {
  'nhtsa.gov': 'Safety recall 21V123: Porsche is recalling certain 2011-2014 Cayenne vehicles because the transfer case bolts may loosen. Dealers will replace the bolts free of charge. '.repeat(5),
  'enginebuilder.example': 'We are an engine builder. In our workshop we have rebuilt eleven 4.8 litre V8 engines from the 958 Cayenne S and GTS with cylinder bore scoring; the Alusil bores cannot be rebored and need sleeves. Cars from 2011 to 2014 arrive with it in 2024 and 2025 too. '.repeat(3),
  'rennlist.com': 'Long forum thread from 2013 to 2019. My GTS developed transfer case shudder at 90k miles and the shop found the transfer case worn, the unit needed a rebuild. Others report the same. '.repeat(5),
  'porsche.com': 'Porsche service campaign WKA1: extended warranty for the transfer case on 2011 to 2014 Cayenne models to 10 years or 100,000 miles. '.repeat(5),
  'vwvortex.com': 'Forum 2011 2012: DSG mechatronic unit failed at 60k miles, dealer replaced it under a service action. '.repeat(6),
  'golfmk6.com': 'Forum 2024: my mk6 GTI water pump housing cracked and leaked coolant at 150k km, common on the EA888 gen 1. '.repeat(6),
  'tech.example': 'Independent workshop notes 2023 to 2025: timing chain tensioner on early 2.0 TSI engines fails; revised tensioner part 06K 109 467 K introduced in 2012 solves it. '.repeat(5),
  'blog.example': 'A blog retelling common problems: coolant leaks, air suspension, transfer case. '.repeat(8),
};
/* пошук: різні результати на різні запити, щоб пакети мали що читати */
function searchFor(q) {
  const l = q.toLowerCase();
  if (/recall|campaign/.test(l)) return items('https://www.nhtsa.gov/recalls?nhtsaId=21V123', 'https://www.porsche.com/usa/service/campaigns/x');
  if (/engine/.test(l)) return items('https://www.enginebuilder.example/porsche-48-v8-bores', 'https://tech.example/tsi-chain', 'https://www.youtube.com/watch?v=1');
  if (/transfer|jerking|stuttering|wear|owners forum/.test(l)) return items('https://rennlist.com/forums/cayenne-958/tc.html', 'https://blog.example/cayenne-958-problems');
  if (/coolant|cooling/.test(l)) return items('https://golfmk6.com/threads/water-pump.1/', 'https://vwvortex.com/threads/dsg.1/');
  if (/still|before buying/.test(l)) return items('https://golfmk6.com/threads/2025-still.2/', 'https://tech.example/still-2025');
  return items('https://blog.example/common', 'https://vwvortex.com/threads/common.2/', 'https://auto.ria.com/uk/x.html');
}

function stubs(overrides = {}) {
  const calls = { context: 0, search: [], fetch: [], model: 0, order: [], bodies: [], persist: [] };
  const base = {
    fetchContext: async () => { calls.context++; calls.order.push('context'); return { ok: true, available: true, context: overrides.ctx || CTX_MI, ms: 5 }; },
    search: async (q) => { calls.search.push(q); calls.order.push('search'); return { query: q, ok: true, reason: null, items: searchFor(q), ms: 3 }; },
    fetchSource: async (src) => { calls.fetch.push(src.url); calls.order.push('fetch'); const text = TEXT[src.host] || ''; return { ...src, status: text ? 'ok' : 'empty', text, chars: text.length, source_date: src.host === 'blog.example' ? '2026-02-01' : null, ms: 2 }; },
    callModel: async (body) => { calls.model++; calls.order.push('model'); calls.bodies.push(body); const out = typeof overrides.modelOut === 'function' ? overrides.modelOut(calls.model, body) : (overrides.modelOut || { findings: [], sources: [], nothing_new_reason: 'nothing new' }); return { choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }; },
    persist: async (vin, payload) => { calls.persist.push(payload); return { ok: true, published: 0, merged: 0, candidates: payload.findings.length, staged_cold: 0, skipped: 0, results: [] }; },
  };
  return { calls, opts: { ...base, ...overrides, env: overrides.env || {} } };
}
/* перший читабельний рядок тексту джерела 0 як цитата */
const excerptOf = body => {
  const m = /--- SOURCE 0 \|[^\n]*\n([^\n]{25,})/.exec(body.messages[1].content);
  return m ? m[1].slice(0, 120) : '';
};
const F = (text, over = {}) => ({ text_en: text, scope: 'version', component_role: 'none', knowledge_type: 'known_issue', novelty: 'new', candidate_id: '', severity: 'major', buyer_importance: 4, buyer_implication_en: 'Check.', causal_status: 'plausible_mechanism', affected_scope: '2011-2014', lifecycle: 'persistent_design_susceptibility', remedy: '', verify_on_vehicle: 'inspection', evidence_period: '2011-2014', current_relevance: 'active', relevance_reason: 'r', evidence: [], ...over });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_miresearch_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'mi-research.js'));
  const SRC = fs.readFileSync('api/mi-research.js', 'utf8');
  const CHECK = fs.readFileSync('api/check.js', 'utf8');
  const run = async (input, overrides) => { const { calls, opts } = stubs(overrides); const ctrl = M.startCheckResearch(input, opts); const state = await ctrl.promise; return { calls, ctrl, state }; };

  /* ---- 1. холодний старт і слабка ідентичність ---- */
  let r = await run({ vin: null, identity: ID_COLD, token: 't' }, { ctx: CTX_COLD });
  ok('1. холодна модель досліджується без версії каталогу', r.state.status === 'ok' && r.state.eligibility === 'check_identity' && r.state.batches.length >= 1, r.state.status + ' ' + r.state.reason);
  ok('1b. мітка з канонічної ідентичності, без заголовка продавця', r.state.identity.label === 'Volkswagen Golf MK6 2.0 L Gasoline 200 hp 2010' && r.calls.search[0].startsWith('Volkswagen Golf MK6'), r.state.identity.label);
  ok('1c. контекст без каталогу все одно читається першим', r.calls.order[0] === 'context');
  r = await run({ vin: null, identity: ID_WEAK }, { ctx: CTX_COLD });
  ok('1d. ідентичність слабша за покоління: пошуку немає', r.state.status === 'skipped' && r.state.reason === 'identity_too_weak' && r.calls.search.length === 0);
  r = await run({ vin: 'WP1ZZZ92ZDLA45155', identity: ID_WEAK }, { ctx: CTX_MI });
  ok('1e. версія каталогу MI робить дослідження придатним і без коду покоління', r.state.status === 'ok' && r.state.eligibility === 'mi_version');
  r = await run({ vin: null, identity: ID_COLD }, { fetchContext: async () => ({ ok: false, reason: 'timeout', ms: 1 }) });
  ok('1f. контекст недоступний, але ідентичність достатня: дослідження іде холодним', r.state.status === 'ok' && r.state.context.context_error === 'timeout' && r.state.batches.length >= 1);

  /* ---- 2. памʼять перед пошуком ---- */
  r = await run({ vin: 'V', identity: ID_MI }, { ctx: CTX_MI });
  const first = r.calls.bodies[0].messages[1].content;
  ok('2. витяг отримує наявне MI, кандидатів і знімок цього Check', /KNOWN \(2 items/.test(first) && /transfer case of this generation degrades/.test(first) && /candidate_id 398/.test(first) && /gate gaps: known_issue_evidence/.test(first) && /FOUND_THIS_CHECK/.test(first));
  ok('2b. пакет посилення шукає саме кандидата, а не «ще одну проблему»', r.state.batches.some(b => b.area === 'strengthen' && b.target_candidate === 398 && /transfer-case wear|internal transfer/.test(b.queries[0])), JSON.stringify(r.state.batches.map(b => [b.area, b.queries[0]])));
  ok('2c. запити не повторюються, адреси не перечитуються', new Set(r.state.queries).size === r.state.queries.length && new Set(r.state.urls).size === r.state.urls.length);
  ok('2d. області з наявного MI (drivetrain, chassis) не досліджуються як прогалини', !r.state.batches.some(b => b.area === 'drivetrain' || b.area === 'chassis'), r.state.batches.map(b => b.area).join(','));

  /* ---- 3. послідовні пакети і стелі ---- */
  ok('3. після першого пакета дослідження триває, поки є прогалини', r.state.batches.length >= 2, String(r.state.batches.length));
  ok('3b. два порожні пакети поспіль зупиняють', r.state.stop_reason === 'two_empty_batches' && r.state.batches.length === 2, r.state.stop_reason + ' ' + r.state.batches.length);
  let n = 0;
  const alwaysFinding = (k, body) => { n++; return { findings: [F('Distinct reusable finding number ' + n + ' about this version and its parts.', { evidence: [{ source_index: 0, excerpt: excerptOf(body), stance: 'supports', evidence_date: '2024' }] })], sources: [], nothing_new_reason: '' }; };
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, modelOut: alwaysFinding });
  ok('3c. стеля 5 пакетів', r.state.batches.length <= 5 && r.state.batches.length >= 3 && r.state.stop_reason, r.state.batches.length + ' ' + r.state.stop_reason);
  ok('3d. стеля 15 запитів і 20 джерел', r.state.totals.queries <= 15 && r.state.totals.sources <= 20, JSON.stringify(r.state.totals));
  ok('3e. на пакет не більше 3 запитів і 4 джерел', r.state.batches.every(b => b.queries.length <= 3 && b.sources.length <= 4));
  ok('3f. один витяг на пакет', r.calls.model === r.state.batches.filter(b => b.status === 'ok').length);
  ok('3g. стара машина отримує пакет про сучасну актуальність', r.state.batches.some(b => b.area === 'recent_relevance' && /still|before buying/.test(b.queries[0])), r.state.batches.map(b => b.area).join(','));
  ok('3h. кожен завершений пакет зберігається окремо, не в кінці', r.calls.persist.length === r.state.batches.filter(b => b.findings.length).length && r.calls.persist.length >= 2);
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, modelOut: alwaysFinding, limits: { ...M.RESEARCH_LIMITS, max_queries: 4 } });
  ok('3i. стеля запитів обрізає останній пакет і зупиняє', r.state.totals.queries <= 4 && r.state.stop_reason === 'max_queries', JSON.stringify(r.state.totals) + ' ' + r.state.stop_reason);
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, modelOut: alwaysFinding, limits: { ...M.RESEARCH_LIMITS, max_sources: 5 } });
  ok('3j. стеля джерел не перевищується', r.state.totals.sources <= 5, String(r.state.totals.sources));
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, modelOut: alwaysFinding, limits: { ...M.RESEARCH_LIMITS, max_batches: 1 } });
  ok('3k. стеля пакетів', r.state.batches.length === 1 && r.state.stop_reason === 'max_batches');

  /* ---- 4. знімок, обрив, збереження ранніх пакетів ---- */
  {
    let release; const gate = new Promise(res => { release = res; });
    let k = 0;
    const { calls, opts } = stubs({ ctx: CTX_COLD, callModel: async (body) => { k++; if (k === 2) await gate; return { choices: [{ message: { content: JSON.stringify(alwaysFinding(k, body)) } }], usage: {} }; } });
    const ctrl = M.startCheckResearch({ vin: null, identity: ID_COLD, token: 'tok' }, opts);
    while (!(ctrl.state.batches.length === 2 && ctrl.state.batches[1].status === 'running' && k === 2)) await new Promise(res => setTimeout(res, 10));
    const waited = await ctrl.waitBatch(120);
    const snap = ctrl.cutoff();
    ok('4. знімок бере лише завершені знахідки (пакет 1), пакет 2 ще працює', waited === false && snap.findings.length === 1 && snap.batches === 1 && ctrl.state.cutoff_at != null, JSON.stringify({ waited, n: snap.findings.length, b: snap.batches }));
    const block = M.researchBlock(snap);
    const before = snap.findings[0].text_en;
    ok('4b. блок основного виклику несе знахідку пакета 1 і не більше', /FRESH_WEB_FINDINGS/.test(block) && block.includes(before) && (block.match(/Distinct reusable finding/g) || []).length === 1);
    release();
    await ctrl.promise.catch(() => null).then(() => null);
    await new Promise(res => setTimeout(res, 20));
    ctrl.abort();
    await ctrl.persistDone(500);
    ok('4c. пізніша знахідка не змінює знімок, але збережена у MI', snap.findings.length === 1 && ctrl.state.findings.length >= 2 && calls.persist.length >= 2 && calls.persist[1].findings[0].text_en !== before);
    ok('4d. обрив після готовності звіту зафіксований', ctrl.state.aborted_at != null && ctrl.state.batches.length <= 5);
    ok('4e. ранні пакети переживають обрив', ctrl.state.batches[0].status === 'ok' && ctrl.state.batches[0].persist && ctrl.state.batches[0].persist.ok);
    const meta = M.researchMeta(ctrl.state);
    ok('4f. хронологія у телеметрії: пакети, знімок, обрив, без текстів джерел', meta.timeline.cutoff_at != null && meta.timeline.aborted_at != null && meta.batches.length >= 2 && meta.batches[0].ended_at != null && !JSON.stringify(meta).includes('Forum 2011 2012'));
  }
  {
    /* обрив посеред пакета 2: пакет 1 лишається */
    let k = 0; let ctrlRef;
    const { calls, opts } = stubs({ ctx: CTX_COLD, callModel: async (body) => { k++; if (k === 2) { ctrlRef.abort(); } return { choices: [{ message: { content: JSON.stringify(alwaysFinding(k, body)) } }], usage: {} }; } });
    ctrlRef = M.startCheckResearch({ vin: null, identity: ID_COLD }, opts);
    const st = await ctrlRef.promise;
    ok('4g. обрив під час пакета 2 зупиняє дослідження, пакет 1 збережений', st.status === 'aborted' && st.batches[0].status === 'ok' && st.batches[1].status === 'aborted' && calls.persist.length === 1 && st.findings.length === 1);
  }
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, modelOut: (k, body) => k === 1 ? alwaysFinding(k, body) : (() => { throw new Error('model down'); })() });
  ok('4h. збій пізнішого пакета не стирає ранній', r.state.batches[0].status === 'ok' && r.state.findings.length === 1 && r.calls.persist.length === 1 && r.state.status === 'failed');
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, persist: async () => { throw new Error('db down'); }, modelOut: alwaysFinding });
  ok('4i. збій збереження не ламає дослідження і видно у пакеті', r.state.status === 'ok' && r.state.batches[0].persist && r.state.batches[0].persist.ok === false && r.state.batches[0].persist.reason === 'error');

  /* ---- 5. збої, вимикач, VIN, fitment ---- */
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, env: { MI_RESEARCH: 'off' } });
  ok('5. вимикач: жодного виклику', r.state.status === 'skipped' && r.state.reason === 'flag_off' && r.calls.context === 0);
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, search: async q => ({ query: q, ok: false, reason: 'http_403', items: [], ms: 1 }) });
  ok('5b. пошук впав: skipped без витягу, контекст лишається', r.state.status === 'skipped' && r.state.stop_reason === 'http_403' && r.calls.model === 0 && r.state.context);
  const ac = new AbortController(); ac.abort();
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, signal: ac.signal });
  ok('5c. зовнішній сигнал обриву до пошуку', r.state.status === 'aborted' && r.calls.search.length === 0);
  const vehicleOut = { findings: [F('This particular car had its DSG mechatronic replaced by the dealer in 2012.', { scope: 'vehicle', evidence: [{ source_index: 0, excerpt: 'DSG mechatronic unit failed at 60k miles, dealer replaced it under a service action', stance: 'supports', evidence_date: '2012' }] }),
    F('The DSG mechatronic unit of this generation is reported to fail and was covered by a service action.', { scope: 'component', component_role: 'transmission', lifecycle: 'campaign_or_one_time_fix', current_relevance: 'active', remedy: 'service action', verify_on_vehicle: 'dealer campaign check by VIN', evidence: [{ source_index: 0, excerpt: 'DSG mechatronic unit failed at 60k miles, dealer replaced it under a service action', stance: 'supports', evidence_date: '2011-2012' }] })], sources: [], nothing_new_reason: '' };
  r = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD, search: async q => ({ query: q, ok: true, items: items('https://vwvortex.com/threads/dsg.1/'), ms: 1 }), modelOut: (k) => k === 1 ? vehicleOut : { findings: [], sources: [], nothing_new_reason: 'n' } });
  const b1 = r.state.batches[0];
  ok('5d. знахідка про VIN у MI не йде, лишається у знімку', b1.findings.some(f => f.scope === 'vehicle') && r.calls.persist[0].findings.every(f => f.scope !== 'vehicle') && r.calls.persist[0].vehicle_scope_dropped === 1);
  const dsg = b1.findings.find(f => f.scope !== 'vehicle');
  ok('5e. нерозвʼязаний компонент не вигадується: область звужена до версії', dsg && dsg.scope === 'version' && dsg.component_role === null);
  ok('5f. холодне збереження несе ідентичність для мітки і без субʼєкта', r.calls.persist[0].identity.label === r.state.identity.label && r.calls.persist[0].identity.generation === 'MK6');

  /* ---- 6. життєвий цикл і актуальність ---- */
  ok('6. кампанія без підтвердження виконання: verify, не active', dsg && dsg.lifecycle === 'campaign_or_one_time_fix' && dsg.current_relevance === 'verify' && dsg.model_relevance === 'active');
  const rules = (lc, rel) => M.applyRelevanceRules({ lifecycle: lc, current_relevance: rel }).relevance;
  ok('6b. постійна вразливість лишається active; "resolved" для неї без доказу про цю машину це лише verify, не закрито', rules('persistent_design_susceptibility', 'verify') === 'active' && rules('persistent_design_susceptibility', 'active') === 'active' && rules('persistent_design_susceptibility', 'resolved') === 'verify');
  ok('6c. вік і знос лишаються active', rules('age_or_wear_related', 'verify') === 'active');
  ok('6d. виправлено ревізією: active стає verify, not_applicable лишається', rules('superseded_by_revision', 'active') === 'verify' && rules('superseded_by_revision', 'not_applicable') === 'not_applicable');
  ok('6e. resolved без доказу про цю машину стає verify; not_applicable поза зоною дії лишається', rules('unknown', 'resolved') === 'verify' && rules('campaign_or_one_time_fix', 'not_applicable') === 'not_applicable');
  const ev = (host, type, quality, date) => ({ host, independence_group: host, source_type: type, quality, stance: 'supports', evidence_date: date });
  const anecdote = { current_relevance: 'active', severity: 'moderate', strength: 'owner', lifecycle: 'unknown', evidence: [ev('forum.example', 'owner', 'secondary', '2026')] };
  const bodyOfEvidence = { current_relevance: 'active', severity: 'moderate', strength: 'specialist', lifecycle: 'age_or_wear_related', evidence: [ev('shop.example', 'specialist', 'primary', '2022'), ev('forum1.example', 'owner', 'secondary', '2022'), ev('forum2.example', 'owner', 'secondary', '2021')] };
  ok('6f. один свіжий анекдот не переважує сильніші незалежні докази', M.rankScore(bodyOfEvidence, 2026) > M.rankScore(anecdote, 2026));
  const frequentMinor = { current_relevance: 'active', severity: 'minor', strength: 'owner', lifecycle: 'age_or_wear_related', evidence: [ev('a.example', 'owner', 'secondary', '2025'), ev('b.example', 'owner', 'secondary', '2025'), ev('c.example', 'owner', 'secondary', '2024')], mentions: 5000 };
  const rareCatastrophic = { current_relevance: 'active', severity: 'catastrophic', strength: 'specialist', lifecycle: 'persistent_design_susceptibility', evidence: [ev('builder.example', 'specialist', 'primary', '2024')] };
  ok('6g. рідка катастрофічна застосовна проблема вище за часту дрібницю', M.rankScore(rareCatastrophic, 2026) > M.rankScore(frequentMinor, 2026));
  const rankSrc = SRC.slice(SRC.indexOf('export function rankScore'), SRC.indexOf('export function rankScore') + 1200);
  ok('6h. кількість згадок у рангу не бере участі', !/mention|items\.length|position/i.test(rankSrc) && M.rankScore({ ...frequentMinor, mentions: 1 }, 2026) === M.rankScore(frequentMinor, 2026));
  ok('6i. закрита і не про цю машину знахідка у ранзі нуль', M.rankScore({ ...rareCatastrophic, current_relevance: 'resolved' }, 2026) === 0 && M.rankScore({ ...rareCatastrophic, current_relevance: 'not_applicable' }, 2026) === 0);
  ok('6j. один слабкий доказ це підказка, а не типове слабке місце', M.prominence({ strength: 'owner', evidence: [ev('f.example', 'owner', 'secondary', '2025')] }) === 'lead' && M.prominence({ strength: 'owner', evidence: [ev('f.example', 'owner', 'secondary', '2025'), ev('g.example', 'owner', 'secondary', '2024')] }) === 'weak_spot' && M.prominence({ strength: 'documented', evidence: [ev('nhtsa.gov', 'legal', 'primary', '2012')] }) === 'weak_spot');
  const snapMix = { context: CTX_COLD, identity: ID_COLD, reportYear: 2026, findings: [
    { ...F('Old recall on transfer case bolts.', { lifecycle: 'campaign_or_one_time_fix', current_relevance: 'verify', remedy: 'recall remedy', verify_on_vehicle: 'VIN campaign check', severity: 'major' }), strength: 'documented', prominence: 'weak_spot', evidence: [{ ...ev('nhtsa.gov', 'legal', 'primary', '2012'), url: 'u' }] },
    { ...F('Bore scoring on this engine remains a susceptibility.', { lifecycle: 'persistent_design_susceptibility', current_relevance: 'active', severity: 'catastrophic' }), strength: 'specialist', prominence: 'weak_spot', evidence: [ev('builder.example', 'specialist', 'primary', '2025')] },
    { ...F('Early production cars had a wiring fault fixed by revision in 2012.', { lifecycle: 'superseded_by_revision', current_relevance: 'not_applicable', relevance_reason: 'this car is a 2013 build' }), strength: 'secondary', prominence: 'weak_spot', evidence: [ev('mag.example', 'review', 'secondary', '2011')] },
    { ...F('One owner reports a rattle from the glovebox.', { lifecycle: 'unknown', current_relevance: 'active', severity: 'minor' }), strength: 'owner', prominence: 'lead', evidence: [ev('forum.example', 'owner', 'secondary', '2026')] },
  ] };
  const blk = M.researchBlock(snapMix);
  const pos = s => blk.indexOf(s);
  ok('6k. блок: катастрофічна постійна вразливість вище за кампанію; кампанія позначена ПЕРЕВІРИТИ з ліками і способом перевірки', pos('Bore scoring') < pos('Old recall') && /ПЕРЕВІРИТИ: історично стосується/.test(blk) && /ліки: recall remedy/.test(blk) && /як перевірити на цій машині: VIN campaign check/.test(blk));
  ok('6l. блок: не про цю машину винесено окремо і не як слабке місце', /НЕ актуально для цієї машини/.test(blk) && pos('wiring fault') > pos('Знайдено, але НЕ актуально'));
  ok('6m. блок: одиничний анекдот винесений у WEAK_LEADS, а не у FRESH_WEB_FINDINGS; правила про поширеність і ярлики', /WEAK_LEADS \(/.test(blk) && pos('glovebox') > pos('WEAK_LEADS (') && pos('glovebox') > pos('FRESH_WEB_FINDINGS (') && /Поширеність не дорівнює важливості/.test(blk) && /"найчастіша", "проблема номер один"/.test(blk) && /перевірити по VIN, чи виконана/.test(blk));
  ok('6n. блок несе дати досвіду окремо від дати сторінки', /досвід 2025/.test(blk) && /досвід 2012/.test(blk));
  ok('6o. витяг просить відділяти дату сторінки від періоду досвіду і не робити з анекдоту факт', /Separate the page date from the period of the experience/.test(M.EXTRACTION_RULES) && /one isolated recent post does not outweigh/.test(M.EXTRACTION_RULES) && /A campaign whose completion on this VIN is unknown is verify, never active/.test(M.EXTRACTION_RULES));
  const emptyRun = await run({ vin: null, identity: ID_COLD }, { ctx: CTX_COLD });
  ok('6p. нуль знахідок лишається нормою: пакети ok без знахідок, збережень немає, статус ok', /Zero findings is a valid, common result/.test(M.EXTRACTION_RULES) && emptyRun.state.status === 'ok' && emptyRun.state.batches.every(b => b.status === 'ok' && !b.findings.length) && emptyRun.calls.persist.length === 0 && emptyRun.state.batches[0].nothing_new_reason === 'nothing new');

  /* ---- 7. без фактів про моделі; проводка ---- */
  const codeOnly = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/AREA_HINTS = \{[\s\S]*?\n\};/, '');
  ok('7. у модулі немає фактів про моделі', !/bore scoring|cayenne|m48|n63|theta|porsche|bmw/i.test(codeOnly.replace(/OWNER_HOST[^\n]*\n/, '').replace(/EXCLUDED_HOST[^\n]*\n/, '')));
  ok('7b. довгого тире немає', !/\u2014/.test(SRC) && !/\u2014/.test(fs.readFileSync('migrations/mi/029_check_research_cold_start.up.sql', 'utf8')));
  const core = CHECK.slice(CHECK.indexOf('async function runCheck('));
  const startAt = core.indexOf('startCheckResearch({');
  ok('7c. дослідження стартує після Vehicle Memory з канонічної ідентичності: версія і мотор лише з декодера, покоління через резолвер з перевіркою назви моделі', startAt > core.indexOf('miEqPromise.then(miEqResolve)') && /version_text: \(nhtsa && \(nhtsa\.Trim \|\| nhtsa\.Series\)\) \|\| null/.test(core) && /generation: resolveGeneration\(\[\{ value: listing\.generation, source: 'listing', notModel: \(nhtsa && nhtsa\.Model\) \|\| listing\.model \}\]\)\.generation/.test(core) && !/title/.test(core.slice(startAt, startAt + 900)));
  ok('7d. знімок перед основним викликом після очікування не довше 3 с', /await miResearch\.waitBatch\(MI_RESEARCH_MAIN_WAIT_MS\);/.test(core) && /const MI_RESEARCH_MAIN_WAIT_MS = 3000;/.test(core) && core.indexOf('miResearch.cutoff()') < core.indexOf("progress('ai')") && /content\.splice\(1, 0, \{ type: 'text', text: miResearchBlock \}\)/.test(core));
  ok('7e. у кінці Check: збереження дочекано і решта обірвана до відповіді', /await miResearch\.persistDone\(3000\);\s*miResearch\.abort\(\);/.test(core) && core.indexOf('miResearch.abort()') < core.indexOf('timings.total_ms = Date.now() - tRun'));
  ok('7f. телеметрія з хронологією і лог', /parsed\._meta\.mi_research = researchMeta\(miResearch\.state\)/.test(core) && /findings_at_cutoff/.test(core));
  ok('7g. ядро Check про тінь так і не знає; Score і share не читають дослідження', !/runMiShadow|mi_shadow_pack/.test(core) && !/mi_research|miResearch/.test(fs.readFileSync('api/score-v4.js', 'utf8')) && !/mi_research/.test(fs.readFileSync('api/share.js', 'utf8')));
  ok('7h. вимикач читає лише api/mi-research.js', fs.readdirSync('api').filter(f => f.endsWith('.js') && /\.MI_RESEARCH\b/.test(fs.readFileSync('api/' + f, 'utf8'))).join() === 'mi-research.js');

  /* ---- 8. фінальна полірування бета: підказка не стає слабким місцем; короткі коди покоління ---- */
  {
    const evx = (h, t, q, d) => ({ host: h, independence_group: h, source_type: t, quality: q, stance: 'supports', evidence_date: d, url: 'https://' + h + '/x', excerpt: 'excerpt text long enough for tests', title: 't' });
    /* справжня форма Mercedes W205 AMG C43: одне джерело власників, low, verify */
    const w205Lead = { text_en: 'Owner reports for the W205 C43 describe jerky low-speed transmission behaviour as a calibration characteristic.', scope: 'version', component_role: null, knowledge_type: 'owner_pattern', severity: 'minor', lifecycle: 'unknown', current_relevance: 'verify', strength: 'owner', evidence: [evx('mbworld.org', 'owner', 'low', '2023')], buyer_importance: 3, causal_status: 'observed_association' };
    w205Lead.prominence = M.prominence(w205Lead);
    const strong = { text_en: 'The plastic engine-valley coolant crossover pipe cracks from heat cycling and leaks coolant.', scope: 'version', component_role: null, knowledge_type: 'known_issue', severity: 'major', lifecycle: 'age_or_wear_related', current_relevance: 'active', strength: 'specialist', evidence: [evx('shop.example', 'specialist', 'primary', '2024')], buyer_importance: 5, causal_status: 'plausible_mechanism' };
    strong.prominence = M.prominence(strong);
    ok('8. форма W205: одне слабке джерело це lead', w205Lead.prominence === 'lead' && strong.prominence === 'weak_spot');
    const snapW = { context: CTX_COLD, identity: ID_COLD, reportYear: 2026, findings: [w205Lead, strong] };
    const blkW = M.researchBlock(snapW);
    ok('8b. підказка лишається у контексті аналізу як WEAK_LEADS L1, сильна знахідка як F1', /\nF1\. \[version, known_issue, major\] The plastic engine-valley coolant/.test(blkW) && /\nL1\. \[version, owner_pattern, minor\] Owner reports for the W205 C43/.test(blkW) && blkW.indexOf('L1.') > blkW.indexOf('WEAK_LEADS (') && blkW.indexOf('F1.') < blkW.indexOf('WEAK_LEADS ('));
    ok('8c. блок забороняє підказці ставати слабким місцем і вимагає source_ref', /У model_notes\.issues і risks їх НЕ писати/.test(blkW) && /SOURCE_REF: кожен пункт model_notes\.issues МУСИТЬ мати source_ref/.test(blkW));
    const parsedW = { model_notes: { issues: [
      { unit: 'коробка', title: 'Рывки коробки на малой скорости', detail: 'd', severity: 'low', seller_serviced: false, source_ref: 'L1' },
      { unit: 'охолодження', title: 'Трещины перемычки охлаждения', detail: 'd', severity: 'high', seller_serviced: false, source_ref: 'F1' },
      { unit: 'підвіска', title: 'Пневмостойки', detail: 'd', severity: 'med', seller_serviced: false, source_ref: 'MI' },
      { unit: 'мотор', title: 'Власне знання', detail: 'd', severity: 'med', seller_serviced: false, source_ref: null },
    ], }, risks: [
      { title: 'Возможное запотевание верхних крышек ГРМ', level: 'low', kind: 'latent', note: 'Владельцы сообщают', action: 'осмотреть', source_ref: 'L1' },
      { title: 'Переднее ДТП', level: 'high', kind: 'finding', note: 'n', action: 'a', source_ref: null },
    ], checklist: ['Проверить рывки коробки на малой скорости на тест-драйве'] };
    const g = M.guardModelNotes(parsedW, snapW);
    const titles = parsedW.model_notes.issues.map(i => i.title);
    ok('8d. W205: підказка з source_ref L1 прибрана зі слабких місць', !titles.includes('Рывки коробки на малой скорости') && g.dropped.some(d => d.where === 'model_notes' && d.ref === 'L1'), JSON.stringify(g));
    ok('8d2. форма Q7: ризик, що спирається лише на підказку, теж прибраний; ризик цього екземпляра лишається', parsedW.risks.map(x => x.title).join('|') === 'Переднее ДТП' && g.dropped.some(d => d.where === 'risks'));
    ok('8e. без знання MI у знімку лишається лише сильна знахідка F1; "MI" без знання MI і власне знання прибрані', titles.join('|') === 'Трещины перемычки охлаждения' && g.dropped.some(d => d.reason === 'no_mi_knowledge') && g.dropped.some(d => d.reason === 'ungrounded'), JSON.stringify(g.dropped));
    ok('8f. обережний пункт перевірки у checklist не чіпається', parsedW.checklist.length === 1);
    ok('8g. підказка лишається для MI: persistPayload її зберігає як кандидата', M.persistPayload([w205Lead], ID_COLD, 't').findings.length === 1);
    ok('8h. без знімка і без issues фільтр нічого не ламає; без знімка F1 не має на що спиратися', M.guardModelNotes({}, null).checked === 0 && M.guardModelNotes({ model_notes: { issues: [{ title: 'x', source_ref: 'F1' }] } }, null).dropped.length === 1);
    /* обґрунтовані слабкі місця: лише MI (коли знання є) і F<n> (коли знахідка є) */
    const snapMI = { context: { ...CTX_MI }, identity: ID_MI, reportYear: 2026, findings: [w205Lead, strong] };
    const P = () => ({ model_notes: { issues: [
      { title: 'mi', source_ref: 'MI' }, { title: 'f1', source_ref: 'F1' }, { title: 'l1', source_ref: 'L1' }, { title: 'null', source_ref: null },
      { title: 'missing' }, { title: 'bad', source_ref: 'wikipedia' }, { title: 'f9', source_ref: 'F9' }, { title: 'lower', source_ref: 'mi' },
    ] }, risks: [
      { title: 'Переднее ДТП', kind: 'finding', source_ref: null }, { title: 'Пробег', kind: 'finding', source_ref: 'MILEAGE_CONTEXT' },
      { title: 'Кадр', kind: 'finding' }, { title: 'Слабкий', kind: 'latent', source_ref: 'L1' }, { title: 'MI ризик', kind: 'latent', source_ref: 'MI' },
    ] });
    const pm = P(); const gm = M.guardModelNotes(pm, snapMI);
    const t2 = pm.model_notes.issues.map(i => i.title).join(',');
    ok('9.1 source_ref MI зберігається, коли знання MI є', t2.includes('mi') && t2.includes('lower'), t2);
    ok('9.2 source_ref F1 зберігається, коли така помітна знахідка є', t2.split(',').includes('f1'), t2);
    ok('9.3 L1 прибраний', !t2.split(',').includes('l1') && gm.dropped.some(d => d.ref === 'L1' && d.reason === 'weak_lead' && d.where === 'model_notes'));
    ok('9.4 null прибраний', !t2.split(',').includes('null') && gm.dropped.some(d => d.title === 'null' && d.reason === 'ungrounded'));
    ok('9.5 відсутній source_ref прибраний', !t2.split(',').includes('missing'));
    ok('9.6 невідомий і неіснуючий F9 прибрані', !t2.split(',').includes('bad') && !t2.split(',').includes('f9') && gm.dropped.filter(d => d.reason === 'unknown_ref').length === 2, JSON.stringify(gm.dropped));
    ok('9.7 ризики цього екземпляра (null, відсутній, власна мітка) не прибрані', pm.risks.map(r => r.title).join('|') === 'Переднее ДТП|Пробег|Кадр|MI ризик');
    ok('9.8 L<n> у risks і далі прибирається', !pm.risks.some(r => r.title === 'Слабкий') && gm.dropped.some(d => d.where === 'risks' && d.ref === 'L1'));
    /* справжня форма Mercedes W205 після повторного прогону: знання MI немає, знахідок немає */
    const snapW205 = { context: { ...CTX_COLD, knowledge: [], knowledge_count: 0 }, identity: ID_COLD, reportYear: 2026, findings: [] };
    const w = { model_notes: { issues: [
      { unit: 'турбіни', title: 'Турбины и контур охлаждения', detail: 'd', severity: 'med', seller_serviced: false, source_ref: null },
      { unit: 'коробка', title: 'Работа 9-ступенчатой коробки', detail: 'd', severity: 'med', seller_serviced: false, source_ref: null },
    ] }, risks: [{ title: 'Переднее ДТП с непроверенной геометрией', kind: 'finding', source_ref: 'AUTO.RIA history_facts' }], checklist: ['9-ступенчатая коробка: проверить переключения'] };
    M.guardModelNotes(w, snapW205);
    ok('9.9 W205: "Работа 9-ступенчатой коробки" з null більше не слабке місце; перелік чесно порожній; ризик і checklist лишились', w.model_notes.issues.length === 0 && w.risks.length === 1 && w.checklist.length === 1);
    ok('9.10 обґрунтоване MI і F<n> слабке місце з\'являється як звичайно', (() => { const q = { model_notes: { issues: [{ title: 'Пневмостойки', source_ref: 'MI' }, { title: 'Трещины перемычки', source_ref: 'F1' }] } }; M.guardModelNotes(q, snapMI); return q.model_notes.issues.length === 2; })());
    ok('9.11 промпт: MI або F<n> обовʼязкові для issues; risks можуть мати null', /кожен пункт model_notes\.issues МУСИТЬ мати source_ref "MI"/.test(M.researchBlock(snapMI)) && /null для фактів і міркувань про цей екземпляр/.test(M.researchBlock(snapMI)) && /ЛИШЕ з блоку MODEL_INTELLIGENCE \(source_ref "MI"\) або FRESH_WEB_FINDINGS/.test(CHECK));
    const schema = fs.readFileSync('api/check-schema.js', 'utf8');
    ok('8i. схема model_notes.issues і risks несе source_ref', /seller_serviced: S\('boolean'\),\n\s*source_ref: NS\(\)/.test(schema) && /action: S\('string', 'конкретна перевірка до покупки, 1 рядок'\),\n\s*source_ref: NS\(\)/.test(schema));
    ok('8j. фільтр викликається одразу після розбору відповіді основного виклику', core.indexOf('guardModelNotes(parsed, miResearchSnapshot)') > core.indexOf("parsed = JSON.parse((data.choices") && core.indexOf('guardModelNotes(parsed, miResearchSnapshot)') < core.indexOf('parsed._meta = {'));
    ok('8k. телеметрія фільтра у _meta.mi_research', /lead_guard: state\.lead_guard \|\| null/.test(SRC));
    /* Audi A5 з полем площадки "B9/F5": холодне дослідження стартує */
    const Y = await import('file://' + path.join(dir, 'api', 'youtube.js')).catch(() => null);
    const Y2 = Y || await (async () => { fs.writeFileSync(path.join(dir, 'api', 'youtube.js'), fs.readFileSync('api/youtube.js', 'utf8')); return import('file://' + path.join(dir, 'api', 'youtube.js')); })();
    const audiGen = Y2.resolveGeneration([{ value: 'B9/F5', source: 'listing', notModel: 'A5' }]).generation;
    ok('8l. Audi "B9/F5" дає покоління B9; поле AUTO.RIA "Typ 4M" дає 4M', audiGen === 'B9' && Y2.resolveGeneration([{ value: 'Typ 4M', source: 'listing', notModel: 'Q7' }]).generation === '4M', String(audiGen));
    r = await run({ vin: 'WAUZZZF55MA000001', identity: { brand: 'AUDI', model_line: 'A5', generation: audiGen, version_text: '45 TFSI quattro', engine_text: '2 L Gasoline 265 hp', model_year: 2021, mileage_km: 90000 } }, { ctx: CTX_COLD });
    ok('8m. Audi A5 холодне дослідження придатне і стартує в тих самих стелях', r.state.identity.sufficient && r.state.eligibility === 'check_identity' && r.state.batches.length >= 1 && r.state.totals.queries <= 15 && r.state.totals.sources <= 20 && r.calls.search[0].startsWith('AUDI A5 B9'), r.state.reason + ' ' + r.state.identity.label);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('miresearchtest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('miresearchtest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('miresearchtest CRASHED:', e.stack || e.message); process.exit(1); });
