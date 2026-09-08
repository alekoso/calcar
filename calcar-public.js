/* CalCar: ПУБЛІЧНІ ідентифікатори і контакти. Тут немає секретів: ключ
   проєкту PostHog і Measurement ID GA4 за задумом видимі в браузері, а
   контакти показуються у футері. Порожнє значення означає "ще не задано":
   аналітика тоді працює локально (події лишаються в буфері сторінки, у
   мережу нічого не йде), футер контакт не показує. Деплой від цього не
   залежить. Заповнює власник проєкту.

   Що потрібно додати для beta:
     analytics.posthog_key   ключ проєкту PostHog (phc_...)
     analytics.posthog_host  регіон PostHog: https://eu.i.posthog.com або https://us.i.posthog.com
     analytics.ga4_id        Measurement ID GA4 (G-XXXXXXX)
     contacts.telegram       адреса каналу чи акаунта, напр. https://t.me/calcar
     contacts.email          адреса для звʼязку, напр. hello@calcar.io */
window.CALCAR_PUBLIC = {
  analytics: {
    posthog_key: '',
    posthog_host: 'https://eu.i.posthog.com',
    ga4_id: '',
  },
  contacts: {
    telegram: '',
    email: '',
  },
};
