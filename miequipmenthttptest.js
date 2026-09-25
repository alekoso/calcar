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
     [MI_HTTP_ANON_KEY=<anon key, типово публічний ключ із config.js>] \
     [MI_HTTP_VIN=WVWZZZ7MZ6V009287] \
     [MI_HTTP_POSITIVE_VIN=<VIN, що розвʼязується у 530i xDrive US MY2018>] \
     [MI_HTTP_POSITIVE_N=21] \
     [MI_HTTP_NEGATIVE_VIN=<VIN сумісного бренду, але іншої версії чи року>] \
     [MI_HTTP_WRITE_VIN=<той самий позитивний VIN>] \
     node miequipmenthttptest.js

   Необовʼязкові гілки:
     * MI_HTTP_POSITIVE_VIN: кандидатів рівно MI_HTTP_POSITIVE_N (21 для
       зрізу 530i xDrive US MY2018), жоден не «встановлений» без доказу;
     * MI_HTTP_NEGATIVE_VIN: кандидатів 0 і причина відмови;
     * MI_HTTP_WRITE_VIN: справжній запис одного спостереження з фото,
       повтор того самого нічого не дописує, після запису предмет
       повертається як confirmed. Ця гілка ПИШЕ у Vehicle Memory, тому
       лише на VIN, який потім прибирається (синтетичний рядок стенду). */

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const URL_BASE = (process.env.MI_HTTP_URL || '').replace(/\/$/, '');
const SERVICE = process.env.MI_HTTP_SERVICE_KEY || '';
/* Анонімний ключ публічний (його і так віддає браузеру config.js), тому
   типово береться звідти і не копіюється руками: копія з інтерфейсу буває
   замаскована крапками «•», і такий заголовок fetch не приймає. Значення
   не друкується ніколи. */
function configAnon() {
  try {
    const w = {};
    require('vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname, 'config.js'), 'utf8'), { window: w });
    return (w.CALCAR_SUPABASE && w.CALCAR_SUPABASE.anon) || '';
  } catch (e) { return ''; }
}
const ANON = process.env.MI_HTTP_ANON_KEY || configAnon();
const plainKey = k => /^[\x21-\x7e]+$/.test(k);
const VIN = (process.env.MI_HTTP_VIN || 'WVWZZZ7MZ6V009287').toUpperCase();
const POS = (process.env.MI_HTTP_POSITIVE_VIN || '').toUpperCase();
const POS_N = parseInt(process.env.MI_HTTP_POSITIVE_N || '21', 10);
const NEG = (process.env.MI_HTTP_NEGATIVE_VIN || '').toUpperCase();
const WRITE = (process.env.MI_HTTP_WRITE_VIN || '').toUpperCase();

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

  /* 2c. позитивний шлях: сумісна ідентичність дає непорожній набір */
  if (POS) {
    const p = await rpc(SERVICE, 'mi_equipment_candidates', { p_vin: POS });
    const n = p.body && Array.isArray(p.body.candidates) ? p.body.candidates.length : -1;
    ok('2c. позитивний VIN: 200 і available', p.status === 200 && p.body.available === true, 'HTTP ' + p.status + ' ' + brief(p.body));
    ok('2d. позитивний VIN: кандидатів ' + POS_N, n === POS_N, 'n=' + n);
    ok('2e. позитивний VIN: лише BMW, без not_available', n > 0 && p.body.candidates.every(x => x.brand === 'BMW' && x.availability !== 'not_available'));
    ok('2f. позитивний VIN: HUD 610 опційний з пакетом ZDA', n > 0 && p.body.candidates.some(x => x.equipment_key === 'head_up_display'
      && x.oem_code === '610' && x.availability === 'optional' && (x.packages || []).some(k => k.oem_code === 'ZDA')));
    console.log('   positive: HTTP ' + p.status + ' available=' + (p.body && p.body.available) + ' precision=' + (p.body && p.body.identity_precision)
      + ' n=' + n + ' installed_without_evidence=' + (n > 0 ? p.body.candidates.filter(x => x.identity).length : 0));
  }

  /* 2g. негативний шлях: несумісна ідентичність кандидатів не має */
  if (NEG) {
    const q = await rpc(SERVICE, 'mi_equipment_candidates', { p_vin: NEG });
    ok('2g. негативний VIN: 200, available false, 0 кандидатів', q.status === 200 && q.body.available === false
      && Array.isArray(q.body.candidates) && q.body.candidates.length === 0, 'HTTP ' + q.status + ' ' + brief(q.body));
    console.log('   negative: HTTP ' + q.status + ' available=' + (q.body && q.body.available) + ' reason=' + (q.body && q.body.reason)
      + ' version=' + (q.body && q.body.identity_summary && q.body.identity_summary.version));
  }

  /* 2h. справжній запис і його ідемпотентність */
  if (WRITE) {
    const row = { vm_ref: 'bmw:head_up_display', source_kind: 'current_vision', provenance_root: 'http-test:' + WRITE, confidence: 'medium' };
    const w1 = await rpc(SERVICE, 'mi_record_equipment', { p_vin: WRITE, p_observations: [row] });
    const w2 = await rpc(SERVICE, 'mi_record_equipment', { p_vin: WRITE, p_observations: [row] });
    ok('2h. запис: 200, written 1', w1.status === 200 && w1.body.written === 1, 'HTTP ' + w1.status + ' ' + brief(w1.body));
    ok('2i. повтор: 200, skipped 1, written 0', w2.status === 200 && w2.body.written === 0 && w2.body.skipped === 1, 'HTTP ' + w2.status + ' ' + brief(w2.body));
    const back = await rpc(SERVICE, 'mi_equipment_candidates', { p_vin: WRITE });
    const hud = back.body && Array.isArray(back.body.candidates) ? back.body.candidates.find(x => x.equipment_key === 'head_up_display') : null;
    ok('2j. після запису HUD повертається як confirmed, решта без змін', !!(hud && hud.identity && hud.identity.status === 'confirmed' && hud.identity.present === true)
      && back.body.candidates.filter(x => x.identity).length === 1, brief(hud));
    console.log('   write: first=' + brief(w1.body) + ' replay=' + brief(w2.body) + ' hud=' + JSON.stringify(hud && hud.identity));
  }

  /* 3. анонімна роль доступу не має: 401/403 саме з відмовою в правах 42501 */
  if (ANON && !plainKey(ANON)) {
    ok('3. анонімний ключ придатний для заголовка', false, 'ключ містить не-ASCII символи (замаскована копія?)');
  } else if (ANON) {
    for (const [name, args] of [['mi_equipment_candidates', { p_vin: VIN }], ['mi_record_equipment', { p_vin: VIN, p_observations: [] }]]) {
      try {
        const a = await rpc(ANON, name, args);
        ok('3. anon не виконує ' + name, [401, 403].includes(a.status) && a.body && a.body.code === '42501', 'HTTP ' + a.status + ' ' + brief(a.body));
        console.log('   anon ' + name + ': HTTP ' + a.status + ' ' + ((a.body && a.body.code) || ''));
      } catch (e) {
        ok('3. anon-виклик ' + name + ' виконано', false, String((e && e.message) || e).slice(0, 160));
      }
    }
  } else {
    console.log('   note: анонімного ключа немає (ні MI_HTTP_ANON_KEY, ні config.js), перевірка заборони для anon пропущена');
  }

  if (errs.length) {
    console.error('miequipmenthttptest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('miequipmenthttptest: усі ' + checks + ' перевірок пройшли (PostgREST + service_role)');
})().catch(e => { console.error('miequipmenthttptest CRASHED:', e.stack || e.message); process.exit(1); });
