/* Шар накопичення знань: чисті build-функції з api/check.js, recompute і
   сторожі схеми. Перевіряється: ідемпотентність у межах снапшота, нові
   снапшоти не чіпають старі, ABSENT лише від довідного джерела, model_notes
   ніколи не потрапляють у issue_observation, historical не підтверджує
   PRESENT, кілька evidence живуть окремо, recompute детермінований і
   рахує по унікальних VIN. */
const fs = require('fs');

const errs = [];
const api = fs.readFileSync('api/check.js', 'utf8');
const sql = fs.readFileSync('supabase-knowledge.sql', 'utf8');

const grab = (src, name) => {
  const m = src.match(new RegExp('(async )?function ' + name + '\\([\\s\\S]*?\\n\\}'));
  return m && m[0];
};

/* ---- 1. чисті функції ---- */
const fns = ['normalizeOptionAlias', 'evidenceKey', 'absentAllowed', 'buildEquipmentObservations', 'validateEquipmentObservation', 'buildIssueObservations', 'buildCoverageRows']
  .map(n => grab(api, n));
if (fns.some(x => !x)) {
  errs.push('не знайдені build-функції шару знань');
} else {
  const lib = new Function(
    "const KNOWLEDGE_SOURCE_MAP = { factory_data: 'vehicle_data', visual: 'visual', listing_data: 'listing_data', seller: 'seller_text', historical: 'historical', document: 'document' };\n"
    + "const ISSUE_TYPE_BY_SOURCE = { historical: 'historical_record', visual: 'visible_defect', document: 'document', seller_text: 'seller_statement', vehicle_data: 'inspection_record', listing_data: 'historical_record' };\n"
    + "const TECHNICAL_ISSUE_TYPES = ['SRS_FAULT', 'SERIOUS_POWERTRAIN_FAULT', 'CRITICAL_WARNING_LIGHTS', 'MODIFICATION_TECHNICAL_CONCERN'];\n"
    + fns.join('\n')
    + '\nreturn { normalizeOptionAlias, evidenceKey, absentAllowed, buildEquipmentObservations, validateEquipmentObservation, buildIssueObservations, buildCoverageRows };')();

  const listing = { vin: 'VIN1', make: 'bmw', model: '5 series', generation: 'G30', year: 2018, country: 'UA', seller_text: 'опис', listing_equipment: ['Камера 360'], history_facts: { accident_recorded: true, accident_note: 'права сторона' } };
  const parsed = {
    vehicle: { engine: '2.0', trim: '530e', drive: 'повний' },
    equipment_v2: [
      { name: 'Bowers & Wilkins', category: 'multimedia', confidence_level: 'visual', retrofit: false, provenance: [{ type: 'visual', ref: 'photo_11', evidence: 'логотип' }, { type: 'visual', ref: 'photo_12', evidence: 'ще логотип' }] },
      { name: 'HUD', category: 'assist', confidence_level: 'seller_and_visual', retrofit: false, provenance: [{ type: 'seller', ref: null, evidence: 'вказано' }, { type: 'visual', ref: 'photo_5', evidence: 'модуль' }] },
      { name: 'Панорама', category: 'comfort', confidence_level: null, historical_claim: true, provenance: [{ type: 'historical', ref: 'auction:IAAI:1', evidence: 'у картці лота' }] },
    ],
    score_facts: {
      findings: [
        { type: 'AIRBAGS_DEPLOYED', event_id: 'accident_2024', evidence: [{ source: 'us_auction', ref: 'auction_metadata', description: 'Airbag: Driver' }] },
        { type: 'SRS_FAULT', event_id: 'current_srs_fault', evidence: [{ source: 'current_photos', ref: 'photo_9', description: 'лампа SRS на панелі' }] },
        { type: 'FLOOD', event_id: 'flood_x', evidence: [] },
      ],
    },
    model_notes: { issues: [{ unit: 'B48', title: 'Течі помпи', detail: 'типова болячка' }] },
    _meta: { photo_selection: { gallery_coverage_complete: true, selector: { types: ['front', 'trunk', 'dashboard', 'front'] } } },
  };

  /* ідемпотентність: три прогони того самого снапшота = ті самі ключі */
  const runA = lib.buildEquipmentObservations(parsed, listing, 'snap1');
  const runB = lib.buildEquipmentObservations(parsed, listing, 'snap1');
  const runC = lib.buildEquipmentObservations(parsed, listing, 'snap1');
  const keys = r => JSON.stringify(r.map(x => [x.observation.vin, x.observation.snapshot_id, x.option_name, x.evidence.map(e => e.evidence_key)]));
  if (keys(runA) !== keys(runB) || keys(runB) !== keys(runC)) errs.push('потрійний прогін дає різні ключі: дублі в БД');
  /* новий снапшот: нові записи (інший unique-ключ), старі недоторкані */
  const runNew = lib.buildEquipmentObservations(parsed, listing, 'snap2');
  if (keys(runNew) === keys(runA)) errs.push('новий снапшот не відрізняється ключами');
  if (!runNew.every(r => r.observation.snapshot_id === 'snap2')) errs.push('новий снапшот пише не у свій ключ');

  /* кілька evidence зберігаються окремо з різними ключами */
  const bw = runA.find(r => r.option_name === 'Bowers & Wilkins');
  if (!bw || bw.evidence.length !== 2) errs.push('кілька evidence схлопнулись');
  if (bw && new Set(bw.evidence.map(e => e.evidence_key)).size !== 2) errs.push('evidence_key не унікальні');

  /* historical не підтверджує PRESENT поточного снапшота */
  const pano = runA.find(r => r.option_name === 'Панорама');
  if (!pano || pano.observation.state !== 'UNKNOWN') errs.push('historical-only дав не UNKNOWN: ' + (pano && pano.observation.state));
  if (pano && pano.evidence[0].claim_state !== 'UNKNOWN') errs.push('historical evidence стверджує PRESENT');

  /* ABSENT від partial-джерела відхиляється, від довідного проходить */
  const absBad = { observation: { state: 'ABSENT' }, evidence: [{ source_type: 'visual' }, { source_type: 'seller_text' }] };
  if (lib.validateEquipmentObservation(absBad)) errs.push('ABSENT від visual/seller пройшов');
  const absList = { observation: { state: 'ABSENT' }, evidence: [{ source_type: 'listing_data' }] };
  if (lib.validateEquipmentObservation(absList)) errs.push('ABSENT від marketplace пройшов');
  const absOk = { observation: { state: 'ABSENT' }, evidence: [{ source_type: 'document' }] };
  if (!lib.validateEquipmentObservation(absOk)) errs.push('ABSENT від документа хибно відхилений');

  /* retrofit прапорець їде в спостереження; false не означає factory */
  if (bw.observation.retrofit !== false) errs.push('retrofit загублений');
  /* ринки розділені: listing_market з оголошення, factory_market не вгадується */
  if (bw.observation.listing_market !== 'UA' || bw.observation.factory_market !== null) errs.push('ринки не розділені або factory вгаданий');

  /* issue_observation: лише ТЕХНІЧНІ vehicle-specific знахідки з доказом.
     ДТП/damage/history події лишаються у Vehicle Graph шарах */
  const issues = lib.buildIssueObservations(parsed, listing, 'snap1');
  if (!issues.find(i => i.observation.event_key === 'current_srs_fault' && i.observation.issue_key === 'SRS_FAULT')) errs.push('технічна знахідка з доказом загублена');
  if (issues.find(i => i.observation.issue_key === 'AIRBAGS_DEPLOYED')) errs.push('damage-подія (ДТП) потрапила в issue_observation');
  if (issues.find(i => i.observation.issue_key === 'FLOOD')) errs.push('знахідка БЕЗ первинного доказу пройшла');
  if (issues.find(i => i.observation.event_key === 'platform_accident_record' || i.observation.issue_key === 'ACCIDENT_RECORDED')) errs.push('запис ДТП площадки пише в issue_observation');
  const biSrc0 = grab(api, 'buildIssueObservations');
  if (/accident_recorded/.test(biSrc0)) errs.push('хук досі читає accident_recorded для issues');
  /* типові слабкі місця моделі не потрапляють ніколи */
  const blob = JSON.stringify(issues);
  if (blob.includes('Течі помпи') || blob.includes('B48')) errs.push('model_notes потрапили в issue_observation');
  const biSrc = grab(api, 'buildIssueObservations');
  /* заборона архітектурна: функція не звертається до цих полів даних
     (коментарі не рахуються, шукаємо реальні доступи) */
  if (/parsed[.)]?[\s\S]{0,10}model_notes|\.model_notes/.test(biSrc)) errs.push('buildIssueObservations читає model_notes');
  if (/parsed\.risks|\.risks\b/.test(biSrc)) errs.push('buildIssueObservations читає generic risks');
  if (/purchase_decision|reasoning/.test(biSrc.replace(/\/\*[\s\S]*?\*\//g, ''))) errs.push('buildIssueObservations читає generated reasoning');

  /* coverage: visual завжди partial, повна галерея живе окремо */
  const cov = lib.buildCoverageRows(parsed, listing, 'snap1', parsed._meta);
  const vis = cov.find(c => c.source_type === 'visual');
  if (!vis || vis.completeness !== 'partial') errs.push('visual coverage не partial');
  if (vis && vis.gallery_complete !== true) errs.push('повний перегляд галереї загублений');
  if (vis && JSON.stringify(vis.covered_areas) !== JSON.stringify(['front', 'trunk', 'dashboard'])) errs.push('covered_areas не з типів кадрів: ' + JSON.stringify(vis && vis.covered_areas));
}

/* ---- 2. recompute: детермінований, по унікальних VIN ---- */
{
  const { computeDerivedStats } = require('./knowledge-recompute.js');
  const eq = [
    /* одна машина, ДВА снапшоти тієї самої опції: prevalence не росте */
    { vin: 'V1', option_id: 'o1', state: 'PRESENT', make: 'BMW', model: '5', generation: 'G30', model_year: 2018 },
    { vin: 'V1', option_id: 'o1', state: 'PRESENT', make: 'BMW', model: '5', generation: 'G30', model_year: 2018 },
    { vin: 'V2', option_id: 'o1', state: 'UNKNOWN', make: 'BMW', model: '5', generation: 'G30', model_year: 2019 },
  ];
  const iss = [
    { vin: 'V1', issue_key: 'SRS_FAULT', make: 'BMW', model: '5', generation: 'G30', model_year: 2018, verification_status: 'unverified' },
    { vin: 'V1', issue_key: 'SRS_FAULT', make: 'BMW', model: '5', generation: 'G30', model_year: 2018, verification_status: 'unverified' },
    { vin: 'V2', issue_key: 'SRS_FAULT', make: 'BMW', model: '5', generation: 'G30', model_year: 2019, verification_status: 'verified' },
  ];
  const cov = [{ vin: 'V1', source_type: 'visual' }, { vin: 'V2', source_type: 'visual' }];
  const a = computeDerivedStats(eq, iss, cov);
  const b = computeDerivedStats(eq, iss, cov);
  if (JSON.stringify(a) !== JSON.stringify(b)) errs.push('recompute не детермінований');
  const gen = a.optionStats.find(r => r.model_year === null && r.option_id === 'o1');
  if (!gen || gen.vehicles_present !== 1) errs.push('повторний снапшот однієї машини збільшив prevalence: ' + (gen && gen.vehicles_present));
  if (gen && gen.vehicles_unknown !== 1) errs.push('unknown по унікальних VIN зламаний');
  if (gen && gen.vehicles_covered !== 2) errs.push('знаменник coverage не 2: ' + (gen && gen.vehicles_covered));
  const genI = a.issueStats.find(r => r.model_year === null);
  if (!genI || genI.vehicles_affected !== 2) errs.push('issue лічильник не по унікальних VIN: ' + (genI && genI.vehicles_affected));
  /* unverified не змішуються з verified: verified рахується окремо */
  if (!genI || genI.vehicles_verified !== 1) errs.push('verified не відокремлені від unverified: ' + (genI && genI.vehicles_verified));
  /* хибного знаменника частоти болячки нема до issue-coverage шару */
  if (genI && 'vehicles_total' in genI) errs.push('derived_issue_stats має хибний знаменник vehicles_total');
  /* "знесли кеш і перерахували": той самий вхід дає ті самі цифри */
  const c = computeDerivedStats(JSON.parse(JSON.stringify(eq)), JSON.parse(JSON.stringify(iss)), JSON.parse(JSON.stringify(cov)));
  if (JSON.stringify(c) !== JSON.stringify(a)) errs.push('перерахунок з нуля дає інші цифри');
}

/* ---- 3. сторожі схеми (файл міграції; до Supabase застосовує власник) ---- */
{
  for (const tbl of ['option_dict', 'option_alias', 'equipment_observation', 'equipment_observation_evidence', 'observation_coverage', 'issue_observation', 'issue_observation_evidence', 'model_option_catalog', 'model_issue_catalog', 'derived_option_stats', 'derived_issue_stats']) {
    if (!sql.includes('create table if not exists public.' + tbl)) errs.push('міграція без ' + tbl);
    if (!sql.includes('alter table public.' + tbl + ' enable row level security')) errs.push('RLS не увімкнений: ' + tbl);
  }
  if (/create policy/i.test(sql)) errs.push('у шарі знань зʼявились політики: він лише для service_role');
  if (!sql.includes('unique (vin, snapshot_id, option_id)')) errs.push('нема unique-ключа спостереження комплектації');
  if (!sql.includes('unique (vin, snapshot_id, event_key)')) errs.push('нема unique-ключа події issue');
  if (!sql.includes('unique (observation_id, evidence_key)')) errs.push('нема ідемпотентності evidence');
  if (!sql.includes('visual_never_complete')) errs.push('нема CHECK: visual не може бути complete');
  if (!sql.includes('issue_key')) errs.push('нема семантичного issue_key');
  if (!sql.includes('vehicles_verified')) errs.push('derived_issue_stats не розрізняє verified');
  {
    const disBlock = sql.slice(sql.indexOf('derived_issue_stats'));
    if (disBlock.includes('vehicles_total')) errs.push('derived_issue_stats досі має vehicles_total');
    const rcSrc = fs.readFileSync('knowledge-recompute.js', 'utf8');
    if (rcSrc.includes('vehicles_total')) errs.push('recompute досі рахує vehicles_total для болячок');
  }
  if ((sql.match(/evidence_excerpt text not null/g) || []).length !== 2) errs.push('evidence_excerpt у каталогах не NOT NULL');
  {
    const micBlock = sql.slice(sql.indexOf('model_issue_catalog'), sql.indexOf('derived_option_stats'));
    if (!micBlock.includes('issue_key text not null')) errs.push('model_issue_catalog.issue_key не NOT NULL');
  }
  {
    const ioBlock = sql.slice(sql.indexOf('public.issue_observation ('), sql.indexOf('issue_observation_evidence'));
    if (!ioBlock.includes('issue_key   text,')) errs.push('issue_observation.issue_key має лишатись nullable');
  }
  {
    const seedSrc2 = fs.readFileSync('knowledge-seed.js', 'utf8');
    if (!seedSrc2.includes('!fct.issue_key) continue')) errs.push('seed пише болячку без issue_key');
  }
  if (!api.includes('TECHNICAL_ISSUE_TYPES')) errs.push('хук без whitelist технічних типів');
  if (!sql.includes('listing_market') || !sql.includes('factory_market')) errs.push('ринки не розділені у схемі');
  if (!sql.includes("source_url  text not null")) errs.push('каталог допускає факт без source_url');
  /* хук не ламає Check і не оновлює derived */
  if (!api.includes("console.log('[knowledge] хук впав, Check не зачеплений:'")) errs.push('хук без ізоляції помилок');
  if (!api.includes('Array.isArray(j) ? j :') && !api.includes('if (Array.isArray(j)) return j;')) errs.push('хук ітерує PostgREST-помилку як масив');
  if (!api.includes("const inList = vals =>")) errs.push('in.() без лапок: пробіли ламають фільтр');
  /* headers після spread opts: opts.headers не сміє затирати auth */
  for (const [fname, src] of [['api/check.js', api], ['knowledge-recompute.js', fs.readFileSync('knowledge-recompute.js', 'utf8')], ['knowledge-seed.js', fs.readFileSync('knowledge-seed.js', 'utf8')]]) {
    if (/Object\.assign\(\{\s*headers:[\s\S]{0,200}?\},\s*opts\)\)/.test(src)) errs.push(fname + ': opts затирає auth-заголовки (401 на POST)');
  }
  if (/derived_option_stats|derived_issue_stats/.test(api)) errs.push('Check чіпає derived-кеш напряму');
  const seedSrc = fs.readFileSync('knowledge-seed.js', 'utf8');
  if (!seedSrc.includes('fct.evidence_excerpt) continue')) errs.push('seed пише факт без excerpt-підстави');
  if (!seedSrc.includes('ЗАБОРОНЕНО додавати факти з власної памʼяті')) errs.push('seed дозволяє LLM відповідати з памʼяті');
}

if (errs.length) { console.log('FAILED:', errs); process.exit(1); }
console.log('ідемпотентність снапшота · нові снапшоти окремо · ABSENT лише довідний · без model_notes · historical не PRESENT · evidence окремо · recompute по VIN · сторожі схеми');
console.log('KNOWLEDGE TEST PASSED');
