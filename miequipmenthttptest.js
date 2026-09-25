/* Інтеграційний тест Equipment v1 через PostgREST, тим самим шляхом, яким
   ходить продакшн (api/mi-equipment.js): роль authenticator з
   safeupdate, далі service_role. psql і Supabase MCP ходять роллю
   postgres і цього рантайму не відтворюють.

   Що перевіряється:
     * rpc/mi_equipment_candidates службовою роллю: 200, без SQLSTATE 21000,
       відповідь має контракт {available, reason?, candidates[]};
     * rpc/mi_record_equipment службовою роллю: 200, рядок від джерела, що
       не бачить авто (listing), відхиляється і НІЧОГО не пише;
     * анонімний ключ жодної з двох функцій не виконує.

   За замовчуванням VIN поза каталогом обладнання (Volkswagen): функція
   відповідає no_equipment_catalog ще ДО мосту у Vehicle Memory, тобто
   тест у продакшні нічого не пише. Запис теж не пише: єдиний рядок
   свідомо відхиляється. Власний VIN можна дати через MI_HTTP_VIN.

     MI_HTTP_URL=https://<project>.supabase.co \
     MI_HTTP_SERVICE_KEY=<service_role key> \
     [MI_HTTP_ANON_KEY=<anon key>] \
     [MI_HTTP_VIN=WVWZZZ7MZ6V009287] \
     node miequipmenthttptest.js */

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const URL_BASE = (process.env.MI_HTTP_URL || '').replace(/\/$/, '');
const SERVICE = process.env.MI_HTTP_SERVICE_KEY || '';
const ANON = process.env.MI_HTTP_ANON_KEY || '';
const VIN = (process.env.MI_HTTP_VIN || 'WVWZZZ7MZ6V009287').toUpperCase();

if (!URL_BASE || !SERVICE) {
  console.log('miequipmenthttptest: ПРОПУЩЕНО, немає MI_HTTP_URL або MI_HTTP_SERVICE_KEY');
  console.log('   цей шлях (PostgREST + service_role) не перевіряється ні psql, ні MCP');
  process.exit(0);
}

async function rpc(key, name, args) {
  const res = await fetch(URL_BASE + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = { _raw: text.slice(0, 200) }; }
  return { status: res.status, body };
}
const brief = b => JSON.stringify(b || {}).slice(0, 200);

(async () => {
  /* 1. кандидати */
  const c = await rpc(SERVICE, 'mi_equipment_candidates', { p_vin: VIN });
  ok('1. mi_equipment_candidates відповідає 200', c.status === 200, 'HTTP ' + c.status + ' ' + brief(c.body));
  ok('1b. немає SQLSTATE 21000 (safeupdate)', !(c.body && c.body.code === '21000'), brief(c.body));
  if (c.status === 200) {
    ok('1c. контракт відповіді', typeof c.body.available === 'boolean' && Array.isArray(c.body.candidates), brief(c.body));
    ok('1d. недоступне не повертається', !c.body.candidates.some(x => x && x.availability === 'not_available'));
    ok('1e. без доказу нічого не «встановлено»', c.body.candidates.every(x => !x.identity || x.identity.status === 'confirmed'));
    console.log('   candidates: available=' + c.body.available + ' reason=' + (c.body.reason || null) + ' n=' + c.body.candidates.length);
  }

  /* 2. запис: лише відхилений рядок, нічого не пишеться */
  const w = await rpc(SERVICE, 'mi_record_equipment', { p_vin: VIN, p_observations: [
    { vm_ref: 'bmw:head_up_display', source_kind: 'listing', provenance_root: 'http-test' },
  ] });
  ok('2. mi_record_equipment відповідає 200', w.status === 200, 'HTTP ' + w.status + ' ' + brief(w.body));
  ok('2b. рядок від listing відхилено, нічого не записано', w.body && w.body.written === 0 && w.body.rejected === 1, brief(w.body));

  /* 3. анонімна роль доступу не має */
  if (ANON) {
    const a1 = await rpc(ANON, 'mi_equipment_candidates', { p_vin: VIN });
    const a2 = await rpc(ANON, 'mi_record_equipment', { p_vin: VIN, p_observations: [] });
    ok('3. anon не виконує mi_equipment_candidates', [401, 403, 404].includes(a1.status), 'HTTP ' + a1.status + ' ' + brief(a1.body));
    ok('3b. anon не виконує mi_record_equipment', [401, 403, 404].includes(a2.status), 'HTTP ' + a2.status + ' ' + brief(a2.body));
  } else {
    console.log('   note: MI_HTTP_ANON_KEY не заданий, перевірка заборони для anon пропущена');
  }

  if (errs.length) {
    console.error('miequipmenthttptest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('miequipmenthttptest: усі ' + checks + ' перевірок пройшли (PostgREST + service_role)');
})().catch(e => { console.error('miequipmenthttptest CRASHED:', e.stack || e.message); process.exit(1); });
