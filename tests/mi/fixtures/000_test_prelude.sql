-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Міграції Model Intelligence посилаються на дві таблиці, які у продакшні
-- вже існують і створені поза цим репозиторієм: public.vehicle_snapshots
-- і public.reports. На чистій локальній базі їх немає, тому стенд створює
-- мінімальні заглушки з тими самими ключами.
--
-- Файл ідемпотентний і нічого не чіпає, якщо таблиці вже є.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid()
);

create table if not exists public.vehicle_snapshots (
  id uuid primary key default gen_random_uuid()
);
