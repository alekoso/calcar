/* CalCar: єдина серверна семантика локалі.
   English це технічна база, дефолт і фолбек для ВСЬОГО user-facing контенту.
   Українська і російська це локалізації поверх неї. Обрана користувачем
   локаль CalCar (явна, підтримувана) є єдиним джерелом правди: мова
   оголошення, країна, IP чи мова останнього повідомлення в чаті мову
   відповіді НЕ визначають.

   Внутрішній код української лишається 'ua' (localStorage, _meta.lang,
   кеш перекладів у збережених звітах); 'uk' і 'uk-UA' нормалізуються в нього,
   щоб не створювати регресій. Це не Vercel-функція: файл без default export. */

export const SUPPORTED_LOCALES = ['en', 'ua', 'ru'];
export const DEFAULT_LOCALE = 'en';
export const FALLBACK_LOCALE = 'en';

/* явна підтримувана локаль -> нормалізований код; відсутня, невідома,
   зіпсована чи непідтримувана -> English. Нічого не вгадуємо */
export function resolveLocale(raw) {
  const n = String(raw == null ? '' : raw).toLowerCase().trim();
  if (!n) return FALLBACK_LOCALE;
  if (n === 'ua' || n === 'uk' || n.startsWith('uk-') || n.startsWith('ua-')) return 'ua';
  if (n === 'ru' || n.startsWith('ru-')) return 'ru';
  if (n === 'en' || n.startsWith('en-')) return 'en';
  return FALLBACK_LOCALE;
}

/* назви мов для директив моделі: орудний ("пиши українською") і знахідний
   ("переклади на українську") відмінки */
export const LANG_NAME = { ua: 'українською', ru: 'російською', en: 'англійською (English)' };
export const LANG_NAME_ACC = { ua: 'українську', ru: 'російську', en: 'англійську (English)' };

/* директива мови для будь-якого user-facing тексту від моделі: явна локаль
   CalCar, без залежності від мови джерела чи мови питання */
export function languageDirective(lang) {
  const l = resolveLocale(lang);
  return 'МОВА ВІДПОВІДІ: усі текстові значення для користувача пиши ' + LANG_NAME[l]
    + ', незалежно від мови оголошення, вихідних даних, памʼяті чи мови, якою поставлене питання. '
    + 'Ключі JSON та enum-значення залишай латиницею точно за схемою.';
}

/* мінімальний locale-aware шар помилок API: обрана підтримувана локаль ->
   локалізований текст, невідома -> English. Без окремого фреймворку */
const ERRORS = {
  ai_not_configured: {
    en: 'AI service is not configured (OPENAI_API_KEY)',
    ua: 'AI-сервіс не налаштований (OPENAI_API_KEY)',
    ru: 'AI-сервис не настроен (OPENAI_API_KEY)',
  },
  apify_not_configured: {
    en: 'Lot data service is not configured (APIFY_TOKEN)',
    ua: 'Сервіс даних лота не налаштований (APIFY_TOKEN)',
    ru: 'Сервис данных лота не настроен (APIFY_TOKEN)',
  },
  bad_listing_url: {
    en: 'Paste the full listing link, starting with https://',
    ua: 'Встав повне посилання на оголошення, з https://',
    ru: 'Вставь полную ссылку на объявление, с https://',
  },
  listing_extract_failed: {
    en: 'Could not read the listing data from this page. Send a different link',
    ua: 'Зі сторінки не вдалося витягнути дані оголошення. Надішли інше посилання',
    ru: 'Со страницы не удалось извлечь данные объявления. Пришли другую ссылку',
  },
  ai_request_failed: {
    en: 'AI request failed',
    ua: 'помилка запиту до AI',
    ru: 'ошибка запроса к AI',
  },
  ai_invalid_response: {
    en: 'AI returned an invalid response, please try again',
    ua: 'AI повернув невалідну відповідь, спробуй ще раз',
    ru: 'AI вернул невалидный ответ, попробуй ещё раз',
  },
  ai_unavailable: {
    en: 'AI is unavailable, please try again',
    ua: 'AI недоступний, спробуй ще раз',
    ru: 'AI недоступен, попробуй ещё раз',
  },
  check_timeout: {
    en: 'The analysis did not finish in time. Try again, the second run is usually faster',
    ua: 'Аналіз не встиг завершитись. Спробуй ще раз, зазвичай з другої спроби швидше',
    ru: 'Анализ не успел завершиться. Попробуй ещё раз, обычно со второй попытки быстрее',
  },
  internal: {
    en: 'Internal error',
    ua: 'Внутрішня помилка',
    ru: 'Внутренняя ошибка',
  },
  analyze_need_input: {
    en: 'Add lot photos or a full 17-character VIN',
    ua: 'Додай фото лота або повний VIN (17 символів)',
    ru: 'Добавь фото лота или полный VIN (17 символов)',
  },
  analyze_need_3_photos: {
    en: 'Damage analysis needs at least 3 photos. Or leave only the VIN and we will calculate without the analysis',
    ua: 'Для розбору пошкоджень потрібно щонайменше 3 фото. Або залиш лише VIN, порахуємо без розбору',
    ru: 'Для разбора повреждений нужно минимум 3 фото. Или оставь только VIN, посчитаем без разбора',
  },
  vin_decode_failed: {
    en: 'The VIN could not be decoded. Check the characters or add photos',
    ua: 'VIN не декодувався. Перевір символи або додай фото',
    ru: 'VIN не декодировался. Проверь символы или добавь фото',
  },
  chat_empty_question: {
    en: 'Empty question',
    ua: 'Порожнє питання',
    ru: 'Пустой вопрос',
  },
  chat_empty_reply: {
    en: 'AI returned an empty reply, please try again',
    ua: 'AI повернув порожню відповідь, спробуй ще раз',
    ru: 'AI вернул пустой ответ, попробуй ещё раз',
  },
  chat_timeout: {
    en: 'The reply did not arrive in time, please try again',
    ua: 'Відповідь не встигла за відведений час, спробуй ще раз',
    ru: 'Ответ не успел за отведённое время, попробуй ещё раз',
  },
  memory_empty: {
    en: 'Empty conversation',
    ua: 'Порожня розмова',
    ru: 'Пустой разговор',
  },
  memory_timeout: {
    en: 'Did not finish in time, try again later',
    ua: 'Не встигли, спробуй пізніше',
    ru: 'Не успели, попробуй позже',
  },
  translate_need_report: {
    en: 'A report is required',
    ua: 'Потрібен звіт',
    ru: 'Нужен отчёт',
  },
  translate_report_too_big: {
    en: 'The report is too large',
    ua: 'Звіт завеликий',
    ru: 'Отчёт слишком большой',
  },
  translate_failed: {
    en: 'Translation failed, please try again',
    ua: 'Переклад не вдався, спробуй ще раз',
    ru: 'Перевод не удался, попробуй ещё раз',
  },
  debug_need_url: {
    en: 'Add ?url=listing_link',
    ua: 'Додай ?url=посилання_на_оголошення',
    ru: 'Добавь ?url=ссылка_на_объявление',
  },
  lot_need_ref: {
    en: 'Enter a lot link or a lot number',
    ua: 'Вкажи посилання на лот або номер лота',
    ru: 'Укажи ссылку на лот или номер лота',
  },
  lot_need_copart_iaai: {
    en: 'Paste a Copart or IAAI lot link',
    ua: 'Встав посилання на лот Copart чи IAAI',
    ru: 'Вставь ссылку на лот Copart или IAAI',
  },
  lot_no_photos: {
    en: 'Lot photos were not received, none of the sources responded. Upload the photos manually',
    ua: 'Фото лота не отримані, жоден із джерел не відповів. Завантаж фото вручну',
    ru: 'Фото лота не получены, ни один из источников не ответил. Загрузи фото вручную',
  },
  lot_fetch_failed: {
    en: 'Could not get the lot data',
    ua: 'Не вдалося отримати дані лота',
    ru: 'Не удалось получить данные лота',
  },
};
export const ERROR_KEYS = Object.keys(ERRORS);

/* текст помилки обраною локаллю; detail (технічна причина) додається через
   двокрапку лише там, де це справді допомагає користувачу */
export function errText(lang, key, detail) {
  const l = resolveLocale(lang);
  const row = ERRORS[key];
  const base = row ? (row[l] || row[FALLBACK_LOCALE]) : String(key);
  const d = detail == null ? '' : String(detail).trim();
  return d ? base + ': ' + d : base;
}
