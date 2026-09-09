/* Check latency: інструментування стадій і одне читання історичного візуалу.

   Тримає дві речі:
   1. _meta.timings пише КОЖНУ стадію зі статусом skipped | cached | executed
      і usage AI-викликів лише тоді, коли API його повернув (нічого не
      вигадується); публічний серіалізатор timings не віддає.
   2. Штатний шлях робить МАКСИМУМ одне читання історичного візуалу
      (readHv('A')); A/B + C consensus живе лише за HV_CONSENSUS=1. Без
      історичних кадрів читань нуль. Доказовий гейт (sanitizeHistoricalVisual)
      і Score v3 не чіпаються. */
const fs = require('fs');
const vm = require('vm');
const errs = [];
const src = fs.readFileSync('api/check.js', 'utf8');

/* ---------- 1. стадії ---------- */
const STAGES = ['listing_fetch', 'listing_extract', 'decoder', 'vehicle_memory', 'history_lookup', 'photo_selector',
  'historical_vision_a', 'historical_vision_b', 'historical_vision_c', 'historical_vision_total', 'main_analysis', 'equipment_verifier', 'persistence'];
for (const st of STAGES) {
  const re = new RegExp("mark\\('" + st + "'|'" + st + "'\\]|\\+ label\\.toLowerCase\\(\\)");
  if (!re.test(src)) errs.push('стадія без таймінгу: ' + st);
}
if (!/timings\.total_ms = Date\.now\(\) - tRun;/.test(src)) errs.push('нема total_ms');
if (!/\n      timings,\n    \};/.test(src)) errs.push('timings не потрапляють у _meta');
/* статуси чесні: decoder cached|executed|skipped, history cached|executed|skipped, hv cached|skipped|executed */
if (!/mark\('decoder', [^;]*'cached' : listing\.vin \? 'executed' : 'skipped'/.test(src)) errs.push('decoder без статусу cached/executed/skipped');
if (!/mark\('history_lookup', [^;]*\(auctionSearch\.cache === 'hit' \? 'cached' : 'executed'\) : 'skipped'/.test(src)) errs.push('history_lookup без статусу');
if (!/mark\('historical_vision_total', 0, 'skipped', \{ reason: 'no_historical_photos' \}\)/.test(src)) errs.push('без історичних кадрів hv не позначається skipped');
if (!/mark\('historical_vision_total', 0, 'cached'/.test(src)) errs.push('кешований hv не позначається cached');
if (!/mark\('photo_selector', 0, 'skipped', \{ reason: 'gallery_le_24'/.test(src)) errs.push('селектор без skipped-статусу');
if (!/mark\('equipment_verifier', eqVerifier\.ms \|\| 0, eqVerifier\.status === 'done' \? 'executed' : 'skipped'/.test(src)) errs.push('верифікатор без статусу');
/* публічний серіалізатор timings не віддає */
const share = fs.readFileSync('api/share.js', 'utf8');
if (/timings/.test(share)) errs.push('share.js віддає timings назовні');
const ui = fs.readFileSync('result-check.html', 'utf8');
if (/_meta\.timings|\.timings\b/.test(ui)) errs.push('сторінка звіту показує технічні тайминги');

/* ---------- 2. usage без вигадок ---------- */
{
  const m = src.match(/const aiUsage = \(data, body\) => \{[\s\S]*?\n  \};/);
  if (!m) errs.push('нема aiUsage');
  else {
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext(m[0] + '\nthis.aiUsage = aiUsage;', ctx);
    const full = ctx.aiUsage({ model: 'gpt-x', usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 50 } } }, { model: 'gpt-y', reasoning_effort: 'high' });
    if (full.model !== 'gpt-x' || full.reasoning_effort !== 'high' || full.input_tokens !== 1200 || full.output_tokens !== 300 || full.cached_tokens !== 100 || full.reasoning_tokens !== 50) errs.push('usage не читається повністю: ' + JSON.stringify(full));
    const none = ctx.aiUsage({ choices: [] }, { model: 'gpt-y' });
    if ('input_tokens' in none || 'output_tokens' in none || 'cached_tokens' in none || none.model !== 'gpt-y' || none.reasoning_effort !== null) errs.push('без usage вигадуються токени: ' + JSON.stringify(none));
    const partial = ctx.aiUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } }, {});
    if ('cached_tokens' in partial || 'reasoning_tokens' in partial || partial.input_tokens !== 10) errs.push('часткове usage дописується вигаданими полями');
  }
}

/* ---------- 3. рівно одне читання історичного візуалу у штатному шляху ---------- */
{
  const gateAt = src.indexOf("if (process.env.HV_CONSENSUS === '1') {");
  const elseAt = src.indexOf('штатний beta-шлях: рівно одне читання');
  if (gateAt < 0 || elseAt < 0 || elseAt < gateAt) errs.push('нема прапорця HV_CONSENSUS з одиничним читанням у else');
  else {
    const gated = src.slice(gateAt, elseAt);
    const outside = src.slice(0, gateAt) + src.slice(elseAt);
    if ((gated.match(/readHv\('B'\)/g) || []).length !== 1 || (gated.match(/readHv\('C'\)/g) || []).length !== 1) errs.push('B/C не всередині прапорця');
    if (/readHv\('B'\)|readHv\('C'\)/.test(outside)) errs.push('читання B або C поза прапорцем');
    const single = src.slice(elseAt, src.indexOf('if (cons && cons.hv) {', elseAt));
    if ((single.match(/readHv\(/g) || []).length !== 1) errs.push('у штатному шляху не рівно одне читання');
    if (!/reads = a \? \[a\] : \[\];\s*cons = hvConsensus\(reads\);/.test(single)) errs.push('одиничне читання не проходить той самий канонічний шлях (hvConsensus з одним читанням)');
  }
  /* читання є лише коли є історичні кадри і нема кешу */
  if (!/if \(!cachedHv && auctionPhotos\.length && listing\.vin && hvCache\.fingerprint\) \{\s*const tHv = Date\.now\(\);/.test(src)) errs.push('умова читання hv змінена: без кадрів чи з кешем читань бути не повинно');
  /* доказовий гейт лишається на місці: одиничне читання проходить sanitizeHistoricalVisual */
  if (!/const hv = sanitizeHistoricalVisual\(j && j\.historical_visual, auctionPhotos\.length\);/.test(src)) errs.push('читання hv обходить доказовий гейт');
  if (!/const canonical = sanitizeHistoricalVisual\(cons\.hv, auctionPhotos\.length\);/.test(src)) errs.push('канонічний hv не проходить sanitize повторно');
  /* окремий effort для описового читання, основний виклик не чіпається */
  if (!/const HV_EFFORT = process\.env\.HV_REASONING_EFFORT \|\| 'low';/.test(src)) errs.push('нема окремого reasoning effort для hv');
  if (!/let mainBody = modelBody\(content\);/.test(src)) errs.push('основний виклик змінив modelBody');
  if (!/const EFFORT = process\.env\.REASONING_EFFORT \|\| 'high';/.test(src)) errs.push('reasoning effort основного виклику змінено');
  /* мітка reuse чесно каже single_read */
  if (!/hvCache\.consensus\.mode === 'single' \? 'single_read'/.test(src)) errs.push('reuse.historical_visual не відрізняє одиничне читання');
}
/* Score v3 не чіпаємо */
const v3 = fs.readFileSync('api/score-v3.js', 'utf8');
if (!/severe: 2\.4/.test(v3)) errs.push('Score v3 змінено');

if (errs.length) { console.log('LATENCY TEST FAILED:'); errs.forEach(e => console.log('  - ' + e)); process.exit(1); }
console.log('latency: 13 стадій + total у _meta.timings зі статусами · usage без вигадок · hv: одне читання штатно, A/B/C лише за HV_CONSENSUS=1, нуль без кадрів · гейт і Score v3 на місці · timings не публічні');
console.log('LATENCY TEST PASSED');
