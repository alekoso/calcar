/* Equipment v1 (міграція 027, api/mi-equipment.js): тест без бази.

   Що доводиться:
   1. тексти для моделей кажуть, що кандидат це доступність, а не
      наявність; Vision отримує лише однозначні візуальні ознаки;
   2. зіставлення назв: офіційні назви і аліаси цілими словами, найдовша
      фраза перемагає, ambiguous-ознака (звичайний круїз) не ототожнюється,
      M Sport brakes не стає пакетом M Sport;
   3. OPTIONAL не стає INSTALLED: самі кандидати не створюють пункту, не
      змінюють рівня доказу і не пишуться у Vehicle Memory;
   4. доказ з фото, даних оголошення чи даних VIN підтверджує кандидата,
      і лише тоді його цінність (value_tier) доходить до рамки .eq-chip.hv;
      пункт лише зі слів продавця цінності від каталогу не отримує;
   5. рядки для Vehicle Memory: лише vehicle_data (build_sheet) і фото
      (current_vision), з коренем походження, без дублікатів;
   6. відкритий пошук: пункти поза каталогом не зникають і не змінюються;
   7. знахідка Vision поза словником понять, що збігається з кандидатом,
      вноситься під офіційною назвою з доказом на кадр і проходить
      sanitizeEquipment як visual;
   8. клієнт RPC: фільтр значущих позицій, чесні причини відмови,
      структурований лог збою, вимикач MI_EQUIPMENT=off;
   9. проводка в api/check.js.

   Запуск: node miequipmenttest.js */

const fs = require('fs');
const os = require('os');
const path = require('path');

const errs = [];
let checks = 0;
const ok = (name, cond, detail) => { checks++; if (!cond) errs.push(name + (detail ? ': ' + detail : '')); };

/* Кандидати у формі, яку віддає public.mi_equipment_candidates (скорочено) */
const SRC = [{ source_id: 1, title: 'BMW of North America pricing guide, 5 Series Sedan (G30) model year 2018', url: 'https://www.press.bmwgroup.com/usa/article/attachment/T0266788EN_US/391871' }];
const C = (key, code, name, tier, availability, extra = {}) => ({
  item_id: code.length, equipment_key: key, vm_ref: 'bmw:' + key, brand: 'BMW', name_en: name, item_kind: extra.kind || 'option',
  oem_code: code, value_tier: tier, availability, applicability: 'applicable', scope: 'exact', vmy_ids: [217],
  packages: extra.packages || [], requires: extra.requires || [], aliases: extra.aliases || [], visual_cues: extra.cues || [], sources: SRC,
});
const al = (alias, lang = 'en', kind = 'community') => ({ alias, lang, kind });
const CANDIDATES = [
  C('head_up_display', '610', 'Head-up Display', 'high_value', 'optional', {
    packages: [{ equipment_key: 'driving_assistance_package', oem_code: 'ZDA', name_en: 'Driving Assistance Package' }],
    aliases: [al('Head-up Display', 'en', 'official'), al('HUD'), al('проекційний дисплей', 'uk'), al('проекционный дисплей', 'ru')],
    cues: [{ cue_key: 'hud', specificity: 'definitive', description_en: 'Head-up display projector aperture on top of the dashboard.' }] }),
  C('active_driving_assistant_plus', '5AT', 'Active Driving Assistant Plus with Active Cruise Control with Stop & Go', 'high_value', 'in_package', {
    packages: [{ equipment_key: 'driving_assistance_plus_package', oem_code: 'ZDB', name_en: 'Driving Assistance Plus Package' }],
    aliases: [al('Active Driving Assistant Plus', 'en', 'official'), al('Active Cruise Control', 'en', 'official'), al('адаптивний круїз-контроль', 'uk'), al('adaptive cruise control')],
    cues: [{ cue_key: 'adaptive_cruise', specificity: 'ambiguous', description_en: 'Distance button.' }] }),
  C('bowers_wilkins_diamond_surround_sound', '6F1', 'Bowers & Wilkins Diamond Surround Sound System', 'high_value', 'optional', {
    requires: [{ equipment_key: 'executive_package', oem_code: 'ZPX', name_en: 'Executive Package' }],
    aliases: [al('Bowers & Wilkins', 'en', 'official'), al('Bowers and Wilkins')],
    cues: [{ cue_key: 'bowers_wilkins', specificity: 'definitive', description_en: 'Bowers & Wilkins logo on a speaker cover.' }] }),
  C('night_vision_pedestrian_detection', '6UK', 'Night Vision with Pedestrian Detection', 'high_value', 'optional', {
    aliases: [al('Night Vision', 'en', 'official'), al('нічного бачення', 'uk'), al('ночного видения', 'ru')] }),
  C('front_ventilated_seats', '453', 'Front ventilated seats', 'high_value', 'in_package', {
    packages: [{ equipment_key: 'luxury_seating_package', oem_code: 'ZLS', name_en: 'Luxury Seating Package' }],
    aliases: [al('Front ventilated seats', 'en', 'official'), al('вентиляція сидінь', 'uk')],
    cues: [{ cue_key: 'seat_ventilation', specificity: 'definitive', description_en: 'Seat ventilation buttons.', negative_note_en: 'Perforated leather alone does not prove ventilation.' }] }),
  C('surround_view_3d', 'ZX3', 'Surround View with 3D View', 'high_value', 'in_package', {
    aliases: [al('Surround View', 'en', 'official'), al('камери кругового огляду', 'uk')],
    cues: [{ cue_key: 'surround_camera', specificity: 'definitive', description_en: 'Surround View image on the central display.' }] }),
  C('m_sport_package', 'ZMP', 'M Sport Package', 'notable', 'optional', { kind: 'package', aliases: [al('M Sport Package', 'en', 'official'), al('пакет M Sport', 'uk')] }),
  C('harman_kardon_surround_sound', '688', 'Harman Kardon surround sound system', 'notable', 'optional', {
    aliases: [al('Harman Kardon', 'en', 'official')], cues: [{ cue_key: 'harman_kardon', specificity: 'definitive', description_en: 'Harman Kardon logo.' }] }),
  C('dynamic_damper_control', '223', 'Dynamic Damper Control', 'notable', 'optional', {
    aliases: [al('Dynamic Damper Control', 'en', 'official')], cues: [{ cue_key: 'dynamic_damper_control', specificity: 'not_visually_resolvable' }] }),
];
const byKey = k => CANDIDATES.find(c => c.equipment_key === k);

/* sanitizeEquipment береться з api/check.js тим самим текстом */
function grab(src, name) {
  const i = src.indexOf('export function ' + name + '(');
  if (i === -1) return null;
  const end = src.indexOf('\n}\n', i);
  return src.slice(i + 'export '.length, end + 2);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calcar_miequipment_'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
    fs.writeFileSync(path.join(dir, 'api', f), fs.readFileSync('api/' + f, 'utf8'));
  }
  const M = await import('file://' + path.join(dir, 'api', 'mi-equipment.js'));
  const CHECK_SRC = fs.readFileSync('api/check.js', 'utf8');
  const san = grab(CHECK_SRC, 'sanitizeEquipment');
  ok('0. sanitizeEquipment знайдено в api/check.js', !!san);
  const { sanitizeEquipment } = new Function(san + '\nreturn { sanitizeEquipment };')();

  /* ---- 1. тексти для моделей ---- */
  const block = M.candidatePromptBlock(CANDIDATES);
  ok('1. блок основного виклику каже про доступність, а не наявність', /ДОСТУПНІСТЬ, А НЕ НАЯВНІСТЬ/.test(block));
  ok('1b. без доказу опцію не згадувати ні як наявну, ні як відсутню', /ЛИШЕ з доказом про саме це авто/.test(block) && /ні як наявну, ні як відсутню/.test(block));
  ok('1c. відкритий пошук не звужується', /Опції поза переліком шукай і вноси як завжди/.test(block));
  ok('1d. офіційна назва, код і пакет', /- Head-up Display \[610\] \(опція, також у пакеті ZDA\)/.test(block), block.split('\n')[1]);
  ok('1e. опція лише в пакеті названа так', /Active Driving Assistant Plus[^\n]*\[5AT\] \(лише в пакеті ZDB\)/.test(block));
  ok('1f. порожній перелік не дає блоку', M.candidatePromptBlock([]) === null && M.candidatePromptBlock(null) === null);
  ok('1g. без довгого тире', !/\u2014/.test(block));
  const hint = M.visionHintBlock(CANDIDATES);
  ok('1h. Vision: лише definitive-ознаки', /Head-up Display:/.test(hint) && /Bowers & Wilkins Diamond/.test(hint) && /Front ventilated seats:/.test(hint)
    && !/Active Driving Assistant/.test(hint) && !/Dynamic Damper/.test(hint) && !/Night Vision/.test(hint), hint);
  ok('1i. Vision: негативна примітка переходить', /Perforated leather alone does not prove ventilation/.test(hint));
  ok('1j. Vision: повний прохід не скорочується і без ознаки нічого не пишеться', /НЕ скорочується/.test(hint) && /Немає ознаки: нічого не пиши/.test(hint));

  /* ---- 2. зіставлення назв ---- */
  const m = (name, concept) => { const c = M.matchCandidate(name, CANDIDATES, concept); return c ? c.equipment_key : null; };
  ok('2. HUD у дужках', m('Проекційний дисплей (HUD)') === 'head_up_display');
  ok('2b. англійська офіційна назва', m('Head-Up Display') === 'head_up_display');
  ok('2c. адаптивний круїз це 5AT', m('Адаптивний круїз-контроль') === 'active_driving_assistant_plus');
  ok('2d. звичайний круїз не ототожнюється (ambiguous)', m('Круїз-контроль', 'adaptive_cruise') === null);
  ok('2e. M Sport brakes не пакет M Sport', m('M Sport brakes') === null);
  ok('2f. пакет M Sport упізнається', m('Пакет M Sport') === 'm_sport_package');
  ok('2g. B&W з амперсандом і словами', m('Аудіосистема Bowers & Wilkins') === 'bowers_wilkins_diamond_surround_sound' && m('Bowers and Wilkins Diamond') === 'bowers_wilkins_diamond_surround_sound');
  ok('2h. нічне бачення українською', m('Система нічного бачення') === 'night_vision_pedestrian_detection');
  ok('2i. definitive-концепт Vision', m('Вентиляція передніх сидінь', 'seat_ventilation') === 'front_ventilated_seats');
  ok('2j. частина слова не збіг', m('HUDSON seat covers') === null);
  ok('2k. концепт other: не збігається ні з чим', m('щось невідоме', 'other:щось невідоме') === null);

  /* ---- 3..6. AVAILABLE != INSTALLED, підтвердження, маркер, відкритий пошук ---- */
  const items = sanitizeEquipment([
    { name: 'Проекційний дисплей (HUD)', category: 'multimedia', value_tier: 'standard', evidence: [{ source: 'current_photos', ref: 'photo_3', sign: 'проектор HUD на торпедо' }] },
    { name: 'Адаптивний круїз-контроль', category: 'assist', value_tier: 'standard', evidence: [{ source: 'listing_data', ref: 'options', sign: 'Адаптивний круїз' }] },
    { name: 'Аудіосистема Harman Kardon', category: 'multimedia', value_tier: 'standard', evidence: [{ source: 'seller_claim', ref: null, sign: 'є Harman Kardon' }] },
    { name: 'Вентиляція сидінь', category: 'comfort', value_tier: 'notable', evidence: [{ source: 'vehicle_data', ref: 'vin', sign: 'SA 453' }] },
    { name: 'Підігрів керма', category: 'comfort', value_tier: 'standard', evidence: [{ source: 'current_photos', ref: 'photo_5', sign: 'кнопка підігріву' }] },
    { name: 'Панорамний дах', category: 'comfort', value_tier: 'notable', evidence: [{ source: 'listing_data', ref: 'options', sign: 'панорама' }] },
  ], null);
  const before = JSON.parse(JSON.stringify(items));
  ok('3. кандидати самі по собі не створюють пунктів', M.applyMiEquipment([], CANDIDATES).items.length === 0);
  const res = M.applyMiEquipment(items, CANDIDATES);
  const it = n => items.find(x => x.name === n);
  ok('3b. кількість пунктів не змінилась', items.length === before.length);
  ok('3c. рівні доказу не змінились', items.every((x, i) => x.confidence_level === before[i].confidence_level), JSON.stringify(items.map(x => x.confidence_level)));
  ok('3d. жодна не згадана опція каталогу не зʼявилась', !items.some(x => /Night Vision|Bowers|Surround|M Sport/.test(x.name)));
  ok('4. фото підтверджує HUD: цінність каталогу', it('Проекційний дисплей (HUD)').value_tier === 'high_value' && it('Проекційний дисплей (HUD)').mi.confirmed === true
    && it('Проекційний дисплей (HUD)').mi.oem_code === '610' && it('Проекційний дисплей (HUD)').mi.packages.join() === 'ZDA');
  ok('4b. дані оголошення підтверджують 5AT', it('Адаптивний круїз-контроль').mi.confirmed === true && it('Адаптивний круїз-контроль').value_tier === 'high_value');
  ok('4c. дані VIN підтверджують вентиляцію', it('Вентиляція сидінь').mi.confirmed === true && it('Вентиляція сидінь').value_tier === 'high_value');
  ok('4d. лише слова продавця: позначка без підтвердження, цінність моделі лишається', it('Аудіосистема Harman Kardon').mi.confirmed === false
    && it('Аудіосистема Harman Kardon').value_tier === 'standard' && it('Аудіосистема Harman Kardon').confidence_level === 'seller');
  ok('4e. лічильники', res.stats.matched === 4 && res.stats.confirmed === 3 && res.stats.confirmed_high_value === 3 && res.stats.seller_only === 1, JSON.stringify(res.stats));
  /* рамка .eq-chip.hv у result-check.html вмикається спільним рішенням
     equipment-value.js: каталог MI головний, запасний список працює лише
     там, де каталог опцію не покриває */
  const page = fs.readFileSync('result-check.html', 'utf8');
  ok('4f. рамка преміуму читає спільне рішення цінності', /const hv = CalCarEquipmentValue\.isHighValue\(o\);/.test(page) && /\.eq-chip\.hv/.test(page));
  const ev = fs.readFileSync('equipment-value.js', 'utf8');
  ok('4g. каталог MI має пріоритет над запасним списком', /if \(mi && mi\.confirmed === true && mi\.value_tier\) return mi\.value_tier === 'high_value';/.test(ev));
  const hvFromMi = items.filter(x => x.mi && x.value_tier === 'high_value' && before.find(b => b.name === x.name).value_tier !== 'high_value');
  ok('4g. маркер каталогу дістався лише підтвердженим пунктам', hvFromMi.length === 3 && hvFromMi.every(x => x.mi.confirmed === true));
  ok('6. відкритий пошук: пункти поза каталогом без змін', JSON.stringify(it('Підігрів керма')) === JSON.stringify(before.find(b => b.name === 'Підігрів керма'))
    && JSON.stringify(it('Панорамний дах')) === JSON.stringify(before.find(b => b.name === 'Панорамний дах')));

  /* ---- 5. Vehicle Memory ---- */
  const rows = M.equipmentMemoryObservations(items, { snapshotId: 'snap-1', token: 'tok-1', observedAt: '2026-09-25T10:00:00.000Z' });
  const kinds = rows.map(r => r.vm_ref + '|' + r.source_kind).sort().join(',');
  ok('5. у памʼять лише фото і дані VIN', kinds === 'bmw:front_ventilated_seats|build_sheet,bmw:head_up_display|current_vision', kinds);
  ok('5b. корінь походження і джерело', rows.every(r => r.provenance_root === 'snapshot:snap-1' && r.source_ref === 'check:tok-1' && r.observed_at === '2026-09-25T10:00:00.000Z'));
  ok('5c. дані оголошення і слова продавця у памʼять не йдуть', !rows.some(r => /active_driving|harman/.test(r.vm_ref)));
  ok('5d. доступність у памʼять не йде ніколи', M.equipmentMemoryObservations([], { snapshotId: 's' }).length === 0
    && M.equipmentMemoryObservations(CANDIDATES.map(c => ({ name: c.name_en, confidence_level: null })), { snapshotId: 's' }).length === 0);
  ok('5e. без кореня походження нічого', M.equipmentMemoryObservations(items, {}).length === 0);
  ok('5f. без дублікатів', M.equipmentMemoryObservations([...items, { ...it('Проекційний дисплей (HUD)') }], { token: 't' }).length === 2);
  ok('5g. відсутність не пишеться', !rows.some(r => /absent/.test(JSON.stringify(r))));

  /* ---- 7. знахідка Vision поза словником ---- */
  const cv = { equipment_visual: [
    { normalized_name: 'Night Vision', concept: 'other:night vision', visible_label_or_feature: 'Night Vision image on the cluster', category: 'display', gallery_index: 4, sign: 'зображення Night Vision на панелі', confidence: 'high' },
    { normalized_name: 'Проекційний дисплей', concept: 'hud', visible_label_or_feature: 'HUD', category: 'display', gallery_index: 2, sign: 'проектор', confidence: 'high' },
    { normalized_name: 'Bowers & Wilkins', concept: 'other:bw low', visible_label_or_feature: 'logo', category: 'audio', gallery_index: 7, sign: 'нечітко', confidence: 'low' },
    { normalized_name: 'Ковпаки коліс', concept: 'other:ковпаки коліс', visible_label_or_feature: 'caps', category: 'wheels', gallery_index: 1, sign: 'ковпаки', confidence: 'high' },
  ] };
  const sup = M.supplementVisionEquipment([], cv, CANDIDATES);
  ok('7. Night Vision внесено під офіційною назвою', sup.items.length === 1 && sup.items[0].name === 'Night Vision with Pedestrian Detection'
    && sup.items[0].evidence[0].ref === 'photo_5' && sup.items[0].category === 'multimedia', JSON.stringify(sup.items));
  ok('7b. словникове поняття і низька впевненість не дублюються', sup.stats.inserted === 1);
  ok('7c. поза каталогом Vision код не вигадує', !sup.items.some(x => /ковпак/i.test(x.name)));
  const supSan = sanitizeEquipment(sup.items, null);
  ok('7d. вставка проходить sanitizeEquipment як visual', supSan.length === 1 && supSan[0].confidence_level === 'visual');
  ok('7e. наявний пункт того самого кандидата не дублюється', M.supplementVisionEquipment([{ name: 'Система нічного бачення' }], cv, CANDIDATES).stats.inserted === 0);
  ok('7f. без кандидатів нічого', M.supplementVisionEquipment([], cv, []).items.length === 0);

  /* ---- 8. клієнт RPC ---- */
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const calls = [];
    const stub = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status < 300, status, json: async () => body }; };
    let r = await M.fetchMiEquipmentCandidates('WBAJA7C5XJG000001', { base: 'https://x.supabase.co', key: 'k', fetch: stub(200, { available: true, identity_precision: 'exact', candidates: [...CANDIDATES, C('plain', 'X1', 'Plain', null, 'standard')] }) });
    ok('8. успіх: лише класифіковані значущі позиції', r.ok && r.candidates.length === CANDIDATES.length && r.total === CANDIDATES.length + 1 && r.identity_precision === 'exact');
    ok('8b. той самий шлях, що в продакшні: /rest/v1/rpc/mi_equipment_candidates зі службовим ключем', calls[0].url === 'https://x.supabase.co/rest/v1/rpc/mi_equipment_candidates'
      && calls[0].init.headers.authorization === 'Bearer k' && JSON.parse(calls[0].init.body).p_vin === 'WBAJA7C5XJG000001');
    r = await M.fetchMiEquipmentCandidates('WBAJA7C5XJG000001', { base: 'https://x', key: 'k', fetch: stub(404, { code: 'PGRST202' }) });
    ok('8c. схеми немає: not_installed без шуму', !r.ok && r.reason === 'not_installed' && logs.length === 0);
    r = await M.fetchMiEquipmentCandidates('WBAJA7C5XJG000001', { base: 'https://x', key: 'k', fetch: stub(500, { code: 'XX000', message: 'boom' }) });
    ok('8d. збій БД: структурований лог з назвою операції', !r.ok && r.reason === 'error' && logs.some(l => /\[mi-equipment\]/.test(l) && /"op":"mi_equipment_candidates"/.test(l) && /"status":500/.test(l)), logs.join('|'));
    r = await M.fetchMiEquipmentCandidates('WBAJA7C5XJG000001', { base: 'https://x', key: 'k', timeoutMs: 20, fetch: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); })) });
    ok('8e. таймаут', !r.ok && r.reason === 'timeout');
    r = await M.fetchMiEquipmentCandidates('WBAJA7C5XJG000001', { env: { MI_EQUIPMENT: 'off' }, base: 'https://x', key: 'k', fetch: () => { throw new Error('must not be called'); } });
    ok('8f. вимикач MI_EQUIPMENT=off', !r.ok && r.reason === 'flag_off');
    r = await M.fetchMiEquipmentCandidates('WBAJA7C5XJG000001', { base: '', key: '' });
    ok('8g. без ключів: no_credentials', !r.ok && r.reason === 'no_credentials');
    r = await M.fetchMiEquipmentCandidates('', { base: 'https://x', key: 'k' });
    ok('8h. без VIN: no_vin', !r.ok && r.reason === 'no_vin');
    r = await M.fetchMiEquipmentCandidates('WBAJA7C5XJG000001', { base: 'https://x', key: 'k', fetch: stub(200, { available: false, reason: 'no_equipment_catalog', candidates: [] }) });
    ok('8i. каталог мовчить: чесна причина', r.ok && r.candidates.length === 0 && r.reason === 'no_equipment_catalog');
    calls.length = 0; logs.length = 0;
    r = await M.recordMiEquipment('wbaja7c5xjg000001', rows, { base: 'https://x', key: 'k', fetch: stub(200, { written: 2, skipped: 0, rejected: 0 }) });
    ok('8j. запис: mi_record_equipment з рядками', r.ok && r.written === 2 && calls[0].url.endsWith('/rest/v1/rpc/mi_record_equipment')
      && JSON.parse(calls[0].init.body).p_vin === 'WBAJA7C5XJG000001' && JSON.parse(calls[0].init.body).p_observations.length === 2);
    r = await M.recordMiEquipment('WBAJA7C5XJG000001', rows, { base: 'https://x', key: 'k', fetch: stub(500, { code: 'XX000' }) });
    ok('8k. збій запису логується', !r.ok && logs.some(l => /"op":"mi_record_equipment"/.test(l)));
    r = await M.recordMiEquipment('WBAJA7C5XJG000001', [], { base: 'https://x', key: 'k', fetch: () => { throw new Error('must not be called'); } });
    ok('8l. нічого писати: без виклику', r.ok && r.written === 0);
    ok('8m. ключ у лог не потрапляє', !logs.some(l => /Bearer|"k"/.test(l)));
  } finally {
    console.log = origLog;
  }

  /* ---- 9. проводка в api/check.js ---- */
  const core = CHECK_SRC.slice(CHECK_SRC.indexOf('async function runCheck('));
  ok('9. кандидати запитуються після Vehicle Memory', core.indexOf('fetchMiEquipmentCandidates(listing.vin)') > core.indexOf('const observation = await observeListing('));
  ok('9b. Vision отримує підказку перед кадрами і чекає обмежено', /content: miVisionHint \? \[\{ type: 'text', text: miVisionHint \}, \.\.\.frameContent\(sent, 'mixed'\)\] : frameContent\(sent, 'mixed'\)/.test(core)
    && /MI_EQ_VISION_WAIT_MS - \(Date\.now\(\) - tCv\)/.test(core));
  ok('9c. блок основного виклику після тексту оголошення', /if \(miEqBlock\) content\.splice\(1, 0, \{ type: 'text', text: miEqBlock \}\);/.test(core));
  ok('9d. позначка після верифікатора', core.indexOf('applyMiEquipment(parsed.equipment_v2') > core.indexOf('applyEquipmentVerifier(parsed.equipment_v2'));
  ok('9e. памʼять пишеться лише з підтвердженими пунктами', /\(listing\.vin && miEqApplied && miEqApplied\.confirmed\)\s*\? recordMiEquipment\(listing\.vin, equipmentMemoryObservations\(parsed\.equipment_v2/.test(core));
  ok('9f. вимикач читає лише api/mi-equipment.js', fs.readdirSync('api').filter(f => f.endsWith('.js') && fs.readFileSync('api/' + f, 'utf8').includes('MI_EQUIPMENT')).join() === 'mi-equipment.js');
  ok('9g. Score, впевненість і вердикт каталог не читають', !/mi_equipment|miEq/.test(fs.readFileSync('api/score-v4.js', 'utf8')) && !/mi_equipment/.test(fs.readFileSync('result-check.html', 'utf8')));

  fs.rmSync(dir, { recursive: true, force: true });
  if (errs.length) {
    console.error('miequipmenttest: помилок ' + errs.length + ' із ' + checks);
    for (const e of errs) console.error(' - ' + e);
    process.exit(1);
  }
  console.log('miequipmenttest: усі ' + checks + ' перевірок пройшли');
})().catch(e => { console.error('miequipmenttest CRASHED:', e.stack || e.message); process.exit(1); });
