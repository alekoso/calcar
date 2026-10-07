/* Checklist merge (api/checklist-merge.js) and the Final Conclusion checks
   field (fc-v2.5).

   The final checklist keeps the material, actionable steps the report already
   holds in structured form, stays short, and never turns a check into a
   diagnosis. Regressions from the 10-report audit of 2026-10-07 (Evoque
   timing chain, X6 generic cold start, GLE valvetrain and service gap,
   Mustang tune and cylinders, Prado frame, Santa Fe borescope and LPG):
   1. a material unresolved risk survives into an actionable check;
   2. cosmetic and minor items do not flood the checklist;
   3. duplicate checks are merged (refinement in place, near-duplicates skipped);
   4. conditionality survives;
   5. a seller claim stays a seller claim;
   6. unresolved identity creates a verification step, not a guessed value;
   7. a recommended inspection is never turned into a diagnosis;
   8. "Questions for the seller" follows its status: retired for new reports
      (purchase_decision retired by owner decision, 9cea9d5), still rendered
      for old stored reports.
   Plus wiring: check.js merges after the Final Conclusion and before the
   consistency gate, and the conclusion sees the checklist and returns checks.

   Run: node checklistmergetest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);
const clone = o => JSON.parse(JSON.stringify(o));

const BASE = {
  vehicle: { title: 'BMW X6 2015' },
  risks: [
    { title: 'Страховой случай', level: 'med', kind: 'finding', note: 'n', action: 'Кузов, крепления бамперов, зазоры дверей: проверить толщиномером и на подъёмнике.' },
    { title: 'Дизельный двигатель, автомат и полный привод', level: 'high', kind: 'latent', note: 'n', action: 'Двигатель, турбина, форсунки, АКПП и раздаточная коробка: проверить холодный запуск, ошибки и поведение на тест-драйве.' },
  ],
  checklist: [
    'Кузов, крепления бамперов, зазоры дверей и крышки багажника: проверить толщину покрытия и следы ремонта с учётом страхового случая.',
    'Одометр, сервисное меню и документы последнего обслуживания: сверить фактический пробег.',
    'Двигатель, турбина, АКПП и раздаточная коробка: проверить холодный запуск, плавность переключений, вибрации и работу полного привода на тест-драйве.',
  ],
  _meta: { lang: 'ru', vehicle_spec: { conflicts: [], fields: {} } },
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_cm_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const M = await import('file://' + path.join(dir, 'api', 'checklist-merge.js'));
  const FC = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const { mergeChecklist, sanitizeFcChecks, assertsFault, actionCovered, MAX_ITEMS } = M;
  const run = (rep, fcRaw = [], lang = 'ru') => { const snap = rep.checklist.slice(); const s = sanitizeFcChecks(fcRaw, snap.length); const log = mergeChecklist(rep, { fcChecks: s.checks, snapshot: snap, lang }); return { log, rejected: s.rejected }; };

  /* ---------- 1. material unresolved risk survives ---------- */
  {
    const r = clone(BASE);
    r.risks.push({ title: 'Сработавшая шторка безопасности', level: 'high', kind: 'finding', note: 'n', action: 'Подушки безопасности, шторки и блок SRS: считать ошибки и подтвердить восстановление документами.' });
    const { log } = run(r);
    ok('1a. a high risk whose action is missing from the checklist is added verbatim', r.checklist.includes('Подушки безопасности, шторки и блок SRS: считать ошибки и подтвердить восстановление документами.') && log.added.some(a => a.source === 'risk'), JSON.stringify(r.checklist));
    const r2 = clone(BASE);
    const { log: l2 } = run(r2);
    ok('1b. risks already covered by the checklist add nothing', l2.added.length === 0 && r2.checklist.length === 3, JSON.stringify(l2));
    const r3 = clone(BASE);
    const { log: l3 } = run(r3, [{ text: 'Двигатель 2,0 дизель: на холодном запуске специалист оценивает, нет ли постороннего шума цепи ГРМ; у этого мотора цепь известное слабое место.', area: 'powertrain', refines: null }]);
    ok('1c. a check recommended by the conclusion and missing from the checklist is added (Evoque timing chain)', l3.added.some(a => a.source === 'final_conclusion') && r3.checklist.some(t => /цепи ГРМ/.test(t)), JSON.stringify(r3.checklist));
    const r4 = clone(BASE);
    r4.risks.push({ title: 'Рама', level: 'med', kind: 'finding', note: 'n', action: 'Рама и кронштейны кузова: осмотреть на коррозию и следы сварки на подъёмнике.' });
    run(r4);
    ok('1d. a medium finding risk (a fact of this car) also keeps its action', r4.checklist.some(t => /^Рама и кронштейны/.test(t)));
    ok('1e. a risk covered under different words (by its title) is not re-added (Prado air suspension)', actionCovered('Пневмобаллоны, компрессор, магистрали и все режимы изменения высоты: проверить удержание уровня.', ['Пневмоподвеска: несколько раз переключить высоту, оценить скорость подъема и утечки воздуха.'], 'Пневмоподвеска с регулировкой высоты'));
  }

  /* ---------- 2. no flood ---------- */
  {
    const r = clone(BASE);
    const { rejected } = run(r, [
      { text: 'Белый кузов: проверить оттенок панелей при дневном свете из-за бликов на фото.', area: 'cosmetic', refines: null },
      { text: 'Мультимедиа: проверить работу Bluetooth и USB-разъёмов.', area: 'other', refines: null },
    ]);
    ok('2a. cosmetic and "other" checks from the conclusion are rejected as not material', rejected.length === 2 && rejected.every(x => x.reason === 'not_material') && r.checklist.length === 3, JSON.stringify(rejected));
    const r2 = clone(BASE);
    r2.risks.push({ title: 'Бронеплёнка', level: 'low', kind: 'latent', note: 'n', action: 'Кромки плёнки: осмотреть на следы окраски.' });
    r2.risks.push({ title: 'Пневмоподвеска', level: 'med', kind: 'latent', note: 'n', action: 'Пневмостойки и компрессор: проверить удержание уровня после ночной стоянки.' });
    run(r2);
    ok('2b. low risks and medium latent risks do not add items by themselves', r2.checklist.length === 3, JSON.stringify(r2.checklist));
    const r3 = clone(BASE);
    r3.checklist = ['A1 узел: проверить первое.', 'B2 агрегат: проверить второе.', 'C3 система: проверить третье.', 'D4 элемент: проверить четвёртое.', 'E5 блок: проверить пятое.', 'F6 механизм: проверить шестое.'];
    const { log, rejected: rj } = run(r3, [
      { text: 'Рама и лонжероны: осмотреть на коррозию и следы сварки на подъёмнике.', area: 'structure', refines: null },
      { text: 'Заказ-наряды дилера: подтвердить заявленное продавцом обслуживание за шесть лет.', area: 'service_history', refines: null },
      { text: 'Цилиндры двигателя: осмотреть эндоскопом на задиры и выяснить расход масла.', area: 'powertrain', refines: null },
      { text: 'Подушки безопасности: считать ошибки блока и проверить документы о восстановлении.', area: 'safety', refines: null },
    ]);
    ok('2c. the list never exceeds MAX_ITEMS and at most 3 conclusion checks are taken', r3.checklist.length === MAX_ITEMS && rj.some(x => x.reason === 'over_limit') && log.skipped.some(x => x.reason === 'cap'), JSON.stringify([r3.checklist.length, rj, log.skipped]));
  }

  /* ---------- 3. duplicates merged ---------- */
  {
    const r = clone(BASE);
    const refined = 'Двигатель, турбина, АКПП и раздаточная коробка: на холодном запуске оценить шум цепи ГРМ трёхлитрового дизеля, затем на тест-драйве проверить плавность переключений, вибрации и работу полного привода.';
    const { log } = run(r, [{ text: refined, area: 'powertrain', refines: 3 }]);
    ok('3a. a specific check replaces the generic item it refines in place (X6: generic cold start becomes the chain check)', r.checklist.length === 3 && r.checklist[2] === refined && log.refined.length === 1, JSON.stringify(r.checklist));
    const r2 = clone(BASE);
    run(r2, [{ text: 'Двигатель: цепь ГРМ на холодном запуске.', area: 'powertrain', refines: 3 }]);
    ok('3b. a refinement much shorter than the item would drop its scope: the item stays and the check is added separately', r2.checklist[2] === BASE.checklist[2] && r2.checklist.length === 4, JSON.stringify(r2.checklist));
    const r3 = clone(BASE);
    const { log: l3 } = run(r3, [{ text: 'Кузов, крепления бамперов, зазоры дверей и крышки багажника: проверить толщину покрытия и следы ремонта после страхового случая.', area: 'accident_repair', refines: null }]);
    ok('3c. a near-duplicate of an existing item is not added', r3.checklist.length === 3 && l3.skipped.some(x => x.reason === 'duplicate'), JSON.stringify(l3));
    const r4 = clone(BASE);
    run(r4, [{ text: refined, area: 'powertrain', refines: 3 }, { text: refined + ' Повторно.', area: 'powertrain', refines: 3 }]);
    ok('3d. two refinements of the same item do not both replace it, and the second is not added as a duplicate', r4.checklist.length === 3 && r4.checklist[2] === refined, JSON.stringify(r4.checklist));
    const s = sanitizeFcChecks([{ text: refined, area: 'powertrain', refines: 9 }], 3);
    ok('3e. a refines index outside the shown checklist becomes null', s.checks[0].refines === null);
  }

  /* ---------- 4. conditionality survives ---------- */
  {
    const cond = 'Пневмоподвеска AIRMATIC, если она действительно установлена, как заявляет продавец: проверить удержание высоты после ночной стоянки и не изношен ли компрессор.';
    const r = clone(BASE);
    run(r, [{ text: cond, area: 'expensive_system', refines: null }]);
    ok('4a. a conditional check is kept verbatim, its condition included', r.checklist.includes(cond), JSON.stringify(r.checklist));
    const lpg = 'Газовое оборудование, если оно установлено: проверить документы на установку, герметичность и настройку смеси.';
    ok('4b. a conditional LPG check is not mistaken for a diagnosis', !assertsFault(lpg) && sanitizeFcChecks([{ text: lpg, area: 'modification', refines: null }], 0).checks.length === 1);
  }

  /* ---------- 5. seller claim stays a seller claim ---------- */
  {
    const claim = 'Заказ-наряды на заявленную продавцом замену масла в вариаторе: подтвердить дату, пробег и объём работ.';
    const r = clone(BASE);
    run(r, [{ text: claim, area: 'documents', refines: null }]);
    ok('5a. a seller-claim check is merged unchanged (no rewriting into a fact)', r.checklist.includes(claim));
    ok('5b. merge never rewrites any existing text', BASE.checklist.every(t => r.checklist.includes(t)));
  }

  /* ---------- 6. unresolved identity -> verification step ---------- */
  {
    const r = clone(BASE);
    r.checklist = BASE.checklist.slice(0, 2);
    r._meta.vehicle_spec = { conflicts: ['power_hp'], fields: { power_hp: { value: null, conflict: true, candidates: [{ source: 'listing', value: 163 }, { source: 'listing', value: 245 }, { source: 'analysis', value: 163 }] } } };
    const { log } = run(r);
    const step = r.checklist.find(t => /^Мощность двигателя/.test(t)) || '';
    ok('6a. a power conflict adds a step that establishes the value and names both candidates', log.added.some(a => a.source === 'identity' && a.field === 'power_hp') && /163 л\.с\. или 245 л\.с\./.test(step) && /установить фактическое значение/.test(step) && /не принимая ни одно из них/.test(step), step);
    const r2 = clone(BASE);
    r2.checklist = ['Двигатель и документы: уточнить фактическую мощность, в объявлении указаны 163 и 245 л.с.'];
    r2._meta.vehicle_spec = r._meta.vehicle_spec;
    const { log: l2 } = run(r2);
    ok('6b. no identity step when the checklist already verifies that field', !l2.added.some(a => a.source === 'identity'));
    const r3 = clone(BASE);
    r3._meta.vehicle_spec = { conflicts: ['version'], fields: { version: { value: null, conflict: true, candidates: [{ value: 'S' }, { value: 'SE' }] } } };
    const { log: l3 } = run(r3);
    ok('6c. a trim (version) conflict adds no checklist step', !l3.added.some(a => a.source === 'identity'));
    const r4 = clone(BASE);
    r4.checklist = BASE.checklist.slice(0, 2);
    r4._meta.vehicle_spec = { conflicts: [], fields: { transmission_type: { value: null, exact: false, candidates: [{ value: 'automatic' }, { value: 'cvt' }] } } };
    run(r4, [], 'ua');
    ok('6d. a gearbox whose exact type is not established gets a step to determine it, both types named, none chosen (ua)', r4.checklist.some(t => /^Коробка передач: точний тип не встановлено \(ступінчастий автомат або варіатор\)/.test(t)), JSON.stringify(r4.checklist));
    const r5 = clone(BASE);
    r5.checklist = BASE.checklist.slice(0, 2);
    r5._meta.vehicle_spec = { conflicts: ['drivetrain'], fields: { drivetrain: { value: null, conflict: true, candidates: [{ value: 'awd' }, { value: 'fwd' }] } } };
    run(r5, [], 'en');
    ok('6e. en: a drivetrain conflict step does not name a candidate as fact', r5.checklist.some(t => /^Drivetrain: the sources disagree; establish the actual value/.test(t) && !/awd|fwd/i.test(t)), JSON.stringify(r5.checklist));
    const r6 = clone(BASE);
    r6._meta.vehicle_spec = { conflicts: [], unknown: ['drivetrain'], fields: {} };
    const { log: l6 } = run(r6);
    ok('6f. unknown stays unknown: an unknown field adds no step and no value', l6.added.length === 0);
  }

  /* ---------- 7. a check is not a diagnosis ---------- */
  {
    ok('7a. a fault asserted without any checking step is detected', assertsFault('Цепь ГРМ растянута, требуется замена.') && assertsFault('The timing chain is worn out.') && assertsFault('Ланцюг ГРМ розтягнутий.'));
    ok('7b. a check about a possible fault is not a diagnosis', !assertsFault('Цепь ГРМ: на холодном запуске проверить, не растянута ли она.') && !assertsFault('Check whether the timing chain is worn on a cold start.') && !assertsFault('Перевірити, чи не розтягнутий ланцюг ГРМ.'));
    const r = clone(BASE);
    const { rejected } = run(r, [{ text: 'Цепь ГРМ растянута, требуется замена.', area: 'powertrain', refines: null }]);
    ok('7c. a diagnosis returned as a check is rejected and the checklist is unchanged', rejected.some(x => x.reason === 'diagnosis') && r.checklist.length === 3);
    const r2 = clone(BASE);
    r2.checklist = [];
    run(r2);
    ok('7d. a latent risk action is carried as written: inspection wording, no fault words added', r2.checklist.includes(BASE.risks[1].action) && !assertsFault(r2.checklist.join(' ')), JSON.stringify(r2.checklist));
    const r3 = clone(BASE);
    run(r3, [{ text: 'Рама: осмотреть на коррозию ' + DASH + ' особенно кронштейны.', area: 'structure', refines: null }]);
    ok('7e. no em dash reaches the checklist', !r3.checklist.join(' ').includes(DASH));
  }

  /* ---------- 8. "Questions for the seller" status ---------- */
  {
    const schema = fs.readFileSync('api/check-schema.js', 'utf8');
    const core = fs.readFileSync('api/check.js', 'utf8');
    const page = fs.readFileSync('result-check.html', 'utf8');
    ok('8a. new Checks: the main response schema has no purchase_decision and no questions_for_seller', !/questions_for_seller|purchase_decision/.test(schema));
    ok('8b. new Checks: a stray purchase_decision is deleted before the report is stored', /delete parsed\.purchase_decision;/.test(core) && !/questions_for_seller/.test(core));
    ok('8c. old stored reports: the block still renders only from a stored purchase_decision.questions_for_seller and stays hidden otherwise', /id="qCard" style="display:none"/.test(page) && /pd && Array\.isArray\(pd\.questions_for_seller\)/.test(page) && /if \(qs\.length\) \{\s*\$\('qCard'\)\.style\.display = '';/.test(page));
    ok('8d. the checks field is not a hidden seller-question generator: no seller-question area', !M.FC_CHECK_AREAS.some(a => /seller|question/.test(a)));
  }

  /* ---------- wiring ---------- */
  {
    const core = fs.readFileSync('api/check.js', 'utf8');
    const iFc = core.indexOf('const fc = await fcPromise;');
    const iMerge = core.indexOf('const cm = mergeChecklist(parsed, { fcChecks: fcc.checks, snapshot, lang });');
    const iGate = core.indexOf('const rc = enforceReportConsistency(parsed, { lang });');
    ok('w1. check.js merges after the Final Conclusion and before the consistency gate', iFc > 0 && iMerge > iFc && iGate > iMerge, JSON.stringify([iFc, iMerge, iGate]));
    ok('w2. a failed or hidden conclusion contributes no checks, the deterministic merge still runs', /const fcOk = fcOut && fcOut\.status === 'ok' && parsed\.final_conclusion && fcOut\.conclusion;/.test(core) && /fcOk \? sanitizeFcChecks\(.*\) : \{ checks: \[\], rejected: \[\] \}/.test(core));
    ok('w3. the merge log is kept in _meta.checklist_merge', /parsed\._meta\.checklist_merge = cm;/.test(core));
    const fmt = FC.conclusionResponseFormat().json_schema.schema;
    ok('w4. conclusion schema: checks with text, area (enum) and refines (integer or null), all required', fmt.required.includes('checks') && fmt.properties.checks.items.required.join() === 'text,area,refines' && fmt.properties.checks.items.properties.area.enum.join() === M.FC_CHECK_AREAS.join() && JSON.stringify(fmt.properties.checks.items.properties.refines.type) === '["integer","null"]');
    const ctx = FC.buildConclusionContext({ vehicle: { title: 'X' }, checklist: ['a: one', 'b: two'], risks: [], _meta: {} });
    ok('w5. the conclusion sees the numbered checklist', Array.isArray(ctx.checklist) && ctx.checklist[1].n === 2 && ctx.checklist[1].text === 'b: two', JSON.stringify(ctx.checklist));
    ok('w6. conclusion rules explain the checks field: material only, refine, no diagnosis, conditions and seller claims kept, identity not guessed', ['CHECKS FIELD', 'Include a check only when it is material', 'set refines to that item', 'A check is a step, not a diagnosis', 'Keep conditions as conditions', 'seller claims as claims', 'never assumes a candidate', 'At most 3 checks'].every(k => FC.CONCLUSION_RULES.includes(k)));
    const san = FC.sanitizeConclusion({ headline: 'H', paragraphs: ['Body.'], checks: [{ text: 't', area: 'powertrain', refines: null }] });
    ok('w7. sanitizeConclusion passes checks through for the merge; old outputs without checks stay as before', Array.isArray(san.checks) && san.checks.length === 1 && !('checks' in FC.sanitizeConclusion({ headline: 'H', paragraphs: ['Body.'] })));
    const src = fs.readFileSync('api/checklist-merge.js', 'utf8');
    ok('w8. module is not a Vercel function, has no em dash and no model-specific facts', !/export default/.test(src) && !src.includes(DASH) && !/evoque|x6|prado|mustang|santa fe|airmatic|ecoboost/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  }

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('CHECKLIST MERGE TEST FAILED:\n  - ' + errs.join('\n  - ')); process.exit(1); }
  console.log(`checklist merge: ${checks} checks · risk actions kept · conclusion checks merged, refined, capped · no diagnosis · conditions and seller claims verbatim · identity steps without a guess · seller questions retired for new reports, rendered for old`);
})().catch(e => { console.log('CHECKLIST MERGE TEST CRASHED:', e && e.stack || e); process.exit(1); });
