/* CalCar Check: структурна схема відповіді основного виклику (OpenAI
   response_format json_schema, strict). Це ЄДИНИЙ контракт вихідних полів:
   усі ключі обовʼязкові, enum-значення точні, невідоме = null там, де це
   дозволено. Семантика полів живе в description; змістовні правила
   (докази, чесність, комплектація, score_facts) лишаються у системному
   промпті. Модель НЕ повертає числовий бал: verdict.score ставить код зі
   Score v3 (score_breakdown.final). historical_visual: null, коли
   канонічний розбір уже є (код підставляє його), інакше повний обʼєкт. */

const S = (type, description, extra = {}) => ({ type, ...(description ? { description } : {}), ...extra });
const NS = (description, extra = {}) => ({ type: ['string', 'null'], ...(description ? { description } : {}), ...extra });
const E = (values, description) => ({ type: 'string', enum: values, ...(description ? { description } : {}) });
const NE = (values, description) => ({ type: ['string', 'null'], enum: [...values, null], ...(description ? { description } : {}) });
const OBJ = (properties, description) => ({ type: 'object', ...(description ? { description } : {}), properties, required: Object.keys(properties), additionalProperties: false });
const ARR = (items, description) => ({ type: 'array', ...(description ? { description } : {}), items });

export const SCORE_FACT_TYPES = ['STRUCTURAL_DAMAGE', 'AIRBAGS_DEPLOYED', 'SRS_FAULT', 'FLOOD', 'FIRE', 'ODOMETER_ROLLBACK', 'VIN_IDENTITY_PROBLEM',
  'SERIOUS_POWERTRAIN_FAULT', 'POOR_REPAIR_VISIBLE', 'CRITICAL_WARNING_LIGHTS', 'MILEAGE_CONFLICT_UNEXPLAINED', 'MAJOR_REPAIR_UNVERIFIED', 'MODIFICATION_TECHNICAL_CONCERN'];

export const HISTORICAL_VISUAL_OBJECT = OBJ({
  visible_damage_zones: ARR(S('string'), 'зони з ВИДИМИМ пошкодженням'),
  visible_severity: E(['minor', 'moderate', 'severe', 'indeterminate']),
  damage_depth: E(['exterior_panels_only', 'inner_structure_or_module', 'load_bearing_structure', 'cabin_intrusion', 'indeterminate']),
  inner_component_damage_extent: E(['none', 'localized', 'substantial', 'indeterminate']),
  outer_panel_damage_extent: E(['none', 'single_panel', 'multiple_panels', 'indeterminate']),
  fascia_status: E(['intact_mounted', 'damaged_but_mounted', 'detached_or_missing', 'not_visible']),
  inner_components_exposed: S('boolean'),
  inner_component_deformation_visible: E(['visible', 'not_visible', 'indeterminate']),
  load_bearing_structure_deformation_visible: S('boolean'),
  cabin_intrusion_visible: S('boolean'),
  wheel_displacement_visible: S('boolean'),
  cosmetic_only: S('boolean'),
  possible_structural_damage: S('boolean'),
  damage_side: E(['left', 'right', 'both', 'center', 'unknown']),
  side_confidence: E(['high', 'medium', 'low']),
  structural_visual_status: E(['no_obvious_severe_signs', 'possible', 'visible_damage', 'indeterminate']),
  srs_visual_status: E(['deployed_visible', 'no_deployment_visible', 'not_visible', 'indeterminate']),
  airbags_visible_parts: ARR(E(['driver', 'passenger', 'curtain', 'knee', 'seat'])),
  signal_evidence: ARR(OBJ({ signal: S('string'), frame: S('string', 'auction_photo_N'), sign: S('string', 'конкретна видима ознака') })),
  summary: S('string', '2-3 речення: що реально видно і що лишається невідомим'),
  evidence: ARR(OBJ({ source: S('string', 'us_auction'), ref: S('string', 'auction_photo_N'), description: S('string') })),
}, 'історичний візуальний аналіз архівних кадрів');

const EVIDENCE_EQ = OBJ({
  source: E(['vehicle_data', 'current_photos', 'seller_claim', 'listing_data', 'historical']),
  ref: NS('photo_7 чи vin_decode чи назва історичного джерела'),
  sign: NS('конкретна ознака на кадрі чи коротка цитата джерела'),
});
const EVIDENCE_SF = OBJ({
  source: E(['seller_claim', 'current_photos', 'historical_listing', 'us_auction', 'registry', 'document']),
  ref: NS('конкретний запис: listing_3, photo_7, auction_event_1, auction_metadata'),
  description: S('string', 'коротке доказове речення'),
});

export function buildMainSchema({ hvProvided = false } = {}) {
  const schema = OBJ({
    vehicle: OBJ({
      title: S('string', 'Марка Модель Рік'),
      year: S(['integer', 'null']),
      model_year: S(['integer', 'null'], 'рік за VIN, ЛИШЕ якщо надійно відомий і відрізняється від year, інакше null'),
      fuel: NE(['petrol', 'diesel', 'hybrid', 'electric']),
      engine: NS('"4.4 л бензин V8, 462 к.с." або "електро, 77 кВт·год"; невідоме = null, без речень про невідомість'),
      transmission: NS(),
      drive: NS(),
      trim: NS('версія або null'),
      mileage_note: NS('ЛИШЕ заявлене число одним коротким рядком: "129 000 км"'),
    }),
    auction: OBJ({
      found: S('boolean', 'true ЛИШЕ коли реально знайдена подія, повʼязана з пошкодженням, ДТП чи відновленням'),
      summary: NS('2-4 речення: що сталося з авто за архівом, реальний обсяг пошкоджень, чи чесно продавець його описує; null коли found=false'),
      findings: ARR(OBJ({ status: E(['ok', 'warn', 'bad', 'unknown']), text: S('string', 'порівняння до/після, 1 речення') })),
    }),
    body_wrap: OBJ({
      present: S('boolean'),
      scope: E(['full', 'partial', 'unknown']),
      sources: ARR(E(['seller', 'visual', 'historical'])),
      inspection_visibility: E(['limited', 'normal']),
    }),
    historical_visual: hvProvided
      ? S('null', 'канонічний розбір уже переданий у даних: завжди null, код підставить його сам')
      : { anyOf: [HISTORICAL_VISUAL_OBJECT, S('null')], description: 'заповнюй ЛИШЕ коли історичні кадри реально передані; інакше null' },
    risks: ARR(OBJ({
      title: S('string'),
      level: E(['high', 'med', 'low'], 'high = висока ціна помилки'),
      kind: E(['finding', 'latent'], 'finding = конкретна знахідка цього авто; latent = HIGH_COST_LATENT_RISK, "не підтверджено", а не "несправно"'),
      note: S('string', '1-2 речення: чому це головна стаття витрат чи ризику саме тут'),
      action: S('string', 'конкретна перевірка до покупки, 1 рядок, починається з переліку конкретних вузлів чи дій'),
    }), '2-5 ключових ризиків САМЕ ЦЬОГО екземпляра, за ціною помилки'),
    equipment_v2: ARR(OBJ({
      name: S('string'),
      category: E(['comfort', 'interior', 'multimedia', 'assist', 'exterior', 'performance']),
      confidence_level: NE(['vehicle_data', 'seller_and_visual', 'visual', 'seller'], 'null лише для суто історичної опції'),
      highlight: S('boolean', 'true у 5-8 найзначущіших для вибору опцій'),
      retrofit: S('boolean'),
      retrofit_basis: NS('конкретний доказ пізнішої установки; null коли retrofit=false'),
      historical_claim: S('boolean'),
      value_tier: E(['standard', 'notable', 'high_value']),
      evidence: ARR(EVIDENCE_EQ),
    })),
    discrepancies: ARR(OBJ({
      severity: E(['high', 'med', 'low']),
      title: S('string', 'коротка назва розбіжності'),
      detail: S('string', '2-3 речення: що стверджується, що знайдено, звідки'),
      sources: ARR(S('string'), 'наприклад "опис продавця", "перевірка площадки", "фото", "VIN"'),
    }), 'ЛИШЕ справжні суперечності двох джерел; порожній масив, якщо їх немає'),
    history: ARR(OBJ({
      date: NS('MM.YYYY або YYYY'),
      event: S('string', '1 рядок: подія з історії авто'),
      gap: NS('тривалість від попередньої події ("2 роки 3 місяці") або null'),
    })),
    history_note: NS('1 рядок ЛИШЕ якщо патерн незвичний, без спекуляцій про причини; якщо історія звичайна: null'),
    photo_findings: ARR(OBJ({ status: E(['ok', 'warn', 'bad', 'unknown']), text: S('string', 'знахідка по фото, 1 речення') }), 'ЛИШЕ про нинішні фото з оголошення'),
    data_notes: NS('сміття чи суперечності в даних площадки, 1-2 речення, або null'),
    model_notes: OBJ({
      issues: ARR(OBJ({
        unit: S('string', 'вузол/двигун'),
        title: S('string'),
        detail: S('string', '1-2 речення'),
        severity: E(['low', 'med', 'high']),
        seller_serviced: S('boolean', 'true, якщо продавець заявляє, що вузол уже обслужений'),
      }), '0-4 типові слабкі місця САМЕ ЦІЄЇ версії при ЦЬОМУ пробігу'),
    }),
    checklist: ARR(S('string'), '3-6 конкретних перевірок при живому огляді і тест-драйві, 1 рядок кожна'),
    purchase_decision: OBJ({
      recommendation: E(['buy', 'go_see', 'negotiate', 'skip']),
      headline: S('string', 'рішення одним рядком, як жива порада'),
      summary_short: S('string', 'чому: 3-4 речення, до 400 символів, НЕ переказ headline'),
      reasoning: S('string', 'повне міркування, 2-4 абзаци, розділені порожнім рядком'),
      questions_for_seller: ARR(S('string'), 'за важливістю: найдорожче за ціною помилки перше'),
      value_context: NS('про ціну СЛОВАМИ, без вигаданих ринкових чисел; null без structured price_context'),
      missing_but_important: ARR(S('string'), 'чого ми не перевірили і як людині це закрити'),
    }),
    score_facts: OBJ({
      findings: ARR(OBJ({
        type: E(SCORE_FACT_TYPES),
        event_id: S('string', 'ОБОВʼЯЗКОВИЙ стабільний ідентифікатор події чи стану: accident_2020, flood_2021, current_srs_fault, mileage_conflict_1'),
        severity: NE(['low', 'med', 'high']),
        repair_status: NE(['visually_consistent', 'confirmed_bad', 'confirmed_ok', 'unknown']),
        serious_intervention: S('boolean'),
        maintenance_evidence: S('boolean'),
        evidence: ARR(EVIDENCE_SF),
      }), 'СЛУЖБОВА класифікація знахідок для коду; порожній масив, якщо знахідок нема'),
      signals: OBJ({
        seller_claims_us_import: S('boolean', 'true лише при ЯВНІЙ заяві продавця про пригін зі США'),
        current_visual_flawless: S('boolean', 'true ЛИШЕ коли на достатніх якісних поточних кадрах кузов і салон практично бездоганні'),
      }),
    }),
    verdict: OBJ({
      summary: S('string', '3-5 речень людською мовою: що це за авто і пропозиція, головні знахідки, чи варто розглядати і за яких умов. Без канцеляриту'),
    }),
  });
  return schema;
}

export function mainResponseFormat(opts) {
  return { type: 'json_schema', json_schema: { name: 'calcar_check_report', strict: true, schema: buildMainSchema(opts) } };
}

/* компактний текстовий опис контракту для fallback json_object (коли
   endpoint/модель не приймає json_schema): той самий перелік полів */
export function schemaProse({ hvProvided = false } = {}) {
  const walk = (node, indent) => {
    if (!node) return 'null';
    if (node.enum) return node.enum.filter(x => x !== null).join('|') + (node.enum.includes(null) ? '|null' : '');
    if (node.anyOf) return node.anyOf.map(n => walk(n, indent)).join(' або ');
    if (node.type === 'object') return '{' + Object.entries(node.properties).map(([k, v]) => '"' + k + '": ' + walk(v, indent)).join(', ') + '}';
    if (node.type === 'array') return '[' + walk(node.items, indent) + ']';
    const t = Array.isArray(node.type) ? node.type.join('|') : node.type;
    return t + (node.description ? ' (' + node.description + ')' : '');
  };
  return walk(buildMainSchema({ hvProvided }), 0);
}
