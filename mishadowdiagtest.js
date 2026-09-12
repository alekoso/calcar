/* Phase 7.7: тимчасовий діагностичний ендпоінт `api/mi-shadow-diag.js`.

   Перевіряється рівно те, що вимагає фаза: без ключа ендпоінта не існує,
   з ключем він віддає лише булеві прапорці, жодне значення оточення
   назовні не йде, а `mi_shadow_enabled` рахує той самий helper, яким
   користується продакшн-тінь.

   База даних, Check, MI і AI тут не потрібні: ендпоінт їх не торкається,
   і тест це теж доводить.

   Запуск: node mishadowdiagtest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const codeOnly = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SRC = fs.readFileSync(path.join(__dirname, 'api', 'mi-shadow-diag.js'), 'utf8');
const CODE = codeOnly(SRC);

/* заглушка res у стилі durabletest: ядро пише статус і тіло */
function fakeRes() {
  return { _s: 200, _o: null, _h: {},
    setHeader(k, v) { this._h[k.toLowerCase()] = v; return this; },
    status(n) { this._s = n; return this; },
    json(o) { this._o = o; return this; } };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_midiag_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
    fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  }
  const D = await import('file://' + path.join(dir, 'api', 'mi-shadow-diag.js'));
  const M = await import('file://' + path.join(dir, 'api', 'mi-shadow.js'));

  const env0 = { BENCH_KEY: process.env.BENCH_KEY, MI_SHADOW_ENABLED: process.env.MI_SHADOW_ENABLED,
    SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const setEnv = o => {
    for (const k of ['BENCH_KEY', 'MI_SHADOW_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k];
    }
  };
  const call = async headers => {
    const res = fakeRes();
    await D.default({ method: 'GET', headers: headers || {} }, res);
    return res;
  };

  const SECRET_KEY = 'bench-secret-value-123';
  const SECRET_URL = 'https://secret-project.supabase.co';
  const SECRET_SRK = 'service-role-key-DO-NOT-LEAK-9876543210';

  try {
    /* 1. без заголовка: 404 і жодних деталей */
    setEnv({ BENCH_KEY: SECRET_KEY, MI_SHADOW_ENABLED: 'true', SUPABASE_URL: SECRET_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRK });
    let r = await call({});
    ok('1. без ключа 404', r._s === 404, 'статус ' + r._s);
    ok('1b. тіло без підказок', JSON.stringify(r._o) === JSON.stringify({ error: 'not found' }), JSON.stringify(r._o));

    /* 2. невірний ключ: теж 404 */
    r = await call({ 'x-calcar-bench': 'wrong-key' });
    ok('2. невірний ключ 404', r._s === 404, 'статус ' + r._s);

    /* 3. ключ є у запиті, але BENCH_KEY не заданий у оточенні: 404 */
    setEnv({ BENCH_KEY: undefined, MI_SHADOW_ENABLED: 'true', SUPABASE_URL: SECRET_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRK });
    r = await call({ 'x-calcar-bench': 'anything' });
    ok('3. без BENCH_KEY у оточенні 404', r._s === 404, 'статус ' + r._s);

    /* 4. правильний ключ: 200 і рівно обумовлені поля */
    setEnv({ BENCH_KEY: SECRET_KEY, MI_SHADOW_ENABLED: 'true', SUPABASE_URL: SECRET_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRK });
    r = await call({ 'x-calcar-bench': SECRET_KEY });
    ok('4. з ключем 200', r._s === 200, 'статус ' + r._s);
    const FIELDS = ['reached', 'mi_shadow_flag_present', 'mi_shadow_flag_raw_length', 'mi_shadow_enabled',
      'has_supabase_url', 'has_service_role_key', 'node'];
    ok('4b. поля рівно за контрактом', JSON.stringify(Object.keys(r._o || {}).sort()) === JSON.stringify([...FIELDS].sort()),
      JSON.stringify(Object.keys(r._o || {})));
    ok('4c. reached=true', r._o.reached === true);
    ok('4d. прапорець видно', r._o.mi_shadow_flag_present === true && r._o.mi_shadow_flag_raw_length === 4);
    ok('4e. enabled=true', r._o.mi_shadow_enabled === true);
    ok('4f. supabase env видно', r._o.has_supabase_url === true && r._o.has_service_role_key === true);
    ok('4g. node рядок', typeof r._o.node === 'string' && r._o.node.startsWith('v'));
    ok('4h. cache-control no-store', r._h['cache-control'] === 'no-store');

    /* 5. ЖОДНЕ значення оточення не витікає у відповідь.

       Значення прапорця перевіряється окремим прогоном із НЕбулевим
       рядком: інакше збіг зі словом `true` у самих булевих полях
       відповіді виглядав би як витік, хоча витоку немає. */
    const dump = JSON.stringify(r._o);
    for (const [label, secret] of [['BENCH_KEY', SECRET_KEY], ['SUPABASE_URL', SECRET_URL], ['SERVICE_ROLE_KEY', SECRET_SRK]]) {
      ok('5. ' + label + ' не у відповіді', !dump.includes(secret), dump.slice(0, 160));
    }
    const FLAG_SECRET = 'yes-but-written-uniquely-7f3a';
    setEnv({ BENCH_KEY: SECRET_KEY, MI_SHADOW_ENABLED: FLAG_SECRET, SUPABASE_URL: SECRET_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRK });
    const rFlag = await call({ 'x-calcar-bench': SECRET_KEY });
    const dumpFlag = JSON.stringify(rFlag._o);
    ok('5. значення прапорця не у відповіді', !dumpFlag.includes(FLAG_SECRET), dumpFlag.slice(0, 160));
    ok('5b. натомість видно лише довжину', rFlag._o.mi_shadow_flag_raw_length === FLAG_SECRET.length);
    setEnv({ BENCH_KEY: SECRET_KEY, MI_SHADOW_ENABLED: 'true', SUPABASE_URL: SECRET_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRK });
    ok('5b. у відповіді лише булеві, число і версія node',
      Object.entries(r._o).every(([k, v]) => k === 'node' ? typeof v === 'string'
        : k === 'mi_shadow_flag_raw_length' ? typeof v === 'number' : typeof v === 'boolean'));

    /* 6. mi_shadow_enabled рахує САМЕ продакшн-helper, а не локальна копія */
    ok('6. helper імпортований', /import \{ miShadowEnabled \} from '\.\/mi-shadow\.js';/.test(CODE),
      'ендпоінт не імпортує miShadowEnabled');
    ok('6b. власної реалізації прапорця немає',
      !/===\s*'true'|toLowerCase\(\)|'1'|'on'|'yes'/.test(CODE), 'у ендпоінті зʼявилась своя логіка прапорця');
    for (const [val, expect, len] of [['true', true, 4], ['1', true, 1], ['on', true, 2], ['yes', true, 3],
      ['false', false, 5], ['', false, 0], ['shadow', false, 6]]) {
      setEnv({ BENCH_KEY: SECRET_KEY, MI_SHADOW_ENABLED: val, SUPABASE_URL: SECRET_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRK });
      const rr = await call({ 'x-calcar-bench': SECRET_KEY });
      ok('6c. ' + JSON.stringify(val) + ' -> ' + expect, rr._o.mi_shadow_enabled === expect && rr._o.mi_shadow_flag_raw_length === len,
        JSON.stringify({ enabled: rr._o.mi_shadow_enabled, len: rr._o.mi_shadow_flag_raw_length }));
      ok('6d. ' + JSON.stringify(val) + ' збігається з helper', rr._o.mi_shadow_enabled === M.miShadowEnabled({ MI_SHADOW_ENABLED: val }));
    }

    /* 7. змінної немає взагалі: present=false, довжина 0 */
    setEnv({ BENCH_KEY: SECRET_KEY, MI_SHADOW_ENABLED: undefined, SUPABASE_URL: SECRET_URL, SUPABASE_SERVICE_ROLE_KEY: SECRET_SRK });
    r = await call({ 'x-calcar-bench': SECRET_KEY });
    ok('7. прапорця немає', r._o.mi_shadow_flag_present === false && r._o.mi_shadow_flag_raw_length === 0 && r._o.mi_shadow_enabled === false);

    /* 8. відсутні Supabase env видно як false, без падіння */
    setEnv({ BENCH_KEY: SECRET_KEY, MI_SHADOW_ENABLED: 'true', SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
    r = await call({ 'x-calcar-bench': SECRET_KEY });
    ok('8. supabase env відсутні', r._o.has_supabase_url === false && r._o.has_service_role_key === false && r._s === 200);
  } finally {
    setEnv(env0);
  }

  /* 9. ендпоінт нічого не торкається: ні БД, ні MI, ні Check, ні AI */
  for (const [what, re] of [['Supabase REST', /rest\/v1|supabase\.co/i], ['RPC тіні', /mi_shadow_pack|rpc\//],
    ['fetch назовні', /\bfetch\s*\(/], ['Check', /check-job|runCheck|\/api\/check/],
    ['AI', /openai|OPENAI_API_KEY/i], ['запис у БД', /insert|update|upsert|PATCH|POST/i]]) {
    ok('9. не звертається до: ' + what, !re.test(CODE), 'знайдено у коді ендпоінта');
  }
  ok('9b. імпортує лише helper прапорця',
    (CODE.match(/^import .*$/gm) || []).join(';') === "import { miShadowEnabled } from './mi-shadow.js';",
    (CODE.match(/^import .*$/gm) || []).join(';'));

  /* 10. гейт дослівно за патерном проєкту */
  ok('10. гейт BENCH_KEY за наявним патерном',
    /const benchAllowed = !!\(process\.env\.BENCH_KEY && req\.headers && req\.headers\['x-calcar-bench'\] === process\.env\.BENCH_KEY\);/.test(CODE));
  ok('10b. без гейта одразу 404', /if \(!benchAllowed\) return res\.status\(404\)/.test(CODE));

  /* 11. продакшн-шлях Check не зачеплений цією фазою */
  const check = fs.readFileSync(path.join(__dirname, 'api', 'check.js'), 'utf8');
  ok('11. api/check.js не знає про діагностику', !/mi-shadow-diag/.test(check));
  ok('11b. тінь лишилась одним викликом', (check.match(/runMiShadow\(/g) || []).length === 1);

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('mishadowdiagtest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('mishadowdiagtest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('mishadowdiagtest CRASHED:', e.stack || e.message); process.exit(1); });
