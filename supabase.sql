-- calcar.ai: таблиця збережених прорахунків
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  title text not null default 'Прорахунок',
  data jsonb not null
);

alter table public.reports enable row level security;

create policy "own reports select" on public.reports
  for select using (auth.uid() = user_id);

create policy "own reports insert" on public.reports
  for insert with check (auth.uid() = user_id);

create policy "own reports delete" on public.reports
  for delete using (auth.uid() = user_id);

create index if not exists reports_user_created
  on public.reports (user_id, created_at desc);
