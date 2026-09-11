/* Model Intelligence: тіньовий клієнт.

   Це ТІНЬ. Модуль нічого не додає у звіт Check і нікуди не підключений:
   `api/check.js` його не імпортує. Призначення одне: дати можливість
   порівняти те, що Check говорить сьогодні, з тим, що сказав би пакет
   знань, не міняючи продакшн-шлях.

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

/* Причини, за яких тіні просто немає. Жодна з них не є збоєм Check. */
export const SHADOW_OFF = {
  no_credentials: 'немає SUPABASE_URL або службового ключа',
  no_vin: 'у звіті немає VIN',
  not_installed: 'схема Model Intelligence не застосована',
  timeout: 'тінь не вклалась у таймаут',
  error: 'тінь впала',
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

/* Компактний рядок для логу поруч зі звичайним Check: скільки знання
   тінь дістала і чи впізнала машину взагалі. Тексту знань у логу немає. */
export function shadowSummary(result) {
  if (!result || !result.ok) return 'mi:off(' + ((result && result.reason) || 'unknown') + ')';
  const p = result.pack || {};
  if (!p.mi_available) return 'mi:none(' + (p.reason || 'unknown') + ',' + result.ms + 'ms)';
  const n = o => (o && o.meta && o.meta.included_count) || 0;
  return 'mi:ok(decision=' + n(p.decision) + ',report=' + n(p.report) + ',' + result.ms + 'ms)';
}
