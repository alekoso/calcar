-- CalCar Check: звʼязок анонімного відвідувача, Check і подій перегляду.
-- Файл ідемпотентний і лише додає колонки та індекси до check_jobs; наявні
-- рядки і старий код працюють без змін (старі job лишаються з null, зворотно
-- їх ніхто не заповнює). Таблицю читає і пише ТІЛЬКИ сервер (service role).
--   analytics_ref  uuid однієї спроби Check: сторінка генерує його до запиту
--                  і шле заголовком x-calcar-check-ref; той самий uuid їде в
--                  події PostHog як check_ref (check_started, check_completed,
--                  report_viewed, report_active_*). Не токен і не VIN.
--   anon_id        стабільний анонімний id браузера автора (calcar_aid, він же
--                  PostHog distinct_id до входу); заголовок x-calcar-aid.
--                  Той самий id уже зберігають report_feedback.anon_id і
--                  check_jobs.email_aid.
-- Застосувати ДО деплою коду, який ці колонки пише: інакше створення job
-- не вдасться і Check піде старим синхронним шляхом.
alter table check_jobs add column if not exists analytics_ref uuid;
alter table check_jobs add column if not exists anon_id text;
create index if not exists check_jobs_analytics_ref_idx on check_jobs (analytics_ref) where analytics_ref is not null;
create index if not exists check_jobs_anon_id_idx on check_jobs (anon_id, created_at) where anon_id is not null;
