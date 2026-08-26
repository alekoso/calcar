/* Бенчмарк аукціонного пошуку на еталонному VIN.
   Використання: node auctionbench.js WBAJA9C5XJB033667
   Друкує структуровано: discovery, кожне джерело, підсумок із числом
   зовнішніх запитів і орієнтовною вартістю: це ціна одного Check
   з аукціонним пошуком. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const vin = (process.argv[2] || '').toUpperCase();
if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { console.log('Використання: node auctionbench.js <VIN 17 символів>'); process.exit(1); }

const tmp = path.join(os.tmpdir(), 'calcar_auctionbench.mjs');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, 'api', 'auction.js'), 'utf8'));

(async () => {
  const { findAuctionRecord, downloadLotPhotos } = await import('file://' + tmp);

  /* лічильник зовнішніх запитів поверх реального fetch */
  let requests = 0;
  const countingFetch = (u, o) => { requests++; return fetch(u, o); };

  /* NHTSA: реальний декод для кросс-перевірки ідентичності */
  let nhtsa = null;
  try {
    requests++;
    const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + vin + '?format=json');
    const row = (await r.json())?.Results?.[0];
    if (row) nhtsa = { Make: row.Make, Model: row.Model, ModelYear: row.ModelYear };
  } catch (e) {}

  const t0 = Date.now();
  const rec = await findAuctionRecord(vin, nhtsa, {});
  let photoStats = null;
  if (rec.status === 'found' && rec.photo_urls?.length) {
    const pr0 = requests;
    const dl = await downloadLotPhotos(rec.photo_urls, { fetchImpl: countingFetch });
    photoStats = { requested: rec.photo_urls.length, downloaded: dl.photos.length, skipped: dl.skipped.length, total_bytes: dl.total_bytes, requests: requests - pr0 };
  }

  const bench = {
    vin,
    nhtsa,
    discovery: rec.diagnostics.filter(d => d.step === 'discovery').map(d => ({
      source: d.source, query: d.url, provider: 'source_specific', status: d.status,
      blocked: d.blocked, candidate_found: d.found, ms: d.ms,
    })),
    sources: rec.diagnostics.filter(d => d.step === 'lot').map(d => ({
      source: d.source, url: d.url, http_status: d.status, blocked: d.blocked,
      vin_matched: d.identity === 'high' || d.identity === 'reduced',
      identity: d.identity || null, ms: d.ms,
    })),
    photos: photoStats,
    outcome: {
      status: rec.status,
      reason: rec.reason || null,
      lot_url: rec.lot_url || null,
      total_ms: Date.now() - t0,
      external_requests: requests + rec.diagnostics.length,
      /* прямий fetch безкоштовний; платний провайдер підставить свою ціну */
      est_cost_usd: 0,
      cache: 'miss',
    },
  };
  console.log(JSON.stringify(bench, null, 1));
  fs.unlinkSync(tmp);
})().catch(e => { console.log('Помилка: ' + (e.stack || e.message)); process.exit(1); });
