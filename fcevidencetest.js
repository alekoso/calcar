/* Evidence-aware Final Conclusion (fc-v2.6 rules, rc-v3.3 gate classes).

   The conclusion may explain, prioritise and speak plainly, but never raises
   the evidence status: consistent points, "not found", "not visible in the
   photos", "the seller says" and a listing-vs-average delta never become
   honest mileage, never happened, almost new, a diagnostic result or the
   cause of the price. One over-certain phrase removes that sentence (or the
   headline alone), never the whole conclusion. Cases from the 2026-10-09
   corpus: RAV4 2019, Prado 2021, Model Y 2023, Cayenne 2015, E-Class 2006;
   Cayenne 2013 (WP1ZZZ92ZDLA45155) is the positive control.
   Run: node fcevidencetest.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_fcev_'));
fs.mkdirSync(path.join(dir, 'api'));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
for (const x of fs.readdirSync('api').filter(f => f.endsWith('.js'))) fs.writeFileSync(path.join(dir, 'api', x), fs.readFileSync('api/' + x, 'utf8'));

const FACTS = (over = {}) => ({ fuel: { value: null, trusted: false, conflict: false }, forced_induction: { value: null, trusted: false, conflict: false }, drivetrain: { value: null, trusted: false, conflict: false }, transmission: { value: null, trusted: false, conflict: false },
  version: { value: null, trusted: false, conflict: false, candidates: [] }, power_hp: { value: null, trusted: false, conflict: false, candidates: [] }, identity_conflicts: [], identity_unknown: [],
  accident: 'none', airbags: null, mileage: { rollback: 'clean', unresolved: false, historical_points: 2 }, dashboard: null, checklist_items: 7, ...over });
const report = (fc, over = {}) => ({ vehicle: { title: 'Car' }, verdict: { score: 7, summary: 'Summary.' }, checklist: ['a: one', 'b: two', 'c: three', 'd: four', 'e: five', 'f: six', 'g: seven'],
  score_breakdown: { inputs: { mileage_rollback: { status: 'clean', available: true }, accident_history: { status: 'clean', available: true } }, events: [] },
  final_conclusion: fc, _meta: { lang: 'ru', history_facts: { registry_present: true, accident_recorded: false, mileage_points: [{ km: 30000, date: '2021-01-21' }, { km: 137000, date: '2026-06-23' }] }, vehicle_spec: { fields: {}, conflicts: [], unknown: [] }, final_conclusion: { status: 'ok', provider: 'anthropic', version: 'fc-v2.6' } }, ...over });
const BODY = 'Первый абзац с фактами. Машина выглядит интересной. История в целом понятная. Снаружи на фото выглядит ухоженно. Это хороший знак, но проверка нужна.\n\nВторой абзац. Пробег высокий для возраста. Найденные показания пробега последовательны. Между отметками прошло больше пяти лет, и что было с обслуживанием, из данных не видно. Цена немного ниже средней.\n\nТретий абзац. Главный вопрос здесь батарея. Диагностика покажет её состояние. Днище на фото не показано.';

(async () => {
  const RC = await import('file://' + path.join(dir, 'api', 'report-consistency.js'));
  const F = await import('file://' + path.join(dir, 'api', 'conclusion.js'));
  const V = (t, over) => RC.sentenceViolations(t, FACTS(over), { section: 'final_conclusion.body' });
  const blocked = (t, over) => V(t, over).length > 0;
  const domain = (t, over) => (V(t, over)[0] || {}).domain || null;

  /* 1. honest mileage without direct evidence */
  ok('1a. "честный пробег" is blocked', blocked('Это машина с честным пробегом.') && domain('Это машина с честным пробегом.') === 'mileage_certainty');
  ok('1b. "реальный пробег установлен" is blocked', blocked('Реальный пробег установлен по сервисной книжке.'));
  ok('1c. en: "honest mileage" is blocked', blocked('The mileage is honest.'));
  ok('1d. ua: "чесний пробіг" is blocked', blocked('Чесний пробіг для свого віку.'));
  ok('1e. the seller saying it stays attributed and passes', !blocked('Продавец утверждает, что пробег честный.'));
  /* 2. confirmed mileage at an ordinary chronology */
  ok('2a. "пробег подтверждён" is blocked with two consistent points', blocked('Пробег подтверждён историей обслуживания.') && domain('Пробег подтверждён историей обслуживания.') === 'mileage_certainty');
  ok('2b. "цифре можно верить" is blocked (RAV4)', blocked('Две отметки ложатся ровно в эту линию, так что цифре можно верить.'));
  ok('2c. "пробег подтверждается точками" is blocked (Prado)', blocked('Пробег подтверждается несколькими точками за годы, и картина выглядит последовательной.'));
  ok('2d. "скрутки точно не было" is blocked', blocked('Скрутки точно не было.'));
  /* 3. cautious rollback wording stays */
  for (const t of ['Не найдено признаков отката.', 'Явных признаков отката по найденным точкам нет.', 'Показания согласуются между собой.', 'Пробег выглядит правдоподобно по доступным данным.', 'No signs of a rollback were found in the known readings.', 'Записи дилерського сервісу узгоджуються з ним, тож скручування тут не видно.']) ok('3. cautious stays: "' + t + '"', !blocked(t));
  /* 4. a gap keeps its cautious wording */
  ok('4a. a gap sentence passes untouched', !blocked('Между двумя сервисными отметками прошло больше пяти лет, и что происходило с обслуживанием в этот период, из отчёта не видно.'));
  ok('4b. "пробег не подтверждён" is a cautious negative, not a certainty', !blocked('Пробег за эти годы ничем не подтверждён.') && !blocked('Реальный пробег по документам не установлен.'));
  ok('4c. rules: the gap must stay visible and consistency is not proof', /A long gap between points stays visible in the wording/.test(F.CONCLUSION_RULES) && /never "honest mileage", "the mileage is confirmed", "the figure can be trusted"/.test(F.CONCLUSION_RULES));
  /* 5. hidden-catch certainty */
  ok('5a. "без скрытой подоплёки" is blocked', blocked('С учётом пробега это выглядит логично, без скрытой подоплёки.') && domain('С учётом пробега это выглядит логично, без скрытой подоплёки.') === 'absence_certainty');
  ok('5b. "без тревожного подтекста" and "no hidden catch" are blocked', blocked('Разница небольшая, без тревожного подтекста.') && blocked('A small gap, no hidden catch.'));
  /* 6. unsupported causality */
  ok('6a. "скидка сделана под X" is blocked', blocked('Скидка сделана как раз под отпотевающий мотор и возраст.') && domain('Скидка сделана как раз под отпотевающий мотор и возраст.') === 'causality');
  ok('6b. "цена ниже именно потому, что" is blocked', blocked('Цена ниже именно потому, что пробег большой.'));
  ok('6c. "объясняется как раз тем" is blocked (E-Class)', blocked('Цена примерно на 14% ниже средней, и это объясняется как раз тем, что следующий крупный ремонт может прийти скоро.'));
  ok('6d. en: "priced in" and "precisely because" are blocked', blocked('The seller has priced the repair in.') && blocked('The price is lower precisely because of the mileage.'));
  /* 7. seller-attributed causality is allowed */
  ok('7a. "Продавец утверждает, что состояние учтено в цене" passes', !blocked('Продавец утверждает, что состояние учтено в цене.'));
  ok('7b. attribution in the first clause does not cover CalCar\'s own claim after the colon (Cayenne 2015)', blocked('Продавец прямо пишет, что состояние уже заложено в цену, и это объяснение похоже на правду: скидка сделана как раз под отпотевающий мотор и возраст.'));
  ok('7c. en attribution passes', !blocked('The seller says the condition is already priced in.'));
  /* 8. market delta is not a motive */
  ok('8a. a plain delta passes', !blocked('Цена объявления примерно на 13% ниже показанной средней.') && !blocked('Цена находится около средней по текущей выборке.'));
  ok('8b. "fits the age and mileage" passes, "explains the price" does not', !blocked('Цена ниже средней, что согласуется с возрастом и пробегом.') && blocked('Большой пробег объясняет цену.'));
  ok('8c. "это объяснимо: возраст, износ" passes (Cayenne 2013)', !blocked('Цена примерно на пятую часть ниже средней по рынку, и это объяснимо: возраст, износ салона и заметные переделки.'));
  ok('8d. rules: the delta proves nothing about why', /The distance between the listing price and the marketplace average proves nothing about why/.test(F.CONCLUSION_RULES) && !/A clearly lower price also has an explanation in the history or condition\./.test(F.CONCLUSION_RULES));
  /* 9. limited photos do not allow a global condition */
  ok('9a. "почти не изношенная" is blocked', blocked('Вы получаете почти не изношенную Model Y дешевле обычного.') && domain('Вы получаете почти не изношенную Model Y дешевле обычного.') === 'global_condition');
  ok('9b. "почти новая", "в отличном состоянии", "like new" are blocked', blocked('Почти новая Tesla с американским ДТП.') && blocked('Машина в отличном состоянии.') && blocked('The car is like new.'));
  ok('9c. "кузов точно не ремонтировался" is blocked', blocked('Кузов точно не ремонтировался.'));
  /* near-new and no-wear are not legalised by photo scope */
  ok('9d. "на фото выглядит почти новой" is blocked', blocked('На фото выглядит почти новой.') && V('На фото выглядит почти новой.')[0].found === 'near_new_verdict');
  ok('9e. "на фото почти не изношена" is blocked', blocked('На фото почти не изношена.'));
  ok('9f. "как новая", "практически без износа", "in the photos it looks like new" are blocked', blocked('На фото выглядит как новая.') && blocked('Салон на фото практически без износа.') && blocked('In the photos it looks like new.'));
  ok('9g. "на доступных фото выглядит ухоженно" and "на видимых ракурсах сильного износа не заметно" stay', !blocked('На доступных фото выглядит ухоженно.') && !blocked('На видимых ракурсах сильного износа не заметно.'));
  /* 10. photo-scoped appearance stays */
  for (const t of ['На доступных фото салон выглядит аккуратно.', 'На видимых ракурсах сильного износа не заметно.', 'На фото явных следов ремонта не видно.', 'In the photos the interior looks well kept.', 'Снаружи машина на фото выглядит ухоженно, следов ремонта кузова не видно.']) ok('10. appearance stays: "' + t + '"', !blocked(t));
  /* 11. absence of evidence is not "never happened" */
  ok('11a. "ДТП не было" is blocked when no accident was found', blocked('ДТП не было.') && domain('ДТП не было.') === 'absence_certainty');
  ok('11b. "ремонта не было", "never repainted" are blocked', blocked('Ремонта не было.') && blocked('The car was never repainted.'));
  for (const t of ['Официально зарегистрированных ДТП в Украине не найдено.', 'Подтверждений ремонта не обнаружено.', 'Записей о ДТП в источниках нет.', 'No accident record was found in the sources.']) ok('11c. evidence-scoped absence stays: "' + t + '"', !blocked(t));
  ok('11d. rules: not found, never "there was no accident"', /never "there was no accident", "it was never repaired", "there are no problems"/.test(F.CONCLUSION_RULES));
  /* 12. seller claim does not become a fact */
  ok('12a. "эндоскопия показала, что двигатель без задиров" is blocked', blocked('Эндоскопия показала, что двигатель без задиров.') && domain('Эндоскопия показала, что двигатель без задиров.') === 'seller_fact');
  ok('12b. attributed diagnostic passes', !blocked('Продавец заявляет, что эндоскопия не выявила задиров; результат стоит подтвердить независимой проверкой.'));
  ok('12c. a future check passes', !blocked('Компьютерная диагностика покажет, нет ли ошибок по фильтру.') && !blocked('The scan will show the battery state.'));
  ok('12d. rules carry the endoscopy example', /The seller says the endoscopy found no scoring/.test(F.CONCLUSION_RULES));
  /* 13. a bad headline does not destroy the body */
  {
    const r = report({ headline: 'Один хозяин с нового и честный, но большой пробег', body: BODY });
    const out = RC.enforceReportConsistency(r, { lang: 'ru' });
    ok('13a. headline removed, body kept, block not hidden', r.final_conclusion && r.final_conclusion.headline === '' && r.final_conclusion.body === BODY && !out.hidden.includes('final_conclusion'), JSON.stringify(out.violations));
    ok('13b. the removal is logged as headline_removed and recorded in meta', out.violations.some(v => v.section === 'final_conclusion.headline' && v.action === 'headline_removed') && r._meta.final_conclusion.consistency.headline_removed === true && r._meta.final_conclusion.status === 'ok');
    const ready = F.conclusionReadiness(r);
    ok('13c. readiness: still structured, headline noted as missing', ready.visible === 'structured' && ready.headline_missing === true && ready.fallback_used === false);
    const r2 = report({ headline: 'Турбований мотор', body: BODY }, { _meta: { lang: 'ua', history_facts: { registry_present: true, accident_recorded: false }, vehicle_spec: { fields: { forced_induction: { value: 'supercharger', strength: 'strong', conflict: false } }, conflicts: [], unknown: [] }, final_conclusion: { status: 'ok' } } });
    RC.enforceReportConsistency(r2, { lang: 'ua' });
    ok('13d. an identity contradiction in the headline also removes only the headline', r2.final_conclusion && r2.final_conclusion.headline === '' && r2.final_conclusion.body === BODY);
  }
  /* 14. headline not stronger than the body */
  ok('14a. rules: headline never more certain than the body, one grammatical phrase, no price cause', /It is never more certain than the body/.test(F.CONCLUSION_RULES) && /one complete, grammatical phrase that reads on its own/.test(F.CONCLUSION_RULES) && /never states the cause of the price and never calls mileage honest, a car almost new, or a claimed version established/.test(F.CONCLUSION_RULES));
  ok('14b. the same classes judge the headline: "честный пробег" headline goes, a plain one stays', RC.sentenceViolations('Свежий Prado с честным пробегом, но слишком часто менял хозяев', FACTS(), { section: 'final_conclusion.headline' }).length === 1 && RC.sentenceViolations('Понятная история, но большой пробег', FACTS(), { section: 'final_conclusion.headline' }).length === 0);
  /* 15. the recommendation respects the checklist */
  ok('15a. a conditional purchase verdict is removed when the checklist holds several items (E-Class)', blocked('Если подвеска держит высоту, а мотор заводится на холодную чисто и без дыма, это вполне разумная покупка за свои деньги; если нет, скидка быстро съестся.') && domain('Если подвеска держит высоту, а мотор заводится на холодную чисто и без дыма, это вполне разумная покупка за свои деньги.') === 'recommendation');
  ok('15b. with a short checklist (two items) the same sentence is left to the rules', !blocked('Если подвеска держит высоту, это разумная покупка.', { checklist_items: 2 }));
  /* false sufficiency of a subset, not any conditional verdict */
  ok('15e. 4 critical checks, verdict on 2 named checks: blocked', blocked('Если подвеска держит высоту и мотор не дымит, машину можно брать.', { checklist_items: 4 }) && V('Если подвеска держит высоту и мотор не дымит, машину можно брать.', { checklist_items: 4 })[0].found === 'subset_2_of_4');
  ok('15f. 4 critical checks, verdict through the whole checklist: allowed', !blocked('Если ключевые проверки из чек-листа пройдут без замечаний, машину можно брать.', { checklist_items: 4 }) && !blocked('Если все проверки выше пройдут, это разумная покупка.', { checklist_items: 4 }) && !blocked('If the key checks on the list pass, this is a sensible buy.', { checklist_items: 4 }));
  ok('15g. "покупка имеет смысл только после проверки основных пунктов выше" is not a verdict on a subset', !blocked('Покупка имеет смысл только после успешной проверки основных пунктов выше.', { checklist_items: 6 }) && !blocked('Якщо ключові перевірки з переліку пройдуть, машину можна розглядати.', { checklist_items: 6 }));
  ok('15h. 1 to 2 meaningful checks: a conditional verdict on them is allowed', !blocked('Если подвеска держит высоту и мотор не дымит, машину можно брать.', { checklist_items: 2 }) && !blocked('Если мотор не дымит, это разумная покупка.', { checklist_items: 1 }));
  ok('15i. a verdict that names no specific component is left to the rules', !blocked('Если всё в порядке, это разумная покупка.', { checklist_items: 6 }));
  ok('15j. an ordinary recommendation without a verdict is untouched', !blocked('Перед покупкой важнее всего проверить подвеску и мотор.', { checklist_items: 6 }));
  ok('15c. naming the decisive check without a verdict passes', !blocked('Именно эндоскопия здесь решает больше всего.') && !blocked('Ціна виглядає розумно з огляду на одного власника.'));
  ok('15d. rules: the closing thought must not reduce the purchase to one or two checks', /The closing thought must not reduce the purchase to those one or two checks/.test(F.CONCLUSION_RULES));
  /* 16-18. languages */
  ok('16. ru guard across classes', ['Честный пробег.', 'ДТП не было.', 'Скидка сделана под ремонт.', 'Почти новая машина.', 'Эндоскопия показала чистые цилиндры.'].every(t => blocked(t)));
  ok('17. ua guard across classes', ['Чесний пробіг.', 'ДТП не було.', 'Знижку зроблено під ремонт.', 'Майже нова машина.', 'Ендоскопія показала чисті циліндри.'].every(t => blocked(t)));
  ok('18a. en guard across classes', ['Honest mileage.', 'There was no accident.', 'The discount was made for the engine.', 'An almost new car.', 'The endoscopy showed clean cylinders.'].every(t => blocked(t)));
  ok('18b. en cautious wording stays', ['The found readings are consistent.', 'No accident record was found.', 'The seller says the condition is priced in.', 'In the photos the car looks well kept.', 'The seller says the endoscopy found no scoring.'].every(t => !blocked(t)));
  /* 19. X5 counterfactual stays green */
  {
    const r = report({ headline: 'Топовый X5 M60i, чья цена держится так, будто аварии не было', body: BODY }, { score_breakdown: { inputs: { mileage_rollback: { status: 'clean', available: true }, accident_history: { status: 'recorded', available: true } }, events: [{ v4_category: 'medium', zone: 'front', year: 2025 }] } });
    r._meta.history_facts.accident_recorded = true;
    RC.enforceReportConsistency(r, { lang: 'ru' });
    ok('19. rc-v3.2 counterfactual exemption still holds under rc-v3.3', r.final_conclusion && r.final_conclusion.headline.startsWith('Топовый X5'));
  }
  /* 20. the positive control is untouched */
  {
    const POS = 'Продавец называет машину версией GTS, и мощность с этим согласуется, но по данным версию подтвердить не удалось, так что пока это слова продавца. Сильная сторона именно этой машины в истории: по реестру первый владелец держал её с 2013 по 2025 год, второй купил год назад. Пробег 153 тысячи для тринадцати лет обычный, а отметка дилерского сервиса в 2018 году хорошо ложится в эту картину.\n\nСнаружи машина на фото выглядит ухоженно, следов ремонта кузова не видно. В салоне светлая кожа, алькантара на потолке, карбоновые вставки.\n\nДля этого V8 известная слабость: задиры на стенках цилиндров. Продавец сам об этом пишет и говорит, что делал эндоскопию и что видео есть. Это хороший знак, но видео от продавца не заменит собственную эндоскопию с замером компрессии, и именно она здесь решает больше всего.\n\nЦена примерно на пятую часть ниже средней по рынку, и это объяснимо: возраст, износ салона и заметные переделки. Если GTS подтвердится, машина интереснее обычного Cayenne S, и тогда цена выглядит еще привлекательнее.';
    const r = report({ headline: 'Двенадцать лет в одних руках и V8, которому нужна проверка цилиндров', body: POS });
    const out = RC.enforceReportConsistency(r, { lang: 'ru' });
    ok('20. Cayenne 2013 style text passes the gate untouched', r.final_conclusion && r.final_conclusion.body === POS && r.final_conclusion.headline.startsWith('Двенадцать') && !out.violations.some(v => /final_conclusion/.test(v.section)), JSON.stringify(out.violations));
    ok('20b. rules keep the living style explicitly', /not a call for a dry report/.test(F.CONCLUSION_RULES));
  }
  /* 21. no new provider or model call */
  {
    const src = fs.readFileSync('api/check.js', 'utf8');
    const gate = fs.readFileSync('api/report-consistency.js', 'utf8');
    ok('21a. check.js calls the production conclusion chain exactly once', (src.match(/runProductionConclusion\(/g) || []).length === 1);
    ok('21b. the gate has no network and no model call', !/fetch\(|callModel|openai|anthropic/i.test(gate));
    ok('21c. versions: fc-v2.6 rules, rc-v3.3 gate', F.CONCLUSION_VERSION === 'fc-v2.6' && RC.CONSISTENCY_VERSION === 'rc-v3.3');
    ok('21d. a single over-certain sentence never hides the block: share rule unchanged', RC.FC_MAX_REMOVED_SHARE === 0.25);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) { console.log('FC EVIDENCE TEST FAILED:\n  - ' + errs.join('\n  - ')); process.exit(1); }
  console.log(`fc evidence: ${checks} checks · mileage certainty · absence certainty · price causality · global condition · seller fact · recommendation vs checklist · headline alone · ru/ua/en · X5 counterfactual · Cayenne 2013 control · no new model call`);
})().catch(e => { console.log('FC EVIDENCE TEST CRASHED:', e && e.stack || e); process.exit(1); });
