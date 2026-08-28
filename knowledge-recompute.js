/* CalCar: перерахунок derived-агрегатів шару знань.
   Запуск РУКАМИ або розкладом (node knowledge-recompute.js), НІКОЛИ з Check:
   Check лічильники не оновлює. Результат: повністю rebuildable кеш у
   derived_option_stats і derived_issue_stats: його можна знести і зібрати
   заново, цифри ті самі (детермінована чиста функція computeDerivedStats).

   Правила чесності:
   - частоти по УНІКАЛЬНИХ VIN, не по снапшотах: повторні оголошення однієї
     машини prevalence не збільшують;
   - знаменник vehicles_covered враховує coverage: серед машин, де джерело
     взагалі могло бачити комплектацію (є хоч один coverage-рядок);
   - зрізи: рівень покоління (variant-поля null) плюс зріз по model_year. */

const ENV_BASE = process.env.SUPABASE_URL;
const ENV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* чиста детермінована функція: спостереження + покриття -> рядки кешу */
function computeDerivedStats(equipmentObs, issueObs, coverage) {
  const covVins = new Set((coverage || []).map(c => c.vin).filter(Boolean));
  const modelKey = o => [o.make || '', o.model || '', o.generation || ''].join('');

  /* по моделі: множина унікальних VIN, які взагалі покриті */
  const coveredByModel = new Map();
  const vinModel = new Map();
  for (const o of [...(equipmentObs || []), ...(issueObs || [])]) {
    if (o.vin && !vinModel.has(o.vin)) vinModel.set(o.vin, modelKey(o));
  }
  for (const [vin, mk] of vinModel) {
    if (!covVins.has(vin)) continue;
    if (!coveredByModel.has(mk)) coveredByModel.set(mk, new Set());
    coveredByModel.get(mk).add(vin);
  }

  const optionRows = new Map();
  for (const o of equipmentObs || []) {
    if (!o.vin || !o.option_id) continue;
    /* два зрізи: покоління (variant null) і model_year */
    for (const my of [null, o.model_year || null]) {
      const key = [modelKey(o), my == null ? '' : my, o.option_id].join('');
      if (!optionRows.has(key)) {
        optionRows.set(key, {
          make: o.make || '', model: o.model || '', generation: o.generation || null,
          model_year: my == null ? null : my, engine: null, trim: null, drivetrain: null,
          option_id: o.option_id,
          present: new Set(), absent: new Set(), unknown: new Set(),
        });
      }
      const row = optionRows.get(key);
      /* унікальні VIN: найсильніший стан перемагає (PRESENT > ABSENT > UNKNOWN) */
      if (o.state === 'PRESENT') { row.present.add(o.vin); row.absent.delete(o.vin); row.unknown.delete(o.vin); }
      else if (o.state === 'ABSENT') { if (!row.present.has(o.vin)) { row.absent.add(o.vin); row.unknown.delete(o.vin); } }
      else if (!row.present.has(o.vin) && !row.absent.has(o.vin)) row.unknown.add(o.vin);
    }
  }
  const optionStats = [...optionRows.values()].map(r => ({
    make: r.make, model: r.model, generation: r.generation,
    model_year: r.model_year, engine: r.engine, trim: r.trim, drivetrain: r.drivetrain,
    option_id: r.option_id,
    vehicles_present: r.present.size,
    vehicles_absent: r.absent.size,
    vehicles_unknown: r.unknown.size,
    vehicles_covered: (coveredByModel.get([r.make, r.model, r.generation || ''].join('')) || new Set()).size,
  })).sort((a, b) => (a.make + a.model + a.option_id).localeCompare(b.make + b.model + b.option_id));

  const issueRows = new Map();
  for (const o of issueObs || []) {
    if (!o.vin || !o.issue_key) continue;
    for (const my of [null, o.model_year || null]) {
      const key = [modelKey(o), my == null ? '' : my, o.issue_key].join('');
      if (!issueRows.has(key)) {
        issueRows.set(key, {
          make: o.make || '', model: o.model || '', generation: o.generation || null,
          model_year: my == null ? null : my, engine: null, trim: null, drivetrain: null,
          issue_key: o.issue_key, affected: new Set(),
        });
      }
      issueRows.get(key).affected.add(o.vin);
    }
  }
  const issueStats = [...issueRows.values()].map(r => ({
    make: r.make, model: r.model, generation: r.generation,
    model_year: r.model_year, engine: r.engine, trim: r.trim, drivetrain: r.drivetrain,
    issue_key: r.issue_key,
    vehicles_affected: r.affected.size,
    vehicles_total: (coveredByModel.get([r.make, r.model, r.generation || ''].join('')) || new Set()).size,
  })).sort((a, b) => (a.make + a.model + a.issue_key).localeCompare(b.make + b.model + b.issue_key));

  return { optionStats, issueStats };
}

async function api(path, opts) {
  const r = await fetch(ENV_BASE.replace(/\/$/, '') + '/rest/v1/' + path, Object.assign({
    headers: Object.assign({
      apikey: ENV_KEY, authorization: 'Bearer ' + ENV_KEY, 'content-type': 'application/json',
    }, (opts && opts.headers) || {}),
  }, opts));
  if (!r.ok && r.status !== 404) throw new Error(path.split('?')[0] + ': HTTP ' + r.status);
  return r;
}

async function fetchAll(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await api(table + '?select=' + select + '&limit=1000&offset=' + from);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  if (!ENV_BASE || !ENV_KEY) {
    console.error('Потрібні env SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const eq = await fetchAll('equipment_observation', 'vin,option_id,state,make,model,generation,model_year');
  const iss = await fetchAll('issue_observation', 'vin,issue_key,make,model,generation,model_year');
  const cov = await fetchAll('observation_coverage', 'vin,source_type');
  const { optionStats, issueStats } = computeDerivedStats(eq, iss, cov);
  console.log('спостережень: eq', eq.length, '| issues', iss.length, '| coverage', cov.length);
  console.log('кеш: option-рядків', optionStats.length, '| issue-рядків', issueStats.length);

  /* кеш зноситься і збирається заново цілком */
  await api('derived_option_stats?id=not.is.null', { method: 'DELETE' });
  await api('derived_issue_stats?id=not.is.null', { method: 'DELETE' });
  for (let i = 0; i < optionStats.length; i += 500) {
    await api('derived_option_stats', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(optionStats.slice(i, i + 500)) });
  }
  for (let i = 0; i < issueStats.length; i += 500) {
    await api('derived_issue_stats', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(issueStats.slice(i, i + 500)) });
  }
  console.log('derived-кеш перезібраний');
}

module.exports = { computeDerivedStats };
if (require.main === module) main().catch(e => { console.error('recompute впав:', e.message); process.exit(1); });
