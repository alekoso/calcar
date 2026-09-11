-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Міграції Model Intelligence посилаються на таблиці, які живуть у схемі
-- продукту, а не у схемі MI. Стенд піднімає їх у тому самому вигляді, що
-- і продакшн.
--
-- До Phase 6.1 тут стояла заглушка з однією колонкою id, бо базового DDL
-- `vehicle_snapshots` у репозиторії не існувало. Тепер він відновлений у
-- `supabase-vehicle-memory-baseline.sql`, і стенд читає справжню
-- структуру замість вигаданої.
--
-- Файл ідемпотентний і нічого не чіпає, якщо таблиці вже є.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid()
);

-- Supabase-only схема: локальний стенд її не має, а
-- `supabase-vehicle-memory-v1.sql` реєструє у ній приватний bucket.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean
);
