/* MI Research v1 (api/mi-research.js, міграція 028): тест без бази.

   Що доводиться:
   1. наявне MI читається ПЕРЕД пошуком і передається витягу як «відоме»;
   2. не більше 3 запитів і не більше 4 відкритих джерел; площадки і
      соцмережі не відкриваються; один хост один раз;
   3. нуль знахідок це нормальний результат: статус ok, у звіт іде лише MI;
   4. збій контексту, пошуку, джерел чи моделі ніколи не кидає і не
      блокує Check; вимикач MI_RESEARCH=off; обрив сигналом;
   5. свіжі знахідки доходять до блоку основного виклику з формулюванням за
      силою джерела: лише власники дає «власники повідомляють», офіційне
      джерело дає документований факт;
   6. цитата, якої немає у тексті джерела, не є доказом; знахідка без
      доказу зникає; клас домену сильніший за думку моделі;
   7. область компонента без розвʼязаного варіанта звужується до версії,
      а не розширюється; знахідка про VIN у MI не йде;
   8. модуль не містить захардкоджених фактів про моделі;
   9. проводка в api/check.js: старт після Vehicle Memory, очікування не
      довше 3 с перед основним викликом, збереження паралельно, обрив у кінці.

   Запуск: node miresearchtest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const CTX = {
  available: true, identity_id: 7, identity_precision: 'partial',
  identity_summary: { brand: 'Porsche', version: 'Porsche Cayenne GTS 958.1', model_year: '2013', market_operated: 'US',
    components: [{ role: 'engine', variant: 'Porsche M48.02 (4.8 V8)', resolution_status: 'assumed_factory' }] },
  knowledge_count: 2,
  knowledge: [
    { kind: 'issues', area: 'drivetrain', text: 'The transfer case of this generation degrades badly enough that the maker extended its warranty.', knowledge_type: 'known_issue', status: 'CONDITIONAL', severity: 'major', condition: 'transfer case must be the factory unit' },
    { kind: 'issues', area: 'chassis', text: 'Air suspension struts leak with age.', knowledge_type: 'owner_pattern', status: 'APPLICABLE' },
  ],
  last_research_at: null, open_candidates: 0,
};
const items = (...links) => links.map((l, i) => ({ link: l, title: 'T' + i, snippet: 's' }));
const SEARCH = {
  'q1': items('https://www.youtube.com/watch?v=1', 'https://rennlist.com/forums/cayenne-958/scoring.html', 'https://auto.ria.com/uk/x.html', 'https://www.nhtsa.gov/recalls?nhtsaId=21V123'),
  'q2': items('https://www.enginebuilder.example/porsche-48-v8-bores', 'https://rennlist.com/forums/other.html', 'https://www.planet-9.com/threads/tc.1/', 'https://www.motorbiscuit.com/x'),
  'q3': items('https://www.porsche.com/usa/service/campaigns/x', 'https://www.reddit.com/r/porsche/y'),
};
const TEXT = {
  'rennlist.com': 'Long forum thread. My 2013 GTS developed bore scoring at 90k miles and the shop found scored cylinders 2 and 6, the engine needed sleeving. Others report the same. '.repeat(6),
  'nhtsa.gov': 'Safety recall 21V123: Porsche is recalling certain 2011-2014 Cayenne vehicles because the transfer case bolts may loosen. Dealers will replace the bolts free of charge. '.repeat(5),
  'enginebuilder.example': 'We are an engine builder. In our workshop we have rebuilt eleven 4.8 litre V8 engines from the 958 Cayenne S and GTS with cylinder bore scoring; the Alusil bores cannot be rebored and need sleeves. '.repeat(4),
  'planet-9.com': 'Owners discuss shudder from the transfer case at low speed turns. '.repeat(8),
  'example-blog.com': 'A blog retelling common Cayenne problems: coolant pipes, air suspension, transfer case. '.repeat(8),
  'porsche.com': 'Porsche service campaign WKA1: extended warranty for the transfer case on 2011 to 2014 Cayenne models to 10 years or 100,000 miles. '.repeat(5),
};

function stubs(overrides = {}) {
  const calls = { context: 0, search: [], fetch: [], model: 0, order: [] };
  const base = {
    fetchContext: async () => { calls.context++; calls.order.push('context'); return { ok: true, available: true, reason: null, context: CTX, ms: 5 }; },
    search: async (q) => { calls.search.push(q); calls.order.push('search'); const k = 'q' + calls.search.length; return { query: q, ok: true, reason: null, items: SEARCH[k] || [], ms: 3 }; },
    fetchSource: async (src) => { calls.fetch.push(src.host); calls.order.push('fetch'); const text = TEXT[src.host] || ''; return { ...src, status: text ? 'ok' : 'empty', text, chars: text.length, ms: 2 }; },
    callModel: async (body) => { calls.model++; calls.order.push('model'); calls.lastBody = body; return { choices: [{ message: { content: JSON.stringify(overrides.modelOut || { findings: [], sources: [], nothing_new_reason: 'sources repeat what CalCar already knows' }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }; },
  };
  return { calls, opts: { ...base, ...overrides, env: overrides.env || {} } };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_miresearch_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'mi-research.js'));
  const SRC = fs.readFileSync('api/mi-research.js', 'utf8');
  const CHECK = fs.readFileSync('api/check.js', 'utf8');

  /* ---- 1, 2. порядок, ліміти ---- */
  let { calls, opts } = stubs();
  let run = await M.runCheckResearch({ vin: 'WP1ZZZ92ZDLA45155', listingHost: 'auto.ria.com' }, opts);
  ok('1. наявне MI читається першим', calls.order[0] === 'context' && calls.order.indexOf('search') > 0);
  ok('1b. витяг отримує відоме знання', /KNOWN \(2 items/.test(calls.lastBody.messages[1].content) && /transfer case of this generation degrades/.test(calls.lastBody.messages[1].content));
  ok('1c. витяг отримує ідентичність і компоненти', /IDENTITY: Porsche Cayenne GTS 958\.1 M48\.02 2013/.test(calls.lastBody.messages[1].content) && /engine: Porsche M48\.02/.test(calls.lastBody.messages[1].content), calls.lastBody.messages[1].content.split('\n')[0]);
  ok('1d. один виклик витягу з низьким зусиллям і строгою схемою', calls.model === 1 && calls.lastBody.reasoning_effort === 'low' && calls.lastBody.response_format.type === 'json_schema' && calls.lastBody.response_format.json_schema.strict === true);
  ok('2. не більше 3 запитів', calls.search.length === 3 && run.queries.length === 3, calls.search.join(' | '));
  ok('2b. запити з підтвердженої ідентичності, без вигаданих слів', calls.search.every(q => q.startsWith('Porsche Cayenne GTS 958.1 M48.02 2013')));
  ok('2c. другий запит цілить у непокриту область (мотор), не у покриті drivetrain і chassis', /engine problems/.test(calls.search[1]));
  ok('2d. не більше 4 джерел, один хост один раз', calls.fetch.length === 4 && new Set(calls.fetch).size === 4, calls.fetch.join(','));
  ok('2e. площадка, соцмережа і сайт оголошення не відкриваються', !calls.fetch.some(h => /youtube|auto\.ria|reddit/.test(h)) || calls.fetch.filter(h => /reddit/.test(h)).length <= 1);
  ok('2f. офіційні і регуляторні джерела мають пріоритет', calls.fetch.includes('nhtsa.gov') && calls.fetch.includes('porsche.com'), calls.fetch.join(','));
  ok('2g. модель бачить лише читабельні джерела, форум відкрито одним хостом', /SOURCE 3 \| rennlist\.com \| domain class: owner\/secondary/.test(calls.lastBody.messages[1].content) && !/motorbiscuit|planet-9/.test(calls.lastBody.messages[1].content), calls.lastBody.messages[1].content.match(/SOURCE \d[^\n]*/g).join(' ; '));

  /* ---- 3. нуль знахідок ---- */
  ok('3. нуль знахідок це ok', run.status === 'ok' && run.findings.length === 0 && /repeat what CalCar already knows/.test(run.nothing_new_reason));
  let block = M.researchBlock(run);
  ok('3b. у звіт іде наявне MI навіть без знахідок', /MODEL_INTELLIGENCE/.test(block) && /transfer case of this generation/.test(block) && !/FRESH_WEB_FINDINGS \(/.test(block));
  ok('3c. умовне знання позначене як CONDITIONAL з умовою', /CONDITIONAL, major\]/.test(block) && /умова: transfer case must be the factory unit/.test(block));
  ok('3d. немає квоти на знахідки у правилах', /Zero findings is a valid, common result/.test(M.EXTRACTION_RULES) && !/find (at least|3)/i.test(M.EXTRACTION_RULES));

  /* ---- 4. збої, вимикач, обрив ---- */
  ({ calls, opts } = stubs({ fetchContext: async () => { throw new Error('boom'); } }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4. збій контексту не кидає', run.status === 'failed' && run.reason === 'error' && calls.search.length === 0);
  ({ calls, opts } = stubs({ search: async q => ({ query: q, ok: false, reason: 'http_403', items: [], ms: 1 }) }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4b. пошук впав: skipped з причиною, контекст лишається для звіту', run.status === 'skipped' && run.reason === 'http_403' && run.context && M.researchBlock(run) && calls.model === 0);
  ({ calls, opts } = stubs({ fetchSource: async src => ({ ...src, status: 'blocked', text: '', chars: 0, ms: 1 }) }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4c. усі джерела заблоковані: ok без витягу і без знахідок', run.status === 'ok' && run.reason === 'no_readable_sources' && calls.model === 0);
  ({ calls, opts } = stubs({ callModel: async () => ({ error: { message: 'rate limited' } }) }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4d. збій моделі: failed, звіт не чекає', run.status === 'failed' && /extraction_/.test(run.reason));
  ({ calls, opts } = stubs({ callModel: async () => ({ choices: [{ message: { content: 'not json' } }] }) }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4e. невалідний JSON: failed', run.status === 'failed' && run.reason === 'extraction_invalid_json');
  ({ calls, opts } = stubs({ env: { MI_RESEARCH: 'off' } }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4f. вимикач MI_RESEARCH=off: жодного виклику', run.status === 'skipped' && run.reason === 'flag_off' && calls.context === 0);
  const ac = new AbortController(); ac.abort();
  ({ calls, opts } = stubs({ signal: ac.signal }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4g. обрив сигналом до пошуку', run.status === 'aborted' && calls.search.length === 0);
  ({ calls, opts } = stubs({ fetchContext: async () => ({ ok: true, available: false, reason: 'version_not_identified', context: { available: false }, ms: 1 }) }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4h. слабка ідентичність: пошуку немає', run.status === 'skipped' && run.reason === 'version_not_identified' && calls.search.length === 0 && M.researchBlock(run) === null);
  ({ calls, opts } = stubs({ fetchContext: async () => ({ ok: true, available: true, context: { ...CTX, last_research_at: new Date(Date.now() - 86400000).toISOString() }, ms: 1 }) }));
  run = await M.runCheckResearch({ vin: 'V' }, opts);
  ok('4i. нещодавно досліджене: пошуку немає, MI у звіт іде', run.status === 'skipped' && run.reason === 'recently_researched' && calls.search.length === 0 && /MODEL_INTELLIGENCE/.test(M.researchBlock(run)));
  ok('4j. без облікових даних RPC чесно відмовляє', (await M.fetchResearchContext('WP1ZZZ92ZDLA45155', { base: '', key: '' })).reason === 'no_credentials');

  /* ---- 5, 6, 7. знахідки, докази, сила джерела, область ---- */
  const modelOut = {
    findings: [
      { text_en: 'Porsche recalled 2011-2014 Cayenne vehicles because transfer case bolts may loosen (NHTSA 21V123).', scope: 'version', component_role: 'none', knowledge_type: 'official_fact', novelty: 'new', severity: 'major', buyer_importance: 4, buyer_implication_en: 'Check that the recall was performed.', causal_status: 'supported_cause', applicability_note: 'Regulator ties it to 2011-2014 Cayenne.',
        evidence: [{ source_index: 0, excerpt: 'the transfer case bolts may loosen. Dealers will replace the bolts free of charge', stance: 'supports' }] },
      { text_en: 'Cylinder bore scoring occurs on the 4.8 V8 of the 958 Cayenne S and GTS; the Alusil bores cannot be rebored.', scope: 'component', component_role: 'engine', knowledge_type: 'known_issue', novelty: 'strengthens_existing', severity: 'catastrophic', buyer_importance: 5, buyer_implication_en: 'Borescope the cylinders.', causal_status: 'plausible_mechanism', applicability_note: 'Sources name the S and GTS 4.8 V8.',
        evidence: [{ source_index: 2, excerpt: 'rebuilt eleven 4.8 litre V8 engines from the 958 Cayenne S and GTS with cylinder bore scoring', stance: 'supports' },
                   { source_index: 3, excerpt: 'this excerpt was never in the source text at all, invented', stance: 'supports' }] },
      { text_en: 'This particular car had scored cylinders 2 and 6 and needed sleeving.', scope: 'vehicle', component_role: 'none', knowledge_type: 'owner_pattern', novelty: 'new', severity: 'moderate', buyer_importance: 3, buyer_implication_en: 'Ask.', causal_status: 'observed_association', applicability_note: '',
        evidence: [{ source_index: 3, excerpt: 'the shop found scored cylinders 2 and 6, the engine needed sleeving', stance: 'supports' }] },
    ],
    sources: [{ source_index: 0, source_type: 'legal', quality: 'primary', note: 'regulator' }, { source_index: 2, source_type: 'specialist', quality: 'primary', note: 'engine builder describing own cases' }, { source_index: 3, source_type: 'official', quality: 'primary', note: 'model wrongly calls a forum official' }],
    nothing_new_reason: '',
  };
  /* джерела у порядку відбору: nhtsa.gov (legal), porsche.com (official), enginebuilder (невідомий домен), rennlist (форум) */
  ({ calls, opts } = stubs({ modelOut }));
  run = await M.runCheckResearch({ vin: 'WP1ZZZ92ZDLA45155' }, opts);
  ok('5. знахідки обрізані до 2', run.status === 'ok' && run.findings.length === 2, JSON.stringify(run.findings.map(f => f.scope + ':' + f.knowledge_type)));
  const recall = run.findings.find(f => f.knowledge_type === 'official_fact');
  const bore = run.findings.find(f => f.knowledge_type === 'known_issue');
  ok('5b. офіційна знахідка: сила documented, джерело legal з регулятора', recall && recall.strength === 'documented' && recall.evidence[0].source_type === 'legal' && recall.evidence[0].host === 'nhtsa.gov');
  ok('6. вигадана цитата відкинута, справжня лишилась', bore && bore.evidence.length === 1 && /rebuilt eleven/.test(bore.evidence[0].excerpt));
  ok('6b. першоджерело фахівців: specialist primary за оцінкою моделі для невідомого домену', bore && bore.evidence[0].source_type === 'specialist' && bore.evidence[0].quality === 'primary' && bore.strength === 'specialist');
  ok('7. компонентна область збережена лише бо мотор розвʼязаний', bore && bore.scope === 'component' && bore.component_role === 'engine');
  block = M.researchBlock(run);
  ok('5c. блок несе свіжі знахідки з джерелами і правилом формулювання', /FRESH_WEB_FINDINGS/.test(block) && /nhtsa\.gov \(legal\/primary\)/.test(block) && /документований факт/.test(block) && /фахівці описують/.test(block));
  ok('5d. блок пояснює, що це докази, а не перевірене знання, і не переносити на іншу версію', /не перевірене знання CalCar/.test(block) && /до цієї машини не переноси/.test(block) && /не є "типовою" без даних/.test(block));
  ok('5e. слабкі місця: дорога поломка вище дрібних', /мотор, коробка, привід, батарея\) стоїть вище/.test(block));

  /* лише власники + область компонента без розвʼязаного мотора */
  const ownerOnly = { findings: [{ text_en: 'Owners report scored cylinders on the 4.8 V8 around 90k miles that needed sleeving.', scope: 'component', component_role: 'transfer_case', knowledge_type: 'owner_pattern', novelty: 'new', severity: 'major', buyer_importance: 4, buyer_implication_en: 'Borescope.', causal_status: 'observed_association', applicability_note: 'forum only',
    evidence: [{ source_index: 3, excerpt: 'the shop found scored cylinders 2 and 6, the engine needed sleeving', stance: 'supports' }] }],
    sources: [{ source_index: 3, source_type: 'official', quality: 'primary', note: 'wrong' }], nothing_new_reason: '' };
  ({ calls, opts } = stubs({ modelOut: ownerOnly }));
  run = await M.runCheckResearch({ vin: 'WP1ZZZ92ZDLA45155' }, opts);
  ok('7b. нерозвʼязаний компонент: область звужена до версії, не розширена', run.findings.length === 1 && run.findings[0].scope === 'version' && run.findings[0].component_role === null);
  ok('6c. клас домену сильніший за модель: форум лишається owner', run.findings[0].evidence[0].source_type === 'owner' && run.findings[0].evidence[0].quality === 'secondary' && run.findings[0].strength === 'owner');
  block = M.researchBlock(run);
  ok('13. лише власники: формулювання "власники повідомляють", не факт', /власники повідомляють/.test(block) && /НЕ факт і НЕ "типова проблема"/.test(block) && !/документований факт/.test(block));

  /* ---- 8, 9. маршрутизація у MI ---- */
  ({ calls, opts } = stubs({ modelOut }));
  run = await M.runCheckResearch({ vin: 'WP1ZZZ92ZDLA45155' }, opts);
  const payload = M.persistPayload(run, 'tok-1');
  ok('8. знахідки про модель ідуть у MI з областю, типом, доказами', payload.findings.length === 2 && payload.check_token === 'tok-1' && payload.findings.every(f => f.evidence.length >= 1 && f.scope && f.knowledge_type && f.buyer_importance));
  ok('8b. впевненість виводиться з сили доказу', payload.findings.find(f => f.knowledge_type === 'official_fact').confidence === 'high' && payload.findings.find(f => f.knowledge_type === 'known_issue').confidence === 'medium');
  const vehicleRun = { ...run, findings: [...run.findings, { scope: 'vehicle', knowledge_type: 'official_fact', text_en: 'This VIN was sold in Germany in 2022.', evidence: [{ url: 'https://x.example/v', host: 'x.example', source_type: 'market', quality: 'low', stance: 'supports', excerpt: 'sold in Germany in 2022 by a dealer', independence_group: 'x.example' }], strength: 'owner', buyer_importance: 3, causal_status: 'unknown', component_role: null }] };
  const p2 = M.persistPayload(vehicleRun, 'tok-2');
  ok('9. знахідка про VIN у MI не йде', p2.findings.length === 2 && p2.vehicle_scope_dropped === 1 && !p2.findings.some(f => f.scope === 'vehicle'));
  ok('9b. порожнє збереження не викликає RPC', (await M.persistResearch('V', { check_token: 't', findings: [] }, { base: 'https://x', key: 'k', fetch: () => { throw new Error('must not be called'); } })).reason === 'nothing_to_persist');
  const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const r = await M.persistResearch('WP1ZZZ92ZDLA45155', payload, { base: 'https://x', key: 'k', fetch: async () => ({ ok: false, status: 500, json: async () => ({ code: 'XX000', message: 'boom' }) }) });
    ok('9c. збій збереження логується структуровано, не ковтається', !r.ok && logs.some(l => /\[mi-research\]/.test(l) && /"op":"mi_research_persist"/.test(l) && /"status":500/.test(l)));
    const r2 = await M.persistResearch('WP1ZZZ92ZDLA45155', payload, { base: 'https://x', key: 'k', fetch: async (url, init) => ({ ok: true, status: 200, json: async () => ({ ok: true, published: 1, merged: 0, candidates: 1, skipped: 0, fragments_rebuilt: 4, results: [{ index: 1, status: 'published' }, { index: 2, status: 'candidate', gate_failed: ['known_issue_evidence'] }] }) }) });
    ok('9d. успішне збереження: лічильники і результати gate', r2.ok && r2.published === 1 && r2.candidates === 1 && r2.fragments_rebuilt === 4 && r2.results[1].gate_failed[0] === 'known_issue_evidence');
  } finally { console.log = origLog; }
  ok('9e. RPC іде тим самим шляхом /rest/v1/rpc зі службовим ключем', /\/rest\/v1\/rpc\/' \+ name/.test(SRC) && /authorization: 'Bearer ' \+ key/.test(SRC));
  const meta = M.researchMeta(run, { ok: true, published: 1 });
  ok('9f. телеметрія без текстів джерел і ключів', meta.findings.length === 2 && !JSON.stringify(meta).includes('rebuilt eleven') && meta.sources.every(s => !s.url) && meta.persist.published === 1);

  /* ---- 8'. модуль без захардкоджених фактів ---- */
  ok('15. у модулі немає фактів про моделі (задири, Cayenne, конкретні мотори)', !/bore|scoring|cayenne|m48|n63|theta/i.test(SRC));
  ok('15b. довгого тире немає', !/\u2014/.test(SRC) && !/\u2014/.test(fs.readFileSync('migrations/mi/028_check_research.up.sql', 'utf8')));

  /* ---- 10. проводка в api/check.js ---- */
  const core = CHECK.slice(CHECK.indexOf('async function runCheck('));
  ok('10. дослідження стартує після Vehicle Memory і після кандидатів обладнання', core.indexOf('runCheckResearch({ vin: listing.vin') > core.indexOf('miEqPromise.then(miEqResolve)') && core.indexOf('runCheckResearch(') < core.indexOf("progress('history')"));
  ok('10b. основний виклик чекає не довше 3 с', /const MI_RESEARCH_MAIN_WAIT_MS = 3000;/.test(core) && /Promise\.race\(\[miResearchPromise, new Promise\(r => setTimeout\([\s\S]{0,220}?, MI_RESEARCH_MAIN_WAIT_MS\)\)\]\)/.test(core));
  ok('10c. блок вставляється у контекст основного виклику до його старту', core.indexOf("content.splice(1, 0, { type: 'text', text: miResearchBlock })") < core.indexOf("progress('ai')"));
  ok('10d. збереження стартує з готовності дослідження, паралельно основному виклику', /miResearchPromise\.then\(r => \(r && r\.status === 'ok' && r\.findings\.length && listing\.vin\)\s*\? persistResearch\(listing\.vin, persistPayload\(r, job && job\.token\)\)/.test(core));
  ok('10e. у кінці Check дослідження обривається, продовження після відповіді немає', /miResearchAbort\.abort\(\);/.test(core) && core.indexOf('miResearchAbort.abort();') < core.indexOf('timings.total_ms = Date.now() - tRun'));
  ok('10f. callModel приймає сигнал обриву', /const callModel = async \(body, ms, signal\) =>/.test(core));
  ok('10g. телеметрія і структурований лог', /parsed\._meta\.mi_research = researchMeta\(miResearch, miResearchPersist\)/.test(core) && /console\.log\('\[mi-research\]'/.test(core));
  ok('10h. ядро Check про тінь так і не знає', !/runMiShadow|mi_shadow_pack/.test(core));
  ok('10i. Score, впевненість і вердикт дослідження не читають', !/mi_research|miResearch/.test(fs.readFileSync('api/score-v4.js', 'utf8')) && !/mi_research/.test(fs.readFileSync('api/share.js', 'utf8')));
  ok('10j. вимикач читає лише api/mi-research.js', fs.readdirSync('api').filter(f => f.endsWith('.js') && /\.MI_RESEARCH\b/.test(fs.readFileSync('api/' + f, 'utf8'))).join() === 'mi-research.js');

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('miresearchtest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('miresearchtest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('miresearchtest CRASHED:', e.stack || e.message); process.exit(1); });
