/* Final Conclusion shadow A/B: local runner and report builder.

   node fc-shadow-bench.js dry-run   [--corpus-dir DIR] [--out DIR]
     frozen input (hash over rules, context and schema, rules version),
     availability tier and the deterministic checks of the STORED
     production conclusion for every report in the corpus. No model calls.
   node fc-shadow-bench.js run       [--via endpoint|local] [--tokens a,b] [--concurrency 2]
                                     [--pairs-subdir pairs] [--base https://www.calcar.io]
                                     [--shadow-model M] [--shadow-effort E]
     endpoint: POST /api/conclusion-bench mode shadow with x-calcar-bench
       (env BENCH_KEY or ~/.calcar-bench.env). Needs nothing local.
     local: runs the same api/conclusion-shadow.js code here; needs
       OPENAI_API_KEY and ANTHROPIC_API_KEY in env and the corpus files.
     Writes <pairs-subdir>/<token>.json (control + shadow, hashes, latency,
     usage, checks). A warm-up run goes to its own subdir and is not
     summarized.
   node fc-shadow-bench.js run ... --skip-control [--shadow-max-tokens N] [--shadow-timeout-ms N]
     shadow-only variant (another model or effort): the control is not
     called; pairs carry only the shadow side and its input hash.
   node fc-shadow-bench.js combine --control-dir DIR --shadow-dir DIR [--out DIR]
     pairs each shadow-only result with the stored pair holding the control
     output of the same report; identical_input only when both hashes match
     the same frozen input. Writes <out>/pairs.
   node fc-shadow-bench.js summarize [--out DIR] [--price-openai in,out,cached] [--no-recheck]
     summary.json / summary.md (latency p50 p90 p95, tokens, cost, failures,
     invariant flags, checks) and the blind artifact: blind.html + blind.json
     without any provider signal, key.json with the A/B assignment apart.
     Invariant flags are recomputed locally with the current
     api/conclusion-checks.js when the corpus report re-freezes to the same
     input_hash as the pair (no model call); the flags the endpoint returned
     stay in the pair files.

   Writes only under --out (default docs/audits/fc-shadow-2026-10-07).
   Never writes to the database, to reports or to Vehicle Memory. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const OUT = path.resolve(opt('out', 'docs/audits/fc-shadow-2026-10-07'));
const CORPUS_DIR = path.resolve(opt('corpus-dir', path.join(OUT, 'corpus')));
const PAIRS_DIR = path.join(OUT, opt('pairs-subdir', 'pairs'));

/* Claude Opus 5.5 list prices per MTok (input, output, cache read, cache write 5-minute) */
const PRICE_ANTHROPIC = { in: 4, out: 20, cached: 0.2, cache_write: 5 };

function loadCorpus(tokens) {
  if (!fs.existsSync(CORPUS_DIR)) return [];
  return fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8')))
    .filter(r => r && r.token && r.report && (!tokens || tokens.includes(r.token)))
    .map(r => {
      /* the export keeps the historical call diagnostics in a separate column */
      if (r.fc_timing && r.report._meta && !(r.report._meta.timings && r.report._meta.timings.final_conclusion)) r.report._meta.timings = { ...(r.report._meta.timings || {}), final_conclusion: r.fc_timing };
      return r;
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
function benchKey() {
  if (process.env.BENCH_KEY) return process.env.BENCH_KEY;
  try {
    const line = fs.readFileSync(path.join(os.homedir(), '.calcar-bench.env'), 'utf8').split('\n').find(l => l.startsWith('BENCH_KEY='));
    return line ? line.slice('BENCH_KEY='.length).trim() : null;
  } catch (e) { return null; }
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))] : null);
function latencyStats(ms) {
  const s = ms.filter(x => typeof x === 'number').sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 50), p90: pct(s, 90), p95: pct(s, 95), min: s[0] ?? null, max: s[s.length - 1] ?? null, mean: s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null };
}
function costOf(rec, price) {
  if (!rec || !price || typeof rec.input_tokens !== 'number' || typeof rec.output_tokens !== 'number') return null;
  const cached = rec.cached_tokens || 0;
  if (rec.provider === 'anthropic') {
    /* Messages API: input_tokens exclude cache reads and cache writes */
    return +(((rec.input_tokens * price.in) + (cached * price.cached) + ((rec.cache_creation_tokens || 0) * price.cache_write) + (rec.output_tokens * price.out)) / 1e6).toFixed(5);
  }
  /* OpenAI: prompt_tokens include the cached part */
  return +((((rec.input_tokens - cached) * price.in) + (cached * (price.cached ?? price.in)) + (rec.output_tokens * price.out)) / 1e6).toFixed(5);
}
/* Messages API input_tokens exclude cache reads and writes; OpenAI prompt_tokens include the cached part */
const inputInclCache = r => (r.provider === 'anthropic' ? (r.input_tokens || 0) + (r.cached_tokens || 0) + (r.cache_creation_tokens || 0) : (r.input_tokens || 0));

async function mods() {
  const shadow = await import('./api/conclusion-shadow.js');
  const checks = await import('./api/conclusion-checks.js');
  const locale = await import('./api/locale.js');
  return { shadow, checks, locale };
}

async function dryRun() {
  const { shadow, checks, locale } = await mods();
  const chk = await import('./api/check.js');
  const rows = loadCorpus(null);
  if (!rows.length) { console.log('corpus is empty: ' + CORPUS_DIR); process.exit(1); }
  const manifest = [];
  for (const row of rows) {
    const report = row.report;
    const lang = locale.resolveLocale(row.lang || (report._meta && report._meta.lang));
    const avail = shadow.shadowAvailability(report);
    const frozen = avail.available ? shadow.freezeConclusionInput({ report, langDirective: locale.languageDirective(lang) }) : null;
    const stored = shadow.storedConclusionInfo(report);
    const baseline = frozen && stored.present ? checks.conclusionInvariantChecks({ text: report.final_conclusion, report, context: frozen.context, directiveHits: chk.directiveVerdictHits }) : null;
    manifest.push({
      token: row.token, title: report.vehicle && report.vehicle.title, lang, created_at: row.created_at, vin: row.vin || (report._meta && report._meta.vin) || null,
      score: report.verdict && report.verdict.score, availability: avail,
      input: frozen ? { input_hash: frozen.input_hash, rules_version: frozen.rules_version, rules_hash: frozen.rules_hash, schema_hash: frozen.schema_hash, context_chars: frozen.context_chars, checklist_snapshot_items: frozen.checklist_snapshot.length } : null,
      stored_conclusion: stored,
      baseline_checks: baseline ? { total: baseline.total, counts: baseline.counts, gate: baseline.gate, violations: baseline.violations, directive: baseline.directive } : null,
    });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), corpus_dir: CORPUS_DIR, reports: manifest }, null, 1));
  const lines = ['| token | car | lang | tier | rules | ctx chars | checklist items | input_hash | stored FC | stored ms | baseline flags |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const m of manifest) lines.push(`| ${m.token} | ${m.title} | ${m.lang} | ${m.availability.tier ?? 'n/a'} | ${m.input ? m.input.rules_version : '-'} | ${m.input ? m.input.context_chars : '-'} | ${m.input ? m.input.checklist_snapshot_items : '-'} | ${m.input ? m.input.input_hash.slice(0, 12) : '-'} | ${m.stored_conclusion.version || '-'} | ${m.stored_conclusion.latency_ms ?? '-'} | ${m.baseline_checks ? m.baseline_checks.total : '-'} |`);
  console.log(lines.join('\n'));
  for (const m of manifest) if (m.baseline_checks && m.baseline_checks.total) console.log(m.token, m.title, JSON.stringify(m.baseline_checks.violations.map(v => [v.check, v.domain, v.found, v.canonical, (v.text || '').slice(0, 90)])), JSON.stringify(m.baseline_checks.directive));
  console.log('manifest:', path.join(OUT, 'manifest.json'));
}

function logPair(token, d) {
  console.log(token, d.status, d.reason || '', d.input && d.input.control_skipped ? 'control skipped' : '', d.control ? `control ${d.control.status}${d.control.reason ? '(' + d.control.reason + ')' : ''} ${d.control.latency_ms}ms` : '', d.shadow ? `shadow ${d.shadow.status}${d.shadow.reason ? '(' + d.shadow.reason + ')' : ''} ${d.shadow.latency_ms}ms` : '', d.input ? `identical ${d.input.identical_input}` : '');
}

async function runEndpoint(tokens, base, shadowModel, shadowEffort, concurrency, extra = {}) {
  const key = benchKey();
  if (!key) { console.log('no BENCH_KEY (env or ~/.calcar-bench.env)'); process.exit(1); }
  fs.mkdirSync(PAIRS_DIR, { recursive: true });
  const queue = [...tokens];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const token = queue.shift();
      const body = { job_token: token, mode: 'shadow' };
      if (shadowModel) body.shadow_model = shadowModel;
      if (shadowEffort) body.shadow_effort = shadowEffort;
      if (extra.skipControl) body.skip_control = true;
      if (extra.shadowMaxTokens) body.shadow_max_tokens = extra.shadowMaxTokens;
      if (extra.shadowTimeoutMs) body.shadow_timeout_ms = extra.shadowTimeoutMs;
      const t0 = Date.now();
      let data;
      try {
        const r = await fetch(base.replace(/\/$/, '') + '/api/conclusion-bench', { method: 'POST', headers: { 'content-type': 'application/json', 'x-calcar-bench': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(extra.shadowTimeoutMs ? extra.shadowTimeoutMs + 25000 : 295000) });
        const txt = await r.text();
        try { data = JSON.parse(txt); } catch (e) { data = { status: 'transport_error', reason: 'http ' + r.status + ' ' + txt.slice(0, 200) }; }
        if (!r.ok && !data.schema) data = { status: 'transport_error', reason: 'http ' + r.status + ' ' + JSON.stringify(data).slice(0, 200) };
      } catch (e) { data = { status: 'transport_error', reason: String(e.message || e).slice(0, 200) }; }
      data.report_id = data.report_id || token;
      data.via = 'endpoint';
      data.fetched_ms = Date.now() - t0;
      fs.writeFileSync(path.join(PAIRS_DIR, token + '.json'), JSON.stringify(data, null, 1));
      results.push(data);
      logPair(token, data);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

async function runLocal(tokens, shadowModel, shadowEffort, concurrency, extra = {}) {
  if (!process.env.OPENAI_API_KEY || !process.env.ANTHROPIC_API_KEY) { console.log('local mode needs OPENAI_API_KEY and ANTHROPIC_API_KEY in env'); process.exit(1); }
  const { shadow, locale } = await mods();
  const chk = await import('./api/check.js');
  const bench = await import('./api/conclusion-bench.js');
  const rows = loadCorpus(tokens);
  fs.mkdirSync(PAIRS_DIR, { recursive: true });
  const queue = [...rows];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      const lang = locale.resolveLocale(row.lang || (row.report._meta && row.report._meta.lang));
      const pair = await shadow.runShadowPair({ token: row.token, report: row.report, lang, langDirective: locale.languageDirective(lang), callOpenAI: bench.callModel, callAnthropic: null, env: process.env, applyLanguage: chk.applyConclusionLanguage, directiveHits: chk.directiveVerdictHits, shadowModel, shadowEffort, shadowMaxTokens: extra.shadowMaxTokens || null, skipControl: !!extra.skipControl });
      pair.via = 'local';
      fs.writeFileSync(path.join(PAIRS_DIR, row.token + '.json'), JSON.stringify(pair, null, 1));
      results.push(pair);
      logPair(row.token, pair);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

async function combine() {
  const { shadow } = await mods();
  const cDir = path.resolve(opt('control-dir', '')), sDir = path.resolve(opt('shadow-dir', ''));
  if (!fs.existsSync(cDir) || !fs.existsSync(sDir)) { console.log('need --control-dir and --shadow-dir'); process.exit(1); }
  fs.mkdirSync(PAIRS_DIR, { recursive: true });
  let ok = 0, bad = 0;
  for (const f of fs.readdirSync(sDir).filter(x => x.endsWith('.json'))) {
    const sp = JSON.parse(fs.readFileSync(path.join(sDir, f), 'utf8'));
    const cpPath = path.join(cDir, f);
    const cp = fs.existsSync(cpPath) ? JSON.parse(fs.readFileSync(cpPath, 'utf8')) : null;
    const pair = shadow.combineReusedControl(cp, sp);
    pair.via = 'combined';
    pair.control_source = path.relative(OUT, cpPath);
    pair.shadow_source = path.relative(OUT, path.join(sDir, f));
    fs.writeFileSync(path.join(PAIRS_DIR, f), JSON.stringify(pair, null, 1));
    if (pair.input && pair.input.identical_input) ok++; else bad++;
    console.log(pair.report_id, pair.status, 'identical', pair.input ? pair.input.identical_input : null, pair.input ? pair.input.input_hash.slice(0, 12) : '', pair.reason || '');
  }
  console.log('combined:', ok, 'identical,', bad, 'not proven ->', PAIRS_DIR);
}

function loadPairs() {
  if (!fs.existsSync(PAIRS_DIR)) return [];
  return fs.readdirSync(PAIRS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(PAIRS_DIR, f), 'utf8')))
    .sort((a, b) => String(a.report_id).localeCompare(String(b.report_id)));
}

/* the blind review page: data inline, ratings kept in this browser only and downloadable */
function blindHtml(blind) {
  const data = JSON.stringify(blind).replace(/</g, '\\u003c');
  const css = ':root{--brand:#B8F23D;--ink:#141619;--bg:#F7F8F6;--line:#e3e5e1;--muted:#5d6360;--card:#fff;--warn-bg:#fff4e5;--warn:#7a3b00;--ok-bg:#eef9e2;--ok:#2a6b00;--chip:#eef0ec}'
    + '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ink:#e8eae6;--bg:#141619;--line:#2c302c;--muted:#a3a9a5;--card:#1c1f1d;--warn-bg:#3a2a12;--warn:#ffcf8a;--ok-bg:#1f3315;--ok:#b8f23d;--chip:#2a2e2b}}'
    + 'body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif}'
    + '.wrap{max-width:1180px;margin:0 auto;padding:16px}h1{font-size:20px;margin:0}.pair{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}'
    + '.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.cols{grid-template-columns:1fr}}.side{border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}'
    + '.side h3{margin:0 0 8px;font-size:15px}.hl{font-weight:700;margin:0 0 8px}.side p{margin:0 0 10px}.box{font-size:13px;border-radius:8px;padding:8px 10px;margin-top:8px}'
    + '.flags{color:var(--warn);background:var(--warn-bg)}.okf{color:var(--ok);background:var(--ok-bg)}.chk{background:var(--chip)}.chk ul,.flags ul{margin:4px 0 0;padding-left:18px}'
    + '.rate{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;font-size:13px}.rate label{margin-right:10px;white-space:nowrap}'
    + '.meta{color:var(--muted);font-size:13px}textarea{width:100%;min-height:50px;box-sizing:border-box;margin-top:8px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px}'
    + 'button{background:var(--brand);color:#141619;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}.top{position:sticky;top:0;background:var(--bg);padding:8px 0 10px;border-bottom:1px solid var(--line);z-index:2}'
    + '.badge{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--chip);font-size:12px}.mis{color:#c0392b;font-weight:700}';
  const js = 'var D=JSON.parse(document.getElementById("data").textContent);'
    + 'var CRIT=[["factual","Factual correctness"],["status","Canonical fact status kept"],["useful","Useful for the purchase decision"],["risks","Risk prioritization"],["checks","Checks quality"],["clarity","Clarity"],["overall","Overall"]];'
    + 'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}'
    + 'function ls(k,v){try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||"null");localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}}'
    + 'function checksHtml(c){if(!c)return "";var h="<div class=\\"box chk\\"><b>Checks returned: "+c.returned.length+"</b>";if(c.returned.length){h+="<ul>";c.returned.forEach(function(x){h+="<li>"+esc(x.text)+" <span class=\\"meta\\">["+esc(x.area)+(x.refines?", refines item "+x.refines:"")+"]</span></li>"});h+="</ul>"}'
    + 'if(c.refined.length){h+="<div class=\\"meta\\" style=\\"margin-top:6px\\">Would replace in the checklist:</div><ul>";c.refined.forEach(function(r){h+="<li><s>"+esc(r.from)+"</s><br>"+esc(r.to)+"</li>"});h+="</ul>"}'
    + 'if(c.added.length){h+="<div class=\\"meta\\" style=\\"margin-top:6px\\">Would be added to the checklist:</div><ul>";c.added.forEach(function(t){h+="<li>"+esc(t)+"</li>"});h+="</ul>"}'
    + 'var dropped=c.rejected.concat(c.skipped);if(dropped.length){h+="<div class=\\"meta\\" style=\\"margin-top:6px\\">Dropped by the merge rules:</div><ul>";dropped.forEach(function(r){h+="<li>"+esc(r.reason)+": "+esc(r.text)+"</li>"});h+="</ul>"}return h+"</div>"}'
    + 'function flagsHtml(f){if(!f)return "";if(!f.total)return "<div class=\\"box okf\\">Automatic flags: none</div>";var h="<div class=\\"box flags\\"><b>Automatic flags: "+f.total+"</b><ul>";f.violations.forEach(function(v){h+="<li>"+esc(v.check+" / "+v.domain+" ("+(v.where||"text")+"): found "+v.found+", canonical "+v.canonical)+(v.text?"<br><span class=\\"meta\\">"+esc(v.text)+"</span>":"")+"</li>"});(f.directive||[]).forEach(function(d){h+="<li>directive wording: "+esc(d.phrase)+"</li>"});return h+"</ul></div>"}'
    + 'function side(name,s){var h="<div class=\\"side\\"><h3>"+name+" <span class=\\"badge\\">"+esc(s.status)+"</span></h3>";if(!s.output){return h+"<p class=\\"meta\\">no output</p>"+flagsHtml(s.flags)+"</div>"}h+="<p class=\\"hl\\">"+esc(s.output.headline)+"</p>";s.output.body.split(/\\n\\s*\\n/).forEach(function(p){h+="<p>"+esc(p)+"</p>"});return h+checksHtml(s.checks)+flagsHtml(s.flags)+"</div>"}'
    + 'var root=document.getElementById("root");D.forEach(function(p,i){var saved=ls("fcab:"+p.report_id)||{};var el=document.createElement("div");el.className="pair";'
    + 'el.innerHTML="<div class=\\"meta\\">"+(i+1)+"/"+D.length+" · "+esc(p.vehicle?p.vehicle.title:"")+" · "+esc(p.lang)+" · input "+esc((p.input_hash||"").slice(0,12))+(p.identical_input===true?" · identical input":" · <span class=\\"mis\\">INPUT NOT PROVEN IDENTICAL</span>")+"</div><div class=\\"cols\\">"+side("A",p.A)+side("B",p.B)+"</div>"'
    + '+"<div class=\\"rate\\">"+CRIT.map(function(c){return "<div><b>"+c[1]+"</b><br>"+["A","B","tie"].map(function(v){return "<label><input type=\\"radio\\" name=\\""+p.report_id+":"+c[0]+"\\" value=\\""+v+"\\""+(saved[c[0]]===v?" checked":"")+"> "+v+"</label>"}).join("")+"</div>"}).join("")+"</div>"'
    + '+"<textarea placeholder=\\"Notes\\" data-id=\\""+p.report_id+"\\">"+esc(saved.notes||"")+"</textarea>";root.appendChild(el)});'
    + 'function collect(){var out={};D.forEach(function(p){var r={};CRIT.forEach(function(c){var x=document.querySelector("input[name=\\""+p.report_id+":"+c[0]+"\\"]:checked");r[c[0]]=x?x.value:null});var t=document.querySelector("textarea[data-id=\\""+p.report_id+"\\"]");r.notes=t?t.value:"";out[p.report_id]=r});return out}'
    + 'function save(){var all=collect();var done=0;Object.keys(all).forEach(function(k){ls("fcab:"+k,all[k]);if(all[k].overall)done++});document.getElementById("progress").textContent="rated "+done+"/"+D.length}'
    + 'document.addEventListener("change",save);document.addEventListener("input",save);save();'
    + 'document.getElementById("dl").onclick=function(){var blob=new Blob([JSON.stringify({rated_at:new Date().toISOString(),ratings:collect()},null,1)],{type:"application/json"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="fc-shadow-ratings.json";a.click()};';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conclusion blind review</title><style>' + css + '</style></head><body><div class="wrap">'
    + '<div class="top"><h1>Final Conclusion A/B, blind review</h1><div class="meta">A and B are two providers in random order per car; the assignment is in key.json. Rate each criterion, then download the ratings. <span id="progress"></span> <button id="dl">Download ratings JSON</button></div></div>'
    + '<div id="root"></div></div><script type="application/json" id="data">' + data + '</script><script>' + js + '</script></body></html>';
}

async function summarize() {
  const { shadow, checks, locale } = await mods();
  const pairs = loadPairs();
  if (!pairs.length) { console.log('no pairs in ' + PAIRS_DIR); process.exit(1); }
  const recheck = { version: checks.CHECKS_VERSION, recomputed: 0, hash_mismatch: [], no_corpus: [] };
  if (!args.includes('--no-recheck')) {
    const chk = await import('./api/check.js');
    const corpus = Object.fromEntries(loadCorpus(null).map(r => [r.token, r]));
    for (const p of pairs) {
      if (!p.input || !p.control || !p.shadow) continue;
      const row = corpus[p.report_id];
      if (!row) { recheck.no_corpus.push(p.report_id); continue; }
      const lang = locale.resolveLocale(row.lang || (row.report._meta && row.report._meta.lang));
      const frozen = shadow.freezeConclusionInput({ report: row.report, langDirective: locale.languageDirective(lang) });
      if (!frozen || frozen.input_hash !== p.input.input_hash) { recheck.hash_mismatch.push(p.report_id); continue; }
      const one = rec => (rec && rec.status === 'ok' && rec.output ? checks.conclusionInvariantChecks({ text: { headline: rec.output.headline, body: rec.output.body, checks: rec.checks_preview ? rec.checks_preview.accepted.map(c => c.text) : [] }, report: row.report, context: frozen.context, directiveHits: chk.directiveVerdictHits }) : null);
      p.checks_endpoint = p.checks;
      p.checks = { control: one(p.control), shadow: one(p.shadow) };
      recheck.recomputed++;
    }
  }
  const po = opt('price-openai', null);
  const priceOpenAI = po ? (() => { const [i, o, c] = po.split(',').map(Number); return { in: i, out: o, cached: isFinite(c) ? c : i }; })() : null;
  const sideStats = (name) => {
    const recs = pairs.map(p => p[name]).filter(Boolean);
    const ok = recs.filter(r => r.status === 'ok');
    const fails = recs.filter(r => r.status !== 'ok');
    const chk = pairs.map(p => p.checks && p.checks[name]).filter(Boolean);
    const sum = k => ok.reduce((a, r) => a + (typeof r[k] === 'number' ? r[k] : 0), 0);
    const costs = ok.map(r => costOf(r, name === 'shadow' ? PRICE_ANTHROPIC : priceOpenAI)).filter(c => c !== null);
    const cp = ok.map(r => r.checks_preview).filter(Boolean);
    return {
      runs: recs.length, ok: ok.length, failed: fails.length,
      failures: fails.map(r => ({ report_id: (pairs.find(p => p[name] === r) || {}).report_id, reason: r.reason, attempts: r.attempts })),
      models: [...new Set(ok.map(r => r.model))], effort: [...new Set(ok.map(r => r.effort))],
      latency_ms: latencyStats(ok.map(r => r.latency_ms)), retries: recs.reduce((a, r) => a + (r.retries || 0), 0),
      timeouts: recs.filter(r => (r.attempts || []).some(a => a.error === 'timeout')).length,
      fallback_model_used: ok.filter(r => r.requested_model && r.model && !String(r.model).startsWith(r.requested_model)).length,
      tokens: {
        input_total: sum('input_tokens'), output_total: sum('output_tokens'), cached_total: sum('cached_tokens'), cache_creation_total: sum('cache_creation_tokens'),
        reasoning_total: ok.some(r => typeof r.reasoning_tokens === 'number') ? sum('reasoning_tokens') : null,
        input_mean: ok.length ? Math.round(sum('input_tokens') / ok.length) : null,
        input_incl_cache_mean: ok.length ? Math.round(ok.reduce((a, r) => a + inputInclCache(r), 0) / ok.length) : null,
        output_mean: ok.length ? Math.round(sum('output_tokens') / ok.length) : null,
      },
      cost_usd: costs.length ? { total: +costs.reduce((a, b) => a + b, 0).toFixed(4), mean: +(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4), priced_runs: costs.length } : null,
      output_chars_mean: ok.length ? Math.round(ok.reduce((a, r) => a + ((r.output && r.output.body) || '').length, 0) / ok.length) : null,
      paragraphs_mean: ok.length ? +(ok.reduce((a, r) => a + ((r.output && r.output.body) || '').split(/\n\s*\n/).length, 0) / ok.length).toFixed(1) : null,
      fc_checks: { returned: cp.reduce((a, c) => a + c.raw.length, 0), accepted: cp.reduce((a, c) => a + c.accepted.length, 0), rejected: cp.reduce((a, c) => a + c.rejected.length, 0), refined: cp.reduce((a, c) => a + c.refined.length, 0), added: cp.reduce((a, c) => a + c.added.length, 0), skipped: cp.reduce((a, c) => a + c.skipped.length, 0) },
      flags: {
        reports_with_flags: chk.filter(c => c.total > 0).length, flags_total: chk.reduce((a, c) => a + c.total, 0),
        by_check: chk.reduce((acc, c) => { for (const [k, v] of Object.entries(c.counts || {})) acc[k] = (acc[k] || 0) + v; return acc; }, {}),
        in_checks: chk.reduce((a, c) => a + (c.violations || []).filter(v => v.where === 'checks').length, 0),
        gate_would_hide: chk.filter(c => c.gate && c.gate.hidden).length,
      },
    };
  };
  const summary = {
    generated_at: new Date().toISOString(), pairs: pairs.length,
    successful_pairs: pairs.filter(p => p.status === 'ok').length,
    identical_input_all: pairs.length > 0 && pairs.every(p => p.input && p.input.identical_input === true),
    input_not_proven: pairs.filter(p => !(p.input && p.input.identical_input === true)).map(p => ({ report_id: p.report_id, status: p.status, reason: p.reason || null })),
    unavailable: pairs.filter(p => p.status === 'unavailable' || p.status === 'transport_error').map(p => ({ report_id: p.report_id, reason: p.reason })),
    rules_versions: [...new Set(pairs.map(p => p.input && p.input.rules_version).filter(Boolean))],
    schema_hashes: [...new Set(pairs.map(p => p.input && p.input.schema_hash).filter(Boolean))],
    control: sideStats('control'), shadow: sideStats('shadow'),
    stored_production_reference: latencyStats(pairs.map(p => p.stored_conclusion && p.stored_conclusion.latency_ms)),
    per_pair: pairs.map(p => ({
      report_id: p.report_id, car: p.vehicle && p.vehicle.title, status: p.status, identical_input: !!(p.input && p.input.identical_input), input_hash: p.input && p.input.input_hash,
      control: p.control ? { status: p.control.status, model: p.control.model, ms: p.control.latency_ms, in: p.control.input_tokens, out: p.control.output_tokens, cached: p.control.cached_tokens, retries: p.control.retries, flags: p.checks && p.checks.control ? p.checks.control.total : null, checks: p.control.checks_preview ? p.control.checks_preview.raw.length : null, reason: p.control.reason } : null,
      shadow: p.shadow ? { status: p.shadow.status, model: p.shadow.model, ms: p.shadow.latency_ms, in: p.shadow.input_tokens, out: p.shadow.output_tokens, cached: p.shadow.cached_tokens, retries: p.shadow.retries, flags: p.checks && p.checks.shadow ? p.checks.shadow.total : null, checks: p.shadow.checks_preview ? p.shadow.checks_preview.raw.length : null, reason: p.shadow.reason } : null,
    })),
    pricing: { anthropic: PRICE_ANTHROPIC, openai: priceOpenAI || 'not provided (--price-openai in,out,cached)' },
    flags_recheck: recheck,
    control_reused: pairs.some(p => p.input && p.input.control_reused_from),
    flags_endpoint_total: { control: pairs.reduce((a, p) => a + (p.checks_endpoint && p.checks_endpoint.control ? p.checks_endpoint.control.total : 0), 0), shadow: pairs.reduce((a, p) => a + (p.checks_endpoint && p.checks_endpoint.shadow ? p.checks_endpoint.shadow.total : 0), 0) },
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  const { blind, key } = shadow.blindPairs(pairs.filter(p => p.control && p.shadow), () => crypto.randomInt(2) === 1);
  const blindJson = JSON.stringify(blind);
  if (shadow.PROVIDER_WORDS.test(blindJson)) { console.log('blind payload leaks a provider word; aborting'); process.exit(1); }
  fs.writeFileSync(path.join(OUT, 'blind.json'), JSON.stringify(blind, null, 1));
  fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify({ generated_at: summary.generated_at, key }, null, 1));
  fs.writeFileSync(path.join(OUT, 'blind.html'), blindHtml(blind));
  const C = summary.control, S = summary.shadow;
  const L = s => s.latency_ms;
  const md = [
    `# Final Conclusion shadow A/B: summary (${summary.generated_at})`, '',
    'Review blind.html before reading this file: the per-pair table below names the providers.', '',
    `Pairs: ${summary.pairs}, successful: ${summary.successful_pairs}. Identical input for every pair: ${summary.identical_input_all}. Rules: ${summary.rules_versions.join(', ')}. Schema hash: ${summary.schema_hashes.map(h => h.slice(0, 12)).join(', ')}.`, '',
    '| | control | shadow |', '|---|---|---|',
    `| runs ok / failed | ${C.ok} / ${C.failed} | ${S.ok} / ${S.failed} |`,
    `| model | ${C.models.join(', ')} | ${S.models.join(', ')} |`,
    `| effort | ${C.effort.join(', ')} | ${S.effort.join(', ')} |`,
    `| control run | ${summary.control_reused ? 'reused from an earlier run, not called again' : 'called in this run'} | called in this run, max_tokens ${[...new Set(pairs.map(p => p.shadow && p.shadow.max_tokens).filter(Boolean))].join(', ') || 'n/a'} |`,
    `| latency p50 / p90 / p95, ms | ${L(C).p50} / ${L(C).p90} / ${L(C).p95} | ${L(S).p50} / ${L(S).p90} / ${L(S).p95} |`,
    `| latency min / mean / max, ms | ${L(C).min} / ${L(C).mean} / ${L(C).max} | ${L(S).min} / ${L(S).mean} / ${L(S).max} |`,
    `| retries / timeouts / fallback model | ${C.retries} / ${C.timeouts} / ${C.fallback_model_used} | ${S.retries} / ${S.timeouts} / ${S.fallback_model_used} |`,
    `| input tokens mean, as reported | ${C.tokens.input_mean} | ${S.tokens.input_mean} |`,
    `| input tokens mean incl. cache | ${C.tokens.input_incl_cache_mean} | ${S.tokens.input_incl_cache_mean} |`,
    `| cached input tokens total | ${C.tokens.cached_total} | ${S.tokens.cached_total} (written ${S.tokens.cache_creation_total}) |`,
    `| output tokens mean | ${C.tokens.output_mean} | ${S.tokens.output_mean} |`,
    `| reasoning tokens total | ${C.tokens.reasoning_total ?? 'n/a'} | inside output |`,
    `| cost USD total (mean) | ${C.cost_usd ? C.cost_usd.total + ' (' + C.cost_usd.mean + ')' : 'no price given'} | ${S.cost_usd ? S.cost_usd.total + ' (' + S.cost_usd.mean + ')' : 'n/a'} |`,
    `| output chars mean / paragraphs mean | ${C.output_chars_mean} / ${C.paragraphs_mean} | ${S.output_chars_mean} / ${S.paragraphs_mean} |`,
    `| checks returned / accepted / refined / added | ${C.fc_checks.returned} / ${C.fc_checks.accepted} / ${C.fc_checks.refined} / ${C.fc_checks.added} | ${S.fc_checks.returned} / ${S.fc_checks.accepted} / ${S.fc_checks.refined} / ${S.fc_checks.added} |`,
    `| checks rejected / skipped by merge | ${C.fc_checks.rejected} / ${C.fc_checks.skipped} | ${S.fc_checks.rejected} / ${S.fc_checks.skipped} |`,
    `| reports with automatic flags | ${C.flags.reports_with_flags} | ${S.flags.reports_with_flags} |`,
    `| flags total (in checks) | ${C.flags.flags_total} (${C.flags.in_checks}) | ${S.flags.flags_total} (${S.flags.in_checks}) |`,
    `| flags by check | ${JSON.stringify(C.flags.by_check)} | ${JSON.stringify(S.flags.by_check)} |`,
    `| consistency gate would hide the block | ${C.flags.gate_would_hide} | ${S.flags.gate_would_hide} |`,
    '', `Invariant flags: ${recheck.recomputed} pairs recomputed locally with ${recheck.version} (hash verified); flags as returned by the endpoint: control ${summary.flags_endpoint_total.control}, shadow ${summary.flags_endpoint_total.shadow}.${recheck.hash_mismatch.length ? ' Hash mismatch, kept endpoint flags: ' + recheck.hash_mismatch.join(', ') + '.' : ''}`,
    '', `Historical production call of the same reports (fc-v2.3, from stored diagnostics): p50 ${summary.stored_production_reference.p50} ms, p90 ${summary.stored_production_reference.p90} ms.`,
    '', '## Per pair', '',
    '| report | car | identical | control ms | shadow ms | control in/out | shadow in(+cache)/out | retries c/s | flags c/s | checks c/s | status |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...summary.per_pair.map(r => `| ${r.report_id} | ${r.car} | ${r.identical_input} | ${r.control ? r.control.ms : '-'} | ${r.shadow ? r.shadow.ms : '-'} | ${r.control ? r.control.in + '/' + r.control.out : '-'} | ${r.shadow ? r.shadow.in + '(+' + (r.shadow.cached || 0) + ')/' + r.shadow.out : '-'} | ${r.control ? r.control.retries : '-'}/${r.shadow ? r.shadow.retries : '-'} | ${r.control ? r.control.flags : '-'}/${r.shadow ? r.shadow.flags : '-'} | ${r.control ? r.control.checks : '-'}/${r.shadow ? r.shadow.checks : '-'} | ${r.status}${r.control && r.control.reason ? ' control: ' + r.control.reason : ''}${r.shadow && r.shadow.reason ? ' shadow: ' + r.shadow.reason : ''} |`),
    '', 'Blind artifact: blind.html and blind.json (A/B in random order per car, no provider signal); key.json holds the assignment.',
  ];
  fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}

(async () => {
  if (cmd === 'dry-run') return dryRun();
  if (cmd === 'run') {
    const tokensArg = opt('tokens', null);
    const tokens = tokensArg ? tokensArg.split(',').map(s => s.trim()).filter(Boolean) : loadCorpus(null).map(r => r.token);
    if (!tokens.length) { console.log('no tokens: pass --tokens or export the corpus'); process.exit(1); }
    const via = opt('via', 'endpoint');
    const conc = parseInt(opt('concurrency', '2'), 10) || 2;
    const sm = opt('shadow-model', null), se = opt('shadow-effort', null);
    const extra = { skipControl: args.includes('--skip-control'), shadowMaxTokens: opt('shadow-max-tokens', null) ? parseInt(opt('shadow-max-tokens', null), 10) : null, shadowTimeoutMs: opt('shadow-timeout-ms', null) ? parseInt(opt('shadow-timeout-ms', null), 10) : null };
    const res = via === 'local' ? await runLocal(tokens, sm, se, conc, extra) : await runEndpoint(tokens, opt('base', 'https://www.calcar.io'), sm, se, conc, extra);
    console.log('pairs written:', res.length, '->', PAIRS_DIR);
    return;
  }
  if (cmd === 'combine') return combine();
  if (cmd === 'summarize') return summarize();
  console.log('usage: node fc-shadow-bench.js dry-run | run [--via endpoint|local] | summarize');
  process.exit(1);
})().catch(e => { console.error('fc-shadow-bench failed:', (e && e.stack) || e); process.exit(1); });
