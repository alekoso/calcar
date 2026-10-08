/* Final semantic consistency gate (api/report-consistency.js).

   Reproduces the contradiction shapes from the 15-report audit and checks
   that the finished report cannot contradict its canonical facts:
   1. turbo vs supercharger; 2. petrol vs diesel; 3. AWD vs RWD;
   4. transmission (manual vs automatic family; automatic vs CVT is fine);
   5. current vs historical mileage (rollback recorded vs "no signs");
   6. accident / airbag state; 7. unresolved identity conflict leaking into
   confident prose. Plus: reported speech, contrasts and hedges are not
   claims; the Final Conclusion keeps its failure semantics; the gate runs
   last in api/check.js and never throws.

   Run: node consistencytest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };
const DASH = String.fromCharCode(0x2014);

const field = (value, strength = 'strong', conflict = false) => ({ value, source: 'decoder+listing', strength, conflict });
function report(over = {}) {
  const base = {
    vehicle: { title: 'Land Rover Range Rover 2013', engine: '5.0 л бензин V8 з компресором', fuel: 'petrol', drive: 'повний', transmission: 'автомат' },
    verdict: { score: 8.3, summary: 'Доглянутий Range Rover. Компресорний V8 потужний. Ціна нижча за середню.' },
    risks: [
      { title: 'Турбіни V8', level: 'high', kind: 'latent', note: 'Турбокомпресори на такому пробігу дорогі.', action: 'перевірити турбіни' },
      { title: 'Пневмопідвіска', level: 'med', kind: 'latent', note: 'Дорогий вузол.', action: 'перевірити просідання' },
    ],
    checklist: ['Перевірити турбіни і інтеркулер на витоки.', 'Пневмопідвіска: утримання висоти після стоянки.'],
    discrepancies: [],
    model_notes: { issues: [{ unit: 'двигун', title: 'Ланцюги ГРМ', detail: 'Відоме слабке місце компресорного V8.', severity: 'high' }] },
    auction: { found: true, summary: 'У 2019 році зафіксоване ДТП у США з пошкодженням передка. Спрацювала подушка водія. На нинішніх фото слідів ремонту не видно.', findings: [{ status: 'bad', text: 'Розкрита подушка безпеки водія.' }] },
    historical_visual: { summary: 'Пошкодження переднього бампера і крила.', srs_visual_status: 'deployed_visible' },
    history_note: null,
    market_value: { liquidity: { level: 'low', reasons: ['Великий турбований V8 має вузьке коло покупців.', 'Дороге утримання вікового преміального SUV.'] }, why_price: { value_loss: 'high', reasons: ['Витрати на утримання знижують попит.'] } },
    score_breakdown: { score_version: 'v4', final: 8.3, events: [{ v4_category: 'medium', airbags: true, zone_classes: ['front'], repair_status: 'unknown' }],
      inputs: { mileage_rollback: { status: 'clean', available: true }, accident_history: { status: 'applied', available: true } }, unresolved: [], mileage_points: [{ km: 178000, family: 'current' }] },
    final_conclusion: { headline: 'Доглянутий Range Rover із питаннями до відновлення', body: 'Це потужний Range Rover з 5-літровим компресорним V8 і комфортною пневмопідвіскою. На фото кузов виглядає доглянутим.\n\nУ 2019 році автомобіль потрапив у ДТП середньої тяжкості, спрацювала подушка водія. Тут вирішує якість відновлення.\n\nЦіна близько 26 тисяч доларів нижча за середню. Для цього турбованого V8 відомі проблеми з охолодженням, тому важлива перевірка системи під тиском.' },
    _meta: {
      lang: 'ua', odometer_km: 178000,
      vehicle_spec: { version: 'vs-v1', conflicts: [], fields: { fuel: field('petrol'), forced_induction: field('supercharger'), drivetrain: field('awd'), transmission: field('automatic'), displacement_l: field(5.0) } },
      history_facts: { accident_recorded: true, registry_present: true, mileage_points: [{ km: 138000, date: '2019-07-08', source: 'registry' }] },
      final_conclusion: { version: 'fc-v2.3', model: 'gpt-6.1-sol' },
      current_visual_shadow: { current_visual: { dashboard: { assessment: { state: 'ignition_on_engine_off', active: [], self_test: ['check engine'], unconfirmed: [], explicit_fault_messages: [] } } } },
    },
  };
  return JSON.parse(JSON.stringify(Object.assign(base, over)));
}
const deep = (o, p, v) => { const ks = p.split('.'); let c = o; for (const k of ks.slice(0, -1)) c = c[k]; c[ks[ks.length - 1]] = v; return o; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_rc_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const { enforceReportConsistency, canonicalFacts, sentenceViolations, gateFinalConclusion, splitSentences } = RC;

  /* ---- 1. turbo vs supercharger ---- */
  let r = report();
  let out = enforceReportConsistency(r, { lang: 'ua' });
  ok('1. canonical induction read from vehicle_spec', out.facts.forced_induction === 'supercharger');
  ok('1a. risk calling the supercharged V8 turbocharged is dropped', r.risks.length === 1 && r.risks[0].title === 'Пневмопідвіска', JSON.stringify(r.risks.map(x => x.title)));
  ok('1b. checklist item about turbos is dropped, the air suspension item stays', r.checklist.length === 1 && /Пневмопідвіска/.test(r.checklist[0]), JSON.stringify(r.checklist));
  ok('1c. market reason "турбований V8" is dropped, card survives with the other reason', r.market_value.liquidity && r.market_value.liquidity.reasons.length === 1 && /утримання/.test(r.market_value.liquidity.reasons[0]));
  ok('1d. model weakness about the supercharged V8 stays (it agrees)', r.model_notes.issues.length === 1);
  ok('1e. Final Conclusion loses only the turbo sentence, the rest stays', r.final_conclusion && !/турбован/.test(r.final_conclusion.body) && /компресорним V8/.test(r.final_conclusion.body) && /Ціна близько 26/.test(r.final_conclusion.body), r.final_conclusion && r.final_conclusion.body);
  ok('1f. the pruned paragraph keeps its structure (3 paragraphs)', r.final_conclusion && r.final_conclusion.body.split('\n\n').length === 3);
  ok('1g. diagnostics record the removals', out.violations.some(v => v.section === 'risks' && v.domain === 'forced_induction' && v.action === 'item_dropped') && out.violations.some(v => v.section === 'final_conclusion.body' && v.action === 'sentence_removed') && r._meta.final_conclusion.consistency.removed === 1);
  ok('1h. verdict summary with the right induction untouched', /Компресорний V8/.test(r.verdict.summary));

  /* ---- 2. petrol vs diesel ---- */
  r = report({ risks: [{ title: 'Форсунки дизеля', level: 'med', kind: 'latent', note: 'У дизельного двигуна дорогі форсунки.', action: 'перевірити' }], checklist: ['Сажовий фільтр дизеля: перевірити регенерацію.'], market_value: { liquidity: { level: 'low', reasons: ['Дизельні SUV цього класу продаються довго.'] }, why_price: null } });
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('2. diesel risk, checklist item and market reason dropped on a petrol car', r.risks.length === 0 && r.checklist.length === 0 && r.market_value.liquidity === null, JSON.stringify([r.risks, r.checklist, r.market_value]));
  ok('2a. liquidity card hidden when its only reason went', out.hidden.includes('market_value.liquidity'));
  r = report({ _meta: deep(report()._meta, 'vehicle_spec.fields.fuel', field('hybrid', 'medium')) });
  r.checklist = ['Бензиновий двигун гібрида: перевірити холодний запуск.'];
  enforceReportConsistency(r, { lang: 'ua' });
  ok('2b. petrol wording on a hybrid is compatible, not a contradiction', r.checklist.length === 1);

  /* ---- 3. AWD vs RWD ---- */
  r = report({ checklist: ['Задній привід: перевірити редуктор заднього моста на витоки.', 'Повний привід: перевірити роздавальну коробку.'] });
  r.market_value.why_price.reasons = ['Задньопривідна версія менш популярна взимку.'];
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('3. RWD checklist item dropped on an AWD car, AWD item kept', r.checklist.length === 1 && /Повний привід/.test(r.checklist[0]), JSON.stringify(r.checklist));
  ok('3a. RWD market reason dropped and the card hidden', r.market_value.why_price === null && out.hidden.includes('market_value.why_price'));
  r = report({ _meta: deep(report()._meta, 'vehicle_spec.fields.drivetrain', field('rwd', 'weak')) });
  r.checklist = ['Повний привід: перевірити роздавальну коробку.'];
  enforceReportConsistency(r, { lang: 'ua' });
  ok('3b. a weak-decoder drivetrain is not a canonical fact: nothing dropped', r.checklist.length === 1);

  /* ---- 4. transmission ---- */
  r = report({ checklist: ['Механічна коробка: перевірити зчеплення.', 'Автомат: перевірити плавність перемикань.'] });
  enforceReportConsistency(r, { lang: 'ua' });
  ok('4. manual gearbox item dropped on an automatic car, automatic item kept', r.checklist.length === 1 && /Автомат/.test(r.checklist[0]), JSON.stringify(r.checklist));
  r = report({ _meta: deep(report()._meta, 'vehicle_spec.fields.transmission', field('cvt', 'medium')) });
  r.checklist = ['Автомат: перевірити плавність перемикань.', 'Варіатор: перевірити ривки на прогрітій машині.'];
  enforceReportConsistency(r, { lang: 'ua' });
  ok('4a. "automatic" on a CVT car is the same family: both items stay', r.checklist.length === 2);

  /* ---- 5. current vs historical mileage ---- */
  r = report();
  r.score_breakdown.inputs.mileage_rollback = { status: 'applied', available: true };
  r.verdict.summary = 'Доглянутий Range Rover. Пробіг без ознак скручування і узгоджується з історією. Ціна нижча за середню.';
  r.final_conclusion.body = 'Це потужний Range Rover з компресорним V8.\n\nПробіг 178 тисяч км підтверджений сервісною історією і виглядає чесним. Власників було четверо, і це нормально.\n\nЦіна близько 26 тисяч доларів нижча за середню.';
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('5. "no signs of rollback" removed from the verdict when records show a decrease', !/скручування/.test(r.verdict.summary) && /Ціна нижча/.test(r.verdict.summary), r.verdict.summary);
  ok('5a. "confirmed by service history" removed from the Final Conclusion, paragraph survives on its other sentence', r.final_conclusion && !/підтверджений сервісною/.test(r.final_conclusion.body) && /Власників було четверо/.test(r.final_conclusion.body), r.final_conclusion && r.final_conclusion.body);
  r = report();
  r._meta.history_facts.mileage_points = []; r.score_breakdown.mileage_points = [{ km: 178000, family: 'current' }];
  r.verdict.summary = 'Пробіг підтверджений історією записів. Кузов доглянутий.';
  enforceReportConsistency(r, { lang: 'ua' });
  ok('5b. "confirmed by history" removed when there are no historical points', !/підтверджений історією/.test(r.verdict.summary) && /Кузов доглянутий/.test(r.verdict.summary), r.verdict.summary);
  r = report();
  r.verdict.summary = 'Пробіг скручений, одометр відмотаний. Кузов доглянутий.';
  enforceReportConsistency(r, { lang: 'ua' });
  ok('5c. confident "rolled back" removed when the rollback check is clean', !/скручений/.test(r.verdict.summary) && /Кузов доглянутий/.test(r.verdict.summary), r.verdict.summary);
  r = report();
  r.verdict.summary = 'Скрутку пробігу не можна виключити без сервісних записів. Кузов доглянутий.';
  enforceReportConsistency(r, { lang: 'ua' });
  ok('5d. a hedged rollback remark is not a claim and stays', /не можна виключити/.test(r.verdict.summary));

  /* ---- 6. accident / airbags ---- */
  r = report();
  r.auction.summary = 'У 2019 році зафіксоване ДТП у США. Розкритих подушок на архівних фото не видно. На нинішніх фото слідів ремонту не видно.';
  r.final_conclusion.body = 'Це потужний Range Rover з компресорним V8.\n\nУ 2019 році автомобіль потрапив у ДТП середньої тяжкості. Подушки безпеки не спрацювали, тому ремонт був простішим. Якість відновлення важлива.\n\nЦіна близько 26 тисяч доларів нижча за середню.';
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('6. "no deployed airbags visible" removed from the auction summary when the archive shows a deployed airbag', !/не видно подушок|Розкритих подушок/.test(r.auction.summary) && /зафіксоване ДТП/.test(r.auction.summary), r.auction.summary);
  ok('6a. "airbags did not deploy" removed from the Final Conclusion', r.final_conclusion && !/не спрацювали/.test(r.final_conclusion.body) && /Якість відновлення важлива/.test(r.final_conclusion.body), r.final_conclusion && r.final_conclusion.body);
  r = report();
  r.score_breakdown.events = []; r.score_breakdown.inputs.accident_history = { status: 'clean', available: true };
  r.auction = { found: false, summary: null, findings: [] }; delete r.historical_visual;
  r._meta.history_facts = { accident_recorded: false, registry_present: true, insurance_case_recorded: false, mileage_points: [{ km: 138000, date: '2019-07-08' }] };
  r.verdict.summary = 'Доглянутий Range Rover. Після ДТП у США кузов відновили. Ціна нижча за середню.';
  r.risks = [{ title: 'Наслідки ДТП', level: 'high', kind: 'finding', note: 'Автомобіль був у ДТП, геометрія не підтверджена.', action: 'перевірити геометрію' }];
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('6b. canonical state "no accident" derived from clean sources', out.facts.accident === 'none');
  ok('6c. "after the accident" sentence and the accident risk dropped on a clean car', !/ДТП/.test(r.verdict.summary) && r.risks.length === 0, r.verdict.summary + ' | ' + r.risks.length);
  r = report();
  r.score_breakdown.events = [{ v4_category: 'light', airbags: false }]; r.historical_visual.srs_visual_status = 'no_deployment_visible';
  r.verdict.summary = 'Невелике ДТП. Спрацювали обидві передні подушки безпеки. Ціна нижча за середню.';
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('6d. canonical airbags = not deployed; "both airbags deployed" removed', out.facts.airbags === false && !/Спрацювали/.test(r.verdict.summary) && /Невелике ДТП/.test(r.verdict.summary), r.verdict.summary);
  /* real sentences from saved reports: "no deployed airbags" on a car whose airbags did not deploy is correct and must stay */
  r = report();
  r.score_breakdown.events = [{ v4_category: 'medium', airbags: false }]; r.historical_visual.srs_visual_status = 'no_deployment_visible';
  r.verdict.summary = 'Было заметное повреждение правого борта, при этом на архивных кадрах нет явных признаков серьёзной деформации кузова или раскрытых подушек. Цена выше средней.';
  r.auction.summary = 'The auction instrument cluster displayed an airbag error message, while deployed airbags are not visible in the available interior photos.';
  r.auction.findings = [{ status: 'warn', text: 'Deployed airbags are not visible, but restoration of the safety system is not evidenced.' }];
  r.final_conclusion = null; /* the base conclusion asserts a deployed airbag and would rightly be hidden here */
  out = enforceReportConsistency(r, { lang: 'ru' });
  ok('6f. negative airbag statements on a no-deployment car are not claims of deployment', out.violations.filter(v => v.domain === 'airbags').length === 0 && r.auction.findings.length === 1 && /раскрытых подушек/.test(r.verdict.summary), JSON.stringify([r.auction.findings.length, r.verdict.summary, out.violations.filter(v => v.domain !== 'forced_induction')]));
  r = report();
  r.checklist = ['Система подушок безпеки: перевірити блок, ремені, піропатрони та відсутність спрацювання після ремонту.', 'Перевірити, чи немає ознак скручування пробігу за сервісною книжкою.'];
  enforceReportConsistency(r, { lang: 'ua' });
  ok('6g. an instruction to check airbags or mileage is not a claim about their state', r.checklist.length === 2, JSON.stringify(r.checklist));
  /* ---- 6h. rc-v3: what photos show vs what they cannot prove (RAV4 smoke 2026-10-08) ---- */
  {
    const noDep = report(); noDep.score_breakdown.events = [{ v4_category: 'medium', airbags: false }]; noDep.historical_visual.srs_visual_status = 'no_deployment_visible';
    const dep = report(); /* the base report: archive shows a deployed airbag */
    const unk = report(); unk.score_breakdown.events = [{ v4_category: 'medium' }]; delete unk.historical_visual;
    const fNo = canonicalFacts(noDep), fDep = canonicalFacts(dep), fUnk = canonicalFacts(unk);
    ok('6h. fixtures: canonical airbags false / true / unknown', fNo.airbags === false && fDep.airbags === true && fUnk.airbags === null, JSON.stringify([fNo.airbags, fDep.airbags, fUnk.airbags]));
    const v = (txt, f) => sentenceViolations(txt, f).filter(x => x.domain === 'airbags' || x.domain === 'accident');
    const RAV4 = 'Подушки не видно раскрытыми, признаков повреждения силовых частей кузова на тех кадрах нет, так что это скорее средний удар по наружным панелям.';
    ok('6h.0 the exact RAV4 smoke sentence is an observation, not a deployment claim', v(RAV4, fNo).length === 0, JSON.stringify(v(RAV4, fNo)));
    const r6 = report(); r6.score_breakdown.events = [{ v4_category: 'medium', airbags: false }]; r6.historical_visual.srs_visual_status = 'no_deployment_visible';
    r6.final_conclusion = { headline: 'Понятный RAV4 с одним ремонтом', body: 'Это понятный кроссовер. ' + RAV4 + ' Ремонт стоит разобрать на осмотре.\n\nЦена близка к средней.' };
    const o6 = enforceReportConsistency(r6, { lang: 'ru' });
    ok('6h.0 the RAV4 sentence survives the gate inside the Final Conclusion', r6.final_conclusion && r6.final_conclusion.body.includes('Подушки не видно раскрытыми') && !o6.violations.some(x => x.domain === 'airbags' && String(x.section).startsWith('final_conclusion')), JSON.stringify(o6.violations));
    for (const t of ['На текущих фото не видно раскрытых подушек.', 'Видимых признаков раскрытия подушек на доступных кадрах нет.', 'Deployed airbags are not visible in the current photos.']) {
      ok('6h.1 cautious observation allowed without a conflicting fact: ' + t, v(t, fNo).length === 0 && v(t, fUnk).length === 0, JSON.stringify([v(t, fNo), v(t, fUnk)]));
    }
    for (const t of ['Подушки не срабатывали.', 'Подушки безпеки не спрацьовували.', 'The airbags never deployed.']) {
      ok('6h.2 "never deployed" blocked when only photos support it: ' + t, v(t, fNo).some(x => x.found === 'never_deployed' && x.canonical === 'not_visible_only') && v(t, fUnk).some(x => x.found === 'never_deployed'), JSON.stringify(v(t, fNo)));
    }
    for (const t of ['SRS исправна.', 'Система безпеки повністю відновлена.', 'Система безопасности полностью восстановлена.', 'The airbag system is working.']) {
      ok('6h.3 SRS health blocked without diagnostic evidence: ' + t, [fNo, fUnk, fDep].every(f => v(t, f).some(x => x.field === 'srs_health')), JSON.stringify(v(t, fNo)));
    }
    for (const t of ['Подушки целые.', 'Подушки цілі.', 'The airbags are intact.']) {
      ok('6h.4 "airbags intact" blocked: ' + t, v(t, fNo).length > 0 && v(t, fUnk).length > 0 && v(t, fDep).length > 0, JSON.stringify([v(t, fNo), v(t, fDep)]));
    }
    for (const t of ['На архивных фото не видно раскрытых подушек.', 'На фото не видно раскрытых подушек.', 'Подушки не срабатывали.']) {
      ok('6h.5 confirmed historical deployment not erased: ' + t, v(t, fDep).some(x => x.canonical === 'deployed'), JSON.stringify(v(t, fDep)));
    }
    for (const t of ['На текущих фото салона раскрытых подушек не видно, но исторически они срабатывали.', 'Сейчас в салоне не видно раскрытых подушек.', 'On the current photos no deployed airbags are visible after the repair.']) {
      ok('6h.6 today\'s photos may show no deployed airbags without erasing history: ' + t, v(t, fDep).length === 0, JSON.stringify(v(t, fDep)));
    }
    ok('6h.6 a current-photo sentence that also names the auction state is still blocked', v('На текущих фото и на аукционе раскрытых подушек не видно.', fDep).length > 0);
    for (const t of ['Авария была лёгкой, потому что подушки не раскрылись.', 'ДТП було легким, бо подушки не спрацювали.', 'It was a minor accident because the airbags did not deploy.']) {
      ok('6h.7 light severity inferred from airbags blocked: ' + t, v(t, fNo).some(x => x.found === 'light_from_airbags'), JSON.stringify(v(t, fNo)));
    }
    ok('6h. instructions and reported speech stay claims-free', v('Проверить, что SRS исправна и подушки не срабатывали.', fNo).length === 0 && v('Продавец утверждает, что подушки не срабатывали.', fNo).length === 0);
    const SC = await import('file://' + path.join(dir, 'api', 'score-ceiling.js'));
    const ev = { v4_category: 'medium', category_basis: ['panels'], zone_classes: ['front'] };
    const hvBase = { visible_damage_zones: ['капот'], damage_depth: 'exterior_panels_only', inner_component_damage_extent: 'none', load_bearing_structure_deformation_visible: false, cabin_intrusion_visible: false, structural_visual_status: 'no_obvious_severe_signs' };
    const sevNo = SC.physicalDamageSeverity({ ...ev, airbags: false }, { ...hvBase, srs_visual_status: 'no_deployment_visible' });
    const sevYes = SC.physicalDamageSeverity({ ...ev, airbags: true }, { ...hvBase, srs_visual_status: 'deployed_visible', airbags_visible_parts: ['driver'] });
    ok('6h.7 airbag status does not change the Score Ceiling damage severity', JSON.stringify(sevNo) === JSON.stringify(sevYes), JSON.stringify([sevNo, sevYes]));
  }
  r = report();
  r.verdict.summary = 'ДТП не зафіксовано у реєстрі. Ціна нижча за середню.';
  enforceReportConsistency(r, { lang: 'ua' });
  ok('6e. on a car with a recorded accident, "no accident recorded" is removed', !/не зафіксовано/.test(r.verdict.summary), r.verdict.summary);

  /* ---- 7. unresolved identity conflict leaking into confident prose ---- */
  r = report();
  r._meta.vehicle_spec.fields.fuel = { value: null, source: null, strength: null, conflict: true, candidates: [{ source: 'decoder', value: 'petrol' }, { source: 'listing', value: 'diesel' }] };
  r._meta.vehicle_spec.conflicts = ['fuel'];
  r.vehicle.fuel = null;
  r.final_conclusion.body = 'Це дизельний позашляховик з потужним мотором. На фото кузов виглядає доглянутим.\n\nУ 2019 році автомобіль потрапив у ДТП середньої тяжкості, спрацювала подушка водія.\n\nЦіна близько 26 тисяч доларів нижча за середню. Джерела розходяться щодо палива: декодер каже бензин, оголошення дизель.';
  r.checklist = ['Дизельний двигун: перевірити форсунки.', 'Пневмопідвіска: утримання висоти.'];
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('7. confident "diesel" sentence removed while sources conflict', r.final_conclusion && !/дизельний позашляховик/.test(r.final_conclusion.body), r.final_conclusion && r.final_conclusion.body);
  ok('7a. the sentence that names the conflict itself stays', r.final_conclusion && /Джерела розходяться/.test(r.final_conclusion.body));
  ok('7b. checklist item asserting diesel dropped', r.checklist.length === 1 && /Пневмопідвіска/.test(r.checklist[0]));
  ok('7c. diagnostics name the identity conflict', out.violations.some(v => v.domain === 'identity_conflict' && v.field === 'fuel') && out.facts.fuel === 'conflict');

  /* ---- 8. reported speech, contrast and hedges are not claims ---- */
  const facts = canonicalFacts(report());
  for (const s of ['Продавець називає мотор турбованим, але це компресорний V8.', 'Це компресорний двигун, а не турбо.', 'За словами продавця, двигун турбований.', 'According to the seller the engine is turbocharged.', 'Якщо це турбований мотор, перевірте турбіни.', 'Декодер VIN вказує задній привід, оголошення повний.']) {
    ok('8. not a claim: ' + s.slice(0, 50), sentenceViolations(s, facts).length === 0, JSON.stringify(sentenceViolations(s, facts)));
  }
  ok('8a. Porsche "Cayenne Turbo" is a model name, not an induction claim', sentenceViolations('Cayenne Turbo з компресорним двигуном не існує, тут саме компресорний V8.', facts).length === 0);
  ok('8b. maintenance reminder lamp is not a fault lamp claim', sentenceViolations('На панелі світиться нагадування про ТО.', facts).length === 0);
  ok('8c. an asserted lit check-engine lamp on a frame without a running engine is a violation', sentenceViolations('Горить лампа Check Engine, що вказує на несправність двигуна.', facts).some(v => v.domain === 'dashboard'));
  const fx = canonicalFacts(report({ _meta: deep(report()._meta, 'current_visual_shadow.current_visual.dashboard.assessment', { state: 'running', active: ['check engine'], self_test: [], unconfirmed: [], explicit_fault_messages: [] }) }));
  ok('8d. an active lamp on a running engine is a real fact: no violation', sentenceViolations('Горить лампа Check Engine, що вказує на несправність двигуна.', fx).length === 0);

  /* ---- 9. Final Conclusion failure semantics ---- */
  r = report();
  r.final_conclusion.headline = 'Турбований Range Rover із питаннями до відновлення';
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('9. a contradicting headline hides the whole block', r.final_conclusion === null && out.hidden.includes('final_conclusion') && r._meta.final_conclusion.status === 'error' && /^consistency_/.test(r._meta.final_conclusion.reason), JSON.stringify(r._meta.final_conclusion));
  r = report();
  r.final_conclusion.body = 'Турбований V8 потужний.\n\nУ 2019 році автомобіль потрапив у ДТП середньої тяжкості.';
  enforceReportConsistency(r, { lang: 'ua' });
  ok('9a. a paragraph that would disappear hides the block instead', r.final_conclusion === null && r._meta.final_conclusion.reason === 'consistency_paragraph_lost');
  const g = gateFinalConclusion({ headline: 'H', body: 'Турбований мотор. Турбіни дорогі. Задній привід. Кузов доглянутий. Ціна нижча.' }, facts);
  ok('9b. more than a quarter of sentences removed hides the block', g.hidden && g.reason === 'too_many_sentences' && g.removed === 3 && g.total === 5, JSON.stringify(g));
  r = report({ final_conclusion: null });
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('9c. a report without a Final Conclusion passes through', r.final_conclusion === null && !out.hidden.includes('final_conclusion'));
  ok('9d. the gate never throws on garbage', (() => { try { enforceReportConsistency(null); enforceReportConsistency({}); enforceReportConsistency({ risks: 'x', final_conclusion: 'y', _meta: null }); return true; } catch (e) { return false; } })());

  /* ---- 10. untouched report stays byte-identical ---- */
  r = report();
  r.risks = [r.risks[1]]; r.checklist = [r.checklist[1]]; r.market_value.liquidity.reasons = [r.market_value.liquidity.reasons[1]];
  r.final_conclusion.body = r.final_conclusion.body.replace(/Для цього турбованого V8 відомі проблеми з охолодженням, тому важлива перевірка системи під тиском\./, 'Для цього компресорного V8 відомі проблеми з охолодженням.');
  const snap = JSON.stringify({ ...r, _meta: { ...r._meta, consistency: undefined } });
  out = enforceReportConsistency(r, { lang: 'ua' });
  ok('10. a consistent report is not modified', out.violations.length === 0 && JSON.stringify({ ...r, _meta: { ...r._meta, consistency: undefined } }) === snap, JSON.stringify(out.violations));
  ok('10a. sentence splitter keeps abbreviations like "тис. км" together', splitSentences('Пробіг 254 тис. км великий. Друге речення.').length === 2);

  /* ---- 11. wiring in api/check.js ---- */
  const src = fs.readFileSync('api/check.js', 'utf8');
  const iFc = src.indexOf('const attached = attachFinalConclusion(parsed, fc, lang);');
  const iRc = src.indexOf('const rc = enforceReportConsistency(parsed, { lang });');
  const iRet = src.indexOf('return res.status(200).json(parsed);');
  const iMeta = src.indexOf('parsed._meta = {');
  const iValue = src.indexOf('parsed.market_value = composeMarketValue');
  ok('11. the gate runs after _meta, market value and the Final Conclusion, before the response', iRc > 0 && iMeta < iRc && iValue < iRc && iFc < iRc && iRc < iRet);
  ok('11a. the gate is isolated: its own try/catch, diagnostics in _meta.consistency and a timing', /try \{\s*const rc = enforceReportConsistency/.test(src) && /parsed\._meta\.consistency = rc;/.test(src) && /mark\('consistency'/.test(src));
  ok('11b. no second LLM call for the gate', !/callModel/.test(fs.readFileSync('api/report-consistency.js', 'utf8')));
  ok('11c. the gate is not in the public allowlist (diagnostics stay private)', !/consistency/.test(fs.readFileSync('api/share.js', 'utf8')));
  for (const f of ['api/report-consistency.js', 'consistencytest.js']) ok('no em dash in ' + f, !fs.readFileSync(f, 'utf8').includes(DASH));

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('CONSISTENCY TEST FAILED (' + errs.length + '/' + checks + '):'); for (const e of errs) console.log('  - ' + e); process.exit(1); }
  console.log('consistency gate: ' + checks + ' checks · turbo/supercharger · petrol/diesel · AWD/RWD · gearbox family · mileage records · airbags/accident · identity conflict · hedges and reported speech · FC failure semantics · wiring');
})().catch(e => { console.log('CONSISTENCY TEST CRASHED:', e.stack || e.message); process.exit(1); });
