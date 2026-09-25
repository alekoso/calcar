/* Model Intelligence: цілеспрямований пошук обладнання конкретного авто
   (Equipment v1, міграція 027).

   Ланцюжок: VIN -> розвʼязана ідентичність -> каталог обладнання бренду і
   доступність на версії x ринку x році -> кандидати -> Check шукає саме їх
   у даних VIN, полях і тексті оголошення та на кадрах -> результат про
   ЦЕ авто -> наявний блок комплектації.

   Інваріант: ДОСТУПНІСТЬ НЕ Є НАЯВНІСТЮ. Кандидат каже лише, що опцію
   можна було замовити. У звіті опція зʼявляється тільки з доказом про саме
   це авто, і лише такий доказ іде у Vehicle Memory. Відсутність модуль не
   стверджує ніколи: «не знайшли» лишається «не підтверджено».

   Відкритий пошук не вимикається: опції поза каталогом Check і далі шукає
   і показує, як раніше. Каталог лише додає точні назви, пакети і цінність.

   Вимкнення: env MI_EQUIPMENT=off. Без ключів оточення, без VIN, без схеми
   чи за таймаутом модуль мовчки не бере участі; причина завжди у полі
   reason і в одному рядку логу, Check від цього не залежить. */

import { CONCEPT_LABELS, canonicalEquipment } from './canonical-merge.js';
import { equipmentConcept } from './current-visual.js';
import { generationFromLabel } from './youtube.js';

const MISSING_FUNCTION = new Set(['PGRST202', 'PGRST106', '42883', '3F000']);

/* Рівні equipment_v2, що є доказом про ЦЕ авто. seller (лише слова
   продавця) до них не належить: такий пункт каталог не підсилює. */
export const EXACT_LEVELS = new Set(['vehicle_data', 'seller_and_visual', 'visual', 'listing_data']);
/* Цілеспрямовано шукаються лише класифіковані значущі позиції */
const SEARCH_TIERS = new Set(['notable', 'high_value']);
/* Vehicle Memory: лише джерела, здатні побачити саме це авто. Дані
   оголошення (listing_data) і слова продавця не пишуться: у резолвері
   вони нижче порогу підтвердження */
const MEMORY_SOURCE = { vehicle_data: 'build_sheet', seller_and_visual: 'current_vision', visual: 'current_vision' };
/* категорії Current Vision -> категорії звіту */
const VISION_CATEGORY = {
  audio: 'multimedia', display: 'multimedia', roof: 'comfort', seats: 'comfort', climate: 'comfort',
  driver_assist: 'assist', camera_parking: 'assist', interior_trim: 'interior', lighting: 'exterior',
  wheels: 'exterior', other: 'comfort',
};

export const MI_EQUIPMENT_TIMEOUT_MS = 2500;

export function miEquipmentEnabled(env) {
  const raw = String(((env || process.env) || {}).MI_EQUIPMENT || '').trim().toLowerCase();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

/* Один виклик RPC через PostgREST зі службовим ключем. Ніколи не кидає. */
async function rpc(name, args, opts = {}) {
  const base = opts.base || process.env.SUPABASE_URL;
  const key = opts.key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const timeoutMs = opts.timeoutMs || MI_EQUIPMENT_TIMEOUT_MS;
  const doFetch = opts.fetch || fetch;
  if (!base || !key) return { ok: false, reason: 'no_credentials', body: null, ms: 0 };
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await doFetch(base.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST',
      signal: ac.signal,
      headers: { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    const ms = Date.now() - started;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = body && (body.code || body.error_code);
      if (res.status === 404 || MISSING_FUNCTION.has(code)) return { ok: false, reason: 'not_installed', body: null, ms };
      return { ok: false, reason: 'error', status: res.status, code: code || null, body: null, ms };
    }
    return { ok: true, reason: null, body, ms };
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? 'timeout' : 'error';
    return { ok: false, reason, error: String((e && e.message) || e).slice(0, 160), body: null, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/* Кандидати для VIN. { ok, reason, candidates, identity_precision, ms }.
   candidates: лише класифіковані значущі позиції (notable, high_value). */
export async function fetchMiEquipmentCandidates(vin, opts = {}) {
  if (!miEquipmentEnabled(opts.env)) return { ok: false, reason: 'flag_off', candidates: [], ms: 0 };
  if (!vin || typeof vin !== 'string' || vin.trim().length < 11) return { ok: false, reason: 'no_vin', candidates: [], ms: 0 };
  const r = await rpc('mi_equipment_candidates', { p_vin: vin.trim().toUpperCase() }, opts);
  if (!r.ok) {
    /* очікувані стани (немає ключів, схеми) не шумлять; збій і таймаут логуються */
    if (r.reason === 'error' || r.reason === 'timeout') {
      console.log('[mi-equipment]', JSON.stringify({ op: 'mi_equipment_candidates', reason: r.reason, status: r.status || null, code: r.code || null, error: r.error || null, ms: r.ms }));
    }
    return { ok: false, reason: r.reason, candidates: [], ms: r.ms };
  }
  const b = r.body || {};
  const all = Array.isArray(b.candidates) ? b.candidates : [];
  const candidates = all.filter(c => c && c.equipment_key && SEARCH_TIERS.has(c.value_tier));
  return {
    ok: true, reason: candidates.length ? null : (b.reason || 'no_candidates'),
    identity_precision: b.identity_precision || null, identity_summary: b.identity_summary || null,
    candidates, total: all.length, ms: r.ms,
  };
}

/* Код платформи, який Model Intelligence уже знає про це авто. Окремого
   запиту під це не робимо: беремо назву розвʼязаної ідентичності з тієї
   самої відповіді, що вже прийшла за комплектацією. Назва версії містить
   код ("BMW 540i G30"), назва версії-ринку-року не містить, тому для
   точної ідентичності тут чесно буде null. */
export function miIdentityGeneration(miEq) {
  const sum = miEq && miEq.identity_summary;
  if (!sum || typeof sum !== 'object') return null;
  return generationFromLabel(sum.version) || generationFromLabel(sum.vmy) || null;
}

/* ---------- Зіставлення назви з кандидатом ---------- */

export function normPhrase(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ʼ'’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function phrasesOf(c) {
  const out = [c.name_en, ...((c.aliases || []).map(a => a && a.alias))]
    .map(normPhrase).filter(p => p.length >= 3);
  return [...new Set(out)];
}

/* Найдовша фраза кандидата, що цілими словами входить у текст. Концепт
   Current Vision рахується лише для візуальної ознаки definitive:
   ambiguous (звичайний круїз, базові LED) не ототожнюється ніколи. */
export function matchCandidate(text, candidates, concept) {
  const hay = ' ' + normPhrase(text) + ' ';
  let best = null, bestLen = 0;
  for (const c of Array.isArray(candidates) ? candidates : []) {
    for (const p of phrasesOf(c)) {
      if (p.length > bestLen && hay.includes(' ' + p + ' ')) { best = c; bestLen = p.length; }
    }
  }
  if (best) return best;
  if (concept && !String(concept).startsWith('other:')) {
    const hits = (candidates || []).filter(c => (c.visual_cues || []).some(v => v && v.cue_key === concept && v.specificity === 'definitive'));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/* Current Vision бачить і те, чого словник понять не знає (Night Vision,
   інтегральне кермо...). Такі знахідки canonical-merge не вносить, бо не
   вміє їх назвати. Якщо знахідка збігається з кандидатом каталогу, код
   вносить її під офіційною назвою виробника з доказом на кадр. */
export function supplementVisionEquipment(items, cv, candidates) {
  const list = Array.isArray(items) ? items.slice() : [];
  const stats = { inserted: 0 };
  if (!cv || !Array.isArray(candidates) || !candidates.length) return { items: list, stats };
  for (const e of canonicalEquipment(cv)) {
    if (!e || CONCEPT_LABELS[e.concept] || e.confidence === 'low') continue;
    const c = matchCandidate([e.normalized_name, e.visible_label_or_feature].filter(Boolean).join(' '), candidates, null);
    if (!c) continue;
    const already = list.some(it => it && typeof it === 'object' && matchCandidate(it.name, [c], equipmentConcept(it.name)));
    if (already) continue;
    list.push({
      name: c.name_en, category: VISION_CATEGORY[e.category] || 'comfort', confidence_level: 'visual',
      highlight: false, retrofit: false, retrofit_basis: null, historical_claim: false, value_tier: c.value_tier || 'standard',
      evidence: [{ source: 'current_photos', ref: 'photo_' + (Number(e.gallery_index) + 1), sign: e.sign || e.visible_label_or_feature || null }],
    });
    stats.inserted++;
  }
  return { items: list, stats };
}

/* Позначка каталогу на пунктах комплектації. Цінність (value_tier) з
   каталогу отримують ЛИШЕ пункти з доказом про це авто; seller-пункт
   лише позначається, його рівень і цінність не змінюються. Пункти поза
   каталогом не чіпаються (відкритий пошук). Рівень доказу не змінюється
   ніколи: каталог не є доказом наявності. */
export function applyMiEquipment(items, candidates) {
  const stats = { matched: 0, confirmed: 0, confirmed_high_value: 0, seller_only: 0, keys: [] };
  if (!Array.isArray(items) || !Array.isArray(candidates) || !candidates.length) return { items: Array.isArray(items) ? items : [], stats };
  for (const it of items) {
    if (!it || typeof it !== 'object' || !it.name) continue;
    const c = matchCandidate(it.name, candidates, equipmentConcept(it.name));
    if (!c) continue;
    const confirmed = EXACT_LEVELS.has(it.confidence_level);
    it.mi = {
      equipment_key: c.equipment_key, vm_ref: c.vm_ref || null, oem_code: c.oem_code || null,
      availability: c.availability || null, applicability: c.applicability || null,
      packages: (c.packages || []).map(p => p.oem_code || p.equipment_key).filter(Boolean),
      value_tier: c.value_tier || null, confirmed,
    };
    stats.matched++;
    if (confirmed) {
      if (c.value_tier) it.value_tier = c.value_tier;
      stats.confirmed++;
      if (c.value_tier === 'high_value') stats.confirmed_high_value++;
      if (stats.keys.length < 24) stats.keys.push(c.equipment_key);
    } else {
      stats.seller_only++;
    }
  }
  return { items, stats };
}

/* Рядки для Vehicle Memory: лише підтверджені пункти з каталогу і лише від
   джерел, що бачать саме це авто. Доступність не пишеться ніколи. */
export function equipmentMemoryObservations(items, ctx = {}) {
  const root = ctx.snapshotId ? 'snapshot:' + ctx.snapshotId : ctx.token ? 'check:' + ctx.token : null;
  if (!root) return [];
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const m = it && it.mi;
    if (!m || !m.confirmed || !m.vm_ref) continue;
    const source = MEMORY_SOURCE[it.confidence_level];
    if (!source) continue;
    const k = m.vm_ref + '|' + source;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      vm_ref: m.vm_ref, source_kind: source, confidence: source === 'build_sheet' ? 'high' : 'medium',
      provenance_root: root, source_ref: ctx.token ? 'check:' + ctx.token : root,
      observed_at: ctx.observedAt || new Date().toISOString(),
    });
  }
  return out;
}

export async function recordMiEquipment(vin, observations, opts = {}) {
  if (!miEquipmentEnabled(opts.env)) return { ok: false, reason: 'flag_off' };
  if (!Array.isArray(observations) || !observations.length) return { ok: true, reason: 'nothing_to_record', written: 0 };
  const r = await rpc('mi_record_equipment', { p_vin: String(vin || '').trim().toUpperCase(), p_observations: observations }, { ...opts, timeoutMs: opts.timeoutMs || 4000 });
  if (!r.ok) {
    if (r.reason !== 'no_credentials' && r.reason !== 'not_installed') {
      console.log('[mi-equipment]', JSON.stringify({ op: 'mi_record_equipment', reason: r.reason, status: r.status || null, code: r.code || null, error: r.error || null, rows: observations.length, ms: r.ms }));
    }
    return { ok: false, reason: r.reason };
  }
  return { ok: true, ...(r.body || {}), ms: r.ms };
}

/* ---------- Тексти для моделей ---------- */

function candidateLine(c) {
  const code = c.oem_code ? ' [' + c.oem_code + ']' : '';
  const pk = (c.packages || []).map(p => p.oem_code || p.name_en).filter(Boolean);
  const alt = (c.aliases || []).map(a => a && a.alias).filter(a => a && normPhrase(a) !== normPhrase(c.name_en)).slice(0, 4);
  const how = c.availability === 'in_package' ? 'лише в пакеті ' + pk.join(', ')
    : c.availability === 'standard' ? 'стандарт'
      : 'опція' + (pk.length ? ', також у пакеті ' + pk.join(', ') : '');
  return '- ' + c.name_en + code + ' (' + how + (c.applicability === 'conditional' ? ', залежить від року чи ринку' : '') + ')'
    + (alt.length ? '; інші назви: ' + alt.join(', ') : '');
}

/* Блок для основного виклику: що цілеспрямовано шукати у даних VIN,
   полях і тексті оголошення. Відкритий пошук при цьому не звужується. */
export function candidatePromptBlock(candidates) {
  const list = (Array.isArray(candidates) ? candidates : []).slice(0, 25);
  if (!list.length) return null;
  return 'MI_EQUIPMENT_CANDIDATES (каталог CalCar за офіційним прайсом виробника): заводські опції, які ЦЯ версія на цьому ринку і в цьому модельному році МОГЛА мати. '
    + 'Це ДОСТУПНІСТЬ, А НЕ НАЯВНІСТЬ. Використовуй перелік лише як список того, що варто цілеспрямовано пошукати у vehicle_data, listing_data, тексті продавця і історичних джерелах. '
    + 'Опцію з переліку вноси в equipment_v2 ЛИШЕ з доказом про саме це авто; без доказу не згадуй її зовсім, ні як наявну, ні як відсутню, і не роби висновків про пакет. '
    + 'Знайдену опцію називай офіційною назвою з переліку. Опції поза переліком шукай і вноси як завжди.\n'
    + list.map(candidateLine).join('\n');
}

/* Підказка для Current Vision: лише позиції з однозначною візуальною
   ознакою. Кадри лишаються єдиним доказом. */
export function visionHintBlock(candidates) {
  const lines = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const cue = (c.visual_cues || []).find(v => v && v.specificity === 'definitive' && v.description_en);
    if (!cue) continue;
    lines.push('- ' + c.name_en + ': ' + cue.description_en + (cue.negative_note_en ? ' ' + cue.negative_note_en : ''));
    if (lines.length >= 12) break;
  }
  if (!lines.length) return null;
  return 'ЦІЛЬОВИЙ ПОШУК КОМПЛЕКТАЦІЇ (додатково до звичайного повного проходу, який НЕ скорочується): ця версія авто могла мати з заводу опції нижче. Це НЕ означає, що вони є. '
    + 'Якщо на кадрі є названа ознака, зафіксуй її в equipment_visual як завжди: normalized_name з назвою опції, кадр і конкретна ознака. Немає ознаки: нічого не пиши.\n'
    + lines.join('\n');
}
