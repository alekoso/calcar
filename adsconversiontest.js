const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const code = fs.readFileSync('analytics.js', 'utf8');
function browser(store = {}, blocked = false) {
  const document = {
    readyState: 'complete', referrer: 'https://calcar.io/?token=private',
    createElement: () => ({}), head: { appendChild() {} },
    addEventListener() {}, dispatchEvent() {},
    body: { classList: { contains: () => false } },
  };
  const w = {
    CALCAR_PUBLIC: { analytics: { ga4_id: 'G-TEST123456', google_ads_id: 'AW-123456', google_ads_check_label: 'testLabel' } },
    location: { pathname: '/check/r/car/private-report-token', search: '?token=private&utm_source=google', hostname: 'calcar.io' },
    localStorage: { getItem(k) { if (blocked) throw Error('blocked'); return store[k] || null; }, setItem(k, v) { if (blocked) throw Error('blocked'); store[k] = String(v); } },
    document, crypto: webcrypto, TextEncoder, URL, URLSearchParams,
    CustomEvent: function () {}, console,
  };
  w.window = w; w.self = w;
  vm.runInNewContext(code, w);
  return w;
}
const conversions = w => (w.dataLayer || []).filter(x => x[0] === 'event' && x[1] === 'conversion');
async function settle() { await new Promise(resolve => setTimeout(resolve, 30)); }
(async () => {
  const store = {}, w = browser(store);
  const cfg = w.dataLayer.find(x => x[0] === 'config' && x[1] === 'AW-123456')[2];
  assert.equal(cfg.groups, 'calcar_ads');
  assert.equal(cfg.send_page_view, false);
  assert.equal(cfg.page_location, 'https://calcar.io/check/r/*?utm_source=google');
  assert.equal(cfg.page_referrer, 'https://calcar.io');
  assert.equal(conversions(w).length, 0, 'loading a report must not convert');
  w.calcar.track('check_started', { product: 'check' });
  await settle();
  assert.equal(conversions(w).length, 0, 'abandoned/failed check has no completion');
  w.calcar.checkCompleted('private-job-1', { product: 'check' });
  w.calcar.checkCompleted('private-job-1', { product: 'check' });
  await settle();
  assert.equal(conversions(w).length, 1);
  assert.equal(conversions(w)[0][2].send_to, 'AW-123456/testLabel');
  assert.match(conversions(w)[0][2].transaction_id, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(conversions(w)).includes('private-job'));
  const reloaded = browser(store);
  reloaded.calcar.checkCompleted('private-job-1', { product: 'check' });
  await settle();
  assert.equal(conversions(reloaded).length, 0, 'reload must not resend');
  // Eviction from GA4's recent-50 list must not evict Ads deduplication.
  delete store.calcar_done_checks;
  const evicted = browser(store);
  evicted.calcar.checkCompleted('private-job-1', { product: 'check' });
  evicted.calcar.checkCompleted('private-job-2', { product: 'check' });
  await settle();
  assert.equal(conversions(evicted).length, 1);
  assert.notEqual(conversions(evicted)[0][2].transaction_id, conversions(w)[0][2].transaction_id);
  const old = browser({ calcar_done_checks: JSON.stringify(['pre-deployment-job']) });
  old.calcar.checkCompleted('pre-deployment-job', { product: 'check' });
  await settle();
  assert.equal(conversions(old).length, 0, 'no backfill of old completions');
  const blocked = browser({}, true);
  blocked.calcar.checkCompleted('private-job-1', { product: 'check' });
  blocked.calcar.checkCompleted('private-job-1', { product: 'check' });
  await settle();
  assert.equal(conversions(blocked).length, 1, 'memory guard when storage is unavailable');
  assert.equal(conversions(blocked)[0][2].transaction_id, conversions(w)[0][2].transaction_id, 'Google deduplication survives cleared storage');
  console.log('Ads conversion tests passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
