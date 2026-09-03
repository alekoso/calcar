-- CalCar Vehicle Intelligence: аддитивна еволюція сховища.
-- Файл ідемпотентний, лише додає колонки; нічого не видаляє, не змінює
-- типи і не переписує старі рядки. Код працює і без цих колонок
-- (PostgREST відхилить лише вставку з невідомою колонкою, тому сервер
-- перед записом не покладається на них як на обовʼязкові).

-- 1. Повний знімок оголошення: через роки має бути видно, що САМЕ
--    показував і писав продавець. Старі рядки ніколи не перезаписуються:
--    кожен Check додає новий рядок vehicle_snapshots.
alter table vehicle_snapshots add column if not exists seller_text text;
alter table vehicle_snapshots add column if not exists listing_fields jsonb;
alter table vehicle_snapshots add column if not exists job_token text;
comment on column vehicle_snapshots.seller_text is 'Повний текст продавця з оголошення на момент знімка (до 3000 символів парсера)';
comment on column vehicle_snapshots.listing_fields is 'Структуровані поля площадки: комплектація, ціновий контекст, факти історії, покоління, посилання на архів, usa_photos';
comment on column vehicle_snapshots.job_token is 'Токен durable-аналізу, з якого зроблено знімок';

-- 2. Канонізація історичного візуалу: діагностика consensus-читання
--    (A/B, за конфлікту C) поверх того самого набору кадрів.
alter table historical_visual_cache add column if not exists reads_count integer;
alter table historical_visual_cache add column if not exists conflict_detected boolean;
alter table historical_visual_cache add column if not exists canonicalized_at timestamptz;
alter table historical_visual_cache add column if not exists extractor_version text;
alter table historical_visual_cache add column if not exists consensus jsonb;
comment on column historical_visual_cache.consensus is 'Матеріальні сигнали кожного читання і перелік полів, де читання розійшлися';
