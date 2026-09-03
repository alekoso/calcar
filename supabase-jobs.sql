-- CalCar Check: durable-аналіз і стабільний історичний візуал.
-- Файл ідемпотентний, лише додає таблиці; нічого не видаляє і не змінює.
-- Обидві таблиці читає і пише ТІЛЬКИ сервер (service role) через api/;
-- RLS увімкнений без політик, тому anon/authenticated-клієнти доступу
-- не мають. Код мовчки працює і без цих таблиць (деградує до старої
-- синхронної поведінки і до повторного Vision), тому міграцію можна
-- застосувати в будь-який момент.

-- 1. Завдання аналізу Check: живе незалежно від вкладки браузера.
--    token це непрозорий публічний ідентифікатор (22 символи base64url,
--    128 біт випадковості), він же адреса read-only звіту /check/r/<token>.
create table if not exists check_jobs (
  token text primary key,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  stage text,
  url text not null,
  vin text,
  lang text not null default 'en',
  user_id uuid,
  report jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists check_jobs_vin on check_jobs (vin);
create index if not exists check_jobs_created on check_jobs (created_at desc);
alter table check_jobs enable row level security;

-- 2. Кеш нормалізованого історичного візуалу: один і той самий VIN з тим
--    самим набором архівних кадрів і тією самою версією аналізу отримує
--    ОДИН результат, а не новий прогін Vision щоразу. Ключ = VIN + відбиток
--    відсортованого набору кадрів + версія екстрактора; source лише для
--    діагностики (звідки кадри: autoria_history, auction_search, archive).
create table if not exists historical_visual_cache (
  vin text not null,
  fingerprint text not null,
  hv_version text not null,
  source text,
  photo_urls jsonb not null default '[]'::jsonb,
  historical_visual jsonb not null,
  created_at timestamptz not null default now(),
  primary key (vin, fingerprint, hv_version)
);
alter table historical_visual_cache enable row level security;
