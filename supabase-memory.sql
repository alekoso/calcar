-- CalCar: спільна памʼять помічника про користувача (одна нотатка на акаунт).
-- Виконати один раз у Supabase: SQL Editor -> New query -> вставити -> Run

create table if not exists public.user_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  memory text,
  -- наскрізний хвіст розмов: останні 12 реплік з усіх вікон чату,
  -- кожна {report_id, title, at, role, text до 280 символів}
  recent_turns jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- для баз, створених до появи хвоста розмов
alter table public.user_memory
  add column if not exists recent_turns jsonb not null default '[]'::jsonb;

alter table public.user_memory enable row level security;

drop policy if exists "own memory select" on public.user_memory;
drop policy if exists "own memory insert" on public.user_memory;
drop policy if exists "own memory update" on public.user_memory;
drop policy if exists "own memory delete" on public.user_memory;

create policy "own memory select" on public.user_memory for select using (auth.uid() = user_id);
create policy "own memory insert" on public.user_memory for insert with check (auth.uid() = user_id);
create policy "own memory update" on public.user_memory for update using (auth.uid() = user_id);
create policy "own memory delete" on public.user_memory for delete using (auth.uid() = user_id);
