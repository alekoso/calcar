/* CalCar Check: шар обліку фотодоказів (Evidence Coverage v1).

   Проблема, яку він закриває. Звіт казав «зона не показана», коли кадр у
   галереї був, але не потрапив у вибірку (селектор упав і кадри взято
   рівномірно), або потрапив, а модель не змогла його прочитати (одометр
   на кадрі панелі без показань). «Не показано» і «не перевірено» це
   різні твердження, і друге не можна видавати за перше.

   Для кожної області (кузов, салон, панель приладів, одометр, моторний
   відсік, днище, багажник, колеса, документи, архів) код визначає статус:
   - absent: кадрів цієї області в галереї справді нема (класифікація
     повна, або вся галерея пішла в розбір) і розбір її не побачив;
   - present_not_selected: кадри є, але у вибірку не потрапили;
   - selected_unreadable: кадри потрапили в розбір, але область чи факт
     прочитати не вдалося;
   - interpreted: область розібрана;
   - present_not_interpreted: кадр є, аналізатора для нього нема (документи);
   - not_reviewed: класифікації нема (селектор упав) або розбору нема, тому
     нічого стверджувати не можна. UNKNOWN не дорівнює ABSENT.

   Вхід: лише те, що вже є у _meta: вибірка кадрів із повною класифікацією
   (types_all), кадри, які реально дійшли до Current Vision, його зони і
   панель, архівні кадри. Дублікати рахуються за photoIdentity, тому
   повторно викладений кадр покриття не збільшує. Жодних нових AI-викликів. */

import { photoIdentity } from './vehicle-memory.js';

export const EVIDENCE_COVERAGE_VERSION = 'ec-2026-10-06-v1';
export const COVERAGE_AREAS = ['exterior_body', 'interior', 'dashboard_cluster', 'odometer', 'engine_bay', 'underbody', 'trunk_cargo', 'wheels_tires', 'document', 'historical'];
export const COVERAGE_STATUSES = ['absent', 'present_not_selected', 'selected_unreadable', 'interpreted', 'present_not_interpreted', 'not_reviewed'];

/* типи кадрів селектора -> область. detail і other область не визначають */
export const TYPE_AREA = {
  front: 'exterior_body', rear: 'exterior_body', side: 'exterior_body', roof: 'exterior_body',
  doors: 'interior', front_seats: 'interior', rear_seats: 'interior', center_console: 'interior', steering: 'interior',
  dashboard: 'dashboard_cluster', engine_bay: 'engine_bay', trunk: 'trunk_cargo', wheels: 'wheels_tires', document: 'document',
};
/* зони Current Vision -> область */
export const ZONE_AREA = {
  front: 'exterior_body', rear: 'exterior_body', left_front: 'exterior_body', left_side: 'exterior_body', left_rear: 'exterior_body',
  right_front: 'exterior_body', right_side: 'exterior_body', right_rear: 'exterior_body', roof: 'exterior_body',
  driver_area: 'interior', front_passenger: 'interior', front_seats: 'interior', rear_seats: 'interior', center_console: 'interior', doors: 'interior',
  dashboard: 'dashboard_cluster', engine_bay: 'engine_bay', underbody: 'underbody', trunk: 'trunk_cargo', wheels: 'wheels_tires',
};
/* кадри, на яких буває одометр: панель, кермо (панель за ним), центральний екран */
const ODOMETER_TYPES = new Set(['dashboard', 'steering', 'center_console']);
const VIS_RANK = { sufficient: 2, partial: 1, not_visible: 0 };

const uniq = arr => [...new Set(arr)];

/* ---------- вхід ----------
   gallery: { total, photos: [url], variants_removed }
   selection: { mode: 'selector'|'all'|'even_fallback'|'even_benchmark', picked: [gi], types_all: [type per gallery index] | null }
   cv: { status, frames: [{gallery_index, photo_identity, type}], dropped: [gi], zones, dashboard } | null
   historical: { photos: n, hv_status: 'executed'|'cached'|'skipped'|... } */
export function buildEvidenceCoverage({ gallery = {}, selection = {}, cv = null, historical = {} } = {}) {
  const total = Number.isFinite(gallery.total) ? gallery.total : (Array.isArray(gallery.photos) ? gallery.photos.length : 0);
  const photos = Array.isArray(gallery.photos) ? gallery.photos : [];
  const picked = uniq((Array.isArray(selection.picked) ? selection.picked : []).filter(Number.isInteger));
  const typesAll = Array.isArray(selection.types_all) && selection.types_all.length === total ? selection.types_all : null;
  const classification = typesAll ? 'full' : (selection.mode === 'all' && picked.length === total && total > 0 ? 'all_frames' : 'none');
  const cvOk = !!(cv && cv.status === 'ok' && cv.zones);
  const sent = cvOk ? uniq((Array.isArray(cv.frames) ? cv.frames : []).map(f => f.gallery_index).filter(Number.isInteger)) : [];
  const dropped = new Set(Array.isArray(cv && cv.dropped) ? cv.dropped : []);
  const delivered = sent.filter(gi => !dropped.has(gi));
  /* дублікати: один фізичний кадр під різними адресами рахується один раз */
  const idOf = gi => (photos[gi] ? photoIdentity(photos[gi]) : 'gi:' + gi);
  const uniqueCount = list => new Set(list.map(idOf)).size;

  const zoneVis = area => {
    if (!cvOk) return null;
    let best = null;
    for (const [z, a] of Object.entries(ZONE_AREA)) {
      if (a !== area) continue;
      const v = cv.zones[z] && cv.zones[z].visibility;
      if (!v) continue;
      if (best === null || VIS_RANK[v] > VIS_RANK[best]) best = v;
    }
    return best;
  };
  const framesOfTypes = types => typesAll ? typesAll.map((t, i) => (types.has(t) ? i : -1)).filter(i => i >= 0) : null;

  const areas = {};
  const addArea = (area, types) => {
    const present = framesOfTypes(types);
    const presentUnique = present ? uniqueCount(present) : null;
    const selected = present ? present.filter(gi => picked.includes(gi)) : [];
    const deliveredHere = present ? selected.filter(gi => delivered.includes(gi)) : [];
    const vis = area === 'document' ? null : zoneVis(area);
    let status, reason = null;
    if (area === 'document') {
      if (classification === 'full') status = present.length ? 'present_not_interpreted' : 'absent';
      else status = 'not_reviewed';
    } else if (vis === 'sufficient' || vis === 'partial') {
      status = 'interpreted';
      if (vis === 'partial') reason = 'partial_visibility';
    } else if (classification === 'full') {
      if (!present.length) status = cvOk ? 'absent' : 'not_reviewed';
      else if (!selected.length) status = 'present_not_selected';
      else if (!deliveredHere.length) { status = 'selected_unreadable'; reason = 'frames_not_delivered'; }
      else status = cvOk ? 'selected_unreadable' : 'not_reviewed';
    } else if (classification === 'all_frames') {
      status = cvOk ? (dropped.size && !delivered.length ? 'selected_unreadable' : 'absent') : 'not_reviewed';
    } else {
      status = 'not_reviewed';
      reason = cvOk ? 'frames_unclassified' : 'no_vision';
    }
    areas[area] = {
      status, reason,
      present_frames: present ? present.map(i => i + 1) : null,
      present_unique: presentUnique,
      selected_frames: selected.map(i => i + 1),
      delivered_frames: deliveredHere.map(i => i + 1),
      visibility: vis,
    };
  };
  for (const area of ['exterior_body', 'interior', 'dashboard_cluster', 'engine_bay', 'underbody', 'trunk_cargo', 'wheels_tires', 'document']) {
    const types = new Set(Object.entries(TYPE_AREA).filter(([, a]) => a === area).map(([t]) => t));
    addArea(area, types);
  }

  /* одометр: факт, а не зона. Зберігає кадр, одиницю і впевненість читання */
  const dash = cvOk && cv.dashboard ? cv.dashboard : null;
  const reading = dash && dash.odometer_reading && Number.isFinite(dash.odometer_reading.value) ? dash.odometer_reading : null;
  const odoPresent = framesOfTypes(ODOMETER_TYPES);
  const odoSelected = odoPresent ? odoPresent.filter(gi => picked.includes(gi)) : [];
  const odoDelivered = odoSelected.filter(gi => delivered.includes(gi));
  let odo;
  if (reading && (reading.confidence === 'high' || reading.confidence === 'medium') && reading.unit !== 'unknown') {
    odo = { status: 'interpreted', reason: null };
  } else if (reading) {
    odo = { status: 'selected_unreadable', reason: reading.unit === 'unknown' ? 'unit_unknown' : 'low_confidence' };
  } else if (dash && dash.visible === true) {
    odo = { status: 'selected_unreadable', reason: 'no_reading_on_visible_cluster' };
  } else if (classification === 'full') {
    if (!odoPresent.length) odo = { status: cvOk ? 'absent' : 'not_reviewed', reason: null };
    else if (!odoSelected.length) odo = { status: 'present_not_selected', reason: null };
    else if (!odoDelivered.length) odo = { status: 'selected_unreadable', reason: 'frames_not_delivered' };
    else odo = { status: cvOk ? 'selected_unreadable' : 'not_reviewed', reason: cvOk ? 'cluster_not_recognized' : 'no_vision' };
  } else if (classification === 'all_frames') {
    odo = { status: cvOk ? 'absent' : 'not_reviewed', reason: null };
  } else {
    odo = { status: 'not_reviewed', reason: cvOk ? 'frames_unclassified' : 'no_vision' };
  }
  areas.odometer = {
    ...odo,
    present_frames: odoPresent ? odoPresent.map(i => i + 1) : null,
    selected_frames: odoSelected.map(i => i + 1),
    delivered_frames: odoDelivered.map(i => i + 1),
    reading: reading ? { value: reading.value, unit: reading.unit, confidence: reading.confidence, photo: Number(reading.gallery_index) + 1, photo_identity: reading.photo_identity || null } : null,
  };

  /* архів: окремий корпус кадрів, з нинішніми не змішується */
  const hPhotos = Number.isFinite(historical.photos) ? historical.photos : 0;
  const hv = String(historical.hv_status || '');
  areas.historical = {
    status: !hPhotos ? 'absent' : (hv === 'executed' || hv === 'cached' ? 'interpreted' : (hv ? 'selected_unreadable' : 'not_reviewed')),
    reason: hPhotos && hv && hv !== 'executed' && hv !== 'cached' ? 'hv_' + hv : null,
    present_frames: hPhotos, corpus: 'auction_archive',
  };

  const list = st => Object.entries(areas).filter(([, a]) => a.status === st).map(([k]) => k);
  return {
    version: EVIDENCE_COVERAGE_VERSION,
    classification,
    selection_mode: selection.mode || null,
    gallery: { total, unique: photos.length ? uniqueCount(photos.map((_, i) => i)) : null, variants_removed: Number.isFinite(gallery.variants_removed) ? gallery.variants_removed : null,
      unrelated_frames: typesAll ? typesAll.filter(t => t === 'detail' || t === 'other').length : null },
    vision: { status: cv ? cv.status || null : 'absent', sent: sent.length, delivered: delivered.length, dropped: [...dropped].map(i => i + 1) },
    areas,
    summary: {
      interpreted: list('interpreted'),
      absent: list('absent'),
      present_not_selected: list('present_not_selected'),
      selected_unreadable: list('selected_unreadable'),
      not_reviewed: [...list('not_reviewed'), ...list('present_not_interpreted')],
    },
  };
}

/* чи може звіт сказати про область «не показано»: лише коли покриття
   підтверджує відсутність кадрів. Решта статусів вимагає інших слів */
export function mayClaimNotShown(coverage, area) {
  const a = coverage && coverage.areas && coverage.areas[area];
  return !!(a && a.status === 'absent');
}
