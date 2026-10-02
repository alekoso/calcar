-- CalCar Check: лист "звіт готовий" за явним opt-in для конкретного Check.
-- Файл ідемпотентний і лише додає колонки до check_jobs; наявні дані і
-- старий код працюють без змін. Таблицю, як і раніше, читає і пише ТІЛЬКИ
-- сервер (service role): RLS увімкнений без політик, публічна відповідь
-- /api/check-job ці колонки не вибирає.
--   email_requested_at  момент opt-in (null = листа ніхто не просив)
--   email_recipient     адреса отримувача; зберігається лише після opt-in
--   email_claimed_at    відправник захопив рядок (захист від двох листів)
--   email_sent_at       лист надіслано; другий раз не надсилається
--   email_error         причина останньої невдалої спроби, без адреси
--   email_aid           анонімний id браузера для події report_email_sent
-- user_id (колонка вже є) заповнюється під час opt-in того, хто увійшов.
alter table check_jobs add column if not exists email_requested_at timestamptz;
alter table check_jobs add column if not exists email_recipient text;
alter table check_jobs add column if not exists email_claimed_at timestamptz;
alter table check_jobs add column if not exists email_sent_at timestamptz;
alter table check_jobs add column if not exists email_error text;
alter table check_jobs add column if not exists email_aid text;
