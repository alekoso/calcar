/* Сторож сумісності з safeupdate (Supabase / PostgREST).

   Навіщо. Supabase вантажить бібліотеку `safeupdate` у сесії ролі
   `authenticator`, якою ходить PostgREST. Вона відхиляє будь-який DELETE
   або UPDATE без WHERE з SQLSTATE 21000. Роль `postgres`, якою йдуть
   перевірки через psql і MCP, цієї бібліотеки НЕ вантажить, тому такий
   оператор проходить локально і падає у продакшні. Саме так Phase 7.6
   зламала автоматичну тінь: `delete from tmp_obs;` у резолвері.

   Що перевіряється. Береться ЕФЕКТИВНЕ визначення кожної функції, тобто
   останнє за порядком міграцій, і в ньому шукаються DELETE та UPDATE без
   WHERE. Історичні визначення не чіпаються: міграції forward-only, і
   попередні тіла лишаються у файлах назавжди.

   Сторож не привʼязаний до конкретних семи рядків: він знайде будь-який
   новий такий оператор у будь-якій функції MI.

   Запуск: node misafeupdatetest.js */

const fs = require('fs');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const DIR = path.join(__dirname, 'migrations', 'mi');
const FILES = fs.readdirSync(DIR).filter(f => /^\d+_.*\.up\.sql$/.test(f)).sort();

/* Тіло функції від `create or replace function` до першого `$$;`.
   Вкладені долари інших тегів (наприклад `$q$`) всередині не заважають:
   `$$;` зустрічається лише наприкінці самого тіла. */
function definitions(sql) {
  const out = [];
  const re = /create\s+or\s+replace\s+function\s+([a-z_]+)\.([a-z_0-9]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const start = m.index;
    const bodyStart = sql.indexOf('as $$', start);
    if (bodyStart === -1) continue;
    const end = sql.indexOf('$$;', bodyStart);
    if (end === -1) continue;
    out.push({ key: (m[1] + '.' + m[2]).toLowerCase(), text: sql.slice(start, end + 3) });
    re.lastIndex = end;
  }
  return out;
}

/* Ефективне визначення: останнє за порядком номерів міграцій. */
const effective = new Map();
for (const f of FILES) {
  for (const d of definitions(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
    effective.set(d.key, { file: f, text: d.text });
  }
}
ok('ефективні визначення знайдені', effective.size > 20, 'знайдено ' + effective.size);

/* Коментарі прибираються: приклад у коментарі не є оператором. */
const stripComments = s => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/* Оператор без WHERE. Дивимось на текст до термінатора `;`.

   Важливо: `on conflict ... do update set` це НЕ окремий UPDATE. safeupdate
   його не чіпає, бо цільовий рядок уже визначений конфліктом ключа. Тому
   рахуються лише оператори, які СТОЯТЬ на початку інструкції: після `;`,
   `begin`, `then`, `else`, `loop` або на початку тіла. */
function unsafeStatements(body) {
  const sql = stripComments(body);
  const found = [];
  /* Якір нульової ширини: інакше `;` попереднього оператора зʼїдається
     збігом і наступний оператор лишається без якоря. */
  const re = /(?<=^|;|\bbegin\b|\bthen\b|\belse\b|\bloop\b|\$\$)\s*(delete\s+from|update)\s+([a-z_][a-z_0-9\.]*)((?:[^;]|\([^)]*\))*);/gi;
  let m;
  while ((m = re.exec(sql))) {
    const kind = m[1].toLowerCase().startsWith('delete') ? 'DELETE' : 'UPDATE';
    const tail = m[3] || '';
    /* WHERE самого оператора; хвіст після `on conflict` не рахується */
    const head = tail.split(/\bon\s+conflict\b/i)[0];
    if (!/\bwhere\b/i.test(head)) {
      found.push({ kind, table: m[2], stmt: (m[0]).replace(/\s+/g, ' ').trim().slice(0, 160) });
    }
  }
  return found;
}

const offenders = [];
for (const [key, def] of effective) {
  for (const s of unsafeStatements(def.text)) offenders.push({ fn: key, file: def.file, ...s });
}

ok('жодного DELETE або UPDATE без WHERE у ефективних визначеннях MI',
  offenders.length === 0,
  offenders.map(o => o.fn + ' [' + o.file + '] ' + o.stmt).join(' | '));

/* Сторож має реально ловити регресію, інакше він декоративний. */
const canary = `create or replace function mi.canary_probe() returns void language plpgsql as $$
begin
  delete from tmp_thing;
  update mi.claim set status = 'x';
end $$;`;
const caught = unsafeStatements(canary);
ok('сторож ловить DELETE без WHERE', caught.some(c => c.kind === 'DELETE' && c.table === 'tmp_thing'));
ok('сторож ловить UPDATE без WHERE', caught.some(c => c.kind === 'UPDATE' && c.table === 'mi.claim'));
ok('сторож не чіпає оператори з WHERE',
  unsafeStatements(`create or replace function mi.x() returns void language plpgsql as $$
begin
  delete from tmp_thing where true;
  update mi.claim set status = 'x' where id = 1;
  delete from mi.fragment_dependency where fragment_id = v_frag;
end $$;`).length === 0);
ok('сторож не реагує на приклад у коментарі',
  unsafeStatements(`create or replace function mi.y() returns void language plpgsql as $$
begin
  -- delete from tmp_thing;
  perform 1;
end $$;`).length === 0);

/* Сім відомих очищень мають бути саме з WHERE і саме у 024. */
const m024 = FILES.filter(f => f.startsWith('024_'));
ok('міграція 024 присутня', m024.length === 1, FILES.join(','));
if (m024.length === 1) {
  const sql = fs.readFileSync(path.join(DIR, m024[0]), 'utf8');
  const clears = (stripComments(sql).match(/delete\s+from\s+tmp_[a-z_]+\s+where\s+true\s*;/gi) || []);
  ok('у 024 рівно сім очищень тимчасових таблиць із where true', clears.length === 7, 'знайдено ' + clears.length);
  ok('у 024 не лишилось жодного голого delete from tmp_',
    !/delete\s+from\s+tmp_[a-z_]+\s*;/i.test(stripComments(sql)));
}

/* Усі цілі семи очищень це саме ТИМЧАСОВІ таблиці. */
const allSql = FILES.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
for (const t of ['tmp_obs', 'tmp_scope', 'tmp_claims', 'tmp_eval', 'tmp_pick']) {
  ok(t + ' створюється як temporary',
    new RegExp('create\\s+temporary\\s+table\\s+if\\s+not\\s+exists\\s+' + t + '\\b', 'i').test(allSql));
  ok(t + ' ніде не створюється як durable',
    !new RegExp('create\\s+table\\s+(if\\s+not\\s+exists\\s+)?' + t + '\\b', 'i').test(allSql));
}

if (errs.length) {
  console.error('misafeupdatetest: помилок ' + errs.length + ' із ' + checks);
  for (const e of errs) console.error(' - ' + e);
  process.exit(1);
}
console.log('misafeupdatetest: усі ' + checks + ' перевірок пройшли');
