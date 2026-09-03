/* CalCar Check: публічний read-only звіт і людське посилання.
   Тут живуть три чисті речі без побічних ефектів:
   - TOKEN_RE: формат непрозорого share-токена (128 біт, base64url);
   - publicReport(): ЯВНИЙ ALLOWLIST-серіалізатор. У публічну відповідь
     потрапляє лише перелічене тут; нове поле у схемі звіту публічним
     не стає автоматично. Приватне (переписка чату, входи рішення з
     іншими авто цієї людини, службова діагностика пайплайна, текст
     продавця для чату) сюди не входить за побудовою, а не за списком
     винятків;
   - slug: make-model-year лише для читабельності адреси. Slug не є
     ключем доступу: звіт визначає токен, неправильний slug лише
     виправляється канонічним redirect на сторінці. */

export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* верхній рівень звіту, дозволений публічно */
const PUBLIC_TOP = [
  'vehicle', 'verdict', 'purchase_decision', 'risks', 'discrepancies',
  'history', 'history_note', 'photo_findings', 'auction', 'model_notes',
  'checklist', 'equipment_v2', 'equipment', 'body_wrap', 'data_notes',
  'presentation_damage', 'historical_visual',
  'score_breakdown', 'score_breakdown_v2', 'score_v2_preview', 'active_score_version',
  'translations',
];
/* _meta: лише те, що потрібно сторінці звіту для показу */
const PUBLIC_META = [
  'kind', 'lang', 'url', 'domain', 'country', 'vin', 'plate', 'price', 'currency',
  'odometer_km', 'photos', 'auction_url', 'auction_photos', 'auction_photos_provenance',
  'auction_meta', 'photo_map', 'price_context', 'analyzed_at',
  'share_token', 'share_slug', 'historical_visual_cache',
];
/* auction_search: сторінці потрібні лише статус і адреса лота */
const PUBLIC_AUCTION_SEARCH = ['status', 'source', 'lot_url', 'sale_date'];

const pick = (obj, keys) => {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

export function publicReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  const out = pick(report, PUBLIC_TOP);
  const meta = pick(report._meta, PUBLIC_META);
  if (report._meta && report._meta.auction_search && typeof report._meta.auction_search === 'object') {
    meta.auction_search = pick(report._meta.auction_search, PUBLIC_AUCTION_SEARCH);
  }
  out._meta = meta;
  return out;
}

/* коротка картка для списків (недавні перевірки на пристрої): сервер
   є джерелом правди, локальний кеш лише прискорює перший рендер */
export function reportSummary(report) {
  if (!report || typeof report !== 'object') return null;
  const sb = report.score_breakdown || {};
  const score = typeof sb.final === 'number' ? sb.final : (report.verdict && typeof report.verdict.score === 'number' ? report.verdict.score : null);
  return {
    title: (report.vehicle && report.vehicle.title) || null,
    photo: (report._meta && Array.isArray(report._meta.photos) && report._meta.photos[0]) || null,
    odometer_km: (report._meta && report._meta.odometer_km) || null,
    score,
    slug: reportSlug(report),
  };
}

/* транслітерація кирилиці для назв, які прийшли не латиницею */
const TR = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'e', ъ: '',
};
export function slugify(s) {
  const str = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const lat = str.replace(/[а-яёєіїґ]/g, c => TR[c] !== undefined ? TR[c] : '');
  const out = lat.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 60).replace(/-+$/, '');
  return out || 'car';
}

/* make-model-year: серверна назва з оголошення (латиниця площадки), інакше
   назва авто зі звіту; рік додається, якщо його ще нема в назві */
export function reportSlug(report) {
  if (!report || typeof report !== 'object') return 'car';
  const meta = report._meta || {};
  if (typeof meta.share_slug === 'string' && SLUG_RE.test(meta.share_slug)) return meta.share_slug;
  const v = report.vehicle || {};
  let base = slugify(v.title || '');
  const year = v.year && /^\d{4}$/.test(String(v.year)) ? String(v.year) : null;
  if (year && !base.includes(year)) base = (base === 'car' ? '' : base + '-') + year;
  return base || 'car';
}

/* адреса звіту: /check/r/<slug>/<token>; slug лише для людини */
export function sharePath(report, token) {
  return '/check/r/' + reportSlug(report) + '/' + token;
}

/* непрозорий токен: 16 випадкових байтів у base64url (22 символи) */
import crypto from 'crypto';
export function makeToken() {
  return crypto.randomBytes(16).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
