-- CalCar: спільна памʼять помічника про користувача (одна нотатка на акаунт).
-- Виконати один раз у Supabase: SQL Editor -> New query -> вставити -> Run

create table if not exists public.user_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  memory text,
  updated_at timestamptz not null default now()
);

alter table public.user_memory enable row level security;

drop policy if exists "own memory select" on public.user_memory;
drop policy if exists "own memory insert" on public.user_memory;
drop policy if exists "own memory update" on public.user_memory;
drop policy if exists "own memory delete" on public.user_memory;

create policy "own memory select" on public.user_memory for select using (auth.uid() = user_id);
create policy "own memory insert" on public.user_memory for insert with check (auth.uid() = user_id);
create policy "own memory update" on public.user_memory for update using (auth.uid() = user_id);
create policy "own memory delete" on public.user_memory for delete using (auth.uid() = user_id);
