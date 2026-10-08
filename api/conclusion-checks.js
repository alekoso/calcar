/* CalCar Check: deterministic invariant checks for a Final Conclusion text.

   Used by the shadow A/B benchmark (api/conclusion-shadow.js) to catch the
   obvious regressions of a candidate provider without pretending to judge
   factual quality. Every check compares prose against canonical facts that
   code already owns:
   - the production consistency gate (api/report-consistency.js): identity
     conflict with a candidate picked, resolved identity changed, unknown
     identity asserted, airbags, accident recorded/none, mileage, lamps;
   - the Score and Confidence numbers of the report;
   - the registry owners count;
   - the resolved accident severity (overstated / understated);
   - critical problems that do not exist anywhere in the frozen input
     (flood, fire, theft, salvage, taxi);
   - the "buy / do not buy" directive, through the caller's detector.

   Conservative by design: reported speech, hedges, negations and check
   instructions are not claims. A clean result is not proof of correctness;
   a flag is a reason to look. Not a Vercel function. */

import { canonicalFacts, gateFinalConclusion, splitSentences, sentenceViolations } from './report-consistency.js';

export const CHECKS_VERSION = 'fc-checks-v1.1';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

/* Cyrillic-aware letter class, same convention as report-consistency.js */
const L = "[a-zа-яіїєґё'’ʼ]";
const rx = (src, flags = 'i') => new RegExp(src.replace(/\\w/g, L).replace(/<B/g, '(?<!' + L + ')').replace(/B>/g, '(?!' + L + ')'), flags);

const REPORTED = rx("продав\\w*|оголошенн\\w*|объявлени\\w*|<Bseller|<Blisting|заявля\\w*|стверджу\\w*|утвержда\\w*|<Bкаже|<Bговорит|<Bsays|<Bclaims|<Bclaimed|according to|за словами|по словам|зі слів|со слов|<Bstated|<Bdeclared");
const HEDGED = rx("можлив\\w*|возможн\\w*|<Bможе|<Bможет|<Bmay|<Bmight|<Bcould|ймовірн\\w*|вероятн\\w*|<Blikely|<Bif<B|<Bякщо|<Bесли|перевір\\w*|провер\\w*|<Bcheck|<Bverify|<Binspect|не виключ\\w*|нельзя исключ\\w*|cannot be ruled out|<Bwhether|<Bчи<B|<Bли<B|варто з[’'ʼ]ясувати|стоит выяснить");
const NEG_BEFORE = rx("(?:^|[\\s(«\"'])(не|ні|нет|без|no|not|non|never|neither|nor|without|isn't|wasn't|aren't|weren't|don't|doesn't|didn't|cannot|can't|hasn't|haven't)[\\s-]*(?:\\S+\\s+){0,2}$");
const negated = (s, idx) => NEG_BEFORE.test(s.slice(Math.max(0, idx - 40), idx));
const NEG_AFTER = rx("^\\S*\\s+(?:\\S+\\s+){0,3}?(?:не видн\\w*|не видно|не виявлен\\w*|не выявлен\\w*|не обнаружен\\w*|не знайден\\w*|не найден\\w*|не зафіксован\\w*|не зафиксирован\\w*|немає|нет<B|відсутн\\w*|отсутств\\w*|not (?:found|seen|visible|recorded))");
const negatedAfter = (s, idx) => NEG_AFTER.test(s.slice(idx, idx + 60));

/* ---- score and confidence numbers ---- */
const SCORE_RE = rx("(\\d{1,2}(?:[.,]\\d)?)\\s*(?:\\/|<Bз|<Bіз|<Bиз|<Bof|out of|<Bвід)\\s*10B>", 'gi');
const SCORE_WORD_RE = rx("(?:<Bscore|<Bбал\\w*|<Bоцінк\\w*|<Bоценк\\w*|<Brating)\\s*(?:of|is|=|:|calcar|у|в)?\\s*(\\d{1,2}(?:[.,]\\d)?)B>(?!\\s*(?:%|тис|тыс|k<B|км|km|\\d))", 'gi');
const CONF_WORD = rx("<Bconfidence|<Bповнот\\w*|<Bполнот\\w*|перевірен\\w*|проверен\\w*|<Bcheck<B|<Bchecked|<Bcoverage|<Bcomplete\\w*|<Bverified share|довір\\w*|достовірн\\w*|достоверн\\w*");
const PRICE_WORD = rx("<Bprice|<Bцін\\w*|<Bцен\\w*|<Baverage|середн\\w*|средн\\w*|дешев\\w*|<Bcheaper|дорож\\w*|<Bbelow|<Babove|<Bнижч\\w*|<Bниж\\w*|<Bвищ\\w*|<Bвыш\\w*|retention|знецін\\w*|обесцен\\w*|<Bvalue|<Bвартіст\\w*|<Bстоимост\\w*|<Bkept");
const PERCENT_RE = /(\d{1,3})\s?%/g;

/* ---- owners ---- */
const NUM_WORDS = {
  one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  'один': 1, 'одного': 1, 'одним': 1, 'одна': 1, 'одной': 1, 'одному': 1, 'єдин': 1, 'единствен': 1,
  'два': 2, 'двох': 2, 'двома': 2, 'две': 2, 'двух': 2, 'двумя': 2,
  'три': 3, 'трьох': 3, 'трьома': 3, 'трех': 3, 'трёх': 3, 'тремя': 3,
  'чотири': 4, 'чотирьох': 4, 'четыре': 4, 'четырех': 4, 'четырёх': 4,
  "п'ять": 5, 'пʼять': 5, 'п’ять': 5, "п'яти": 5, 'пять': 5, 'пяти': 5,
  'шість': 6, 'шести': 6, 'шесть': 6, 'сім': 7, 'семи': 7, 'семь': 7,
  'вісім': 8, 'восьми': 8, 'восемь': 8, "дев'ять": 9, 'девять': 9, 'девяти': 9, 'десять': 10, 'десяти': 10,
};
const OWNERS_RE = rx("<B(\\d{1,2}|" + Object.keys(NUM_WORDS).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, m => "\\" + m)).join("|") + ")B>\\s+(?:\\w+\\s+){0,2}?(?:owners?B>|власник\\w*|владел\\w*|хазя\\w*|хозя\\w*)", "gi");
/* a preposition right before the number makes it a tenure, not the total:
   "seven years with one owner", "у одного хозяина", "при одному власнику" */
const OWNERS_TENURE = rx("(?:^|[\\s(«\"'])(?:у|при|с|со|з|із|від|от|під|под|за|в|во|with|under|from|by|since|for)\\s+$");
function ownersFigure(word) {
  if (/^\d+$/.test(word)) return parseInt(word, 10);
  const w = word.toLowerCase();
  for (const [k, v] of Object.entries(NUM_WORDS)) if (w.startsWith(k)) return v;
  return null;
}

/* ---- severity ---- */
const ACCIDENT_WORD = rx("<Bдтп|авар\\w*|<Baccident|<Bcollision|<Bcrash|<Bудар\\w*|<Bimpact|<Bпошкодж\\w*|<Bповрежд\\w*|<Bdamage");
const SEV_HEAVY = rx("серйозн\\w*|серьезн\\w*|серьёзн\\w*|<Bважк\\w*|<Bтяжел\\w*|<Bтяжк\\w*|<Bheavy|<Bsevere|<Bserious|<Bmajor|сильн\\w+ (?:удар|ДТП|авар)|структурн\\w*|несуч\\w*|несущ\\w*|<Bstructural");
const SEV_LIGHT = rx("<Bлегк\\w*|<Bлёгк\\w*|незначн\\w*|<Bminor|<Blight<B|<Bcosmetic|косметичн\\w*|дрібн\\w*|мелк\\w*|<Bsmall<B");

/* ---- critical problems not present in the input ---- */
const CRITICAL_TERMS = {
  flood: rx("затоп\\w*|<Bутоп\\w*|<Bпотоп\\w*|<Bflood\\w*|hydrolock|гідроудар\\w*|гидроудар\\w*|water damage|water-damaged|<Bsubmerged"),
  fire: rx("пожеж\\w*|пожар\\w*|<Bзгорі\\w*|<Bсгоре\\w*|<Bгоріл\\w*|<Bгорел\\w*|<Bfire<B|fire damage|<Bburn\\w*"),
  theft: rx("викраден\\w*|<Bугон\\w*|<Bугнан\\w*|<Bstolen|<Btheft"),
  salvage: rx("<Bтотал\\w*|total loss|<Bsalvage|<Bсписан\\w*|<Bутиліз\\w*|<Bутилиз\\w*|не підлягає відновленню|не подлежит восстановлению|<Bwritten off|write-off"),
  taxi: rx("<Bтаксі|<Bтакси|<Btaxi|<Buber|<Bbolt<B|каршер\\w*|<Bcarshar\\w*|<Bride-?hail\\w*"),
};
/* the frozen input as one lowercase string: keys and values, so a boolean
   fact such as accidents.events[].fire = true counts as present */
export function inputText(context) { return JSON.stringify(context || {}).toLowerCase(); }

function sentencesOf(text) {
  return String(text || '').split(/\n\s*\n/).flatMap(p => splitSentences(p));
}

/* text: { headline, body, checks? }. checks are the check lines the
   conclusion returned (fc-v2.5) that production would merge into the final
   checklist; they get the same gate as checklist items and the same claim
   checks as the text. Every violation carries where: text | checks.
   Returns { version, violations, gate, directive, counts, total }.
   `directiveHits` is the caller's detector of "buy / do not buy" phrasing
   (api/check.js directiveVerdictHits); null skips that check */
export function conclusionInvariantChecks({ text, report, context, directiveHits = null } = {}) {
  const out = { version: CHECKS_VERSION, violations: [], gate: null, directive: [], counts: {}, total: 0 };
  if (!isObj(text) || typeof text.body !== 'string' || !text.body.trim()) return out;
  const fc = { headline: typeof text.headline === 'string' ? text.headline : '', body: text.body };
  const checkLines = arr(text.checks).filter(c => typeof c === 'string' && c.trim());
  const ctx = isObj(context) ? context : {};

  /* 1. the production consistency gate, read-only here */
  try {
    const facts = canonicalFacts(report);
    const g = gateFinalConclusion(fc, facts);
    out.gate = { hidden: !!g.hidden, reason: g.reason || null, removed: g.removed || 0, total: g.total || 0 };
    for (const v of arr(g.violations)) out.violations.push({ check: 'gate', domain: v.domain, field: v.field, found: v.found, canonical: v.canonical, section: v.section || null, text: v.text || null, where: 'text' });
    /* checks: the production gate drops a merged checklist item that contradicts a canonical fact */
    for (const line of checkLines) {
      for (const sent of splitSentences(line)) {
        for (const v of sentenceViolations(sent, facts, { section: 'final_conclusion.checks' })) out.violations.push({ check: 'gate', domain: v.domain, field: v.field, found: v.found, canonical: v.canonical, section: v.section || null, text: sent.slice(0, 160), where: 'checks' });
      }
    }
  } catch (e) { out.gate = { error: String((e && e.message) || e).slice(0, 120) }; }

  const sentences = [...sentencesOf(fc.headline), ...sentencesOf(fc.body)].map(x => ({ s: x, where: 'text' }))
    .concat(checkLines.flatMap(line => splitSentences(line)).map(x => ({ s: x, where: 'checks' })));
  const inText = inputText(ctx);
  const score = isObj(ctx.calcar_score) ? num(ctx.calcar_score.value) : null;
  const confidence = isObj(ctx.confidence) ? num(ctx.confidence.percent) : null;
  const owners = isObj(ctx.ownership) ? num(ctx.ownership.owners_count) : null;
  const sevs = arr(isObj(ctx.accidents) ? ctx.accidents.events : []).map(e => isObj(e) ? e.severity : null).filter(Boolean);
  const allLight = sevs.length > 0 && sevs.every(s => s === 'light');
  const allHeavy = sevs.length > 0 && sevs.every(s => s === 'heavy');

  for (const item of sentences) {
    const s = item.s;
    const mark = out.violations.length;
    const reported = REPORTED.test(s);
    const hedged = HEDGED.test(s);
    const snip = s.slice(0, 160);

    /* 2. Score: a figure out of 10 must be the computed score */
    const seenScore = new Set();
    for (const re of [SCORE_RE, SCORE_WORD_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const v = parseFloat(String(m[1]).replace(',', '.'));
        if (!isFinite(v) || v > 10 || seenScore.has(v)) continue;
        seenScore.add(v);
        if (score === null) out.violations.push({ check: 'score', domain: 'score', found: String(v), canonical: 'unavailable', text: snip });
        else if (Math.abs(v - score) > 0.05) out.violations.push({ check: 'score', domain: 'score', found: String(v), canonical: String(score), text: snip });
      }
    }
    /* 3. Confidence: a percentage next to a completeness word must be the computed percent */
    if (confidence !== null && CONF_WORD.test(s) && !PRICE_WORD.test(s)) {
      PERCENT_RE.lastIndex = 0;
      let m;
      while ((m = PERCENT_RE.exec(s))) {
        const v = parseInt(m[1], 10);
        if (Math.abs(v - confidence) > 1) out.violations.push({ check: 'confidence', domain: 'confidence', found: String(v), canonical: String(confidence), text: snip });
      }
    }
    /* 4. Owners: a count stated as fact must come from the registry */
    if (!reported && !hedged) {
      OWNERS_RE.lastIndex = 0;
      let m;
      while ((m = OWNERS_RE.exec(s))) {
        if (negated(s, m.index) || OWNERS_TENURE.test(s.slice(Math.max(0, m.index - 12), m.index))) continue;
        const v = ownersFigure(m[1]);
        if (v === null) continue;
        if (owners === null) out.violations.push({ check: 'owners', domain: 'owners', found: String(v), canonical: 'unknown', text: snip });
        else if (v !== owners) out.violations.push({ check: 'owners', domain: 'owners', found: String(v), canonical: String(owners), text: snip });
        break;
      }
    }
    /* 5. Severity: only when every resolved event agrees */
    if (!reported && !hedged && ACCIDENT_WORD.test(s)) {
      if (allLight && SEV_HEAVY.test(s) && !SEV_LIGHT.test(s)) out.violations.push({ check: 'severity', domain: 'accident_severity', found: 'heavy', canonical: 'light', text: snip });
      if (allHeavy && SEV_LIGHT.test(s) && !SEV_HEAVY.test(s)) out.violations.push({ check: 'severity', domain: 'accident_severity', found: 'light', canonical: 'heavy', text: snip });
    }
    /* 6. Critical problems absent from the whole input */
    if (!reported && !hedged) {
      for (const [term, re] of Object.entries(CRITICAL_TERMS)) {
        const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
        const g = new RegExp(re.source, flags);
        let m;
        while ((m = g.exec(s))) {
          if (negated(s, m.index) || negatedAfter(s, m.index)) continue;
          if (!inText.includes(term) && !re.test(inText)) out.violations.push({ check: 'not_in_input', domain: term, found: m[0], canonical: 'absent_from_input', text: snip });
          break;
        }
      }
    }
    for (let i = mark; i < out.violations.length; i++) out.violations[i].where = item.where;
  }
  /* 7. directive wording, through the caller's detector */
  if (typeof directiveHits === 'function') {
    try { out.directive = arr(directiveHits({ headline: fc.headline, reasoning: fc.body })); } catch (e) { out.directive = []; }
  }
  for (const v of out.violations) out.counts[v.check] = (out.counts[v.check] || 0) + 1;
  if (out.directive.length) out.counts.directive = out.directive.length;
  out.total = out.violations.length + out.directive.length;
  return out;
}
