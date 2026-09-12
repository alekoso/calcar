/* Phase 7.6: автоматична тінь Model Intelligence у фоні durable-Check.

   Тут перевіряється ПРОВОДКА, а не знання. База даних не потрібна: клієнт
   тіні підмінюється, а перевіряється рівно те, що вимагає фаза:
   прапорець за замовчуванням вимкнений, тінь не може зачепити Check,
   звіт користувача не змінюється, у лог не потрапляє текст знань.

   Запуск: node mishadowwiretest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
/* Код без коментарів. Перевірки, які говорять про КОД, не мають чіплятися
   до прози: слова «not exists» чи назва прапорця у коментарі це пояснення,
   а не поведінка. */
const codeOnly = src => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CHECK_SRC = fs.readFileSync(path.join(__dirname, 'api', 'check.js'), 'utf8');
const JOB_SRC = fs.readFileSync(path.join(__dirname, 'api', 'check-job.js'), 'utf8');
const SHADOW_SRC = fs.readFileSync(path.join(__dirname, 'api', 'mi-shadow.js'), 'utf8');

/* пакет тіні у двох виглядах: часткова ідентичність і точна */
const PARTIAL_PACK = {
  vin: 'WBAJB9C50JB049616', mi_available: true, identity_precision: 'partial', identity_id: 1,
  identity_summary: { version: 'BMW M550i xDrive G30', market_operated: 'UA',
    version_note: 'INFERRED FROM CHECK ANALYSIS: BMW M550i xDrive G30. Low confidence, this is not a VIN decode.' },
  decision: { meta: { version_id: 7, included_count: 14, candidate_vmy_count: 3,
    counts: { APPLICABLE: 11, CONDITIONAL: 55, EXCLUDED: 2 },
    unresolved_dimensions: ['market_sold', 'model_year', 'vmy'] },
    systems: [{ area: 'engine', claims: [{ claim_id: 1, text_en: 'SECRET BLOCKED KNOWLEDGE TEXT' }] }] },
  report: { meta: { included_count: 19 }, systems: [] },
};
const EXACT_PACK = {
  vin: 'WBAJB9C50JB049616', mi_available: true, identity_precision: 'exact', identity_id: 2,
  identity_summary: { vmy: 'BMW M550i xDrive US MY2018' },
  decision: { meta: { included_count: 24, counts: { APPLICABLE: 20, CONDITIONAL: 4 } }, systems: [] },
  report: { meta: { included_count: 30 }, systems: [] },
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_mishadow_wire_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
    fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  }
  const M = await import('file://' + path.join(dir, 'api', 'mi-shadow.js'));

  const envOff = {};
  const envOn = { MI_SHADOW_ENABLED: 'true' };
  const calls = [];
  const logs = [];
  const spy = pack => (vin, o) => { calls.push({ vin, o }); return { ok: true, reason: null, pack, ms: 7 }; };
  const log = line => logs.push(line);
  const reset = () => { calls.length = 0; logs.length = 0; };

  /* 1. прапорця немає: клієнт тіні не викликається взагалі */
  reset();
  let r = await M.runMiShadow({ token: 'T', vin: 'V1' }, { env: envOff, call: spy(PARTIAL_PACK), log });
  ok('1. прапорця немає, виклику немає', calls.length === 0 && r.skipped === true && r.reason === 'flag_off');
  ok('1b. прапорця немає, логу немає', logs.length === 0);

  /* 2. прапорець false: те саме */
  for (const v of ['false', '0', 'off', '', 'shadow']) {
    reset();
    r = await M.runMiShadow({ token: 'T', vin: 'V1' }, { env: { MI_SHADOW_ENABLED: v }, call: spy(PARTIAL_PACK), log });
    ok('2. прапорець ' + JSON.stringify(v) + ' не вмикає тінь', calls.length === 0 && r.skipped === true);
  }
  for (const v of ['1', 'true', 'on', 'yes', 'TRUE', ' On ']) {
    ok('2b. прапорець ' + JSON.stringify(v) + ' вмикає тінь', M.miShadowEnabled({ MI_SHADOW_ENABLED: v }) === true);
  }
  ok('2c. дефолт без змінної оточення вимкнений', M.miShadowEnabled({}) === false);

  /* 3. прапорець true: клієнт викликаний рівно один раз, VIN зі звіту */
  reset();
  r = await M.runMiShadow({ token: 'TOK', report: { _meta: { vin: 'WBAJB9C50JB049616' } } },
    { env: envOn, call: spy(PARTIAL_PACK), log });
  ok('3. виклик рівно один', calls.length === 1, 'викликів ' + calls.length);
  ok('3b. VIN узятий зі звіту', calls[0] && calls[0].vin === 'WBAJB9C50JB049616');
  ok('3c. таймаут переданий клієнту', calls[0] && calls[0].o && calls[0].o.timeoutMs === M.SHADOW_TIMEOUT_MS);
  ok('3d. стеля часу дві секунди', M.SHADOW_TIMEOUT_MS === 2000);

  /* 4. тінь викликається лише після успішного запису звіту */
  ok('4. виклик під if (ok) у гілці done',
    /if \(ok\) \{ try \{ await runMiShadow\(\{ token, report: shim\._o \}\); \} catch \(e\) \{\} \}/.test(CHECK_SRC));
  const errBranch = CHECK_SRC.slice(CHECK_SRC.indexOf("status: 'error', stage: 'error'"));
  ok('4b. у гілці помилки тіні немає', !/runMiShadow/.test(errBranch.slice(0, 600)));

  /* 5. виняток клієнта не ламає нічого */
  reset();
  r = await M.runMiShadow({ token: 'T', vin: 'V' },
    { env: envOn, call: () => { throw new Error('boom'); }, log });
  ok('5. виняток проковтнутий', r && r.event === 'mi_shadow' && r.ok === false);
  ok('5b. причина error', r.reason === 'error');
  ok('5c. лог усе одно один', logs.length === 1);

  /* 6. таймаут клієнта не ламає нічого і не тримає фон довше за стелю */
  reset();
  const t0 = Date.now();
  r = await M.runMiShadow({ token: 'T', vin: 'V' },
    { env: envOn, timeoutMs: 120, call: () => new Promise(() => {}), log });
  const waited = Date.now() - t0;
  ok('6. зависання завершується таймаутом', r && r.ok === false && r.reason === 'timeout');
  ok('6b. фон не чекає довше за стелю', waited < 1500, 'чекали ' + waited + ' мс');

  /* 7. mi_available=false це успішний прогін, а не збій */
  reset();
  r = await M.runMiShadow({ token: 'T', vin: 'V' }, { env: envOn, log,
    call: () => ({ ok: true, reason: null, ms: 5, pack: { mi_available: false, reason: 'brand_not_in_catalog' } }) });
  ok('7. ok=true при mi_available=false', r.ok === true && r.mi_available === false);
  ok('7b. причина видно у логу', r.reason === 'brand_not_in_catalog');
  reset();
  r = await M.runMiShadow({ token: 'T', vin: 'V' }, { env: envOn, log,
    call: () => ({ ok: false, reason: 'not_installed', ms: 1, pack: null }) });
  ok('7c. відсутня схема це не помилка Check', r.ok === false && r.reason === 'not_installed');

  /* 8 і 9. ні частковий, ні точний результат не чіпають звіт */
  for (const [name, pack] of [['частковий', PARTIAL_PACK], ['точний', EXACT_PACK]]) {
    reset();
    const report = { vehicle: { title: 'BMW' }, verdict: { score: 7, verdict: 'ok' },
      _meta: { vin: 'WBAJB9C50JB049616', share_token: 'TOK' } };
    const before = JSON.stringify(report);
    await M.runMiShadow({ token: 'TOK', report }, { env: envOn, call: spy(pack), log });
    ok('8/9. ' + name + ' результат не змінює звіт', JSON.stringify(report) === before);
    ok('8/9b. ' + name + ': у звіті немає полів MI',
      !/mi_available|identity_precision|mi_shadow/.test(JSON.stringify(report)));
  }

  /* 10 і 11. Score і Verdict не залежать від тіні */
  reset();
  const scored = { verdict: { score: 7, verdict: 'take' }, _meta: { vin: 'V' } };
  const scoreBefore = JSON.stringify(scored.verdict);
  await M.runMiShadow({ token: 'T', report: scored }, { env: envOn, call: spy(PARTIAL_PACK), log });
  ok('10. Score не змінився', JSON.stringify(scored.verdict) === scoreBefore);
  ok('11. Verdict не змінився', scored.verdict.verdict === 'take');
  ok('10b. тінь не рахує Score у check.js',
    !/runMiShadow[\s\S]{0,200}(computeScore|verdict)/.test(CHECK_SRC));

  /* 12. payload звіту: тінь не повертає нічого, що можна покласти у звіт */
  ok('12. виклик не присвоюється у звіт', !/(_meta\.[a-z_]+|parsed\.[a-z_]+)\s*=\s*await runMiShadow/.test(CHECK_SRC));
  ok('12b. публічний серіалізатор про тінь не знає',
    !/mi_shadow|runMiShadow/.test(fs.readFileSync(path.join(__dirname, 'api', 'share.js'), 'utf8')));

  /* 13. повтор фонового виконання: та сама семантика, нового стану в JS немає */
  reset();
  const a = await M.runMiShadow({ token: 'TOK', vin: 'V' }, { env: envOn, call: spy(PARTIAL_PACK), log });
  const b = await M.runMiShadow({ token: 'TOK', vin: 'V' }, { env: envOn, call: spy(PARTIAL_PACK), log });
  const stripMs = o => { const c = { ...o }; delete c.duration_ms; return JSON.stringify(c); };
  ok('13. повтор дає той самий результат', stripMs(a) === stripMs(b));
  ok('13b. кожен прогін це рівно один виклик клієнта', calls.length === 2);
  ok('13c. ідемпотентність не переписана у JS',
    !/not exists|insert into|on conflict/i.test(codeOnly(SHADOW_SRC)), 'у клієнті зʼявився власний SQL');

  /* 14. структурований діагностичний рядок */
  reset();
  r = await M.runMiShadow({ token: 'TOK', report: { _meta: { vin: 'WBAJB9C50JB049616' } } },
    { env: envOn, call: spy(PARTIAL_PACK), log });
  ok('14. рядок логу рівно один', logs.length === 1);
  const line = logs[0] || {};
  for (const f of ['event', 'vin', 'report_id', 'ok', 'mi_available', 'reason', 'identity_precision',
    'version_source', 'version_confidence', 'candidate_vmy_count', 'included_decision',
    'included_report', 'conditional_count', 'unresolved_dimensions', 'duration_ms']) {
    ok('14. поле ' + f + ' у логу', Object.prototype.hasOwnProperty.call(line, f));
  }
  ok('14b. event правильний', line.event === 'mi_shadow');
  ok('14c. лічильники з пакета', line.included_decision === 14 && line.included_report === 19
    && line.conditional_count === 55 && line.candidate_vmy_count === 3);
  ok('14d. джерело версії видно', line.version_source === 'check_inference' && line.version_confidence === 'low');
  ok('14e. невизначені виміри видно', Array.isArray(line.unresolved_dimensions)
    && line.unresolved_dimensions.join(',') === 'market_sold,model_year,vmy');
  ok('14f. точний пакет не позначається як check_inference',
    (await M.runMiShadow({ token: 'T', vin: 'V' }, { env: envOn, call: spy(EXACT_PACK), log: () => {} })).version_source === 'catalog');

  /* 15. у лог не потрапляє ні текст знань, ні сам пакет */
  const dump = JSON.stringify(logs);
  ok('15. тексту заблокованого знання у логу немає', !/SECRET BLOCKED KNOWLEDGE TEXT/.test(dump));
  ok('15b. у логу немає claims і systems', !/"claims"|"systems"|text_en/.test(dump));
  ok('15c. розмір рядка логу розумний', dump.length < 1200, 'довжина ' + dump.length);
  ok('15d. клієнт не логує пакет цілком', !/JSON\.stringify\((result\.)?pack\)/.test(SHADOW_SRC));

  /* 16. синхронний шлях api/check.js не зачеплений */
  const core = CHECK_SRC.slice(CHECK_SRC.indexOf('async function runCheck('));
  ok('16. ядро runCheck про тінь не знає', !/runMiShadow|mi_shadow_pack/.test(core));
  ok('16b. виклик рівно один на весь файл', (CHECK_SRC.match(/runMiShadow\(/g) || []).length === 1);
  ok('16c. синхронний фолбек лишився', /if \(!durable\) return runCheck\(req, res, null\);/.test(CHECK_SRC));
  ok('16d. api/check-job.js не чіпаний', !/mi-shadow|mi_shadow_pack|runMiShadow/.test(JOB_SRC));

  /* прапорець ніколи не їде у клієнт */
  for (const f of fs.readdirSync('.').filter(x => x.endsWith('.html'))) {
    ok('прапорець не в ' + f, !fs.readFileSync(f, 'utf8').includes('MI_SHADOW_ENABLED'));
  }
  /* Прапорець живе у helper тіні. Phase 7.7 свідомо додала другого читача:
     тимчасовий діагностичний ендпоінт, який показує, яким прапорець видно
     у рантаймі продакшну. Список закритий: будь-який третій файл, що
     читає прапорець, це помилка. */
  const FLAG_READERS_ALLOWED = ['mi-shadow-diag.js', 'mi-shadow.js'];
  const flagReaders = fs.readdirSync('api').filter(f => f.endsWith('.js'))
    .filter(f => codeOnly(fs.readFileSync('api/' + f, 'utf8')).includes('MI_SHADOW_ENABLED')).sort();
  ok('прапорець читається лише у helper і у діагностиці',
    flagReaders.join(',') === FLAG_READERS_ALLOWED.join(','),
    'читають: ' + (flagReaders.join(',') || 'ніхто'));

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('mishadowwiretest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('mishadowwiretest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('mishadowwiretest CRASHED:', e.stack || e.message); process.exit(1); });
