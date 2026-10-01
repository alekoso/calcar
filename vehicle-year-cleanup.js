/* CalCar: разова чистка модельного року, записаного старим шляхом декодера.

   До 575203d Check брав ModelYear з vPIC NHTSA без статусу декоду і писав
   його в vehicles.model_year (decoder_version 'vpic-v1'). Для європейських
   VIN неповний декод (ErrorCode 8 та подібні) давав рік з 10-го символу за
   американською конвенцією: Mercedes 2013 ставав 2001. Нові Check такий
   рік уже не пишуть; цей скрипт прибирає записане раніше.

   Правило (без вгадування):
   - лише рядки 'vpic-v1', де model_year збігається з nhtsa.ModelYear, тобто
     рік прийшов саме з декодера;
   - статус декоду перечитується у vPIC; чистий декод (ErrorCode "0") не
     чіпається;
   - неповний декод: якщо є довірений модельний рік з іншого джерела
     (trustedYears), він стає на місце, інакше model_year = null. Рік
     оголошення (vehicles.year) модельним роком не вважається;
   - nhtsa отримує статус декоду, рік переїжджає в ModelYearUntrusted.

   Запуск:
     node vehicle-year-cleanup.js                  сухий прогін, нічого не пише
     node vehicle-year-cleanup.js --apply          запис (лише після перегляду)
   Оточення: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Запис іде тим самим
   PostgREST-шляхом, що й застосунок, з умовою на vin і старе значення. */

const DECODER_LEGACY = 'vpic-v1';
const DECODER_CURRENT = 'vpic-v2';

function codesOf(code) { return String(code == null ? '' : code).split(/[\s,;]+/).filter(Boolean); }
function decodeClean(code) { const c = codesOf(code); return c.length > 0 && c.every(x => x === '0'); }

/* row: { vin, model_year, year, decoder_version, nhtsa }; vpic: { code, text } з
   перечитаного декоду; trustedYears: { [vin]: рік } з довірених джерел */
function classifyLegacyYear(row, vpic, trustedYears = {}) {
  const r = row || {};
  if (r.decoder_version !== DECODER_LEGACY) return { action: 'SKIP', reason: 'not_legacy_decoder' };
  if (r.model_year == null) return { action: 'SKIP', reason: 'no_model_year' };
  const decoded = r.nhtsa && r.nhtsa.ModelYear != null ? parseInt(r.nhtsa.ModelYear, 10) : null;
  if (decoded !== r.model_year) return { action: 'SKIP', reason: 'model_year_not_from_decoder' };
  if (!vpic || vpic.code == null) return { action: 'SKIP', reason: 'decoder_status_unknown' };
  if (decodeClean(vpic.code)) return { action: 'SKIP', reason: 'clean_decode' };
  const trusted = trustedYears[r.vin];
  if (Number.isInteger(trusted) && trusted !== r.model_year) return { action: 'REPLACE', replacement: trusted, reason: 'unreliable_decode_trusted_year' };
  if (Number.isInteger(trusted) && trusted === r.model_year) return { action: 'SKIP', reason: 'confirmed_by_trusted_source' };
  return { action: 'NULL', replacement: null, reason: 'unreliable_decode_no_trusted_year' };
}

/* nhtsa після чистки: статус декоду і рік як недовірений */
function gatedNhtsa(nhtsa, vpic) {
  const n = { ...(nhtsa || {}) };
  if (vpic && vpic.code != null) n.ErrorCode = String(vpic.code).slice(0, 40);
  if (vpic && vpic.text) n.ErrorText = String(vpic.text).slice(0, 240);
  if (n.ModelYear != null && !decodeClean(n.ErrorCode)) { n.ModelYearUntrusted = n.ModelYear; delete n.ModelYear; }
  return n;
}

async function rest(path, opts = {}) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('потрібні SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(base.replace(/\/$/, '') + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json', prefer: opts.prefer || 'return=representation' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(path.split('?')[0] + ': HTTP ' + r.status + ' ' + JSON.stringify(body).slice(0, 200));
  return body;
}

async function vpicStatus(vins) {
  const out = {};
  for (let i = 0; i < vins.length; i += 40) {
    const form = new URLSearchParams({ DATA: vins.slice(i, i + 40).join(';'), format: 'json' });
    const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/', { method: 'POST', body: form });
    const j = await r.json();
    for (const x of (j && j.Results) || []) if (x.VIN) out[x.VIN] = { code: x.ErrorCode, text: x.ErrorText, model_year: x.ModelYear || null };
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const rows = await rest('vehicles?decoder_version=eq.' + DECODER_LEGACY + '&model_year=not.is.null&select=vin,year,model_year,decoder_version,nhtsa');
  const status = await vpicStatus(rows.map(r => r.vin));
  const plan = rows.map(r => ({ row: r, vpic: status[r.vin] || null, ...classifyLegacyYear(r, status[r.vin] || null, {}) }));
  console.log(['VIN', 'model_year', 'year', 'vpic_code', 'action', 'replacement', 'reason'].join('\t'));
  for (const p of plan) console.log([p.row.vin, p.row.model_year, p.row.year, p.vpic ? p.vpic.code : '?', p.action, p.replacement ?? '', p.reason].join('\t'));
  const todo = plan.filter(p => p.action !== 'SKIP');
  console.log('усього рядків ' + plan.length + ', до зміни ' + todo.length + ' (REPLACE ' + todo.filter(p => p.action === 'REPLACE').length + ', NULL ' + todo.filter(p => p.action === 'NULL').length + ')');
  if (!apply) { console.log('сухий прогін: нічого не записано'); return; }
  for (const p of todo) {
    /* умова на vin і старе значення: рядок, змінений після прогону, не чіпаємо */
    const res = await rest('vehicles?vin=eq.' + encodeURIComponent(p.row.vin) + '&model_year=eq.' + p.row.model_year + '&decoder_version=eq.' + DECODER_LEGACY, {
      method: 'PATCH', body: { model_year: p.replacement, nhtsa: gatedNhtsa(p.row.nhtsa, p.vpic), decoder_version: DECODER_CURRENT },
    });
    console.log(p.row.vin, Array.isArray(res) && res.length === 1 ? 'оновлено' : 'пропущено (рядок змінився)');
  }
}

module.exports = { classifyLegacyYear, gatedNhtsa, decodeClean, DECODER_LEGACY, DECODER_CURRENT };
if (require.main === module) main().catch(e => { console.error('vehicle-year-cleanup:', e.message); process.exit(1); });
