/* Контракт REST-запитів Vehicle Memory зі схемою.

   Навіщо. `readSnapshots` роками вибирав і сортував `vehicle_snapshots` за
   колонкою `created_at`, якої в таблиці немає. PostgREST відповідав HTTP
   400, помилка ковталась, історичні точки пробігу не доходили до Check
   узагалі. Рядковий тест на один запит цього б не спіймав: треба звіряти
   КОЖЕН запит із реальною схемою.

   Що перевіряється. Колонки з `select=`, `order=`, фільтрів `col=eq.` і
   `on_conflict=` у REST-викликах `api/check.js` і `api/vehicle-memory.js`
   звіряються з DDL репозиторію. Відновлений базовий DDL сам звірений із
   продакшном тестом `mivmtest.js` (пункт 14), тому DDL тут і є контракт.

   Плюс поведінка `readSnapshots` на заглушці fetch: час знімка береться з
   `captured_at`, а збій запиту дає структурований лог, а не тишу.

   Запуск: node vmrestschematest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

/* ---------- 1. схема з DDL репозиторію ---------- */
const DDL_FILES = ['supabase-vehicle-memory-baseline.sql', 'supabase-vehicle-intelligence.sql',
  'supabase-vehicle-memory-v1.sql', 'supabase-vehicle-memory-v2.sql', 'supabase-auction-cache.sql',
  'supabase-jobs.sql'];
const TYPES = 'uuid|text|jsonb|integer|numeric|smallint|timestamptz|date|boolean|bigint';
const schema = {};
const addCol = (t, c) => { (schema[t] = schema[t] || new Set()).add(c); };
for (const f of DDL_FILES) {
  const sql = fs.readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
  for (const m of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
    for (const line of m[2].split('\n')) {
      const c = line.match(new RegExp('^\\s*([a-z_]+)\\s+(?:' + TYPES + ')\\b', 'i'));
      if (c) addCol(m[1], c[1]);
    }
  }
  for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?([a-z_]+)\s+add\s+column\s+if\s+not\s+exists\s+([a-z_]+)/gi)) addCol(m[1], m[2]);
}
ok('схема vehicle_snapshots зібрана з DDL', schema.vehicle_snapshots && schema.vehicle_snapshots.size === 36,
  'колонок ' + (schema.vehicle_snapshots ? schema.vehicle_snapshots.size : 0));
ok('у vehicle_snapshots немає created_at', !schema.vehicle_snapshots.has('created_at'));
ok('у vehicle_snapshots є captured_at', schema.vehicle_snapshots.has('captured_at'));

/* ---------- 2. колонки з REST-запитів ---------- */
function referencedColumns(snippet) {
  const out = [];
  const sel = snippet.match(/[?&]select=([a-z_0-9,()*]+)/i);
  if (sel && sel[1] !== '*') {
    for (const part of sel[1].match(/[a-z_]+\([a-z_,]+\)|[a-z_*]+/gi) || []) {
      const emb = part.match(/^([a-z_]+)\(([a-z_,]+)\)$/i);
      if (emb) for (const c of emb[2].split(',')) out.push({ table: emb[1], col: c, via: 'select-embed' });
      else if (part !== '*') out.push({ col: part, via: 'select' });
    }
  }
  const ord = snippet.match(/[?&]order=([a-z_]+)/i);
  if (ord) out.push({ col: ord[1], via: 'order' });
  for (const f of snippet.matchAll(/[?&]([a-z_]+)=(?:eq|neq|is|in|gt|gte|lt|lte)\./gi)) out.push({ col: f[1], via: 'filter' });
  const oc = snippet.match(/[?&]on_conflict=([a-z_,]+)/i);
  if (oc) for (const c of oc[1].split(',')) out.push({ col: c, via: 'on_conflict' });
  return out;
}
function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const found = [];
  const re = /(?:rest\/v1\/|rest\(')([a-z_]+)\?/g;
  let m;
  while ((m = re.exec(src))) {
    const table = m[1];
    /* фрагмент до наступного REST-виклику або кінця опцій запиту */
    let tail = src.slice(m.index + m[0].length - 1, m.index + 700);
    const next = tail.slice(1).search(/rest\/v1\/|rest\('|headers\s*:|method\s*:|\{\s*method/);
    if (next >= 0) tail = tail.slice(0, next + 1);
    const line = src.slice(0, m.index).split('\n').length;
    for (const r of referencedColumns(tail)) found.push({ file, line, table: r.table || table, col: r.col, via: r.via });
  }
  return found;
}
const refs = [...scanFile('api/check.js'), ...scanFile('api/vehicle-memory.js')];
ok('знайдено REST-запити до таблиць памʼяті', refs.filter(r => r.table === 'vehicle_snapshots').length >= 5,
  'посилань ' + refs.length);
const unknown = refs.filter(r => schema[r.table] && !schema[r.table].has(r.col));
ok('кожна колонка REST-запитів існує у схемі', unknown.length === 0,
  unknown.map(u => u.file + ':' + u.line + ' ' + u.table + '.' + u.col + ' (' + u.via + ')').join(' | '));
const unchecked = [...new Set(refs.filter(r => !schema[r.table]).map(r => r.table))];
ok('немає таблиць без DDL у репозиторії', unchecked.length === 0, unchecked.join(','));

/* сторож мусить ловити саме цей клас помилки */
const canary = referencedColumns("vehicle_snapshots?vin=eq.' + v + '&select=odometer_km,source_url,created_at&order=created_at.asc");
ok('канарка: created_at у vehicle_snapshots ловиться',
  canary.some(r => r.col === 'created_at') && canary.every(r => r.col !== 'created_at' || !schema.vehicle_snapshots.has(r.col)));

/* ---------- 3. поведінка readSnapshots ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_vmrest_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) {
  fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));
}

(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  const C = await import('file://' + path.join(dir, 'api', 'check.js'));
  const realFetch = globalThis.fetch;
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => logs.push(a.map(String).join(' '));
  try {
    let seenUrl = null;
    globalThis.fetch = async url => {
      seenUrl = String(url);
      return { ok: true, status: 200, json: async () => [
        { odometer_km: 93000, source_url: 'https://auto.ria.com/uk/auto_x_1.html', captured_at: '2026-08-26T19:46:03Z' },
        { odometer_km: 153000, source_url: 'https://auto.ria.com/uk/auto_x_2.html?utm_source=io', captured_at: '2026-09-10T07:20:32Z' },
      ] };
    };
    const rows = await C.readSnapshots('WP1ZZZ92ZDLA45155', 'https://auto.ria.com/uk/auto_current_9.html');
    ok('readSnapshots просить captured_at', /select=odometer_km,source_url,captured_at&order=captured_at\.asc/.test(seenUrl || ''), seenUrl);
    ok('readSnapshots не згадує created_at у запиті', !/created_at/.test(seenUrl || ''));
    ok('час точки береться з captured_at', rows.length === 2 && rows[0].created_at === '2026-08-26T19:46:03Z'
      && rows[1].created_at === '2026-09-10T07:20:32Z', JSON.stringify(rows));
    ok('пробіг точок збережений', rows[0].odometer_km === 93000 && rows[1].odometer_km === 153000);

    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [
      { odometer_km: 1, source_url: 'https://auto.ria.com/uk/auto_current_9.html', captured_at: '2026-09-01T00:00:00Z' }] });
    const own = await C.readSnapshots('WP1ZZZ92ZDLA45155', 'https://auto.ria.com/uk/auto_current_9.html');
    ok('поточне оголошення і далі не рахується історією', own.length === 0);

    logs.length = 0;
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ code: '42703' }) });
    const bad = await C.readSnapshots('WP1ZZZ92ZDLA45155', 'https://x/y');
    ok('збій запиту повертає порожній список', Array.isArray(bad) && bad.length === 0);
    ok('збій запиту дає структурований лог', logs.some(l => /\[vehicle-memory\]/.test(l) && /"op":"read_snapshots"/.test(l) && /"status":400/.test(l)),
      logs.join(' || '));

    logs.length = 0;
    globalThis.fetch = async () => { throw new Error('socket hang up'); };
    await C.readSnapshots('WP1ZZZ92ZDLA45155', 'https://x/y');
    ok('виняток мережі теж дає структурований лог', logs.some(l => /"op":"read_snapshots"/.test(l) && /socket hang up/.test(l)));
  } finally {
    console.log = realLog;
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (errs.length) {
    console.error('vmrestschematest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('vmrestschematest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('vmrestschematest CRASHED:', e.stack || e.message); process.exit(1); });
