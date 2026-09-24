/* Score v4 shadow: порівняння v3 і v4 на реальних Check.

   Два режими:
   1) node scorev4shadow.js --file rows.json
      rows.json: масив компактних рядків (див. compactRow нижче), наприклад
      вивантаження check_jobs через SQL;
   2) SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY в env: читає check_jobs
      (status done) через PostgREST сам, останній джоб кожного VIN.

   Друкує: eligibility, розподіл v4, v3 проти v4, строки розкладання.
   Нічого не пише ні в БД, ні в репозиторій (лише --out для JSON). */
const fs = require('fs');

function compactRow(job) {
  const r = job.report || {};
  const m = r._meta || {};
  const cvs = m.current_visual_shadow || null;
  const cv = cvs && cvs.current_visual ? cvs.current_visual : null;
  return {
    vin: job.vin || m.vin || null,
    created_at: job.created_at || m.analyzed_at || null,
    title: r.vehicle && r.vehicle.title,
    v3_final: r.score_breakdown && r.score_breakdown.final,
    v3_grade: r.score_breakdown && r.score_breakdown.grade,
    findings: (r.score_facts && r.score_facts.findings) || [],
    hv: r.historical_visual || null,
    coverage_inputs: (r.score_breakdown && r.score_breakdown.coverage_inputs) || {},
    auction: m.auction_search ? {
      status: m.auction_search.status, lot_id: m.auction_search.lot_id_meta || null, house: m.auction_search.house || null,
      sale_date: m.auction_search.sale_date || null, airbags: m.auction_search.airbags_meta || null,
      primary_damage: m.auction_search.primary_damage || null, secondary_damage: m.auction_search.secondary_damage || null,
      odometer: m.auction_search.odometer || null,
    } : null,
    history_facts: m.history_facts || null,
    seller_text: m.seller_text || '',
    fuel: r.vehicle && r.vehicle.fuel, year: r.vehicle && r.vehicle.year, odometer_km: m.odometer_km,
    cv_status: cvs ? cvs.status : 'absent',
    cv_zones: cv ? Object.fromEntries(Object.entries(cv.zones || {}).map(([k, z]) => [k, z.visibility])) : null,
    cv_findings: cv ? Object.entries(cv.zones || {}).flatMap(([zone, z]) => (z.findings || []).map(f => ({ zone, kind: f.kind, severity: f.severity, confidence: f.confidence, sign: f.sign, gallery_index: f.gallery_index, component: f.component, wheel_position: f.wheel_position }))) : [],
    cv_odometer: cv && cv.dashboard ? cv.dashboard.odometer_reading : null,
    seller_disclosures: r.seller_disclosures || [],
  };
}

async function fetchRows() {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('потрібні SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY або --file');
  const rows = [];
  for (let off = 0; ; off += 50) {
    const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/check_jobs?status=eq.done&select=vin,created_at,report&order=created_at.asc&offset=' + off + '&limit=50',
      { headers: { apikey: key, authorization: 'Bearer ' + key } });
    if (!r.ok) throw new Error('check_jobs HTTP ' + r.status);
    const page = await r.json();
    rows.push(...page.map(compactRow));
    if (page.length < 50) break;
  }
  return rows;
}

function buildInput(row, V4, V3) {
  const hf = row.history_facts || {};
  const ci = row.coverage_inputs || {};
  const now = row.created_at ? Date.parse(row.created_at) : Date.now();
  const age = V3.resolveVehicleAge({ model_year: row.year || null }, now);
  const nowIso = new Date(now).toISOString().slice(0, 10);
  const cvOk = row.cv_status === 'ok' && row.cv_zones;
  const zones = cvOk ? { sufficient: Object.keys(row.cv_zones).filter(z => row.cv_zones[z] === 'sufficient'), partial: Object.keys(row.cv_zones).filter(z => row.cv_zones[z] === 'partial'), not_visible: Object.keys(row.cv_zones).filter(z => row.cv_zones[z] === 'not_visible') } : null;
  const findings = cvOk ? (row.cv_findings || []).filter(f => f.severity !== 'minor' && f.confidence !== 'low').map(f => ({ ...f, component: f.component || 'other', wheel_position: f.wheel_position || null, photo: (f.gallery_index || 0) + 1 })) : [];
  const points = [];
  for (const p of Array.isArray(hf.mileage_points) ? hf.mileage_points : []) points.push(p);
  if (row.auction && row.auction.status === 'found' && row.auction.odometer && row.auction.odometer.value != null && row.auction.sale_date) {
    points.push({ km: row.auction.odometer.value, unit: row.auction.odometer.unit, status: row.auction.odometer.status || 'unknown', date: row.auction.sale_date, source: 'auction', family: 'auction' });
  }
  if (typeof row.odometer_km === 'number' && row.odometer_km > 0) points.push({ km: row.odometer_km, date: nowIso, source: 'listing', family: 'current' });
  if (row.cv_odometer && row.cv_odometer.value > 0 && ['km', 'mi'].includes(row.cv_odometer.unit)) points.push({ km: row.cv_odometer.value, unit: row.cv_odometer.unit, date: nowIso, source: 'dashboard', family: 'dashboard' });
  const auctionMeta = ci.auction_record_exists ? {
    lot_id: row.auction && row.auction.lot_id, house: row.auction && row.auction.house, sale_date: row.auction && row.auction.sale_date,
    airbags: row.auction && row.auction.airbags && typeof row.auction.airbags === 'object' ? { deployed: row.auction.airbags.deployed === true, raw: row.auction.airbags.raw || null } : null,
    primary_damage: row.auction && row.auction.primary_damage, secondary_damage: row.auction && row.auction.secondary_damage,
  } : null;
  return {
    findings: row.findings, auctionMeta, historicalVisual: row.hv,
    accidentRecord: hf.accident_recorded === true ? { recorded: true, note: hf.accident_note || null } : null,
    auctionChecked: !!(row.auction && row.auction.status),
    currentVisual: cvOk ? { zones, condition_findings: findings } : null,
    vehicle: { odometer_km: typeof row.odometer_km === 'number' ? row.odometer_km : null, age_months: age.age_months, age_source: age.age_source, powertrain_class: V4.resolvePowertrainClass({ fuel: row.fuel }) },
    mileagePoints: points, platformMileageFlag: false,
    sellerDisclosures: row.seller_disclosures, listingText: row.seller_text || '',
    evidence: {
      identity_confirmed: ci.identity_confirmed, basics_known: ci.basics_known, photos_count: ci.photos_count,
      seller_text_chars: String(row.seller_text || '').trim().length, auction_record_exists: ci.auction_record_exists,
      registry_present: hf.registry_present === true, historical_listings_count: ci.historical_listings_count,
      cv_status: row.cv_status, cv_zones_sufficient: zones ? zones.sufficient.length : 0, listing_vin: row.vin,
    },
  };
}

(async () => {
  const V4 = await import('./api/score-v4.js');
  const V3 = await import('./api/score-v3.js');
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const outIdx = args.indexOf('--out');
  let rows = fileIdx >= 0 ? JSON.parse(fs.readFileSync(args[fileIdx + 1], 'utf8')) : await fetchRows();
  if (rows.length && rows[0].report) rows = rows.map(compactRow);
  /* останній джоб кожного VIN */
  const byVin = new Map();
  for (const r of rows) if (r.vin) byVin.set(r.vin, r);
  const results = [];
  for (const row of byVin.values()) {
    const inp = buildInput(row, V4, V3);
    const b = V4.computeScoreV4(inp);
    results.push({ vin: row.vin, title: row.title, v3: row.v3_final, v3_grade: row.v3_grade, v4: b.final, v4_if_eligible: b.final_if_eligible,
      eligible: b.score_eligible, reason: b.score_unavailable_reason, strong: b.eligibility.strong_negative, domains: b.eligibility.domains_count, rich: b.eligibility.rich_visual,
      items: b.items.map(i => i.key + ' ' + i.amount), events: b.events.map(e => e.v4_category + (e.latest ? '*' : '') + '(' + e.category_basis.join('+') + ')'),
      inputs: Object.fromEntries(Object.entries(b.inputs).map(([k, v]) => [k, v.status])), unresolved: b.unresolved.map(u => u.key), dropped: b.dropped, intensity: b.mileage_intensity });
  }
  const pad = (v, n) => String(v ?? '-').slice(0, n).padEnd(n);
  console.log(pad('VIN', 18), pad('v3', 5), pad('v4', 5), pad('elig', 6), pad('items', 70));
  for (const r of results) console.log(pad(r.vin, 18), pad(r.v3, 5), pad(r.v4 === null ? 'n/a' : r.v4, 5), pad(r.eligible ? 'yes' : r.reason, 6), pad(r.items.join(', '), 70));
  const el = results.filter(r => r.eligible);
  const dist = {};
  for (const r of el) dist[r.v4] = (dist[r.v4] || 0) + 1;
  console.log('\nVIN:', results.length, '| eligible:', el.length, '| not eligible:', results.filter(r => !r.eligible).map(r => r.vin.slice(-6) + ':' + r.reason).join(' ') || 'none');
  console.log('v4 distribution:', JSON.stringify(Object.fromEntries(Object.entries(dist).sort((a, b) => Number(a[0]) - Number(b[0])))));
  const both = el.filter(r => typeof r.v3 === 'number');
  const diff = both.map(r => r.v4 - r.v3);
  if (diff.length) console.log('v4 - v3: mean', (diff.reduce((a, b) => a + b, 0) / diff.length).toFixed(2), '| min', Math.min(...diff).toFixed(1), '| max', Math.max(...diff).toFixed(1), '| n', diff.length);
  const st = {};
  for (const r of results) for (const [k, v] of Object.entries(r.inputs)) { st[k] = st[k] || {}; st[k][v] = (st[k][v] || 0) + 1; }
  console.log('input states:', JSON.stringify(st));
  if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], JSON.stringify(results, null, 1));
})().catch(e => { console.error('shadow failed:', e.stack || e.message); process.exit(1); });
