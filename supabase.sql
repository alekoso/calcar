-- calcar.ai: таблиця збережених прорахунків і перевірок.
-- Файл ідемпотентний: повторний запуск нічого не ламає і не чистить дані.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  title text not null default 'Прорахунок',
  -- 'check' це перевірка оголошення, 'import' це прорахунок пригону
  kind text not null default 'import',
  -- коротка адреса /check/:public_id, 6 символів; у звітів Import її нема
  public_id text,
  data jsonb not null
);

-- для баз, створених до появи цих колонок
alter table public.reports add column if not exists kind text not null default 'import';
alter table public.reports add column if not exists public_id text;

alter table public.reports enable row level security;

drop policy if exists "own reports select" on public.reports;
drop policy if exists "own reports insert" on public.reports;
drop policy if exists "own reports update" on public.reports;
drop policy if exists "own reports delete" on public.reports;

create policy "own reports select" on public.reports
  for select using (auth.uid() = user_id);

create policy "own reports insert" on public.reports
  for insert with check (auth.uid() = user_id);

create policy "own reports update" on public.reports
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own reports delete" on public.reports
  for delete using (auth.uid() = user_id);

create index if not exists reports_user_created
  on public.reports (user_id, created_at desc);

-- звіт відкривається за public_id через .single(), тому адреса має бути унікальна;
-- null-значень це не стосується, їх у Postgres може бути скільки завгодно
create unique index if not exists reports_public_id
  on public.reports (public_id);
