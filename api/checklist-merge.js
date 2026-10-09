/* Checklist merge: the final checklist keeps every material, actionable check
   that the report itself has already identified in structured form.

   Sources, all structured, none rediscovered from prose:
   1. risks[].action of every high risk and of every medium finding risk
      (the main analysis writes risk and action together; the checklist is a
      separate list of the same call and can lose an action);
   2. an unresolved canonical identity field (_meta.vehicle_spec conflict, or
      a gearbox whose exact type is not established) becomes a step that
      establishes it, never a guessed value;
   3. checks[] returned by the Final Conclusion (fc-v2.5+): the steps it
      recommends, with an area and an optional "refines item N" pointing at
      the checklist it was shown. Only material areas pass; a refinement
      replaces the generic item in place, a new check is appended.

   The list stays short: refinements do not grow it, additions stop at
   MAX_ITEMS, near-duplicates are not added. A check is a step, not a
   diagnosis: an item that asserts a fault without any checking verb or
   condition is rejected. Text is never rewritten, so conditions ("if the
   air suspension is fitted") and seller claims ("the oil change the seller
   reports") survive as written.
   Not a Vercel function (no default export): imported by api/check.js. */

export const CHECKLIST_MERGE_VERSION = 'cm-v1';
export const MAX_ITEMS = 7;
export const MAX_FC_CHECKS = 3;
export const FC_CHECK_AREAS = ['safety', 'structure', 'identity', 'powertrain', 'mileage', 'expensive_system', 'service_history', 'modification', 'accident_repair', 'documents', 'cosmetic', 'other'];
const NON_MATERIAL = new Set(['cosmetic', 'other']);

const EM_DASH = new RegExp('\\s*' + String.fromCharCode(0x2014) + '\\s*', 'g');
const tidy = s => String(s || '').replace(EM_DASH, ', ').replace(/\s+/g, ' ').trim();
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/* ---------- word stems for coverage and duplicates ---------- */
const STOP = new Set(['проверить', 'перевірити', 'check', 'inspect', 'осмотреть', 'оглянути', 'поскольку', 'оскільки', 'because', 'также', 'також', 'after', 'после', 'після', 'when', 'если', 'якщо', 'with', 'this', 'that', 'есть', 'чтобы', 'щоб', 'which', 'которые', 'які', 'было', 'було']);
export function stems(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().split(/[^a-zа-яіїєґё0-9]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w.slice(0, 5));
  }
  return out;
}
const share = (a, b) => { if (!a.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / a.size; };
function jaccard(a, b) { let n = 0; for (const x of a) if (b.has(x)) n++; const u = a.size + b.size - n; return u ? n / u : 0; }

/* the inspected area of an action: the part before the first colon, or the
   whole text when the action has no "area: what to do" form */
const areaPart = t => { const s = String(t || ''); const i = s.indexOf(':'); return i > 3 && i < 160 ? s.slice(0, i) : s; };

/* a risk is covered when one checklist item names most of the inspected
   area of its action or most of its title, or the checklist as a whole
   names nearly all of the action area */
export function actionCovered(action, checklist, title = '') {
  const items = checklist.map(stems);
  const one = need => need.size > 0 && items.some(s => share(need, s) >= 0.5);
  const need = stems(areaPart(action));
  if (!need.size) return true;
  if (one(need) || one(stems(title))) return true;
  const all = new Set(); for (const s of items) for (const x of s) all.add(x);
  return share(need, all) >= 0.75;
}
const nearDuplicate = (text, checklist) => { const a = stems(text); return checklist.some(t => jaccard(a, stems(t)) >= 0.6); };

/* ---------- a check is not a diagnosis ---------- */
const L = 'a-zа-яіїєґё';
const FAULT = new RegExp(`(?:^|[^${L}])(?:неисправ|несправн|faulty|malfunction|изношен|зношен|worn[- ]out|растянут|розтягнут|stretched|сломан|зламан|broken|требует замены|потребує заміни|needs? (?:to be )?replac|вышел из строя|вийшов з ладу|failed)`, 'i');
const STEP = new RegExp(`(?:^|[^${L}])(?:провер|перевір|check|inspect|осмотр|огляд|оцен|оцін|assess|убед|переконат|verify|confirm|подтверд|підтверд|установ|встанов|выясн|зʼясу|з'ясу|measure|измер|вимір|если|якщо|if|whether|ли|чи)(?:[^${L}]|[${L}])`, 'i');
export function assertsFault(text) { return FAULT.test(String(text || '')) && !STEP.test(String(text || '')); }

/* ---------- identity verification ----------
   Core technical identity only. A trim (version) conflict changes the price
   reading, not what to inspect, and marketplace generation strings still
   reach it, so it does not produce a checklist step */
const ID_WORDS = {
  model: /модел|model/i,
  generation: /покол|generation/i,
  version: /верси|версі|version|комплектац|модифікац|модификац|\btrim\b/i,
  power_hp: /потужн|мощн|horsepower|power|к\.?\s?с|л\.?\s?с|\bhp\b/i,
  fuel: /палив|топлив|fuel|бензин|дизел|petrol|diesel/i,
  electrification: /гібрид|гибрид|hybrid|mhev|phev/i,
  displacement_l: /об.?[єеё]м|displacement/i,
  forced_induction: /наддув|турб|turbo|компрес|supercharg/i,
  transmission: /коробк|трансміс|трансмис|transmission|gearbox|варіатор|вариатор|cvt/i,
  drivetrain: /привід|привод|drivetrain|awd|4wd|4x4/i,
};
const ID_LABEL = {
  model: { ua: 'Модель', ru: 'Модель', en: 'Model' },
  generation: { ua: 'Покоління', ru: 'Поколение', en: 'Generation' },
  version: { ua: 'Версія', ru: 'Версия', en: 'Version' },
  power_hp: { ua: 'Потужність двигуна', ru: 'Мощность двигателя', en: 'Engine power' },
  fuel: { ua: 'Тип палива', ru: 'Тип топлива', en: 'Fuel type' },
  electrification: { ua: 'Тип гібридної системи', ru: 'Тип гибридной системы', en: 'Hybrid system type' },
  displacement_l: { ua: 'Обʼєм двигуна', ru: 'Объём двигателя', en: 'Engine displacement' },
  forced_induction: { ua: 'Тип наддуву', ru: 'Тип наддува', en: 'Induction type' },
  transmission: { ua: 'Коробка передач', ru: 'Коробка передач', en: 'Gearbox' },
  drivetrain: { ua: 'Привід', ru: 'Привод', en: 'Drivetrain' },
};
/* an item verifies an identity field only when it names the field and sets
   out to establish it; "check the gearbox shifts" does not establish its type */
const ESTABLISH = /уточн|установ|определ|встанов|визнач|зʼясу|з'ясу|выясн|сверить|звір|establish|determine|identify|confirm|verify|код агрегат|unit code|маркиров|маркуван|документ|document/i;
const HP = { ua: 'к.с.', ru: 'л.с.', en: 'hp' };
const OR = { ua: ' або ', ru: ' или ', en: ' or ' };
const TT = { cvt: { ua: 'варіатор', ru: 'вариатор', en: 'CVT' }, automatic: { ua: 'ступінчастий автомат', ru: 'ступенчатый автомат', en: 'stepped automatic' }, dct: { ua: 'роботизована коробка', ru: 'роботизированная коробка', en: 'dual-clutch gearbox' } };

/* a naming conflict (model line, generation, version) is settled by the
   VIN plate and the documents; the step names what each source said */
const SRC = { decoder: { ua: 'декодер VIN', ru: 'декодер VIN', en: 'VIN decoder' }, listing: { ua: 'оголошення', ru: 'объявление', en: 'listing' }, analysis: { ua: 'розбір сторінки', ru: 'разбор страницы', en: 'page analysis' } };
const NAMING = ['model', 'generation', 'version'];
function identitySteps(spec, lang) {
  const L2 = lang === 'ua' || lang === 'en' ? lang : 'ru';
  const out = [];
  if (!isObj(spec) || !isObj(spec.fields)) return out;
  for (const f of Array.isArray(spec.conflicts) ? spec.conflicts : []) {
    if (!ID_LABEL[f]) continue;
    if (NAMING.includes(f)) {
      const named = [...new Set((spec.fields[f] && Array.isArray(spec.fields[f].candidates) ? spec.fields[f].candidates : []).filter(c => c && (c.raw || c.value)).map(c => (SRC[c.source] ? SRC[c.source][L2] : c.source) + ': ' + String(c.raw || c.value).slice(0, 40)))];
      const list = named.length ? ' (' + named.join('; ') + ')' : '';
      out.push({ field: f, text: L2 === 'ua' ? `${ID_LABEL[f].ua}: джерела називають її по-різному${list}; звірити VIN на кузові і в техпаспорті з даними оголошення і встановити фактичне значення.`
        : L2 === 'en' ? `${ID_LABEL[f].en}: the sources name it differently${list}; compare the VIN on the body and in the registration papers with the listing and establish the actual value.`
        : `${ID_LABEL[f].ru}: источники называют её по-разному${list}; сверить VIN на кузове и в техпаспорте с данными объявления и установить фактическое значение.` });
      continue;
    }
    const cands = (spec.fields[f] && Array.isArray(spec.fields[f].candidates) ? spec.fields[f].candidates : []).map(c => c && c.value).filter(v => v !== null && v !== undefined);
    /* power: each candidate in the unit its source used; a converted kW
       figure shows both ("204 кВт (277 л.с.)"), never a bare normalised number */
    const raw = (spec.fields[f] && Array.isArray(spec.fields[f].candidates) ? spec.fields[f].candidates : []).filter(c => c && c.value !== null && c.value !== undefined);
    const KW = { ua: 'кВт', ru: 'кВт', en: 'kW' };
    const vals = f === 'power_hp' ? [...new Set(raw.map(c => (c.unit === 'kw' && Number.isFinite(Number(c.raw_value)) ? Number(c.raw_value) + ' ' + KW[L2] + ' (' + Math.round(Number(c.value)) + ' ' + HP[L2] + ')' : Math.round(Number(c.value)) + ' ' + HP[L2])))] : [];
    const list = vals.length > 1 ? ' (' + vals.join(OR[L2]) + ')' : '';
    out.push({ field: f, text: L2 === 'ua' ? `${ID_LABEL[f].ua}: джерела розходяться${list}; встановити фактичне значення за документами і маркуванням на огляді, не обираючи жодне з них заздалегідь.`
      : L2 === 'en' ? `${ID_LABEL[f].en}: the sources disagree${list}; establish the actual value from the documents and markings at the inspection, without assuming either one.`
      : `${ID_LABEL[f].ru}: источники расходятся${list}; установить фактическое значение по документам и маркировке на осмотре, не принимая ни одно из них заранее.` });
  }
  const tt = spec.fields.transmission_type;
  if (isObj(tt) && tt.exact === false && Array.isArray(tt.candidates) && tt.candidates.length > 1 && !(spec.conflicts || []).includes('transmission')) {
    const names = [...new Set(tt.candidates.map(c => c && c.value).filter(Boolean))].map(v => (TT[v] ? TT[v][L2] : v));
    out.push({ field: 'transmission', text: L2 === 'ua' ? `Коробка передач: точний тип не встановлено (${names.join(OR.ua)}); визначити за кодом агрегату на огляді.`
      : L2 === 'en' ? `Gearbox: the exact type is not established (${names.join(OR.en)}); determine it from the unit code at the inspection.`
      : `Коробка передач: точный тип не установлен (${names.join(OR.ru)}); определить по коду агрегата на осмотре.` });
  }
  return out;
}

/* ---------- Final Conclusion checks ---------- */
/* raw checks -> [{ text, area, refines }]; refines is a 1-based index into
   the checklist snapshot the conclusion was shown, or null */
export function sanitizeFcChecks(raw, snapshotLength = 0) {
  const out = []; const rejected = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!isObj(c)) continue;
    const text = tidy(c.text).slice(0, 300);
    const area = FC_CHECK_AREAS.includes(c.area) ? c.area : 'other';
    if (text.length < 12) { rejected.push({ reason: 'empty', text }); continue; }
    if (NON_MATERIAL.has(area)) { rejected.push({ reason: 'not_material', area, text }); continue; }
    if (assertsFault(text)) { rejected.push({ reason: 'diagnosis', area, text }); continue; }
    if (out.length >= MAX_FC_CHECKS) { rejected.push({ reason: 'over_limit', area, text }); continue; }
    const n = Number.isInteger(c.refines) && c.refines >= 1 && c.refines <= snapshotLength ? c.refines : null;
    out.push({ text, area, refines: n });
  }
  return { checks: out, rejected };
}

/* ---------- merge ---------- */
/* report: the finished parsed report; fcChecks: [{text, area, refines}] from
   sanitizeFcChecks; snapshot: the checklist strings the conclusion was shown.
   Mutates report.checklist and returns the merge log */
export function mergeChecklist(report, { fcChecks = [], snapshot = null, lang = 'ru' } = {}) {
  const log = { version: CHECKLIST_MERGE_VERSION, before: 0, after: 0, refined: [], added: [], skipped: [] };
  if (!isObj(report)) return log;
  const list = (Array.isArray(report.checklist) ? report.checklist : []).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
  log.before = list.length;
  const refinedIdx = new Set();
  const add = (text, source, extra = {}) => {
    if (nearDuplicate(text, list)) { log.skipped.push({ source, reason: 'duplicate', text, ...extra }); return; }
    if (list.length >= MAX_ITEMS) { log.skipped.push({ source, reason: 'cap', text, ...extra }); return; }
    list.push(text); log.added.push({ source, text, ...extra });
  };

  /* 1. refinements from the conclusion replace the generic item in place */
  const snap = Array.isArray(snapshot) ? snapshot : list.slice();
  const fresh = [];
  for (const c of fcChecks || []) {
    if (!c || !c.text) continue;
    if (c.refines) {
      const target = snap[c.refines - 1];
      const i = target ? list.indexOf(String(target).trim()) : -1;
      /* the replacement keeps the scope of the generic item: a much shorter
         text would drop what the item checked, so it is added instead */
      if (i >= 0 && !refinedIdx.has(i) && c.text.length >= 0.6 * list[i].length) {
        log.refined.push({ area: c.area, from: list[i], to: c.text });
        list[i] = c.text; refinedIdx.add(i); continue;
      }
    }
    fresh.push(c);
  }

  /* 2. material risks keep their action */
  for (const r of Array.isArray(report.risks) ? report.risks : []) {
    if (!isObj(r) || typeof r.action !== 'string' || !r.action.trim()) continue;
    const material = r.level === 'high' || (r.level === 'med' && r.kind === 'finding');
    if (!material) continue;
    if (actionCovered(r.action, list, r.title)) continue;
    add(tidy(r.action), 'risk', { risk: String(r.title || '').slice(0, 90), level: r.level });
  }

  /* 3. unresolved identity becomes a step that establishes it */
  const spec = report._meta && report._meta.vehicle_spec;
  for (const s of identitySteps(spec, lang)) {
    if (list.some(t => ID_WORDS[s.field] && ID_WORDS[s.field].test(t) && ESTABLISH.test(t))) continue;
    add(s.text, 'identity', { field: s.field });
  }

  /* 4. new checks from the conclusion */
  for (const c of fresh) add(c.text, 'final_conclusion', { area: c.area });

  report.checklist = list;
  log.after = list.length;
  return log;
}
