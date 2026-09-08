-- CalCar beta: відгук на звіт ("Цей аналіз був корисним?"). Аддитивно:
-- нова таблиця, RLS увімкнено без політик, пише лише сервер (service role)
-- через api/feedback.js. На Score і зміст звіту не впливає.
create table if not exists report_feedback (
  id uuid primary key default gen_random_uuid(),
  report_ref text not null,            -- share-токен або public_id звіту
  product text not null default 'check',
  user_id uuid,                        -- є лише у залогіненого
  anon_id text,                        -- стабільний анонімний id браузера (calcar_aid)
  verdict text not null check (verdict in ('positive', 'negative')),
  text text,                           -- необовʼязкове "чого не вистачило", до 1000 символів
  lang text,
  page text,
  created_at timestamptz not null default now()
);
create index if not exists report_feedback_report on report_feedback (report_ref, created_at desc);
create index if not exists report_feedback_created on report_feedback (created_at desc);
alter table report_feedback enable row level security;
