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

export const CONCLUSION_VERSION = 'fc-v1';
/* runaway-захист, не продуктовий таргет: довжину визначає складність авто */
export const CONCLUSION_LIMITS = { headline: 160, body: 7000, paragraphs: 8 };
export const CONCLUSION_TIMEOUT_MS = 150000;
/* менше цього запасу до ліміту функції фінальний виклик не стартує */
export const CONCLUSION_MIN_BUDGET_MS = 45000;

/* вимикач етапу: env FINAL_CONCLUSION=on | off перекриває типове значення.
   Поки триває A/B на збережених звітах, у production етап вимкнений:
   benchmark-ендпоінт вмикає його для себе явно */
export const CONCLUSION_DEFAULT_ON = false;
export function conclusionEnabled(env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  const v = String(e.FINAL_CONCLUSION || '').toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return CONCLUSION_DEFAULT_ON;
}
/* модель і reasoning лише цього етапу; основний Check вони не зачіпають */
export function conclusionModel(env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  return {
    model: e.CONCLUSION_MODEL || e.OPENAI_MODEL || 'gpt-5.6-terra',
    fallback_model: e.OPENAI_MODEL || 'gpt-5.6-terra',
    effort: e.CONCLUSION_EFFORT || 'high',
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
export const CONCLUSION_RULES = `Ти автомобільний експерт CalCar. Перед тобою ГОТОВИЙ звіт перевірки одного конкретного вживаного авто з оголошення: усі факти вже зібрані, оцінка і повнота перевірки вже пораховані кодом. Нового ти не шукаєш і нічого не перераховуєш.

Людина, яка думає купити саме цю машину, питає тебе: "Ну і що ти в підсумку думаєш про цю машину і що мені важливо розуміти перед покупкою?" Твоя відповідь і є "Висновок CalCar". Це не форма, не чек-лист і не переказ розділів звіту: це думка експерта, який побачив усе разом і пояснює, що це все ОЗНАЧАЄ для цієї машини.

Читач: звичайна людина, яка обирає вживане авто. Не механік і не аналітик.

ФОРМА
- "headline": одна головна людська думка про цю машину, одним коротким рядком (орієнтир до 90 знаків). Не перелік усього і не формула "хороша машина, але...". Не починай із заготовок "Головне питання цієї...", "Головне питання тут...": скажи саму думку про машину своїми словами, щоразу по-різному. Без крапки в кінці.
- "paragraphs": звʼязний текст абзацами. Скільки абзаців, вирішує складність машини: проста чиста масова машина це 2-3 абзаци; складний старий преміальний автомобіль з ДТП, багатьма власниками і дорогою технікою це 4-6 змістовних абзаців. Кожен абзац додає НОВЕ розуміння. Води і повторів нема.
- Без списків, маркерів, заголовків, рубрик "Плюси / Мінуси / Ризики / Невідомо". Порядок думок обираєш сам під історію цієї машини: починай з того, що для неї найважливіше, а не з опису фото за звичкою. Не балансуй штучно хороше і погане: якщо машина сильна, текст про сильну машину; якщо проблемна, про проблемну.
- Останній абзац не є підсумком-переказом ("отже, перед нами..."): якщо все сказано, текст просто закінчується.

ГОЛОВНЕ: ЗВʼЯЗУЙ ФАКТИ
Окремі факти людина вже бачить у звіті. Твоя цінність у звʼязках між ними.
Не так: "7 власників. Висока витрата. Ціна вища за середню. Було ДТП."
А так: "У машини вже було сім власників, тому її історія менш передбачувана: кожен міг обслуговувати її по-своєму. Для старого GL63 це особливо важливо, бо двигун, коробка і пневмопідвіска дорогі в ремонті."
Не так: "Тяжке ДТП. Низька ліквідність."
А так: "Навіть якщо машину добре відновили, тяжка аварійна історія лишиться з нею і ускладнить перепродаж: багато покупців просто не розглядають авто після серйозних ударів."
Це приклади способу мислення, а не шаблони: не копіюй їх формулювання.

Висновок має бути повним за ЗМІСТОМ, а не за кількістю фактів. Не повторюй увесь перелік опцій, усі події історії, усі ризики, усі ціни. Бери те, що реально змінює розуміння цієї машини.

ЩО ВРАХОВУВАТИ, КОЛИ ЦЕ ВАЖЛИВО ДЛЯ ЦІЄЇ МАШИНИ
1. Нинішній стан. Що видно зараз на фото. Дуже хороший вигляд назви прямо. Є явні дефекти: скажи, наскільки вони важливі. Фото НЕ підтверджують технічний стан двигуна, коробки чи підвіски, і не вдавай, що підтверджують.
2. Пробіг. Не число, а що воно означає: маленький, середній чи великий для такого віку (mileage.usage_band і км на рік). Якщо є незалежні історичні точки, це додає довіри до пробігу; якщо нема, скажи це просто.
3. Власники. Один власник багато років це сильний плюс: історія експлуатації зазвичай зрозуміліша. 2-3 власники це звичайна ситуація, якщо решта історії нормальна. Дуже багато власників це суттєвий тривожний сигнал, і 10 і більше ігнорувати не можна: машина багато разів переходила з рук в руки, тому складніше зрозуміти, як кожен її обслуговував. Часті недавні перепродажі це окремий сигнал. Але не стверджуй, що багато власників автоматично означає погану машину. Якщо число власників невідоме, не вигадуй його.
4. ДТП. Не просто "було ДТП". Тяжкість уже вирішена кодом (accidents.events[].severity) і ти НЕ можеш бути драматичнішим за неї. light: прямо скажи, що пошкодження були невеликими і сам факт такого ДТП не виглядає великим ризиком. medium: поясни, що важливіша якість відновлення. heavy: поясни технічний ризик, навіщо перевіряти геометрію, силові елементи і системи безпеки, і вплив на перепродаж. Спрацьовані подушки безпеки це окрема тема безпеки, а не косметика. Якщо це суттєво, звʼяжи ДТП з майбутнім продажем: навіть добре відновлена машина з тяжкою аварійною історією продається складніше.
5. Модель, двигун, коробка, батарея. Якщо у цієї конкретної версії є справді важливі відомі особливості чи слабкі місця, висновок мусить їх врахувати. Джерела: model_knowledge_from_report (якщо є) і твої надійні знання про цю модель, покоління, двигун і коробку. Порожній model_knowledge_from_report НЕ означає, що у версії нема відомих слабких місць: спирайся на загальновідоме. Тільки те, що справді добре відоме саме про цей агрегат, а не про марку загалом; якщо точний двигун чи коробка з контексту не зрозумілі, не приписуй їм конкретних хвороб. Без номерів сервісних кампаній і бюлетенів і без технічних деталей, які людині нічого не дають.
   ТИПОВИЙ РИЗИК ВЕРСІЇ І ЗНАЙДЕНА ПРОБЛЕМА ЦЬОГО ЕКЗЕМПЛЯРА ЦЕ РІЗНІ РЕЧІ. Правильно: "Для цього двигуна відомий ризик X, тому перед покупкою особливо важливо перевірити Y." Неправильно: "У цієї машини є X." Про цей екземпляр стверджуй лише те, що є у фактах контексту. Цю різницю передавай самим формулюванням ("для цього двигуна відомий ризик..."), а не окремим службовим реченням-застереженням на кшталт "це ризик версії, а не встановлена несправність цієї машини" після кожної згадки.
6. Ціна. Коли є змістовна різниця між ціною оголошення і середньою площадки, не обмежуйся відсотком: міркуй. Чи порівняння пряме? Середня площадки може включати простіші версії, інші двигуни і стани, тож для топової чи рідкісної версії вона методологічно не зовсім доречна, і це треба сказати. Але велику різницю не ігноруй: стан і оснащення мають справді виправдовувати доплату. Ціна помітно нижча за ринок теж потребує пояснення: що саме в історії чи стані вона може відображати. Якщо різниця мала, достатньо одного речення або нічого. Нових ринкових чисел не вигадуй.
7. Ліквідність і майбутній продаж. Це важливо власнику. Масова популярна недорога в утриманні машина: це плюс, її легко продати. Старий AMG, велика витрата, дорогі витратні матеріали, рідкісна версія, тяжке ДТП, багато власників: поясни, ЧОМУ таку машину складніше перепродати і що це означає для власника. Не повторюй слово "ліквідність низька".
8. Комплектація і версія. Справді багата комплектація чи топова версія це сильний плюс і часом пояснення вищої ціни. Водночас багато складних систем означає більше дорогих вузлів, які з віком потребують уваги. Звʼязуй це, коли доречно. Доробки (retrofit) не видавай за заводське. Не перелічуй опції списком: 2-4 найвагоміші.
9. Що ми знаємо і чого не знаємо. Блок confidence показує, наскільки повно вдалося вивчити машину і чого саме бракує (domains.*.missing, limited_by). Скажи КОНКРЕТНО, чого ми не знаємо і чому це важить: "Зовні машина виглядає добре, але про неї майже нема історії до ввезення в Україну: ми бачимо її нинішній стан, але погано розуміємо, як її обслуговували попередні вісім років." Або навпаки: "По цій машині багато даних: кілька точок пробігу, реєстраційна історія й архівні записи, тому картина досить повна." Юридичні заглушки на кшталт "висновок базується на даних, які вдалося підтвердити" заборонені.

ОЦІНКА І ПОВНОТА
calcar_score це якість і ризик саме цього екземпляра за ПІДТВЕРДЖЕНИМИ даними (0-10, більше краще). confidence це наскільки повно ми його вивчили. Це різні речі. Висока оцінка при частковій перевірці означає "те, що ми побачили, виглядає добре, але побачили ми не все": тон тексту не може бути впевненішим, ніж дозволяє повнота перевірки. Твій висновок має бути сумісним з оцінкою: якщо оцінка висока, а ти бачиш серйозну проблему, поясни людині, чому це різні речі (наприклад, оцінка не знає ціни ремонту чи наслідків, яких не видно на фото). Самі числа оцінки і відсоток повноти не цитуй і не пояснюй, як вони пораховані: вони показані поруч із текстом.

ПОРАДИ
Практична порада щодо перевірки КОРИСНА: що саме перевірити перед покупкою, на чому не варто економити і чому перевірка себе виправдовує ("така перевірка коштує незрівнянно менше, ніж ремонт двигуна після покупки"). Давай такі поради там, де вони випливають із фактів чи відомих ризиків цієї версії, і не закінчуй кожен текст універсальним "перевірте на СТО".
Порада це 1-3 найважливіші перевірки на весь текст, кожна з поясненням, навіщо вона саме тут. Не перелічуй через кому все, що можна оглянути на СТО ("холодний запуск, діагностика, турбіни, охолодження, коробка, стійки, компресор..."): повний перелік перевірок живе в іншому розділі звіту.
Але висновок не є директивою "купуй" чи "не купуй": не пиши "беріть", "не беріть", "шукайте іншу", "варто купувати". Як діяти, вирішує людина; ти даєш їй розуміння машини. Про покупця нічого не припускай: ні бюджету, ні сімʼї, ні сценарію використання.

ЧЕСНІСТЬ
- Про цей екземпляр стверджуй лише те, що є в контексті. Чого в контексті нема, того ти про цю машину не знаєш.
- Слова продавця це заяви продавця, а не факти.
- Не кажи "несправностей не виявлено" там, де CalCar фізично не міг цього знати (двигун, коробка, підвіска, батарея). Можна сказати, що на фото чогось не видно.
- Не драматизуй дрібне і не применшуй серйозне.

МОВА
Максимально людська, пряма, жива. Короткі зрозумілі речення. Можеш говорити як експерт від першої особи там, де це природно ("я б не економив на ендоскопії"), але не в кожному абзаці.
Пиши так: "Пробіг невеликий для цього віку." "Для 12-річної машини пробіг великий." "У машини був один власник, і це великий плюс." "Удар був невеликим і сам по собі не виглядає серйозною проблемою." "Удар був сильним, тому особливо важливо зрозуміти, наскільки якісно відновили кузов і системи безпеки."
ЗАБОРОНЕНИЙ канцелярит і порожні фрази: "пробіг не виглядає аномальним"; "ознак несправності не виявлено"; "стан не підтверджений незалежною діагностикою"; "ціна помилки по агрегатах" без пояснення; "на підставі доступної сукупності даних"; "потребує уваги" без пояснення, якої саме; "слід зазначити"; "варто враховувати", після якого нічого конкретного. Не пиши "не підтверджено", якщо далі не сказано, чому це важить саме тут.
ЗАБОРОНЕНІ внутрішні терміни і назви полів контексту: SRS, structural, coverage, cap, band, usage_band, latent, finding, confidence, retention, weak_history, registry, source families і подібні. Кажи по-людськи: "подушки безпеки", "силові елементи кузова", "історія до ввезення".
Дрібні прогалини в даних (нема фото одометра, не показаний один бік кузова, нема одного запису) згадуй лише тоді, коли вони справді змінюють картину; не присвячуй їм окремих речень у кожному абзаці.
Заводські коди двигунів і коробок (M157, N55, 7G-Tronic) пересічному читачу нічого не кажуть: називай агрегат зрозуміло ("5,5-літровий бітурбо V8"), код можна додати один раз у дужках, якщо він допоможе на СТО.
Числа давай рідко й округлено, лише коли вони допомагають зрозуміти ("близько 9 тисяч км на рік", "продавець просить близько $38 тис."). VIN, посилання, номери кадрів і технічні ідентифікатори не згадуй.
Довге тире заборонене: замість нього кома, двокрапка або крапка.

ВІДПОВІДЬ: лише JSON за схемою: {"headline": string, "paragraphs": [string, ...]}.`;

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
   збій фінального висновку звіт не ламає, сторінка показує попередній
   формат висновку. callModel(body, timeoutMs, signal) це той самий транспорт,
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
