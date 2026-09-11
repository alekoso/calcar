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

-- Phase 7.3: міст читає модифікацію з розбору Check, тому стенд має ті
-- колонки `reports`, які є у продакшні (`supabase.sql`). `user_id` не
-- відтворюється: схеми auth на стенді немає. `data` у продакшні без
-- значення за замовчуванням; тут воно потрібне лише для додавання колонки.
alter table public.reports add column if not exists created_at timestamptz not null default now();
alter table public.reports add column if not exists kind text not null default 'import';
alter table public.reports add column if not exists data jsonb not null default '{}'::jsonb;

-- Supabase-only схема: локальний стенд її не має, а
-- `supabase-vehicle-memory-v1.sql` реєструє у ній приватний bucket.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean
);
