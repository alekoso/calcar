/* CalCar Check: Final Conclusion ("Висновок CalCar").
   Окремий фінальний synthesis-виклик ПІСЛЯ того, як звіт уже зібраний:
   Score, Confidence, ризики, історія, Vision, ринкова вартість, ліквідність.
   Модель отримує компактний контекст готових фактів (buildConclusionContext)
   і пише висновок з нуля: короткий headline і звʼязний текст абзацами.

   Чого тут немає за побудовою:
   - старий purchase_decision і verdict.summary у контекст НЕ йдуть (щоб
     новий текст не якорився на попередній висновок);
   - фото, пошук і повторний Vision: виклик лише текстовий;
   - особистий контекст людини (бюджет, памʼять, інші авто).

   Файл не є Vercel-функцією (default export відсутній): його імпортують
   api/check.js і benchmark-ендпоінт api/conclusion-bench.js. */

export const CONCLUSION_VERSION = 'fc-v2.3';
/* runaway-захист, не продуктовий таргет: довжину визначає складність авто */
export const CONCLUSION_LIMITS = { headline: 160, body: 7000, paragraphs: 8 };
export const CONCLUSION_TIMEOUT_MS = 150000;
/* менше цього запасу до ліміту функції фінальний виклик не стартує */
export const CONCLUSION_MIN_BUDGET_MS = 45000;

/* вимикач етапу: env FINAL_CONCLUSION=on | off перекриває типове значення.
   Вимкнений етап звіт не ламає: звіт лишається без блоку висновку */
export const CONCLUSION_DEFAULT_ON = true;
export function conclusionEnabled(env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const v = String(e.FINAL_CONCLUSION || '').toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return CONCLUSION_DEFAULT_ON;
}
/* модель і reasoning лише цього етапу; основний Check вони не зачіпають.
   A/B 2026-10-02 на 12 збережених звітах (gpt-5.6-terra medium, gpt-6-sol
   high, gpt-6.1-sol high і medium): gpt-6.1-sol найкраще звʼязує факти і
   знає особливості версій; high p50 53 с, medium 23 с при близькій якості,
   тому типово medium (рішення власника). Перемикання без коду: env
   CONCLUSION_MODEL і CONCLUSION_EFFORT */
export const CONCLUSION_MODEL_DEFAULT = 'gpt-6.1-sol';
export function conclusionModel(env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  return {
    model: e.CONCLUSION_MODEL || CONCLUSION_MODEL_DEFAULT,
    fallback_model: e.OPENAI_MODEL || 'gpt-5.6-terra',
    effort: e.CONCLUSION_EFFORT || 'medium',
  };
}

/* ---------- компактний контекст ---------- */
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

/* порожнє (null, '', [], {}) у контекст не йде: моделі нема чим фантазувати */
export function prune(v) {
  if (Array.isArray(v)) {
    const out = v.map(prune).filter(x => x !== undefined);
    return out.length ? out : undefined;
  }
  if (isObj(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) { const p = prune(x); if (p !== undefined) out[k] = p; }
    return Object.keys(out).length ? out : undefined;
  }
  if (v === null || v === undefined || v === '') return undefined;
  return v;
}

function mileagePoints(hf, mc) {
  const seen = new Set();
  const out = [];
  for (const p of [...arr(hf && hf.mileage_points), ...arr(mc && mc.historical_points)]) {
    if (!p || num(p.km) === null) continue;
    const key = p.km + '|' + String(p.date || '').slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ km: p.km, date: p.date ? String(p.date).slice(0, 10) : null, source: p.source || null });
  }
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).slice(-8);
}

function accidentEvents(report) {
  const sb = isObj(report.score_breakdown) ? report.score_breakdown : {};
  const shadow = isObj(report.score_breakdown_shadow) ? report.score_breakdown_shadow : {};
  const events = arr(sb.events).length ? arr(sb.events) : arr(shadow.events);
  return events.filter(isObj).map(e => ({
    /* вирішена кодом тяжкість: light | medium | heavy | unknown */
    severity: e.v4_category || e.severity || null,
    severity_basis: arr(e.category_basis).join(', ') || null,
    zones: arr(e.zone_classes).join(', ') || null,
    airbags_deployed: e.airbags === true ? true : null,
    airbags_parts: arr(e.airbags_visible_parts).join(', ') || null,
    fire: e.fire === true ? true : null,
    year: e.trusted_year || e.resolver_year || null,
    repair_status: e.repair_status || null,
    unrepaired_signs_now: e.unrepaired_signs === true ? true : null,
  }));
}

function confidenceBlock(c) {
  if (!isObj(c) || num(c.overall_internal) === null) return c && c.unavailable_reason ? { unavailable: c.unavailable_reason } : null;
  const domains = {};
  for (const [name, d] of Object.entries(isObj(c.domains) ? c.domains : {})) {
    if (!isObj(d)) continue;
    const inputs = arr(d.inputs).filter(isObj);
    domains[name] = {
      status: d.status || null,
      have: inputs.filter(i => i.state === 'verified').map(i => i.key),
      checked_and_empty: inputs.filter(i => i.state === 'checked_absent').map(i => i.key),
      missing: inputs.filter(i => i.state && i.state !== 'verified' && i.state !== 'checked_absent').map(i => i.key),
    };
  }
  return {
    level: c.text_key || null,
    percent: c.overall_internal,
    limited_by: arr(c.caps_applied).filter(x => x && x.binding).map(x => x.name),
    domains,
  };
}

function scoreBlock(report) {
  const sb = isObj(report.score_breakdown) ? report.score_breakdown : {};
  const value = report.verdict && num(report.verdict.score) !== null ? report.verdict.score
    : (sb.score_available !== false && num(sb.final) !== null ? sb.final : null);
  const inputs = isObj(sb.inputs) ? sb.inputs : {};
  return {
    value,
    unavailable_reason: value === null && isObj(report.score_breakdown) ? (sb.score_unavailable_reason || 'not_enough_data') : null,
    /* за що знято бали; сума штрафів пояснює, чому бал саме такий */
    penalties: arr(sb.items).filter(isObj).map(i => ({ what: i.label_key || i.key || null, points: num(i.amount) })),
    not_assessed: Object.entries(inputs).filter(([, v]) => isObj(v) && v.available === false).map(([k]) => k),
  };
}

function equipmentBlock(list) {
  const items = arr(list).filter(o => isObj(o) && typeof o.name === 'string');
  const label = o => o.name.slice(0, 80) + (o.retrofit ? ' (retrofit, not factory)' : '') + (o.confidence_level === 'seller' ? ' (seller claim only)' : '');
  const high = items.filter(o => o.value_tier === 'high_value');
  const notable = items.filter(o => o.value_tier === 'notable');
  return {
    total_confirmed_items: items.length || null,
    expensive_desirable: high.slice(0, 14).map(label),
    notable: notable.slice(0, Math.max(0, 14 - Math.min(14, high.length))).map(label),
  };
}

function currentConditionBlock(report, meta) {
  const cvs = isObj(meta.current_visual_shadow) ? meta.current_visual_shadow : {};
  const cv = isObj(cvs.current_visual) ? cvs.current_visual : {};
  const zones = isObj(cv.zones) ? cv.zones : {};
  const dash = isObj(cv.dashboard) ? cv.dashboard : {};
  /* лампи і повідомлення панелі: у контекст лише сам текст, без кадрів */
  const label = x => (typeof x === 'string' ? str(x, 120) : (isObj(x) ? str(x.text || x.name || x.label || x.sign, 160) : null));
  return {
    photo_findings: arr(report.photo_findings).filter(isObj).map(f => ({ status: f.status || null, text: str(f.text, 320) })),
    /* службові посилання на кадри в тексті Vision людині нічого не кажуть */
    visual_summary: str(typeof cv.summary === 'string' ? cv.summary.replace(/\s*\[gallery_index=\d+\]/g, '') : null, 700),
    photo_coverage_note: str(cv.coverage && cv.coverage.note, 300),
    photos_usable: num(cv.coverage && cv.coverage.frames_usable),
    zones_not_shown: Object.entries(zones).filter(([, z]) => isObj(z) && z.visibility === 'not_visible').map(([k]) => k),
    dashboard_warning_lights: arr(dash.warning_lights).map(label).filter(Boolean).slice(0, 6),
    dashboard_messages: arr(dash.readable_messages).map(label).filter(Boolean).slice(0, 4),
    body_wrap_present: report.body_wrap && report.body_wrap.present === true ? true : null,
    odometer_photo_vs_listing: cvs.odometer_vs_listing && cvs.odometer_vs_listing.status ? cvs.odometer_vs_listing.status : null,
  };
}

function priceBlock(report, meta) {
  const pc = isObj(meta.price_context) ? meta.price_context : {};
  const vc = isObj(meta.value_curve) ? meta.value_curve : {};
  const np = isObj(vc.new_price) ? vc.new_price : {};
  const ret = isObj(vc.retention) ? vc.retention : {};
  const mv = isObj(report.market_value) ? report.market_value : {};
  const exact = np.msrp && isObj(np.msrp.exact) ? np.msrp.exact : null;
  return {
    listing_price: num(meta.price) !== null ? { amount: meta.price, currency: meta.currency || null } : null,
    marketplace_average: num(pc.average_price) !== null ? {
      amount: pc.average_price, currency: pc.currency || null, source: pc.source_name || null,
      /* відʼємне: оголошення дешевше за середню площадки */
      listing_vs_average_percent: num(pc.delta_percent),
      caveat: 'the marketplace average is for the model and year as the marketplace groups them; it may mix different trims, engines and conditions',
    } : null,
    price_when_new: num(np.value) !== null ? {
      amount_usd: np.value,
      basis: np.basis || null,
      version: exact ? str(exact.version, 80) : null,
      is_estimate: np.basis === 'reverse_estimate' || np.basis === 'msrp_base_floor' ? true : null,
    } : null,
    value_retention: ret.state && ret.state !== 'unknown' ? { state: ret.state, kept_share_of_new_price: num(ret.observed_retention), typical_share_for_this_age: num(ret.expected_retention) } : null,
    forecast: isObj(vc.future) && num(vc.future.value) !== null ? { value_usd: vc.future.value, in_years: vc.future.years || null } : null,
    liquidity: isObj(mv.liquidity) ? { level: mv.liquidity.level || null, reasons: arr(mv.liquidity.reasons).map(x => str(x, 300)) } : null,
    why_this_price: isObj(mv.why_price) ? { value_loss: mv.why_price.value_loss || null, reasons: arr(mv.why_price.reasons).map(x => str(x, 300)) } : null,
  };
}

export function buildConclusionContext(report) {
  if (!isObj(report)) return null;
  const meta = isObj(report._meta) ? report._meta : {};
  const v = isObj(report.vehicle) ? report.vehicle : {};
  const sb = isObj(report.score_breakdown) ? report.score_breakdown : {};
  const hf = isObj(meta.history_facts) ? meta.history_facts : {};
  const mc = meta.decision_inputs && isObj(meta.decision_inputs.mileage_context) ? meta.decision_inputs.mileage_context : {};
  const hv = isObj(report.historical_visual) ? report.historical_visual : null;
  const auction = isObj(report.auction) ? report.auction : {};
  const owners = num(hf.owners_count) !== null ? hf.owners_count : (sb.vehicle_owners && num(sb.vehicle_owners.owners_count));
  const ctx = {
    vehicle: {
      title: str(v.title, 120), trim: str(v.trim, 80), year: v.year || null, generation: str(v.generation, 40),
      engine: str(v.engine, 120), transmission: str(v.transmission, 60), drive: str(v.drive, 40), fuel: v.fuel || null,
      age_years: num(sb.vehicle_age && sb.vehicle_age.age_years) !== null ? sb.vehicle_age.age_years : num(mc.age_years),
      listing_country: meta.country || null, marketplace: meta.domain || null,
    },
    calcar_score: scoreBlock(report),
    confidence: confidenceBlock(report.confidence),
    mileage: {
      current_km: num(meta.odometer_km) !== null ? meta.odometer_km : num(mc.current_km),
      km_per_year: num(mc.annual_km), typical_km_per_year_for_this_powertrain: num(mc.reference_km_year),
      /* very_low | low | normal | high | very_high відносно віку */
      usage_band: mc.band || null,
      known_points: mileagePoints(hf, mc),
      rollback_check: sb.inputs && sb.inputs.mileage_rollback ? sb.inputs.mileage_rollback.status : null,
      marketplace_mismatch_flag: hf.mileage_mismatch_flag === true ? true : null,
    },
    ownership: {
      owners_count: owners !== null && owners !== undefined ? owners : null,
      owner_change_dates: arr(hf.owner_events).filter(isObj).map(e => (e.ordinal ? '#' + e.ordinal + ' ' : '') + String(e.date || '').slice(0, 10)),
      imported_used: hf.imported_used === true ? true : null,
      registry_data_present: hf.registry_present === true ? true : (hf.registry_present === false ? false : null),
      past_listings_found: num(hf.past_listings),
    },
    history: {
      timeline: arr(report.history).filter(isObj).slice(0, 16).map(h => ({ date: h.date || null, event: str(h.event, 260), gap_before: h.gap || null })),
      note: str(report.history_note, 400),
      accident_recorded_officially: hf.accident_recorded === true ? true : null,
      accident_note: str(hf.accident_note, 300),
      insurance_case_recorded: hf.insurance_case_recorded === true ? true : null,
    },
    accidents: {
      events: accidentEvents(report),
      auction_record: auction.found === true ? {
        house: meta.auction_meta && meta.auction_meta.house || null,
        date: meta.auction_meta && meta.auction_meta.date || null,
        summary: str(auction.summary, 900),
        findings: arr(auction.findings).filter(isObj).slice(0, 8).map(f => ({ status: f.status || null, text: str(f.text, 300) })),
      } : null,
      archive_photos: hv ? {
        summary: str(hv.summary, 700),
        visible_severity: hv.visible_severity || null,
        damage_depth: hv.damage_depth || null,
        zones: arr(hv.visible_damage_zones).slice(0, 8),
        airbags: hv.srs_visual_status || null,
        possible_structural_damage: hv.possible_structural_damage === true ? true : null,
        structural_signs: hv.structural_visual_status || null,
      } : null,
    },
    current_condition: currentConditionBlock(report, meta),
    equipment: equipmentBlock(report.equipment_v2),
    seller: {
      description_text: str(meta.seller_text, 1800),
      claims: arr(report.seller_disclosures).filter(isObj).slice(0, 12).map(d => ({ about: d.unit || d.category || null, quote: str(d.quote, 220), says_no_problem: d.negated === true ? true : null, vague: d.vague === true ? true : null })),
    },
    discrepancies: arr(report.discrepancies).filter(isObj).slice(0, 8).map(d => ({ severity: d.severity || null, title: str(d.title, 200), detail: str(d.detail, 500) })),
    key_risks: arr(report.risks).filter(isObj).slice(0, 6).map(r => ({
      level: r.level || null,
      /* finding = факт цього авто; latent = дорогий вузол без підтвердження стану */
      kind: r.kind || null,
      title: str(r.title, 160), note: str(r.note, 420), check: str(r.action, 260),
    })),
    /* типові особливості саме цієї версії, зібрані Check з джерелами (MI і
       веб-дослідження). Порожньо = база ще не заповнена, а не "проблем нема" */
    model_knowledge_from_report: arr(report.model_notes && report.model_notes.issues).filter(isObj).slice(0, 10).map(i => ({
      unit: str(i.unit, 80), title: str(i.title, 160), detail: str(i.detail, 420), severity: i.severity || null,
      seller_says_already_serviced: i.seller_serviced === true ? true : null,
    })),
    price_and_market: priceBlock(report, meta),
    data_notes: str(report.data_notes, 500),
  };
  return prune(ctx) || {};
}

/* ---------- правила ---------- */
/* fc-v2.2 (approved 2026-10-03 after A/B on 12 saved reports): English internal
   rules; the output language comes from the report locale directive.
   fc-v2.3 (approved 2026-10-03 after bench A/B on BMW 530i, Giulia, RAV4): the
   powertrain step weighs a genuine well-established strength of the exact
   engine, transmission or battery the same way as a known weakness, so a
   well-regarded powertrain is not represented solely by its one weak point */
export const CONCLUSION_RULES = `You are CalCar's experienced automotive expert. In front of you is the FINISHED check report for one specific used car from a listing: every fact has already been collected, and the score and the completeness of the check have already been computed by code. You do not search for anything new and you do not recompute anything.

A person is thinking about buying this exact car and asks you, the way one asks a friend who knows cars: "What do I actually need to understand about this car before buying it?" Your answer is the "CalCar Conclusion".

The reader is an ordinary person, not a mechanic and not an analyst. They can already see the full report with all its sections next to your text. They do not need another reference sheet from you. They need one coherent opinion: what kind of purchase this is.

OUTPUT LANGUAGE
Write the headline and all paragraphs in the language given by the language directive in the user message. These rules are written in English only as internal instructions. The few sample phrases below illustrate tone and are not text to translate or reuse.

FORM AN OPINION FIRST, THEN WRITE
Before writing, answer three questions for yourself (do not print them):
1. What does the buyer GET with this exact car: why people buy this kind of car, and what is good about this particular one.
2. What do they PAY for it: cost of ownership, risk, harder resale, unknown past.
3. Which one or two things actually decide whether this is a good purchase.
The text is an expanded answer to these questions, not a tour of the report sections. If a fact changes none of the three answers, it does not belong in the conclusion.
4. Powertrain step (always do this before drafting, silently): look at the relevant powertrain of this exact vehicle. Combustion car: engine and transmission. Electric car: battery, drive units and the relevant drivetrain. Hybrid or plug-in hybrid: the engine, hybrid system, battery and transmission as applicable. For the components that are confidently identified, consider both sides: whether one has a well-established strength that genuinely matters for ownership, and whether one has a well-established weakness that materially affects this purchase. The rules for including either are in "Model, engine, gearbox, battery" below.
The questions are a way to think, not an outline. Do not force a fixed sequence such as benefit, then main question, then technical risk, then price. Let the dominant facts of this vehicle determine the order: a car defined by its accident may open with the accident, a car defined by its owner history with the owners, a clean simple car with what makes it an easy choice.

FORM
- "headline": one main human thought about this car, short and natural (aim for up to about 70 characters), no trailing period. It does not have to be a contrast. An automatic "X attracts with Y, but Z" pattern is forbidden as a default. A headline may simply describe the car well, name the one condition everything depends on, or characterise the purchase. It must grow out of this car's facts and be phrased freshly every time.
- "paragraphs": connected reasoning in paragraphs. Use 2 to 5 paragraphs, based only on how many independent ideas this specific vehicle actually needs. Do not target four paragraphs, and do not settle on the same count for every car: a simple, understandable car is often fully explained in 2 or 3; a complex case (ageing premium car, accident, tuning, tangled history) may need 4 or 5. Prefer the shortest text that fully explains the meaningful story of this car. This is not an article: as orientation, about 800-1300 characters for a simple car and up to about 1800-2000 for a complex one. Do not cut substance to be short, and do not stretch.
- Do NOT write one paragraph per report section or per category (photos, mileage, owners, engine, price...). A paragraph is built around a THOUGHT, and one thought naturally draws on facts from several sections. Do not force the sequence "what the car offers, then history, then technical risks, then price and resale".
- No lists, bullets, subheadings or labels. You choose the order of thoughts for this car.
- Do not end with a recap, and do not end with one more "just in case" caveat. When everything important has been said, stop. Avoid stock closing sentences. Do not force every conclusion to end with price or resale: let the dominant facts of this car determine the final sentence.

WHAT THE BUYER GETS
The conclusion explains not only risks but also what is good about owning this car. Depending on the car this may be comfort, a premium feel, status, driving character, a strong engine, handling, space and practicality, equipment, efficiency, a reputation for reliability, low running costs, easy resale, a rare or desirable version. Base this on the confirmed version and equipment in the context and on what is commonly known about the model.
Say it plainly, then say honestly what it costs in ownership and risk: this is what you get, and this is what you pay for it.
Do not invent positives for a car with a bad history just to balance the tone, and do not invent a scary "but" for a clean one. Balance comes from the facts, not from editorial symmetry. If the car is genuinely understandable and has no serious confirmed problems, say so directly, and then mention only the model or ownership considerations that really matter.

DO NOT CANCEL EVERY POSITIVE
The most visible flaw of a weak conclusion is that every good word is immediately neutralised by "but", "however", "at the same time".
- A positive statement may stand on its own, as its own sentence, with no caveat after it.
- If the car looks genuinely good in the photos, say so clearly. A well-preserved body and interior is a meaningful fact. Do NOT follow it with a reminder that photos cannot prove the condition of the engine, gearbox or suspension: the reader understands that photos show appearance. The limits of photos may be mentioned at most once per text, and only where it really changes the conclusion (for example, the zone of an old impact is not shown).
- Keep contrast for real turns of thought. As orientation: no more than two or three contrastive turns in the whole text.
- Use defensive negative constructions ("this is not proof that...", "by itself this does not mean...", "this does not replace...") sparingly: at most one or two per text, and only where the reader would otherwise misunderstand.

EVERY IDEA ONCE
Hard editorial rule: once an idea has been explained, do not return to it later in other words.
- expensive upkeep and expensive repairs: once, in one place;
- the accident: once, as a whole (what happened, how serious, what follows from it);
- mileage: once;
- "the seller's words need documents behind them": at most once per text;
- price: in one place.
Before answering, reread your draft: if two paragraphs say essentially the same thing about different components ("it is expensive, it should be checked"), merge them into one thought.

CONNECT FACTS AND EXPLAIN CONSEQUENCES
The reader sees separate facts in the report. Your value is in the connections and the consequences for the owner.
Weak: a row of facts, such as owner count, fuel consumption, price above average.
Strong: one thought that ties them together, such as: many owners make it harder to know how the car was maintained, and that matters more on a car whose major repairs are very expensive.
This shows a way of thinking, not wording to copy.

HOW TO READ THE FACTS (use only what matters for this car)
Mileage. Say it simply: low for its age, normal, high, very high (mileage.usage_band, km per year). If there is a meaningful mileage discrepancy, explain it in plain words. Historical points that support the mileage deserve one short remark of trust, not a paragraph.
Owners. One owner who genuinely covers most of the car's life is a strong positive. If "one owner" refers only to the period after import, do not present it as a positive for the car's whole life. Two or three owners over many years is normal and may not need a mention. Many owners is an important uncertainty, and 10 or more must not be ignored: the car changed hands many times, so it is harder to know how each owner maintained it. Short ownership periods and quick resales are also a signal. But many owners does not automatically mean a bad car. Never invent an unknown owner count.
Accidents. Severity is already resolved by code (accidents.events[].severity) and you must not be more dramatic than it. light: say plainly that it was a small accident and by itself does not look like a major problem; do not build a theme out of it. medium: the point is the quality of the repair. heavy: explain both the technical risk (geometry, structural members, safety systems) and the resale consequence: even a well-repaired car keeps a serious accident history, and some buyers will simply exclude it at the next sale. Deployed airbags are a safety matter, not a cosmetic one.
Model, engine, gearbox, battery. Model Intelligence is not required: an empty model_knowledge_from_report does not mean the version has no known weaknesses.
Before drafting, explicitly consider whether the exact resolved engine, transmission, battery or version has one well-established weakness that materially affects this purchase. Include it if ALL of the following are true:
- the exact vehicle, version and powertrain identity is sufficiently clear from the context;
- the weakness is widely established, not obscure or controversial;
- it is common enough or expensive enough to materially matter for ownership or for the pre-purchase inspection.
Usually mention at most one such weakness, exceptionally two. Prefer model knowledge already present in the report when available.
Do not invent a weakness just because this step exists. If no sufficiently certain material weakness comes to mind, omit model-specific risk entirely.
Strengths are weighed the same way. If the exact resolved engine, transmission, battery or drive unit has a genuinely well-established strength that matters for ownership (for example a reputation for durability, a simple proven design, or strong efficiency for its class), say so plainly in a clause or a sentence. This matters most when you also name its known weak point: a well-regarded powertrain must not be represented solely by its one weakness. Ground a strength exactly like a weakness: model knowledge already present in the report first, then only highly established general knowledge about this exact unit. Do not invent praise, do not hand every powertrain a compliment, and do not require both a strength and a weakness in every conclusion: if neither is material, say nothing about the powertrain. This step does not make the conclusion an engine and gearbox checklist and must not make it longer by more than a sentence.
Be concrete. The form is: for this engine, X is a known weak point, so before purchase it is worth checking Y. Do not replace a known specific risk with vague phrases such as "the V8 may be expensive to repair" or "complex components can require large expenses" when a materially useful exact weakness is confidently known.
Do not introduce service campaigns, TSBs, recall-like technical details or campaign numbers unless their applicability to the exact resolved engine/version/year is explicitly supported by the report context or MI. If applicability is uncertain, omit them.
Always distinguish a known weakness of this version from a confirmed defect of this exact vehicle. About this specimen, state only what is in the context facts. Carry the distinction in the wording itself ("is known for", "is a known weak point"), without separate disclaimer sentences such as "these are risks of the version, not established faults of this car".
Checks. Practical inspection advice is welcome when it is tied to the biggest risk of this car. Say what the check will show for this car; add why it pays for itself only when that is specific to this car, not as a generic remark that inspections are cheaper than repairs. This means one or two checks in the whole text, not a checklist: the full list of checks lives in another section of the report. Do not end every paragraph with advice to check something.
Price. Reason about it; do not just state a percentage. If the marketplace average is a useful enough comparison for this car, simply use it. Explain limitations of the marketplace average only when they materially change the interpretation of this vehicle's price, for example a top, rare or high-performance version compared against an average dominated by ordinary versions. Do not automatically mention that the average mixes versions, trims or conditions. Do not ignore a large difference: condition, version and history have to explain it. A clearly lower price also has an explanation in the history or condition. A small difference deserves one sentence or none. Do not invent market numbers.
Price has no fixed place. It may appear early, in the middle, combined with the accident or the history it explains, combined with resale, or without a paragraph of its own when it is not central to this car. It does not have to be the last paragraph.
Resale. Mention future resale only when something specific about THIS vehicle materially changes future demand: severe accident history, extreme mileage, many owners, a rare performance version, tuning, unusually expensive ownership, or another concrete reason. When you mention it, name that reason. Do not add a "narrow circle of buyers" remark as a routine ending, and do not mention resale at all for an ordinary car with nothing unusual. Never use the bare word "liquidity".
Fuel consumption. Mention it only when it materially matters for this exact car or version (for example a large supercharged V8). Do not mention it as generic ownership filler. The same applies to the generic remark that a low purchase price does not make upkeep cheap: say it only when it is a real point about this car, and at most once.
What we know and what we do not. Name uncertainty concretely: what part of the car's life is not visible and why that matters (for example, almost no history before import, so the current condition is visible but past maintenance is not). A rich history is a positive and is worth naming too. Do not repeat the check-completeness label and do not write filler such as "the conclusion is based on available data". Do not mention small gaps (no odometer photo, one side not shown) unless they change the picture.

SCORE AND COMPLETENESS
calcar_score is the quality and risk of this specimen based on confirmed data (0-10, higher is better). confidence is how completely it could be studied. A high score with a partial check means "what we saw looks good, but we did not see everything": the tone must not be more certain than the completeness allows. The conclusion must be compatible with the score; if the score is high and you see a serious problem, explain in one sentence why these are different things. Do not quote the score or the completeness percentage and do not explain how they are computed.

HONESTY AND LIMITS
- About this specimen, state only what is in the context. The seller's words are the seller's claims, not facts.
- Do not say "no faults found" where CalCar physically could not know (engine, gearbox, suspension, battery).
- Do not dramatise small things and do not downplay serious ones.
- The conclusion is not a "buy" or "do not buy" directive: no "take it", "do not take it", "look for another one", "worth buying". The person decides how to act. Assume nothing about the buyer: no budget, no family, no use case.

LANGUAGE AND STYLE (applies in the output language)
Write like an experienced friend who knows cars: simple phrases, living words, short sentences. First person is fine occasionally, where it is natural.
Good tone: "The mileage is high for a nine-year-old car." "For this engine it is especially important to check X." "If a serious engine or air suspension repair is needed here, the bill can be very large."
Bad tone: "the mileage does not appear anomalous for the age"; "the engine condition is not confirmed by independent diagnostics"; "high cost of error on major units"; "no signs of malfunction detected"; "based on the totality of available data"; "requires attention" with no explanation; "it should be noted".
Avoid generic editorial bridge phrases. If a sentence could be inserted unchanged into many different car conclusions, rewrite it around a concrete fact of this specific vehicle. This applies to announcing sentences (naming "the main question", "the decisive issue", "what matters most here"), to generic openers about what this kind of car gives its buyer, to generic statements that an inspection costs less than a repair, and to generic closers about future buyers or about documents being useful later. A paragraph may start directly from the relevant fact, with no announcement before it.
FORBIDDEN in the output: internal terms and context field names such as SRS, structural, coverage, cap, band, usage_band, latent, finding, confidence, retention, weak_history, registry, source families. Use plain human words instead (airbags, structural parts of the body, history before import).
Factory engine and gearbox codes mean nothing to the reader: name the unit in plain words (for example, a 5.5-litre biturbo V8).
Do not list options: name the two or three that matter most, and only if they explain what the buyer gets or pays for. Do not present retrofits as factory equipment.
Use numbers rarely and rounded, only when they help understanding. Do not mention VINs, links, photo numbers or technical identifiers.
The em dash character is forbidden in the output, and so are sentence structures that normally require it. Do not write a noun phrase followed by a pause and its explanation ("The main issue here [dash] the repaired body", "75 thousand km [dash] low mileage for its age"). Such a sentence becomes ungrammatical when the dash is replaced by a comma. Rewrite it with a normal verb, a colon, or as a separate sentence ("The repaired body matters most here", "75 thousand km is low mileage for its age"). This applies to the headline too.

RESPONSE: JSON only, by the schema: {"headline": string, "paragraphs": [string, ...]}.`;

export function conclusionResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'calcar_final_conclusion', strict: true,
      schema: {
        type: 'object', additionalProperties: false, required: ['headline', 'paragraphs'],
        properties: {
          headline: { type: 'string' },
          paragraphs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  };
}

export function conclusionUserMessage({ langDirective, context }) {
  return (langDirective ? langDirective + ' Це стосується headline і всіх абзаців.\n\n' : '')
    + 'ГОТОВИЙ ЗВІТ ЦЬОГО АВТО (факти, зібрані і пораховані CalCar; назви полів службові, у текст їх не перенось):\n'
    + JSON.stringify(context);
}

/* ---------- валідація відповіді ---------- */
const DASH_RE = new RegExp('\\s*' + String.fromCharCode(0x2014) + '\\s*', 'g');
const tidy = s => String(s).replace(DASH_RE, ', ').replace(/[ \t]+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();

/* обрізання лише як runaway-захист і лише по межі речення чи слова */
export function cutAtBoundary(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sent = head.match(/^[\s\S]*[.!?…]["»)]?(?=\s|$)/);
  if (sent && sent[0].length >= max * 0.5) return sent[0].trim();
  const sp = head.lastIndexOf(' ');
  return (sp > 0 ? head.slice(0, sp) : head).replace(/[,;:\s]+$/, '').trim();
}

export function sanitizeConclusion(raw) {
  if (!isObj(raw)) return null;
  let headline = typeof raw.headline === 'string' ? tidy(raw.headline.replace(/\s+/g, ' ')) : '';
  headline = cutAtBoundary(headline, CONCLUSION_LIMITS.headline).replace(/\.$/, '');
  const src = Array.isArray(raw.paragraphs) ? raw.paragraphs
    : (typeof raw.body === 'string' ? raw.body.split(/\n\s*\n/) : []);
  const paras = [];
  let total = 0;
  for (const p of src) {
    if (typeof p !== 'string') continue;
    /* абзац усередині абзацу лишається абзацом; маркери списків знімаються */
    for (const part of p.split(/\n\s*\n/)) {
      const t = tidy(part.replace(/\n+/g, ' ').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
      if (!t) continue;
      if (paras.length >= CONCLUSION_LIMITS.paragraphs || total + t.length > CONCLUSION_LIMITS.body) {
        /* ліміт: цілий абзац відкидається, речення посередині не ріжеться */
        if (!paras.length) paras.push(cutAtBoundary(t, CONCLUSION_LIMITS.body));
        return headline && paras.length ? { headline, body: paras.join('\n\n'), truncated: true } : null;
      }
      paras.push(t);
      total += t.length;
    }
  }
  if (!headline || !paras.length) return null;
  return { headline, body: paras.join('\n\n') };
}

/* ---------- виклик ---------- */
function usageOf(data, body) {
  const u = data && isObj(data.usage) ? data.usage : null;
  const out = { model: (data && data.model) || body.model, reasoning_effort: body.reasoning_effort || null };
  if (u) {
    if (typeof u.prompt_tokens === 'number') out.input_tokens = u.prompt_tokens;
    if (typeof u.completion_tokens === 'number') out.output_tokens = u.completion_tokens;
    if (u.prompt_tokens_details && typeof u.prompt_tokens_details.cached_tokens === 'number') out.cached_tokens = u.prompt_tokens_details.cached_tokens;
    if (u.completion_tokens_details && typeof u.completion_tokens_details.reasoning_tokens === 'number') out.reasoning_tokens = u.completion_tokens_details.reasoning_tokens;
  }
  return out;
}

const logLine = o => console.log('[final-conclusion]', JSON.stringify(o));

/* Повертає { status, conclusion, ms, ai, attempts, reason }. Ніколи не кидає:
   збій фінального висновку звіт не ламає, звіт лишається без висновку. callModel(body, timeoutMs, signal) це той самий транспорт,
   що й в інших викликах Check */
export async function runFinalConclusion({ report, langDirective = '', callModel, timeoutMs = CONCLUSION_TIMEOUT_MS, model = null, effort = null, env = null, signal = null } = {}) {
  const t0 = Date.now();
  const cfg = conclusionModel(env);
  const primary = model || cfg.model;
  const eff = effort || cfg.effort;
  const out = { status: 'skipped', conclusion: null, ms: 0, ai: null, attempts: [], reason: null, version: CONCLUSION_VERSION, context_chars: 0 };
  if (!conclusionEnabled(env)) { out.reason = 'disabled'; return out; }
  if (typeof callModel !== 'function') { out.reason = 'no_transport'; return out; }
  let context;
  try { context = buildConclusionContext(report); } catch (e) { context = null; }
  if (!context || !context.vehicle) { out.reason = 'no_context'; return out; }
  const user = conclusionUserMessage({ langDirective, context });
  out.context_chars = user.length;
  const bodyFor = (m, withEffort) => {
    const b = {
      model: m, max_completion_tokens: 12000,
      response_format: conclusionResponseFormat(),
      messages: [{ role: 'system', content: CONCLUSION_RULES }, { role: 'user', content: user }],
    };
    if (withEffort && eff && eff !== 'off') b.reasoning_effort = eff;
    return b;
  };
  /* сходинки: сильна модель з reasoning; та сама без параметра reasoning
     (якщо endpoint його не приймає); модель основного Check */
  const plan = [[primary, true]];
  if (cfg.fallback_model && cfg.fallback_model !== primary) plan.push([cfg.fallback_model, true]);
  for (let i = 0; i < plan.length; i++) {
    let [m, withEffort] = plan[i];
    const left = timeoutMs - (Date.now() - t0);
    if (left < 15000) { out.reason = out.reason || 'timeout'; break; }
    for (let pass = 0; pass < 2; pass++) {
      const body = bodyFor(m, withEffort);
      const tA = Date.now();
      let data = null, err = null;
      try { data = await callModel(body, Math.max(15000, timeoutMs - (Date.now() - t0)), signal); }
      catch (e) { err = e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e).slice(0, 160); }
      const apiErr = data && data.error ? String(data.error.message || data.error.code || 'api_error').slice(0, 200) : null;
      let clean = null;
      if (!err && !apiErr) {
        try { clean = sanitizeConclusion(JSON.parse(String(data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim())); } catch (e) { clean = null; }
      }
      out.attempts.push({ model: m, effort: withEffort ? eff : null, ms: Date.now() - tA, ok: !!clean, error: err || apiErr || (clean ? null : 'invalid_output') });
      if (clean) {
        out.status = 'ok'; out.conclusion = clean; out.ai = usageOf(data, body); out.ms = Date.now() - t0; out.reason = null;
        return out;
      }
      out.reason = err || apiErr || 'invalid_output';
      /* параметр reasoning не прийнято: одна повторна спроба без нього */
      if (pass === 0 && withEffort && apiErr && /reasoning_effort|unsupported|unrecognized|unknown parameter/i.test(apiErr)) { withEffort = false; continue; }
      break;
    }
  }
  out.status = 'error'; out.ms = Date.now() - t0;
  logLine({ op: 'run', status: 'error', reason: out.reason, attempts: out.attempts });
  return out;
}
