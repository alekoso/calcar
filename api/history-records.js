/* CalCar: записи джерела (source records) з блоку історії площадки ->
   структуровані записи з чесним походженням, окремо від канонічних подій.

   Блок історії площадки це не хронологія і не події: це перелік записів
   різних джерел (реєстр, архів аукціону, дилерське СТО, страхова, минулі
   оголошення), де одна фізична подія може лишити кілька записів (запис
   ДТП за рік удару, запис за рік продажу лота, зведення зверху сторінки),
   а один рядок може нести чужу одиницю виміру. Тут кожен запис читається
   як запис: вид, рік чи дата, текст, зони, причина, походження, чи є фото.
   Що з них одна подія, вирішує groupAccidentRecords за доказами, а не за
   кількістю рядків чи схожістю тексту.

   Модуль чистий і не знає ринку: він розбирає розмітку цієї площадки
   (підписи "Зафіксовано ДТП", "Джерело фіксації", "Страхові випадки"),
   але жодне продуктове правило тут не залежить від країни. Класифікатор
   зон приходить ззовні (zoneClasses зі score-v3.js), тому модуль без
   імпортів і його можна виконати в тестах поряд із extractHistoryFacts. */

/* дефіс, en dash і em dash у підписі "Джерело фіксації"; у коді лише escape */
const DASH = '[\\u2014\\u2013-]';
const YEAR_RE = /(?<![\d.])((?:19|20)\d{2})(?![\d.])/;

export function recordCause(text) {
  const t = String(text || '').toLowerCase();
  if (/повін|повен|затоп|утоп|flood|water damage/.test(t)) return 'flood';
  if (/пожеж|пожар|згор|сгор|горіл|горел|\bfire\b|\bburn/.test(t)) return 'fire';
  return null;
}

/* підпис "Джерело фіксації: ..." -> походження точки пробігу */
export function classifyFixationSource(label) {
  const t = String(label || '').toLowerCase();
  if (!t.trim()) return null;
  if (/аукціон|аукцион|auction|copart|iaai|manheim/.test(t)) return 'auction_archive';
  if (/сто\b|дилер|dealer|service/.test(t)) return 'dealer_service';
  if (/технічн|техническ|inspection|перевірк|проверк/.test(t)) return 'inspection';
  if (/реєстр|реестр|registry|держ|государств/.test(t)) return 'registry';
  return 'marketplace_record';
}

const STOP = '(?=\\s(?:\\d{2}\\.\\d{2}\\.\\d{2}\\s|\\d{4}\\s+рік\\s|\\d{1,2}-\\S+\\s+(?:власник|владелец)|Дізнайтесь|Узнайте|Історія авто|История авто)|$)';
const toIso = d => { const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(d); return m ? '20' + m[3] + '-' + m[2] + '-' + m[1] : null; };
const toKm = (n, thousands) => { const v = parseInt(n, 10); return isFinite(v) ? (thousands ? v * 1000 : v) : null; };

/* text -> { accidents, insurance, odometer }
   accidents: [{ kind:'accident', year, text, zones:[], photos, cause, source }]
     source: 'marketplace_history' (рядок історії) | 'marketplace_summary' (зведення зверху)
   insurance: [{ kind:'insurance', year, text, cause, scope:'home'|'abroad', source:'marketplace_insurance' }]
   odometer:  [{ date, km, source, source_label, unit:'km_as_printed' }]
     source: 'past_listing' | 'registry' | 'auction_archive' | 'dealer_service' | 'inspection' | 'marketplace_record' */
export function parseHistoryRecords(text, { zoneClasses } = {}) {
  const t = String(text || '');
  const zones = s => (typeof zoneClasses === 'function' ? [...zoneClasses(s)] : []);
  const accidents = [];
  const seen = new Set();
  for (const m of t.matchAll(new RegExp('(\\d{4})\\s+рік\\s+Зафіксовано ДТП\\s*(.*?)' + STOP, 'g'))) {
    const year = parseInt(m[1], 10);
    let body = String(m[2] || '').trim();
    const photos = /Фото пошкоджень|Фото повреждений/i.test(body);
    body = body.replace(/\s*(Фото пошкоджень|Фото повреждений)\s*$/i, '').trim();
    const key = year + '|' + body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    accidents.push({ kind: 'accident', year, text: body || null, zones: zones(body), photos, cause: recordCause(body), source: 'marketplace_history' });
  }
  /* зведення зверху сторінки: "ДТП Зафіксовано • на території ... в 2021 р. • Основні ушкодження: ..., другорядні: ..." */
  for (const m of t.matchAll(/ДТП\s+Зафіксовано\s*•\s*(.*?)\s*•\s*(Основні ушкодження|Основные повреждения)[:\s]*(.*?)(?=\s\d+\s+з\s+\d+|\sДивитися|\sСмотреть|\sСтрахові|\sСтраховые|\sІсторія авто|$)/g)) {
    const where = String(m[1] || '').trim().replace(/\.$/, '');
    const dmg = String(m[3] || '').trim();
    const ym = YEAR_RE.exec(where);
    const year = ym ? parseInt(ym[1], 10) : null;
    const body = (where + '. ' + dmg).trim();
    accidents.push({ kind: 'accident', year, text: body, zones: zones(dmg), photos: false, cause: recordCause(body), source: 'marketplace_summary' });
  }
  const insurance = [];
  for (const m of t.matchAll(/(Страхові випадки|Страховые случаи)\s+(в Україні|в Украине|за кордоном|за рубежом)\s+(Виявлено|Обнаружен[оы]?)((?:\s*•[^•]*?)*?)(?=\s(?:Страхові випадки|Страховые случаи|Історія авто|История авто|Перевірено технічно|Дивитися деталі|Смотреть детали|Дізнайтесь|Узнайте)|$)/g)) {
    const scope = /кордон|рубеж/i.test(m[2]) ? 'abroad' : 'home';
    const items = String(m[4] || '').split('•').map(s => s.replace(/^\s*Виявлено\s*/i, '').trim()).filter(Boolean);
    if (!items.length) { insurance.push({ kind: 'insurance', year: null, text: null, cause: null, scope, source: 'marketplace_insurance' }); continue; }
    for (const it of items) {
      const ym = YEAR_RE.exec(it);
      insurance.push({ kind: 'insurance', year: ym ? parseInt(ym[1], 10) : null, text: it, cause: recordCause(it), scope, source: 'marketplace_insurance' });
    }
  }
  const odometer = [];
  for (const m of t.matchAll(/(\d{2}\.\d{2}\.\d{2})\s+Продавалось на AUTO\.RIA\s+Продавець вказав пробіг\s*(\d+)(\s*тис)?/g)) {
    const date = toIso(m[1]), km = toKm(m[2], !!m[3]);
    if (date && km !== null) odometer.push({ date, km, source: 'past_listing', source_label: null, unit: 'km_as_printed' });
  }
  for (const m of t.matchAll(/(\d{2}\.\d{2}\.\d{2})\s+Зафіксовано пробіг\s*(\d+)(\s*тис)?/g)) {
    const date = toIso(m[1]), km = toKm(m[2], !!m[3]);
    if (!date || km === null) continue;
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 160);
    const sm = new RegExp('Джерело фіксації\\s*' + DASH + '?\\s*(.{3,90}?)' + STOP).exec(tail);
    const label = sm ? sm[1].trim() : null;
    /* без підпису джерела запис читається як запис реєстру (поведінка до цього модуля) */
    odometer.push({ date, km, source: label ? classifyFixationSource(label) : 'registry', source_label: label, unit: 'km_as_printed' });
  }
  return { accidents, insurance, odometer };
}

/* ---------- ідентичність записів про ДТП ----------
   Два записи це ОДНА канонічна подія лише з доказом: та сама (або не
   суперечлива) картина зон і суміжні роки (|різниця| <= yearWindow), тобто
   типовий життєвий цикл одного удару (ДТП -> лот -> продаж -> вивіз).
   Різні зони або розрив у 2+ роки = окремі записи. Текстова схожість сама
   по собі не зливає. Записи одного року з тим самим текстом це точний
   дублікат (exact_duplicate); сусідніх років це possibly_same: подія одна,
   поки нема доказу двох ударів, другого підтвердженого ДТП не створюється.
   Записи з причиною повінь/пожежа це не ДТП, а hazards: їх рахує своя
   логіка (flood/fire) і вони не стають "ДТП невідомої тяжкості". */
const disjoint = (a, b) => a.length > 0 && b.length > 0 && a.every(z => !b.includes(z));
export function groupAccidentRecords(records, { yearWindow = 1 } = {}) {
  const list = (Array.isArray(records) ? records : []).filter(r => r && r.kind === 'accident');
  const hazards = list.filter(r => r.cause === 'flood' || r.cause === 'fire');
  const acc = list.filter(r => !r.cause).slice().sort((a, b) => (b.year || 0) - (a.year || 0));
  const groups = [];
  for (const r of acc) {
    const g = groups.find(x => !disjoint(x.zones, r.zones) && (r.year === null || x.year_max === null || Math.abs(x.year_max - r.year) <= yearWindow || Math.abs(x.year_min - r.year) <= yearWindow));
    if (g) {
      g.records.push(r);
      if (r.year !== null) { g.years.push(r.year); g.year_min = g.year_min === null ? r.year : Math.min(g.year_min, r.year); g.year_max = g.year_max === null ? r.year : Math.max(g.year_max, r.year); }
      for (const z of r.zones) if (!g.zones.includes(z)) g.zones.push(z);
      if (r.text && !g.texts.includes(r.text)) g.texts.push(r.text);
      g.photos = g.photos || r.photos;
    } else {
      groups.push({ records: [r], years: r.year === null ? [] : [r.year], year_min: r.year, year_max: r.year, zones: [...r.zones], texts: r.text ? [r.text] : [], photos: !!r.photos });
    }
  }
  for (const g of groups) {
    const distinct = new Set(g.years);
    g.identity = g.records.length === 1 ? 'single' : distinct.size <= 1 ? 'exact_duplicate' : 'possibly_same';
    g.year = g.year_max;
  }
  return { groups, hazards };
}
