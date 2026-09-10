/* CalCar Check: структурна схема відповіді основного виклику (OpenAI
   response_format json_schema, strict). Це ЄДИНИЙ контракт вихідних полів:
   усі ключі обовʼязкові, enum-значення точні, невідоме = null там, де це
   дозволено. Семантика полів живе у системному промпті; description
   тут лишається ЛИШЕ там, де промпт формат поля не задає (короткий
   контракт формату чи nullability), інакше схема дублює правила і коштує
   вхідних токенів на кожному виклику. Модель НЕ повертає числовий бал:
   verdict.score ставить код зі Score v3 (score_breakdown.final).
   historical_visual: null, коли канонічний розбір уже є (код підставляє
   його), інакше повний обʼєкт. */

const S = (type, description, extra = {}) => ({ type, ...(description ? { description } : {}), ...extra });
const NS = (description, extra = {}) => ({ type: ['string', 'null'], ...(description ? { description } : {}), ...extra });
const E = (values, description) => ({ type: 'string', enum: values, ...(description ? { description } : {}) });
const NE = (values, description) => ({ type: ['string', 'null'], enum: [...values, null], ...(description ? { description } : {}) });
const OBJ = (properties, description) => ({ type: 'object', ...(description ? { description } : {}), properties, required: Object.keys(properties), additionalProperties: false });
const ARR = (items, description) => ({ type: 'array', ...(description ? { description } : {}), items });

export const SCORE_FACT_TYPES = ['STRUCTURAL_DAMAGE', 'AIRBAGS_DEPLOYED', 'SRS_FAULT', 'FLOOD', 'FIRE', 'ODOMETER_ROLLBACK', 'VIN_IDENTITY_PROBLEM',
  'SERIOUS_POWERTRAIN_FAULT', 'POOR_REPAIR_VISIBLE', 'CRITICAL_WARNING_LIGHTS', 'MILEAGE_CONFLICT_UNEXPLAINED', 'MAJOR_REPAIR_UNVERIFIED', 'MODIFICATION_TECHNICAL_CONCERN'];

export const HISTORICAL_VISUAL_OBJECT = OBJ({
  visible_damage_zones: ARR(S('string')),
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
  signal_evidence: ARR(OBJ({ signal: S('string'), frame: S('string', 'auction_photo_N'), sign: S('string') })),
  summary: S('string'),
  evidence: ARR(OBJ({ source: S('string', 'us_auction'), ref: S('string', 'auction_photo_N'), description: S('string') })),
});

const EVIDENCE_EQ = OBJ({
  source: E(['vehicle_data', 'current_photos', 'seller_claim', 'listing_data', 'historical']),
  ref: NS('photo_7, vin_decode або назва джерела'),
  sign: NS(),
});
const EVIDENCE_SF = OBJ({
  source: E(['seller_claim', 'current_photos', 'historical_listing', 'us_auction', 'registry', 'document']),
  ref: NS(),
  description: S('string'),
});

export function buildMainSchema({ hvProvided = false } = {}) {
  const schema = OBJ({
    vehicle: OBJ({
      title: S('string', 'Марка Модель Рік'),
      year: S(['integer', 'null']),
      model_year: S(['integer', 'null'], 'рік за VIN, якщо надійно відомий і відрізняється від year; інакше null'),
      fuel: NE(['petrol', 'diesel', 'hybrid', 'electric']),
      engine: NS(),
      transmission: NS(),
      drive: NS(),
      trim: NS(),
      mileage_note: NS(),
    }),
    auction: OBJ({
      found: S('boolean'),
      summary: NS('2-4 речення; null коли found=false'),
      findings: ARR(OBJ({ status: E(['ok', 'warn', 'bad', 'unknown']), text: S('string', '1 речення') })),
    }),
    body_wrap: OBJ({
      present: S('boolean'),
      scope: E(['full', 'partial', 'unknown']),
      sources: ARR(E(['seller', 'visual', 'historical'])),
      inspection_visibility: E(['limited', 'normal']),
    }),
    historical_visual: hvProvided
      ? S('null', 'канонічний розбір уже переданий: завжди null')
      : { anyOf: [HISTORICAL_VISUAL_OBJECT, S('null')], description: 'null, коли історичних кадрів не передано' },
    risks: ARR(OBJ({
      title: S('string'),
      level: E(['high', 'med', 'low']),
      kind: E(['finding', 'latent'], 'latent = HIGH_COST_LATENT_RISK'),
      note: S('string', '1-2 речення'),
      action: S('string', 'конкретна перевірка до покупки, 1 рядок'),
    })),
    equipment_v2: ARR(OBJ({
      name: S('string'),
      category: E(['comfort', 'interior', 'multimedia', 'assist', 'exterior', 'performance']),
      confidence_level: NE(['vehicle_data', 'seller_and_visual', 'visual', 'seller']),
      highlight: S('boolean'),
      retrofit: S('boolean'),
      retrofit_basis: NS('null коли retrofit=false'),
      historical_claim: S('boolean'),
      value_tier: E(['standard', 'notable', 'high_value']),
      evidence: ARR(EVIDENCE_EQ),
    })),
    discrepancies: ARR(OBJ({
      severity: E(['high', 'med', 'low']),
      title: S('string'),
      detail: S('string', 'що стверджується, що знайдено, звідки'),
      sources: ARR(S('string'), 'назви джерел: "опис продавця", "фото", "VIN"'),
    })),
    history: ARR(OBJ({
      date: NS('MM.YYYY або YYYY'),
      event: S('string', '1 рядок'),
      gap: NS('тривалість від попередньої події ("2 роки 3 місяці") або null'),
    })),
    history_note: NS('1 рядок лише про незвичний патерн історії; звичайна історія = null'),
    photo_findings: ARR(OBJ({ status: E(['ok', 'warn', 'bad', 'unknown']), text: S('string', '1 речення') })),
    data_notes: NS(),
    model_notes: OBJ({
      issues: ARR(OBJ({
        unit: S('string', 'вузол/двигун'),
        title: S('string'),
        detail: S('string', '1-2 речення'),
        severity: E(['low', 'med', 'high']),
        seller_serviced: S('boolean'),
      })),
    }),
    checklist: ARR(S('string')),
    purchase_decision: OBJ({
      recommendation: E(['buy', 'go_see', 'negotiate', 'skip']),
      headline: S('string'),
      summary_short: S('string'),
      reasoning: S('string'),
      questions_for_seller: ARR(S('string')),
      value_context: NS('null без price_context'),
      missing_but_important: ARR(S('string')),
    }),
    score_facts: OBJ({
      findings: ARR(OBJ({
        type: E(SCORE_FACT_TYPES),
        event_id: S('string', 'стабільний ідентифікатор події чи стану'),
        severity: NE(['low', 'med', 'high']),
        repair_status: NE(['visually_consistent', 'confirmed_bad', 'confirmed_ok', 'unknown']),
        serious_intervention: S('boolean'),
        maintenance_evidence: S('boolean'),
        evidence: ARR(EVIDENCE_SF),
      })),
      signals: OBJ({
        seller_claims_us_import: S('boolean'),
        current_visual_flawless: S('boolean'),
      }),
    }),
    verdict: OBJ({
      summary: S('string', '3-5 речень людською мовою: що це за авто і пропозиція, головні знахідки, чи варто розглядати і за яких умов'),
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
