/* ТИМЧАСОВИЙ діагностичний ендпоінт Phase 7.7.

   Навіщо. Автоматична тінь Model Intelligence не залишає жодного сліду у
   продакшні, хоча код Phase 7.6 задеплоєний (перевірено: `/api/mi-shadow`
   відповідає 500 через відсутній default export, а неіснуючий шлях дає
   404). Дві гіпотези, які з бази даних не розрізняються: прапорець
   `MI_SHADOW_ENABLED` не видно у рантаймі, або виконання не доходить до
   виклику тіні після запису звіту. Логи тут не допомагають: при
   вимкненому прапорці `runMiShadow` виходить ДО логу.

   Цей ендпоінт відповідає рівно на перше питання, нічого не запускаючи.

   Що він НЕ робить: не викликає `public.mi_shadow_pack`, резолвер,
   компілятор, Supabase, Check і AI; нічого не пише; звіт, Score і Verdict
   не бачить взагалі.

   Секрети назовні не йдуть НІКОЛИ: повертаються лише булеві прапорці і
   довжина рядка прапорця, самих значень немає ні в тілі, ні в логах.

   Доступ: той самий гейт, що у benchmark-перемикачах Check, заголовок
   `x-calcar-bench` проти env `BENCH_KEY`. Без ключа 404, тобто ендпоінт
   не існує для всіх, крім власника.

   ПРИБРАТИ після діагностики. */

export const config = { maxDuration: 10 };

import { miShadowEnabled } from './mi-shadow.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  /* Гейт дослівно за наявним патерном проєкту. Без ключа ендпоінта
     для зовнішнього світу не існує: 404, без деталей і без підказок. */
  const benchAllowed = !!(process.env.BENCH_KEY && req.headers && req.headers['x-calcar-bench'] === process.env.BENCH_KEY);
  if (!benchAllowed) return res.status(404).json({ error: 'not found' });

  const raw = process.env.MI_SHADOW_ENABLED;

  return res.status(200).json({
    reached: true,
    /* присутність саме змінної, а не її істинність: порожній рядок теж
       означає, що змінна долетіла до рантайму */
    mi_shadow_flag_present: typeof raw === 'string',
    /* довжина без самого значення: ловить невидимі символи і пробіли */
    mi_shadow_flag_raw_length: typeof raw === 'string' ? raw.length : 0,
    /* той самий helper, яким користується продакшн-тінь */
    mi_shadow_enabled: miShadowEnabled(),
    has_supabase_url: !!process.env.SUPABASE_URL,
    has_service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    node: process.version,
  });
}
