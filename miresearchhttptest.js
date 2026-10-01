/* Інтеграційний тест MI Research v1 через PostgREST, тим самим шляхом, яким
   ходить продакшн (api/mi-research.js): роль authenticator з safeupdate,
   далі service_role. psql і Supabase MCP ходять роллю postgres і цього
   рантайму не відтворюють.

   Що перевіряється:
     * rpc/mi_research_context службовою роллю: 200, без SQLSTATE 21000,
       контракт {available, reason?} і для доступної ідентичності
       knowledge[] з наявним знанням;
     * rpc/mi_research_persist службовою роллю: 200; порожній перелік
       знахідок нічого не пише; знахідка про VIN пропускається з причиною;
     * rpc/mi_research_finalize (міграція 030) службовою роллю: 200; без
       канонічного покоління нічого не пише; контекст з канонічною
       ідентичністю лише читає;
     * анонімний ключ жодної з трьох функцій не виконує.

   За замовчуванням VIN поза каталогом (Volkswagen): контекст відповідає
   brand_not_in_catalog ще ДО мосту у Vehicle Memory, збереження отримує
   лише знахідку про VIN, яка пропускається. У продакшні тест нічого не
   пише. Власний VIN можна дати через MI_HTTP_VIN.

     MI_HTTP_URL=https://<project>.supabase.co \
     MI_HTTP_SERVICE_KEY=<service_role key> \
     [MI_HTTP_ANON_KEY=<anon key, типово публічний ключ із config.js>] \
     [MI_HTTP_VIN=WVWZZZ7MZ6V009287] \
     node miresearchhttptest.js */

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const URL_BASE = (process.env.MI_HTTP_URL || '').replace(/\/$/, '');
const SERVICE = process.env.MI_HTTP_SERVICE_KEY || '';
const VIN = (process.env.MI_HTTP_VIN || 'WVWZZZ7MZ6V009287').toUpperCase();
function configAnon() {
  try {
    const w = {};
    require('vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname, 'config.js'), 'utf8'), { window: w });
    return (w.CALCAR_SUPABASE && w.CALCAR_SUPABASE.anon) || '';
  } catch (e) { return ''; }
}
const ANON = process.env.MI_HTTP_ANON_KEY || configAnon();
const plainKey = k => /^[\x21-\x7e]+$/.test(k);

if (!URL_BASE || !SERVICE) {
  console.log('miresearchhttptest: ПРОПУЩЕНО, немає MI_HTTP_URL або MI_HTTP_SERVICE_KEY');
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
const brief = b => JSON.stringify(b || {}).slice(0, 220);

(async () => {
  const c = await rpc(SERVICE, 'mi_research_context', { p_vin: VIN, p_identity: null });
  ok('1. mi_research_context відповідає 200', c.status === 200, 'HTTP ' + c.status + ' ' + brief(c.body));
  ok('1b. немає SQLSTATE 21000 (safeupdate)', !(c.body && c.body.code === '21000'), brief(c.body));
  if (c.status === 200) {
    ok('1c. контракт відповіді', typeof c.body.available === 'boolean' && (c.body.available || typeof c.body.reason === 'string'), brief(c.body));
    if (c.body.available) ok('1d. контекст несе mi_scope, перелік відомого і памʼять кандидатів', ['version', 'generation', 'none'].includes(c.body.mi_scope) && Array.isArray(c.body.knowledge) && Array.isArray(c.body.open_candidates));
    console.log('   context: available=' + c.body.available + ' mi_scope=' + (c.body.mi_scope || '-') + ' knowledge=' + (c.body.knowledge_count == null ? '-' : c.body.knowledge_count) + ' candidates=' + (c.body.open_candidates_count == null ? '-' : c.body.open_candidates_count) + ' version=' + ((c.body.identity_summary && c.body.identity_summary.version) || '-'));
  }

  const w0 = await rpc(SERVICE, 'mi_research_persist', { p_vin: VIN, p_run: { check_token: 'http-test', identity: { label: 'HTTP test identity' }, findings: [] } });
  ok('2. mi_research_persist відповідає 200 на порожній перелік', w0.status === 200, 'HTTP ' + w0.status + ' ' + brief(w0.body));
  ok('2b. порожній перелік нічого не пише', w0.body && (w0.body.ok === false || (w0.body.findings === 0 && w0.body.published === 0 && w0.body.candidates === 0)), brief(w0.body));
  const w1 = await rpc(SERVICE, 'mi_research_persist', { p_vin: VIN, p_run: { check_token: 'http-test', identity: { label: 'HTTP test identity' }, findings: [
    { scope: 'vehicle', knowledge_type: 'official_fact', text_en: 'This VIN was sold abroad according to a listing seen during the HTTP test.', buyer_importance: 3, evidence: [] },
  ] } });
  ok('2c. знахідка про VIN пропускається, у MI не пише', w1.status === 200 && w1.body && (w1.body.ok === false
    || (w1.body.skipped === 1 && w1.body.published === 0 && w1.body.candidates === 0 && w1.body.results && w1.body.results[0].reason === 'vehicle_scope_not_mi')), brief(w1.body));
  console.log('   persist: ' + brief(w1.body));

  /* міграція 030: контекст з ідентичністю лише читає; фінал без покоління нічого не пише */
  const c2 = await rpc(SERVICE, 'mi_research_context', { p_vin: VIN, p_identity: { brand: 'Volkswagen', model_line: 'HTTP test line', generation: 'ZZ99', version_text: 'http', label: 'HTTP test identity' } });
  ok('4. контекст з канонічною ідентичністю відповідає 200 і нічого не пише', c2.status === 200 && c2.body && c2.body.available === true && c2.body.research_identity && c2.body.research_identity.generation === 'ZZ99' && c2.body.research_identity.key === 'volkswagen|httptestline|ZZ99' && c2.body.open_candidates_count === 0, 'HTTP ' + c2.status + ' ' + brief(c2.body));
  const f0 = await rpc(SERVICE, 'mi_research_finalize', { p_vin: VIN, p_run: { check_token: 'http-test', identity: { brand: 'Volkswagen', model_line: 'HTTP test line', generation: null }, listing_generation: null, analysis_generation: null } });
  ok('4b. mi_research_finalize відповідає 200 і без покоління нічого не пише', f0.status === 200 && f0.body && f0.body.ok === true && f0.body.reason === 'no_generation', 'HTTP ' + f0.status + ' ' + brief(f0.body));
  ok('4c. немає SQLSTATE 21000 (safeupdate)', !(f0.body && f0.body.code === '21000') && !(c2.body && c2.body.code === '21000'), brief(f0.body));
  console.log('   finalize: ' + brief(f0.body));

  if (ANON && !plainKey(ANON)) {
    ok('3. анонімний ключ придатний для заголовка', false, 'ключ містить не-ASCII символи (замаскована копія?)');
  } else if (ANON) {
    for (const [name, args] of [['mi_research_context', { p_vin: VIN, p_identity: null }], ['mi_research_persist', { p_vin: VIN, p_run: { findings: [] } }], ['mi_research_finalize', { p_vin: VIN, p_run: {} }]]) {
      try {
        const a = await rpc(ANON, name, args);
        ok('3. anon не виконує ' + name, [401, 403].includes(a.status) && a.body && a.body.code === '42501', 'HTTP ' + a.status + ' ' + brief(a.body));
        console.log('   anon ' + name + ': HTTP ' + a.status + ' ' + ((a.body && a.body.code) || ''));
      } catch (e) {
        ok('3. anon-виклик ' + name + ' виконано', false, String((e && e.message) || e).slice(0, 160));
      }
    }
  } else {
    console.log('   note: анонімного ключа немає, перевірка заборони для anon пропущена');
  }

  if (errs.length) {
    console.error('miresearchhttptest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('miresearchhttptest: усі ' + checks + ' перевірок пройшли (PostgREST + service_role)');
})().catch(e => { console.error('miresearchhttptest CRASHED:', e.stack || e.message); process.exit(1); });
