/* Інтеграційний тест тіні через PostgREST, тобто тим самим шляхом, яким
   ходить продакшн.

   Навіщо окремий тест. Перевірки через psql і Supabase MCP виконуються
   роллю `postgres`. PostgREST ходить роллю `authenticator` з
   `session_preload_libraries = supautils, safeupdate`, далі `set role
   service_role`. Це РІЗНІ рантайми: у другому діють safeupdate, гранти і
   RLS. Phase 7.7 показала ціну різниці: `delete from tmp_obs;` проходив
   локально і падав у продакшні з SQLSTATE 21000.

   Тест звертається до HTTP-ендпоінта PostgREST і перевіряє:
     * виклик rpc/mi_shadow_pack службовою роллю не дає 21000;
     * відповідь має форму пакета тіні;
     * анонімний ключ до цієї функції доступу не має.

   Тест НЕ вигадує оточення. Без явних змінних він не виконується і чесно
   про це каже, бо інакше мовчазний пропуск виглядав би як успіх:

     MI_HTTP_URL=https://<project>.supabase.co \
     MI_HTTP_SERVICE_KEY=<service_role key> \
     [MI_HTTP_ANON_KEY=<anon key>] \
     [MI_HTTP_VIN=WVWZZZ7MZ6V009287] \
     node mishadowhttptest.js

   Викликати ГІЛКУ або тестовий проєкт. Тінь пише спостереження у
   Vehicle Memory, тому проти продакшну запускати свідомо і рідко. */

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const URL_BASE = (process.env.MI_HTTP_URL || '').replace(/\/$/, '');
const SERVICE = process.env.MI_HTTP_SERVICE_KEY || '';
const ANON = process.env.MI_HTTP_ANON_KEY || '';
const VIN = process.env.MI_HTTP_VIN || 'WVWZZZ7MZ6V009287';

if (!URL_BASE || !SERVICE) {
  console.log('mishadowhttptest: ПРОПУЩЕНО, немає MI_HTTP_URL або MI_HTTP_SERVICE_KEY');
  console.log('   цей шлях (PostgREST + service_role) не перевіряється ні psql, ні MCP;');
  console.log('   без нього safeupdate, гранти і RLS лишаються неперевіреними');
  process.exit(0);
}

async function rpc(key, vin) {
  const res = await fetch(URL_BASE + '/rest/v1/rpc/mi_shadow_pack', {
    method: 'POST',
    headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ p_vin: vin }),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = { _raw: text.slice(0, 200) }; }
  return { status: res.status, body };
}

(async () => {
  /* 1. службова роль: виклик проходить і НЕ впирається у safeupdate */
  const r = await rpc(SERVICE, VIN);
  ok('1. RPC відповідає 200', r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  const code = r.body && (r.body.code || r.body.error_code);
  ok('1b. немає SQLSTATE 21000 (safeupdate)', code !== '21000',
    JSON.stringify(r.body).slice(0, 200));
  ok('1c. немає повідомлення про DELETE без WHERE',
    !/DELETE requires a WHERE clause/i.test(JSON.stringify(r.body || {})),
    JSON.stringify(r.body).slice(0, 200));

  /* 2. форма відповіді: це пакет тіні, а не довільний JSON.
     mi_available=false це коректний успішний результат для машини поза
     каталогом, тому перевіряється саме наявність контракту. */
  if (r.status === 200 && r.body && typeof r.body === 'object') {
    ok('2. у відповіді є vin', r.body.vin === VIN.toUpperCase() || r.body.vin === VIN);
    ok('2b. у відповіді є прапорець mi_available', typeof r.body.mi_available === 'boolean');
    ok('2c. є ingest або причина', !!(r.body.ingest || r.body.reason));
  }

  /* 3. повторний виклик ідемпотентний за семантикою */
  const r2 = await rpc(SERVICE, VIN);
  ok('3. повтор теж 200', r2.status === 200, 'HTTP ' + r2.status);
  if (r.status === 200 && r2.status === 200) {
    ok('3b. mi_available не змінився', r.body.mi_available === r2.body.mi_available);
    ok('3c. повтор нічого не дописує', (r2.body.ingest && String(r2.body.ingest.written)) === '0',
      JSON.stringify(r2.body && r2.body.ingest || {}).slice(0, 160));
  }

  /* 4. анонімна роль доступу не має: права відкликані у 018 */
  if (ANON) {
    const a = await rpc(ANON, VIN);
    ok('4. anon не виконує mi_shadow_pack', a.status === 401 || a.status === 403 || a.status === 404,
      'HTTP ' + a.status + ' ' + JSON.stringify(a.body).slice(0, 120));
  } else {
    console.log('   note: MI_HTTP_ANON_KEY не заданий, перевірка заборони для anon пропущена');
  }

  if (errs.length) {
    console.error('mishadowhttptest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('mishadowhttptest: усі ' + checks + ' перевірок пройшли (PostgREST + service_role)');
})().catch(e => { console.error('mishadowhttptest CRASHED:', e.stack || e.message); process.exit(1); });
