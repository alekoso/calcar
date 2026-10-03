/* CalCar Check: переклад готового звіту, чиста логіка без мережі.

   Модель НЕ отримує звіт і НЕ повертає звіт. Код детерміновано збирає з
   публічного звіту лише рядки, які людина бачить і які треба перекладати,
   модель перекладає плаский список { id, text }, а перекладений вигляд код
   складає з ОРИГІНАЛУ, підставляючи текст за шляхом id. Числа, Score,
   Confidence, ціни, коди, структура лишаються оригінальними.

   Що не йде в модель:
   - score_breakdown, score_breakdown_v2, confidence, _meta, translations і
     решта службових розділів (їх немає в SECTIONS);
   - коди і перелічення (CODE_KEYS), дати, номери, VIN, URL, id кадрів;
   - provenance: внутрішнє походження опції, звіт його не показує;
   - статичні підписи інтерфейсу: їх дає словник i18n мови перекладу.
   Опис продавця живе в _meta.seller_text і, як і раніше, не перекладається. */

import crypto from 'node:crypto';

/* версія правил: зміна правил робить старий кеш недійсним */
export const TRANSLATE_VERSION = 'tr1';

/* розділи звіту, які показує сторінка і в яких є текст для людини */
const SECTIONS = ['vehicle', 'verdict', 'purchase_decision', 'final_conclusion', 'risks', 'discrepancies',
  'history', 'history_note', 'photo_findings', 'auction', 'model_notes', 'checklist', 'equipment_v2',
  'equipment', 'data_notes', 'market_value'];
/* коди, перелічення і службові поля: ніколи не перекладаються */
const CODE_KEYS = new Set(['status', 'severity', 'level', 'kind', 'category', 'confidence_level', 'factory_status',
  'marketplace', 'photo_id', 'source', 'source_ref', 'type', 'value_tier', 'owner_ordinal_source', 'event_source',
  'date', 'gap', 'price_story', 'retention_state', 'value_loss', 'state', 'side', 'unit_raw', 'id', 'key', 'lang',
  'code', 'label_key', 'input', 'family', 'operation', 'provenance', 'currency', 'fuel', 'generation', 'trim',
  'year', 'model_year', 'url', 'vin', 'plate', 'make', 'model']);
/* назва авто це бренд і модель, не текст */
const DENY_PATHS = new Set(['vehicle.title']);
/* поля, де одне слово теж текст для людини ("Sunroof", "Automatic") */
const WORD_KEYS = new Set(['name', 'title', 'transmission', 'drive', 'engine', 'unit', 'sign', 'event', 'text',
  'note', 'action', 'detail', 'summary', 'headline', 'body', 'mileage_note']);
/* масиви рядків, кожен елемент яких текст для людини */
const WORD_LISTS = new Set(['checklist', 'sources', 'reasons', 'missing_but_important', 'questions_for_seller', 'price_factors']);

const URL_RE = /^(?:https?:)?\/\//i;
const SNAKE_RE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
const LETTERS_RE = /\p{L}{2,}/u;
const LOWER_RE = /\p{Ll}/u;
const NON_ASCII_LETTER_RE = /[^\u0000-\u007f]/;

function translatable(value, key, listKey) {
  const s = String(value);
  if (!s.trim() || URL_RE.test(s.trim()) || SNAKE_RE.test(s.trim())) return false;
  if (!LETTERS_RE.test(s) || !LOWER_RE.test(s)) return false;     /* числа, дати, VIN, коди на кшталт FWD */
  if (/\s/.test(s.trim()) || NON_ASCII_LETTER_RE.test(s)) return true;
  return WORD_KEYS.has(key) || WORD_LISTS.has(listKey);
}

/* публічний звіт -> [{ id: "risks.0.title", text }] у сталому порядку обходу */
export function extractTranslatable(report) {
  const out = [];
  if (!report || typeof report !== 'object') return out;
  const walk = (v, path, key, listKey) => {
    if (typeof v === 'string') {
      if (!DENY_PATHS.has(path) && translatable(v, key, listKey)) out.push({ id: path, text: v });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + '.' + i, key, key)); return; }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (CODE_KEYS.has(k) || k.startsWith('_')) continue;
        walk(v[k], path + '.' + k, k, null);
      }
    }
  };
  for (const sec of SECTIONS) if (report[sec] !== undefined && report[sec] !== null) walk(report[sec], sec, sec, null);
  return out;
}

/* відбиток вихідних рядків: інший текст звіту, інша мова джерела чи інші
   правила -> інший ключ, і старий переклад не застосовується */
export function translationHash(items, srcLang, target) {
  return crypto.createHash('sha256').update(TRANSLATE_VERSION + '|' + srcLang + '|' + target + '|' + JSON.stringify(items)).digest('hex').slice(0, 32);
}

/* відповідь моделі: рівно ті самі id у тому самому порядку, кожен текст непорожній */
export function validateTranslated(items, got) {
  const list = got && Array.isArray(got.items) ? got.items : null;
  if (!list) return { ok: false, reason: 'no_items' };
  if (list.length !== items.length) return { ok: false, reason: list.length < items.length ? 'missing_items' : 'extra_items' };
  const texts = {};
  for (let i = 0; i < items.length; i++) {
    const g = list[i];
    if (!g || g.id !== items[i].id) return { ok: false, reason: 'id_mismatch', at: i };
    if (typeof g.text !== 'string' || !g.text.trim()) return { ok: false, reason: 'empty_text', at: i };
    /* правило продукту: довгого тире немає ніде */
    texts[g.id] = g.text.replace(/\s*\u2014\s*/g, ', ');
  }
  return { ok: true, texts };
}

/* перекладений вигляд: глибока копія ОРИГІНАЛУ з підміною лише рядків за
   id; рядок підміняється лише якщо в оригіналі за цим шляхом той самий
   вихідний текст. Оригінал не змінюється */
export function applyTranslations(report, items, texts) {
  const view = JSON.parse(JSON.stringify(report));
  let applied = 0;
  for (const it of items) {
    const segs = it.id.split('.');
    let o = view;
    for (let i = 0; i < segs.length - 1 && o != null; i++) o = o[segs[i]];
    const last = segs[segs.length - 1];
    if (o != null && o[last] === it.text && typeof texts[it.id] === 'string') { o[last] = texts[it.id]; applied++; }
  }
  return { view, applied };
}

/* один пакетний запит перекладу: короткий строгий промпт і схема відповіді */
export const TRANSLATE_SCHEMA = {
  name: 'report_translation',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } },
      },
    },
  },
};
const LANG_EN = { ua: 'Ukrainian', ru: 'Russian', en: 'English' };
export function translateMessages(items, target) {
  return [
    { role: 'system', content: 'You translate UI text of a car inspection report into ' + LANG_EN[target] + '. '
      + 'Translate every item text. Preserve the meaning exactly: do not summarize, shorten, add, explain or rewrite. '
      + 'Keep numbers, measurements, prices, dates, VINs, plate numbers, brand and model names and automotive terminology accurate; write units the usual way for the target language. '
      + 'Keep paragraph breaks. Never use the em dash character. '
      + 'Return the same ids in the same order: one output item per input item, no missing or extra items.' },
    { role: 'user', content: JSON.stringify({ items }) },
  ];
}
