/* Model Intelligence: тіньовий клієнт.

   Це ТІНЬ. Модуль нічого не додає у звіт Check. З Phase 7.6 він
   підключений до фонового завершення durable-job у `api/check.js`, але
   лише за серверним прапорцем `MI_SHADOW_ENABLED`; без прапорця виклику
   немає взагалі. Призначення те саме: порівняти те, що Check говорить
   сьогодні, з тим, що сказав би пакет знань, не міняючи продакшн-шлях.

   Схем `mi` і `mi_vm` у продакшні поки немає. Тому модуль мовчки
   вимикається у чотирьох випадках: немає ключів оточення, немає VIN,
   функції `mi_shadow_pack` немає у схемі (PostgREST віддає PGRST202 або
   404), запит не вклався у таймаут. Мовчки це не «проковтнути помилку»:
   причина завжди повертається у полі `reason` і її видно у логах.

   Назовні є рівно одна точка входу, `public.mi_shadow_pack(text)`:
   SECURITY DEFINER, права відкликані у public, anon і authenticated,
   тобто доступна лише службовому ключу. Ролі `mi` вона не розширює.

   Клієнт ЧИТАЄ. Побічний ефект у функції один і він навмисний: міст
   переносить те, що Check уже знає про машину, у Vehicle Memory
   (ідемпотентно, повторний виклик не пише нічого). Знання про моделі
   тінь не змінює і публікувати не може. */

const MISSING_FUNCTION = new Set(['PGRST202', 'PGRST106', '42883', '3F000']);

/* Причини, за яких тіні просто немає. Жодна з них не є збоєм Check.

   Тексти англійські свідомо: це внутрішня діагностика для логів, вона
   ніколи не потрапляє користувачу, а правило локалізації (localetest)
   забороняє захардкоджений український текст у повідомленнях api/. */
export const SHADOW_OFF = {
  no_credentials: 'no SUPABASE_URL or service role key',
  no_vin: 'the report has no VIN',
  not_installed: 'the Model Intelligence schema is not applied',
  timeout: 'the shadow did not fit the timeout',
  error: 'the shadow failed',
};

/* Єдиний виклик тіні.

   Повертає завжди обʼєкт, ніколи не кидає: { ok, reason, pack, ms }.
   `ok: true` означає, що пакет зібрано; `pack.mi_available` каже, чи
   знайшлось знання саме про цю машину. Ці два прапорці різні: тінь може
   відпрацювати бездоганно і чесно відповісти, що машини вона не знає. */
export async function miShadowPack(vin, opts = {}) {
  const base = opts.base || process.env.SUPABASE_URL;
  const key = opts.key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const timeoutMs = opts.timeoutMs || 8000;

  if (!base || !key) return { ok: false, reason: 'no_credentials', pack: null, ms: 0 };
  if (!vin || typeof vin !== 'string' || vin.length < 11) {
    return { ok: false, reason: 'no_vin', pack: null, ms: 0 };
  }

  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(base.replace(/\/$/, '') + '/rest/v1/rpc/mi_shadow_pack', {
      method: 'POST',
      signal: ac.signal,
      headers: {
        apikey: key,
        authorization: 'Bearer ' + key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_vin: vin.trim().toUpperCase() }),
    });
    const ms = Date.now() - started;
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      /* Схеми немає: це очікуваний стан, поки власник не застосував
         міграції. Не шум, не помилка Check. */
      const code = body && (body.code || body.error_code);
      if (res.status === 404 || MISSING_FUNCTION.has(code)) {
        return { ok: false, reason: 'not_installed', pack: null, ms };
      }
      console.log('[mi-shadow] HTTP', res.status, JSON.stringify(body || {}).slice(0, 200));
      return { ok: false, reason: 'error', pack: null, ms, status: res.status };
    }

    return { ok: true, reason: null, pack: body, ms };
  } catch (e) {
    const ms = Date.now() - started;
    const reason = e && e.name === 'AbortError' ? 'timeout' : 'error';
    if (reason === 'error') console.log('[mi-shadow]', String(e && e.message || e).slice(0, 200));
    return { ok: false, reason, pack: null, ms };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Автоматична тінь у фоні durable-Check (Phase 7.6) ----------

   Прапорець сервера. Читається лише тут і лише на сервері, у клієнт не
   потрапляє ніколи. Відсутній або будь-яке інше значення означає OFF:
   тоді тіні немає взагалі, тобто ні мережевого виклику, ні логу. */
export function miShadowEnabled(env) {
  const raw = String(((env || process.env) || {}).MI_SHADOW_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/* Жорсткий стель часу тіні. Фонове завершення Check не має права чекати
   на знання: звіт на цей момент уже записаний і користувач його бачить. */
export const SHADOW_TIMEOUT_MS = 2000;

/* Один структурований рядок на один прогін тіні.

   У лог ідуть ЛИШЕ лічильники і коди. Тексту знань, заблокованих
   кандидатів і самих пакетів тут немає і бути не може.

   Про `version_code`: чинна `public.mi_shadow_pack` коду версії назовні
   не віддає, вона дає subject_id і людську мітку. Вигадувати поле, яке
   завжди порожнє, сенсу немає, а міняти SQL ця фаза забороняє, тому в
   лог ідуть `version_id`, `version_label` і `version_matched_by`. */
export function shadowLogLine(input, result) {
  const pack = (result && result.pack) || {};
  const dec = (pack.decision && pack.decision.meta) || {};
  const rep = (pack.report && pack.report.meta) || {};
  const summary = pack.identity_summary || {};
  const inferred = typeof summary.version_note === 'string' && summary.version_note.length > 0;
  const available = !!pack.mi_available;
  return {
    event: 'mi_shadow',
    vin: (input && input.vin) || null,
    report_id: (input && input.token) || null,
    ok: !!(result && result.ok),
    mi_available: available,
    reason: (result && result.ok ? (pack.reason || null) : (result && result.reason) || null) || null,
    identity_precision: pack.identity_precision || null,
    version_id: dec.version_id != null ? dec.version_id : null,
    version_label: summary.version || null,
    version_matched_by: inferred ? 'check_inference' : (available ? 'catalog' : null),
    version_source: inferred ? 'check_inference' : (available ? 'catalog' : null),
    version_confidence: inferred ? 'low' : null,
    candidate_vmy_count: dec.candidate_vmy_count != null ? dec.candidate_vmy_count : null,
    included_decision: dec.included_count != null ? dec.included_count : null,
    included_report: rep.included_count != null ? rep.included_count : null,
    conditional_count: (dec.counts && dec.counts.CONDITIONAL) || 0,
    unresolved_dimensions: dec.unresolved_dimensions || null,
    duration_ms: (result && result.ms) || 0,
  };
}

/* Точка підключення до фонового завершення Check.

   Контракт простий: НІКОЛИ не кидає і нічого не повертає у звіт. Усе, що
   може піти не так (прапорець вимкнено, немає VIN, схеми немає, таймаут,
   помилка мережі, помилка БД), закінчується одним рядком логу. Check на
   момент виклику вже записаний як done, тому його статус, Score, Verdict
   і payload звіту не залежать від результату цієї функції ніяк.

   Ідемпотентність не реалізується тут повторно: вона живе у самій
   `mi_shadow_pack` (міст пише спостереження через not exists, ідентичність
   і пакети знань ідемпотентні), і Phase 7.4 довела це на продакшні. */
export async function runMiShadow(input = {}, opts = {}) {
  if (!miShadowEnabled(opts.env)) return { skipped: true, reason: 'flag_off' };
  const call = opts.call || miShadowPack;
  const log = opts.log || (line => console.log('[mi-shadow]', JSON.stringify(line)));
  const vin = input.vin || (input.report && input.report._meta && input.report._meta.vin) || '';
  const started = Date.now();
  let result;
  try {
    result = await Promise.race([
      Promise.resolve(call(vin, { timeoutMs: opts.timeoutMs || SHADOW_TIMEOUT_MS })),
      new Promise(resolve => setTimeout(
        () => resolve({ ok: false, reason: 'timeout', pack: null, ms: Date.now() - started }),
        (opts.timeoutMs || SHADOW_TIMEOUT_MS) + 250)),
    ]);
  } catch (e) {
    result = { ok: false, reason: 'error', pack: null, ms: Date.now() - started };
  }
  if (!result || typeof result !== 'object') result = { ok: false, reason: 'error', pack: null, ms: Date.now() - started };
  const line = shadowLogLine({ vin, token: input.token }, result);
  try { log(line); } catch (e) {}
  return line;
}

/* Компактний рядок для логу поруч зі звичайним Check: скільки знання
   тінь дістала і чи впізнала машину взагалі. Тексту знань у логу немає. */
export function shadowSummary(result) {
  if (!result || !result.ok) return 'mi:off(' + ((result && result.reason) || 'unknown') + ')';
  const p = result.pack || {};
  if (!p.mi_available) return 'mi:none(' + (p.reason || 'unknown') + ',' + result.ms + 'ms)';
  const n = o => (o && o.meta && o.meta.included_count) || 0;
  return 'mi:ok(decision=' + n(p.decision) + ',report=' + n(p.report) + ',' + result.ms + 'ms)';
}
