-- CalCar Garage: авто користувача та журнал обслуговування

create table if not exists public.garage_vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vin text not null,
  make text, model text, year int,
  trim text, engine text, transmission text, drive text, fuel text,
  current_mileage int,
  country text, city text, plate text,
  purchase_date date,
  photos jsonb not null default '[]'::jsonb,
  check_report_id uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, vin)
);

create table if not exists public.garage_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.garage_vehicles(id) on delete cascade,
  type text not null,
  event_date date not null,
  mileage int,
  description text,
  cost numeric,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.garage_vehicles enable row level security;
alter table public.garage_entries enable row level security;

create policy "own vehicles all" on public.garage_vehicles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own entries all" on public.garage_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists garage_vehicles_user on public.garage_vehicles (user_id, created_at desc);
create index if not exists garage_vehicles_vin on public.garage_vehicles (vin);
create index if not exists garage_entries_vehicle on public.garage_entries (vehicle_id, event_date desc, created_at desc);

-- created_at запису незмінний: доказова цінність журналу
create or replace function public.freeze_created_at()
returns trigger language plpgsql as $$
begin
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists garage_entries_freeze on public.garage_entries;
create trigger garage_entries_freeze before update on public.garage_entries
  for each row execute function public.freeze_created_at();

-- updated_at авто
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists garage_vehicles_touch on public.garage_vehicles;
create trigger garage_vehicles_touch before update on public.garage_vehicles
  for each row execute function public.touch_updated_at();

-- приватне сховище файлів гаража
insert into storage.buckets (id, name, public)
  values ('garage', 'garage', false)
  on conflict (id) do nothing;

create policy "garage files select" on storage.objects
  for select using (bucket_id = 'garage' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "garage files insert" on storage.objects
  for insert with check (bucket_id = 'garage' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "garage files delete" on storage.objects
  for delete using (bucket_id = 'garage' and (storage.foldername(name))[1] = auth.uid()::text);
