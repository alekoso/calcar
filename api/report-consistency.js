/* CalCar Check: final semantic consistency gate (report-consistency).

   Why it exists. The 15-report audit found finished reports where one
   section had already reached the correct interpretation while another
   still carried an older or wrong fact: a supercharged V8 called "turbo"
   in the Checklist, petrol in the header and diesel in a risk, AWD in the
   analysis and RWD in a market reason, airbags deployed in the archive and
   "no deployed airbags" in the summary. Each section is written by a model
   call that sees the same facts, so the contradictions are not data errors
   but prose errors. This gate makes sure a finished report cannot
   contradict the canonical structured facts on buyer-critical domains.

   Canonical facts come only from code: api/vehicle-spec.js (identity),
   score_breakdown.events and historical_visual (accidents, airbags),
   score_breakdown.inputs.mileage_rollback plus history points (mileage),
   the dashboard assessment of Current Vision (lamps). The gate never
   invents a value: it only compares prose claims against these facts.

   Repair policy, deterministic and conservative:
   - list items (risks, checklist, discrepancies, model weaknesses, market
     reasons, auction findings) that contradict a canonical fact are
     dropped; a market card that loses all its reasons is hidden;
   - free text (auction summary, verdict summary, history note, archive
     summary) loses only the contradicting sentence; nothing is rewritten;
   - Final Conclusion loses the contradicting sentence; if the headline
     contradicts, a paragraph would disappear, or more than a quarter of
     the sentences would go, the whole block is hidden with the same
     failure semantics as a failed call (final_conclusion = null and a
     reason in _meta.final_conclusion). The block is never regenerated.
   A sentence that reports someone else's words, contrasts two values or
   is hedged is not a claim and is left alone. Everything the gate did is
   recorded in _meta.consistency for diagnostics.

   Not a Vercel function: imported by api/check.js. */

export const CONSISTENCY_VERSION = 'rc-v2';
export const CONSISTENCY_DOMAINS = ['fuel', 'forced_induction', 'drivetrain', 'transmission', 'version', 'power_hp', 'identity_conflict', 'identity_unknown', 'airbags', 'accident', 'mileage', 'dashboard'];
/* share of Final Conclusion sentences that may be removed before the block is hidden */
export const FC_MAX_REMOVED_SHARE = 0.25;

import { powerValues, powerEquivalent } from './vehicle-spec.js';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : '');
const TRUSTED = new Set(['strong', 'medium']);

/* ---------- canonical facts ---------- */

export function canonicalFacts(report) {
  const r = isObj(report) ? report : {};
  const meta = isObj(r._meta) ? r._meta : {};
  const vs = isObj(meta.vehicle_spec) && isObj(meta.vehicle_spec.fields) ? meta.vehicle_spec : null;
  const field = f => {
    const x = vs && isObj(vs.fields[f]) ? vs.fields[f] : null;
    if (!x) return { value: null, trusted: false, conflict: false };
    return { value: x.value === undefined ? null : x.value, trusted: !x.conflict && x.value !== null && TRUSTED.has(x.strength), conflict: !!x.conflict };
  };
  const sb = isObj(r.score_breakdown) ? r.score_breakdown : {};
  const shadow = isObj(r.score_breakdown_shadow) ? r.score_breakdown_shadow : {};
  const events = arr(sb.events).length ? arr(sb.events) : (arr(shadow.events).length ? arr(shadow.events) : arr(shadow.accident_events));
  const hv = isObj(r.historical_visual) ? r.historical_visual : null;
  const hf = isObj(meta.history_facts) ? meta.history_facts : {};
  const auction = isObj(r.auction) ? r.auction : {};
  const eventAirbags = events.some(e => isObj(e) && e.airbags === true);
  const hvAirbags = hv ? hv.srs_visual_status : null;
  let airbags = null;
  if (eventAirbags || hvAirbags === 'deployed_visible') airbags = true;
  else if (hvAirbags === 'no_deployment_visible' && events.length && events.every(e => isObj(e) && e.airbags === false)) airbags = false;
  const recorded = events.length > 0 || hf.accident_recorded === true || hf.insurance_case_recorded === true || auction.found === true;
  /* "no accident" is canonical only when every source answered and none shows one */
  const sourcesAnswered = hf.registry_present === true || auction.found === false || typeof hf.accident_recorded === 'boolean';
  const accident = recorded ? 'recorded' : (sourcesAnswered && isObj(sb.inputs) && isObj(sb.inputs.accident_history) && sb.inputs.accident_history.status === 'clean' ? 'none' : 'unknown');
  const roll = isObj(sb.inputs) && isObj(sb.inputs.mileage_rollback) ? sb.inputs.mileage_rollback : {};
  const unresolved = arr(sb.unresolved).some(u => isObj(u) && u.input === 'mileage_rollback');
  const points = [...arr(hf.mileage_points), ...arr(sb.mileage_points).filter(p => isObj(p) && p.family !== 'current')].filter(isObj);
  const cvs = isObj(meta.current_visual_shadow) ? meta.current_visual_shadow : {};
  const dashA = isObj(cvs.current_visual) && isObj(cvs.current_visual.dashboard) && isObj(cvs.current_visual.dashboard.assessment)
    ? cvs.current_visual.dashboard.assessment
    : (isObj(cvs.summary) && isObj(cvs.summary.dashboard_assessment) ? cvs.summary.dashboard_assessment : null);
  const cands = f => (vs && isObj(vs.fields[f]) && Array.isArray(vs.fields[f].candidates) ? vs.fields[f].candidates.map(c => c.raw || c.value).filter(Boolean) : []);
  return {
    fuel: field('fuel'), forced_induction: field('forced_induction'), drivetrain: field('drivetrain'), transmission: field('transmission'),
    version: { ...field('version'), candidates: cands('version') },
    power_hp: { ...field('power_hp'), candidates: cands('power_hp') },
    identity_conflicts: vs ? arr(vs.conflicts) : [],
    /* genuinely unknown: no trusted source, no conflict; downstream may not infer these */
    identity_unknown: vs ? arr(vs.unknown) : [],
    accident, airbags,
    mileage: {
      /* applied = odometer decreased between dated records (Score fact); clean = checked, no decrease */
      rollback: roll.status || 'unavailable',
      unresolved,
      historical_points: points.length,
    },
    dashboard: dashA ? { state: dashA.state || 'unknown', active: arr(dashA.active), explicit: arr(dashA.explicit_fault_messages) } : null,
  };
}

/* ---------- claims in prose ---------- */

/* JS \w and \b are ASCII-only, so every pattern is built from a Cyrillic-aware
   letter class: in the sources below "\w" means a letter of any supported
   language and "<B" / "B>" mean a word boundary around Cyrillic or Latin */
const L = "[a-zа-яіїєґё'’ʼ]";
const rx = (src, flags = 'i') => new RegExp(src.replace(/\\w/g, L).replace(/<B/g, '(?<!' + L + ')').replace(/B>/g, '(?!' + L + ')'), flags);

/* a sentence that reports someone else's words, names a source, contrasts
   two values or is hedged is not the report's own claim */
const REPORTED = rx("(?:продав\\w+|оголошенн\\w*|объявлени\\w*|декодер\\w*|decoder|площадк\\w*|реєстр\\w*|реестр\\w*|картк\\w*|карточк\\w*|seller|listing|marketplace|registry)\\S*\\s+(?:\\S+\\s+){0,2}(?:вказ\\w*|указ\\w*|каже|говор\\w*|назива\\w*|называ\\w*|заявля\\w*|стверджу\\w*|утвержда\\w*|пише|пишет|описує|описыва\\w*|says|claims|describes|lists|calls|states|indicates|shows)|за словами|зі слів|со слов|по словам|according to|заявлен\\w*|\\bvin\\b|розшифр\\w*|расшифр\\w*|декодер|decoder|джерела розходяться|источники расходятся|sources disagree|розбіжн\\w*|расхожд\\w*|не встановлен\\w*|не установлен\\w*|not established|не збігається|не совпадает|не підтверджу\\w*|не подтвержда\\w*|not confirmed|unconfirmed|замість|вместо|instead of|rather than|<Bа неB>|<Bа не\\s|, але це|, но это|, but (?:it|this|that) is|,? not an? ");
const HEDGED = rx("не виключ\\w*|нельзя исключ\\w*|не можна виключ\\w*|cannot be ruled out|can't be ruled out|можлив\\w*|возможн\\w*|може бути|может быть|\\bmay\\b|\\bmight\\b|\\bcould\\b|ймовірн\\w*|вероятн\\w*|likely|perhaps|підозр\\w*|подозр\\w*|suspect|<Bякщо|<Bесли|\\bif\\b|<BчиB>|<BлиB>|whether");
const NEG_BEFORE = rx("(?:^|[\\s(«\"'])(не|ні|нет|без|no|not|non|never|neither|nor|without|isn't|wasn't|aren't|weren't|don't|doesn't|didn't|cannot|can't|hasn't|haven't)[\\s-]*(?:\\S+\\s+){0,2}$");

function negated(sentence, idx) { return NEG_BEFORE.test(sentence.slice(Math.max(0, idx - 40), idx)); }

const IDENTITY = {
  fuel: {
    petrol: rx("бензин\\w*|petrol|gasoline", 'gi'),
    diesel: rx("дизел\\w*|diesel", 'gi'),
    electric: rx("електромобіл\\w*|электромобил\\w*|electric (?:car|vehicle|suv|sedan|crossover)|\\bbev\\b|на електротяз\\w*|електричн\\w+ (?:авто|двигун|мотор)|электрическ\\w+ (?:авто|двигател|мотор)", 'gi'),
    hybrid: rx("гібрид\\w*|гибрид\\w*|hybrid", 'gi'),
  },
  forced_induction: {
    turbo: rx("турбо\\w*|турбін\\w*|турбин\\w*|turbo\\w*|бітурбо|битурбо|twin-?turbo", 'gi'),
    supercharger: rx("компресор\\w*|компрессор\\w*|supercharg\\w*|kompressor", 'gi'),
    na: rx("атмосферн\\w*|naturally aspirated|non-turbo|без наддув\\w*|безнаддувн\\w*", 'gi'),
  },
  drivetrain: {
    awd: rx("повн\\w+ привод\\w*|повн\\w+ привід\\w*|полн\\w+ привод\\w*|повнопривідн\\w*|полноприводн\\w*|\\bawd\\b|\\b4x4\\b|\\b4wd\\b|all-wheel|xdrive|quattro|4matic|4motion", 'gi'),
    rwd: rx("задн\\w+ привод\\w*|задн\\w+ привід\\w*|задньопривідн\\w*|заднеприводн\\w*|\\brwd\\b|rear-wheel", 'gi'),
    fwd: rx("передн\\w+ привод\\w*|передн\\w+ привід\\w*|передньопривідн\\w*|переднеприводн\\w*|\\bfwd\\b|front-wheel", 'gi'),
  },
  transmission: {
    manual: rx("механік\\w*|механічн\\w+ (?:коробк\\w*|кпп|трансмісі\\w*)|механическ\\w+ (?:коробк\\w*|кпп|трансмисси\\w*)|<Bмкпп|manual (?:gearbox|transmission)|stick shift|ручн\\w+ коробк\\w*", 'gi'),
    cvt: rx("варіатор\\w*|вариатор\\w*|\\bcvt\\b", 'gi'),
    dct: rx("робот\\w* коробк\\w*|роботизован\\w*|\\bdsg\\b|\\bdct\\b|\\bpdk\\b|dual-?clutch|двозчеплен\\w*|двухсцеплен\\w*|s[- ]?tronic", 'gi'),
    automatic: rx("автомат\\w*|automatic|<Bакпп|гідротрансформатор\\w*|гидротрансформатор\\w*", 'gi'),
  },
};
const AUTO_FAMILY = new Set(['automatic', 'cvt', 'dct']);
/* a value in prose that is compatible with the canonical one */
function compatible(domain, claim, canon) {
  if (claim === canon) return true;
  if (domain === 'fuel') {
    const ice = v => v === 'petrol' || v === 'diesel';
    if ((claim === 'hybrid' || canon === 'hybrid' || canon === 'phev') && (ice(claim) || ice(canon) || claim === 'hybrid')) return true;
    return false;
  }
  if (domain === 'transmission') return AUTO_FAMILY.has(claim) && AUTO_FAMILY.has(canon);
  return false;
}

/* model names that carry an induction word without claiming anything about this car */
const TRIM_TURBO = /(?:cayenne|panamera|macan|911|carrera|taycan|boxster|cayman)\s*turbo|turbo s\b/i;

function sentenceClaims(sentence) {
  const out = {};
  const s = sentence;
  for (const [domain, dict] of Object.entries(IDENTITY)) {
    for (const [value, r] of Object.entries(dict)) {
      r.lastIndex = 0;
      let m;
      while ((m = r.exec(s))) {
        if (negated(s, m.index)) continue;
        if (domain === 'forced_induction' && value === 'turbo' && TRIM_TURBO.test(s)) continue;
        (out[domain] = out[domain] || new Set()).add(value);
        break;
      }
    }
  }
  return out;
}

/* explicit positive and negative statements; negation handled by the pattern itself */
const AIRBAG_DEPLOYED = rx("подуш\\w*[^.]{0,30}(?:спрацюва\\w*|сработа\\w*|розкрит\\w*|раскрыт\\w*|відкрит\\w*|открыт\\w*|вистрелил\\w*|выстрелил\\w*)|(?:спрацюва\\w*|сработа\\w*|розкрит\\w*|раскрыт\\w*|відкрит\\w*|открыт\\w*)[^.]{0,30}подуш\\w*|airbags?[^.]{0,30}(?:deployed|went off|fired)|deployed airbags?");
const AIRBAG_NOT = rx("подуш\\w*[^.]{0,40}не (?:спрацюва\\w*|сработа\\w*|розкрив\\w*|раскрыва\\w*|розкрилис\\w*|раскрылись)|(?:розкрит\\w*|раскрыт\\w*|спрацьован\\w*|сработавш\\w*|deployed|fired)[^.]{0,20}(?:подуш\\w*|airbags?)[^.]{0,40}(?:не видно|не зафіксован\\w*|не зафиксирован\\w*|не спостеріга\\w*|не наблюда\\w*|немає|нема|нет|not visible|not seen|cannot be seen|not evident)|(?:не видно|нема[єе]?|нет|без|відсутн\\w*|отсутству\\w*|no|without)[^.]{0,70}(?:розкрит\\w*|раскрыт\\w*|спрацьован\\w*|сработавш\\w*|deployed|fired)[^.]{0,20}(?:подуш\\w*|airbags?)|airbags? (?:did not|didn't|had not|hadn't|haven't|have not) (?:deploy|fire|go off)|no (?:deployed|fired) airbags?|without airbag deployment|подушки цілі|подушки целы|airbags (?:are|were|remain) intact");
const ACCIDENT_HAD = rx("(?:бул[аои]|був|была|было|пережи\\w+|потрапи\\w+|попа(?:л|ла|ло)|after|після|после|зафіксован\\w*|зафиксирован\\w*|recorded|відновлен\\w*|восстановлен\\w*|repaired)[^.]{0,25}(?:дтп|авар\\w*|accident|collision|crash|удар\\w*)|(?:дтп|авар\\w*|accident|collision|crash)[^.]{0,20}(?:бул[аои]|була|було|была|было|зафіксован\\w*|зафиксирован\\w*|recorded|в сша|in the us|у сша)");
const ACCIDENT_NONE = rx("(?:без|нет|нема[єе]?|не було|не было|no|without)\\s+(?:зафіксован\\w+\\s+|зареєстрован\\w+\\s+|recorded\\s+|registered\\s+)?(?:дтп|авар\\w*|accident|collision|crash)|(?:дтп|авар\\w*|accident|collision|crash)\\w*[^.]{0,30}не (?:зафіксован\\w*|зареєстрован\\w*|було|было|зафиксирован\\w*|зарегистрирован\\w*)|(?:дтп|авар\\w*|accident|collision|crash)[^.]{0,20}(?:not recorded|not registered|history is clean|is clean)|чиста історія|чистая история|clean history|не бит\\w*|небит\\w*");
const ROLLBACK_CONFIRMED = rx("(?:пробіг|пробег|одометр|mileage|odometer)[^.]{0,40}(?:скручен\\w*|змотан\\w*|смотан\\w*|rolled back|was rolled|відмотан\\w*|отмотан\\w*|занижен\\w*)|(?:скрутк\\w*|скручуванн\\w*|rollback|rolled-back)[^.]{0,20}(?:підтверджен\\w*|подтвержден\\w*|confirmed|очевидн\\w*|obvious)");
const ROLLBACK_NONE = rx("(?:без|нет|нема[єе]?|no)\\s+(?:ознак|признаков|signs? of|evidence of)\\s+(?:скру\\w+|відмот\\w+|отмот\\w+|rollback|tamper\\w*)|(?:скрут\\w+|відмот\\w+|отмот\\w+|rollback|tamper\\w*)[^.]{0,20}(?:не виявлен\\w*|не выявлен\\w*|не зафіксован\\w*|не зафиксирован\\w*|not (?:found|detected|indicated))|(?:пробіг|пробег|mileage|odometer)[^.]{0,40}(?:без розбіжност\\w*|без расхожден\\w*|consistent with (?:the )?(?:records|history)|узгоджу\\w+|согласу\\w+|послідовн\\w+|последователь\\w+)");
const MILEAGE_CONFIRMED = rx("(?:пробіг|пробег|mileage|odometer)[^.]{0,40}(?:підтверджен\\w*|подтвержд[её]н\\w*|confirmed|documented|supported)[^.]{0,30}(?:істор\\w*|истор\\w*|history|record\\w*|запис\\w*|точк\\w*|сервіс\\w*|сервис\\w*|service)|(?:істор\\w*|истор\\w*|history|records?|запис\\w*)[^.]{0,30}(?:підтверджу\\w+|подтвержда\\w+|confirm\\w*|support\\w*)[^.]{0,20}(?:пробіг|пробег|mileage|odometer)");
const LAMP_ON = rx("горить|горит|світиться|светится|увімкнен\\w*|включ[её]н\\w*|активн\\w*|\\bon\\b|\\blit\\b|illuminated|warning light|індикатор несправност\\w*|индикатор неисправност\\w*|помилк\\w+ (?:двигуна|подушок|abs)|ошибк\\w+ (?:двигателя|подушек|abs)|check engine|\\babs\\b|\\bsrs\\b|airbag (?:light|lamp|warning)");
const LAMP_WORD = rx("лампа|лампочк\\w*|індикатор\\w*|индикатор\\w*|warning light|check engine|\\bsrs\\b|\\babs\\b|контрольн\\w+ (?:лампа|индикатор)|сигнал\\w+ лампа");
const MAINT_REMINDER = rx("maint|<BТОB>|service (?:reminder|due)|обслуговуванн\\w*|обслуживани\\w*|нагадуванн\\w*|напоминани\\w*");
const VERSION_UNKNOWN = rx("(?:точн\\w+ |exact )?(?:верс\\w+|комплектац\\w+|version|trim)[^.]{0,40}(?:не встановлен\\w*|не установлен\\w*|невідом\\w*|неизвест\\w*|не підтверджен\\w*|не подтвержд\\w*|не визначен\\w*|не определен\\w*|не з[’'ʼ]ясован\\w*|не выяснен\\w*|not established|unknown|not confirmed|unclear|uncertain|not determined)|(?:не встановлен\\w*|не установлен\\w*|невідом\\w*|неизвест\\w*)[^.]{0,20}(?:верс\\w+|комплектац\\w+|version|trim)");
const VERSION_ASSERT = rx("(?:це|это|this is|is a|is the|саме|именно|версі\\w+|верси\\w+|version|комплектац\\w+|trim|у |в |for the |на )");
/* an instruction to check something is not a statement about the car's state */
const INSTRUCTION = rx("^(?:перевір\\w*|провер\\w*|check|verify|inspect|оглян\\w*|осмотр\\w*|з[’'ʼ]ясу\\w*|выясн\\w*|переконат\\w*|убедит\\w*|запит\\w*|запрос\\w*|попрос\\w*)|(?:перевірити|перевірте|проверить|проверьте|to check|to verify|to inspect|варто перевірити|стоит проверить|слід перевірити|необхідно перевірити|нужно проверить|потрібно перевірити)");
const LAMP_EXEMPT = rx("самоперевір\\w*|самопроверк\\w*|self-?test|тест ламп|до запуску|до пуска|before start|контекстн\\w*");

export function sentenceViolations(sentence, facts, { section = '' } = {}) {
  const out = [];
  const s = str(sentence);
  if (!s.trim()) return out;
  const reported = REPORTED.test(s);
  const hedged = HEDGED.test(s);
  /* identity: a confident claim against a trusted canonical value, or any
     confident claim about a field whose sources are in conflict */
  if (!reported && !hedged) {
    const claims = sentenceClaims(s);
    for (const domain of ['fuel', 'forced_induction', 'drivetrain', 'transmission']) {
      const found = claims[domain];
      if (!found) continue;
      const canon = facts[domain];
      if (canon.conflict || facts.identity_conflicts.includes(domain)) {
        out.push({ domain: 'identity_conflict', field: domain, found: [...found].join('|'), canonical: 'conflict' });
        continue;
      }
      if (!canon.trusted) continue;
      for (const v of found) if (!compatible(domain, v, canon.value)) out.push({ domain, field: domain, found: v, canonical: canon.value });
    }
  }
  const instruction = INSTRUCTION.test(s);
  /* version: an established version may not be called unknown; while the
     sources conflict, no candidate may be asserted */
  /* "not established" is itself the claim here, so the reported-speech exemption does not apply */
  if (facts.version && facts.version.trusted && VERSION_UNKNOWN.test(s)) out.push({ domain: 'version', field: 'version', found: 'unknown', canonical: String(facts.version.value) });
  if (facts.version && facts.version.conflict && !reported && !hedged) {
    for (const cand of facts.version.candidates) {
      const r = new RegExp('(?<![a-z0-9а-яіїєґё])' + String(cand).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9а-яіїєґё])', 'i');
      if (String(cand).length >= 2 && r.test(s) && VERSION_ASSERT.test(s)) { out.push({ domain: 'identity_conflict', field: 'version', found: String(cand), canonical: 'conflict' }); break; }
    }
  }
  /* power: figures are normalised (kW, hp, PS) before comparing; a figure
     that differs from the established power, or any figure while the sources
     conflict, is a violation */
  if (facts.power_hp && (facts.power_hp.trusted || facts.power_hp.conflict) && !reported) {
    const figs = powerValues(s);
    if (figs.length) {
      if (facts.power_hp.conflict) out.push({ domain: 'identity_conflict', field: 'power_hp', found: figs.join('|'), canonical: 'conflict' });
      else for (const f of figs) if (!powerEquivalent(f, facts.power_hp.value)) { out.push({ domain: 'power_hp', field: 'power_hp', found: String(f), canonical: String(facts.power_hp.value) }); break; }
    }
  }
  /* unknown identity: no source gives fuel, drivetrain or gearbox type, so a
     confident claim can only come from generic model knowledge */
  if (!reported && !hedged && facts.identity_unknown.length) {
    const claims = sentenceClaims(s);
    for (const domain of ['fuel', 'drivetrain', 'transmission']) {
      if (facts.identity_unknown.includes(domain) && claims[domain] && !(domain === 'transmission' && [...claims[domain]].every(v => AUTO_FAMILY.has(v)) && facts.transmission.value)) {
        out.push({ domain: 'identity_unknown', field: domain, found: [...claims[domain]].join('|'), canonical: 'unknown' });
      }
    }
  }
  /* airbags: only against an established state; an instruction to check them is not a claim */
  if (facts.airbags === true && !instruction && AIRBAG_NOT.test(s)) out.push({ domain: 'airbags', field: 'airbags', found: 'not_deployed', canonical: 'deployed' });
  if (facts.airbags === false && !hedged && !reported && !instruction && AIRBAG_DEPLOYED.test(s) && !AIRBAG_NOT.test(s)) out.push({ domain: 'airbags', field: 'airbags', found: 'deployed', canonical: 'not_deployed' });
  /* accident */
  if (facts.accident === 'recorded' && !instruction && ACCIDENT_NONE.test(s) && !reported) out.push({ domain: 'accident', field: 'accident', found: 'none', canonical: 'recorded' });
  if (facts.accident === 'none' && !hedged && !reported && !instruction && ACCIDENT_HAD.test(s) && !ACCIDENT_NONE.test(s)) out.push({ domain: 'accident', field: 'accident', found: 'had', canonical: 'none' });
  /* mileage */
  const m = facts.mileage || {};
  if (m.rollback === 'applied' && !instruction && (ROLLBACK_NONE.test(s) || MILEAGE_CONFIRMED.test(s))) out.push({ domain: 'mileage', field: 'rollback', found: 'consistent', canonical: 'decreased_between_records' });
  if (m.rollback === 'clean' && !m.unresolved && !hedged && !reported && !instruction && ROLLBACK_CONFIRMED.test(s)) out.push({ domain: 'mileage', field: 'rollback', found: 'rolled_back', canonical: 'clean' });
  if (m.historical_points === 0 && !instruction && MILEAGE_CONFIRMED.test(s)) out.push({ domain: 'mileage', field: 'history', found: 'confirmed_by_history', canonical: 'no_historical_points' });
  /* dashboard: a fault lamp asserted as lit when the assessment has no active lamp and no explicit fault message */
  const d = facts.dashboard;
  if (d && !d.active.length && !d.explicit.length && d.state !== 'unknown' && d.state !== 'running' && d.state !== 'ev_ready'
    && LAMP_WORD.test(s) && LAMP_ON.test(s) && !MAINT_REMINDER.test(s) && !hedged && !reported && !instruction && !LAMP_EXEMPT.test(s)) {
    out.push({ domain: 'dashboard', field: 'lamp', found: 'active_fault_lamp', canonical: 'no_active_lamp_' + d.state });
  }
  return out.map(v => ({ ...v, section }));
}

export function splitSentences(text) {
  return str(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[^a-zа-яіїєґё])/).filter(Boolean);
}

/* ---------- repairs ---------- */

/* free text: only the contradicting sentences go; null when nothing is left */
function pruneText(text, facts, section, log) {
  if (typeof text !== 'string' || !text.trim()) return { text, removed: 0, total: 0 };
  const sents = splitSentences(text);
  const kept = [];
  let removed = 0;
  for (const s of sents) {
    const v = sentenceViolations(s, facts, { section });
    if (v.length) { removed++; log.push(...v.map(x => ({ ...x, action: 'sentence_removed', text: s.slice(0, 160) }))); continue; }
    kept.push(s);
  }
  return { text: kept.length ? kept.join(' ') : null, removed, total: sents.length };
}

/* each part of an item (title, note, action) is judged on its own: a check
   instruction in the action must not shield a false statement in the note */
function pruneItems(list, partsOf, facts, section, log) {
  if (!Array.isArray(list)) return list;
  return list.filter(item => {
    const parts = arr(partsOf(item)).filter(p => typeof p === 'string' && p.trim());
    if (!parts.length) return true;
    const v = parts.flatMap(p => splitSentences(p).flatMap(s => sentenceViolations(s, facts, { section })));
    if (!v.length) return true;
    log.push(...v.slice(0, 2).map(x => ({ ...x, action: 'item_dropped', text: parts.join(' | ').slice(0, 160) })));
    return false;
  });
}

/* Final Conclusion: sentence removal inside paragraphs; the block is hidden
   when the headline contradicts, a paragraph would disappear or more than
   FC_MAX_REMOVED_SHARE of the sentences would go */
export function gateFinalConclusion(fc, facts) {
  if (!isObj(fc) || typeof fc.body !== 'string') return { fc, hidden: false, removed: 0, total: 0, violations: [] };
  const log = [];
  const headlineV = sentenceViolations(fc.headline, facts, { section: 'final_conclusion.headline' });
  if (headlineV.length) return { fc: null, hidden: true, reason: 'headline', removed: 0, total: 0, violations: headlineV.map(v => ({ ...v, action: 'block_hidden', text: str(fc.headline).slice(0, 160) })) };
  const paras = fc.body.split(/\n\s*\n/);
  const outParas = [];
  let removed = 0, total = 0, emptyPara = false;
  for (const p of paras) {
    const r = pruneText(p, facts, 'final_conclusion.body', log);
    removed += r.removed; total += r.total;
    if (r.text === null && r.total) { emptyPara = true; continue; }
    if (r.text) outParas.push(r.text);
  }
  if (!removed) return { fc, hidden: false, removed: 0, total, violations: [] };
  if (emptyPara || !outParas.length || removed / Math.max(1, total) > FC_MAX_REMOVED_SHARE) {
    return { fc: null, hidden: true, reason: emptyPara ? 'paragraph_lost' : 'too_many_sentences', removed, total, violations: log.map(v => ({ ...v, action: 'block_hidden' })) };
  }
  return { fc: { ...fc, body: outParas.join('\n\n') }, hidden: false, removed, total, violations: log };
}

/* ---------- the gate ---------- */

export function enforceReportConsistency(report, { lang = 'en' } = {}) {
  const out = { version: CONSISTENCY_VERSION, violations: [], dropped: 0, sentences_removed: 0, hidden: [], facts: null };
  if (!isObj(report)) return out;
  const facts = canonicalFacts(report);
  out.facts = {
    fuel: facts.fuel.trusted ? facts.fuel.value : (facts.fuel.conflict ? 'conflict' : null),
    forced_induction: facts.forced_induction.trusted ? facts.forced_induction.value : (facts.forced_induction.conflict ? 'conflict' : null),
    drivetrain: facts.drivetrain.trusted ? facts.drivetrain.value : (facts.drivetrain.conflict ? 'conflict' : null),
    transmission: facts.transmission.trusted ? facts.transmission.value : (facts.transmission.conflict ? 'conflict' : null),
    accident: facts.accident, airbags: facts.airbags, mileage_rollback: facts.mileage.rollback, historical_points: facts.mileage.historical_points,
    dashboard_state: facts.dashboard ? facts.dashboard.state : null,
  };
  const log = out.violations;
  const before = () => log.length;

  /* list sections: contradicting items are dropped */
  const n0 = before();
  report.risks = pruneItems(report.risks, it => isObj(it) ? [it.title, it.note, it.action] : [], facts, 'risks', log);
  report.checklist = pruneItems(report.checklist, it => (typeof it === 'string' ? [it] : (isObj(it) ? [it.title, it.text] : [])), facts, 'checklist', log);
  report.discrepancies = pruneItems(report.discrepancies, it => isObj(it) ? [it.title, it.detail] : [], facts, 'discrepancies', log);
  if (isObj(report.model_notes)) report.model_notes.issues = pruneItems(report.model_notes.issues, it => isObj(it) ? [it.title, it.detail] : [], facts, 'model_notes', log);
  if (isObj(report.auction)) report.auction.findings = pruneItems(report.auction.findings, it => isObj(it) ? [it.text] : [], facts, 'auction.findings', log);
  if (isObj(report.market_value)) {
    for (const card of ['liquidity', 'why_price']) {
      const c = report.market_value[card];
      if (!isObj(c) || !Array.isArray(c.reasons)) continue;
      const had = c.reasons.length;
      c.reasons = pruneItems(c.reasons, it => (typeof it === 'string' ? [it] : []), facts, 'market_value.' + card, log);
      if (had && !c.reasons.length) { report.market_value[card] = null; out.hidden.push('market_value.' + card); }
    }
  }
  out.dropped = log.filter(v => v.action === 'item_dropped').length;

  /* free text: sentence removal */
  const prune = (holder, key, section) => {
    if (!isObj(holder) || typeof holder[key] !== 'string') return;
    const r = pruneText(holder[key], facts, section, log);
    if (r.removed) { holder[key] = r.text; out.sentences_removed += r.removed; }
  };
  prune(report.auction, 'summary', 'auction.summary');
  prune(report.verdict, 'summary', 'verdict.summary');
  prune(report, 'history_note', 'history_note');
  prune(report.historical_visual, 'summary', 'historical_visual.summary');

  /* Final Conclusion: same failure semantics as a failed call */
  if (isObj(report.final_conclusion)) {
    const g = gateFinalConclusion(report.final_conclusion, facts);
    log.push(...g.violations);
    out.sentences_removed += g.hidden ? 0 : g.removed;
    if (g.hidden) {
      report.final_conclusion = null;
      out.hidden.push('final_conclusion');
      if (isObj(report._meta)) report._meta.final_conclusion = { ...(isObj(report._meta.final_conclusion) ? report._meta.final_conclusion : {}), status: 'error', reason: 'consistency_' + g.reason, consistency: { removed: g.removed, total: g.total } };
    } else if (g.removed) {
      report.final_conclusion = g.fc;
      if (isObj(report._meta) && isObj(report._meta.final_conclusion)) report._meta.final_conclusion.consistency = { removed: g.removed, total: g.total };
    }
  }
  void n0; void lang;
  return out;
}
