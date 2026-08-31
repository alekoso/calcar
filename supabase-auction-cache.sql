-- CalCar: negative/discovery-кеш аукціонного пошуку за VIN.
-- ЗАСТОСОВУЄ ВЛАСНИК ВРУЧНУ (як supabase-knowledge.sql). Код уже читає і
-- пише цю таблицю (api/check.js readAuctionCache/writeAuctionCache) і
-- мовчки працює без неї; після застосування зʼявляється TTL-кеш absent
-- (30 днів, api/auction.js shouldRecheck) і захист від повторних
-- Serper-викликів на кожен повторний Check того самого VIN.
-- Знайдені події живуть окремо і постійно в auction_events.
create table if not exists auction_checks (
  vin text primary key,
  status text not null check (status in ('absent', 'found')),
  source text,
  lot_url text,
  checked_at timestamptz not null default now(),
  record jsonb
);
