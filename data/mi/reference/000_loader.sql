-- CalCar Model Intelligence, Phase 3: допоміжні функції завантаження.
--
-- ЦЕ НЕ МІГРАЦІЯ. Файл не змінює схему і не створює постійних обʼєктів:
-- усі помічники живуть у pg_temp і зникають разом із сесією. Тому всі
-- файли цієї теки треба подавати psql ОДНІЄЮ сесією, у порядку номерів.
--
-- Навіщо помічники: back-loading працює з природними ключами карток
-- (наприклад eng:n63b44o2), а не з числовими id. Тимчасова таблиця
-- pg_temp.key_map тримає відповідність ключа і subject_id.

create temporary table if not exists key_map (
  key        text primary key,
  subject_id bigint not null
);

create temporary table if not exists source_map (
  key       text primary key,
  source_id bigint not null
);

-- Атом картки -> кандидати, яких він породив. Основа таблиці покриття:
-- без цього рядка неможливо довести, що атом не загубився.
create temporary table if not exists atom_map (
  task_ref     text primary key,   -- 'C-051' або 'C-051#a' для розщеплення
  atom_id      text not null,      -- 'C-051'
  card         text not null,      -- 'bmw' | 'tesla' | 'porsche'
  candidate_id bigint
);

-- Атоми, які свідомо НЕ породжують кандидата, з причиною. Мовчазного
-- зникнення атома бути не може: він або в atom_map, або тут.
create temporary table if not exists atom_note (
  task_ref text primary key,
  atom_id  text not null,
  card     text not null,
  status   text not null,          -- 'rejected' | 'blocked'
  reason   text not null
);

-- ---------- Реєстрація subject ----------

create or replace function pg_temp.mk(p_key text, p_kind mi.subject_kind, p_label text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  select subject_id into v_id from key_map where key = p_key;
  if found then return v_id; end if;
  insert into mi.knowledge_subject (kind, label) values (p_kind, p_label) returning id into v_id;
  insert into key_map (key, subject_id) values (p_key, v_id);
  return v_id;
end $$;

create or replace function pg_temp.sid(p_key text)
returns bigint language plpgsql stable as $$
declare v_id bigint;
begin
  select subject_id into v_id from key_map where key = p_key;
  if v_id is null then raise exception 'unknown subject key %', p_key; end if;
  return v_id;
end $$;

create or replace function pg_temp.src(p_key text)
returns bigint language plpgsql stable as $$
declare v_id bigint;
begin
  select source_id into v_id from source_map where key = p_key;
  if v_id is null then raise exception 'unknown source key %', p_key; end if;
  return v_id;
end $$;

-- ---------- Джерела ----------

create or replace function pg_temp.mksrc(
  p_key text, p_type mi.source_type, p_quality mi.source_quality,
  p_title text, p_ref text, p_platform text, p_market text,
  p_access mi.access_status default 'ok', p_url text default null)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into mi.source (source_type, quality, url, reference, title, platform,
                         market_code, access_status)
  values (p_type, p_quality, nullif(p_url, ''), p_ref, p_title, p_platform,
          p_market, p_access)
  returning id into v_id;
  insert into source_map (key, source_id) values (p_key, v_id);
  return v_id;
end $$;

-- ---------- Кандидат ----------

-- opts: subject_text, layer, value_kind, value, causal, propagation, note,
--       applic (масив предикатів), links, ev (масив доказів),
--       importance (1..5), implication, contested, contested_note.
-- importance і implication несуть те, що картка каже покупцю: перше це
-- здатність змінити рішення, друге це дослівний buyer-текст атома.
-- Доказ: {"src": ключ, "stance": supports|contradicts|context,
--         "group": ідентифікатор незалежної групи, "ctx": {...},
--         "excerpt": текст, "lang": "en"}.
create or replace function pg_temp.stage(
  p_task_ref text, p_card text, p_subject_key text,
  p_type mi.knowledge_type, p_conf mi.confidence, p_text text,
  p_opts jsonb default '{}'::jsonb)
returns bigint language plpgsql as $$
declare
  v_id bigint;
  e jsonb;
begin
  if exists (select 1 from atom_map where task_ref = p_task_ref) then
    raise exception 'duplicate task_ref %', p_task_ref;
  end if;

  insert into mi.candidate_claim (
    task_ref, proposed_subject_text, resolved_subject_id, proposed_knowledge_type,
    text_en, value_kind, structured_value, proposed_confidence, proposed_layer,
    proposed_causal_status, proposed_propagation, proposed_applicability,
    proposed_links, proposed_buyer_importance, proposed_buyer_implication_en,
    proposed_contested, proposed_contested_note_en,
    extractor, review_status, review_note)
  values (
    p_task_ref,
    coalesce(p_opts->>'subject_text', p_subject_key),
    pg_temp.sid(p_subject_key),
    p_type, p_text,
    (p_opts->>'value_kind')::mi.value_kind,
    p_opts->'value',
    p_conf,
    (p_opts->>'layer')::mi.practice_layer,
    (p_opts->>'causal')::mi.causal_status,
    coalesce((p_opts->>'propagation')::mi.propagation, 'exact'),
    p_opts->'applic',
    p_opts->'links',
    (p_opts->>'importance')::smallint,
    p_opts->>'implication',
    coalesce((p_opts->>'contested')::boolean, false),
    p_opts->>'contested_note',
    'phase3-reference-backload',
    'normalized',
    p_opts->>'note')
  returning id into v_id;

  for e in select * from jsonb_array_elements(coalesce(p_opts->'ev', '[]'::jsonb)) loop
    insert into mi.candidate_evidence (candidate_id, source_id, stance, excerpt,
                                       excerpt_lang, independence_group, context)
    values (v_id, pg_temp.src(e->>'src'),
            coalesce((e->>'stance')::mi.stance, 'supports'),
            e->>'excerpt', coalesce(e->>'lang', 'en')::char(2),
            coalesce(e->>'group', e->>'src'), e->'ctx');
  end loop;

  if jsonb_array_length(coalesce(p_opts->'ev', '[]'::jsonb)) > 0 then
    update mi.candidate_claim set review_status = 'evidence_linked' where id = v_id;
  end if;

  insert into atom_map (task_ref, atom_id, card, candidate_id)
  values (p_task_ref, split_part(p_task_ref, '#', 1), p_card, v_id);
  return v_id;
end $$;

-- Атом, який свідомо не стає кандидатом.
create or replace function pg_temp.note_atom(
  p_task_ref text, p_card text, p_status text, p_reason text)
returns void language plpgsql as $$
begin
  insert into atom_note (task_ref, atom_id, card, status, reason)
  values (p_task_ref, split_part(p_task_ref, '#', 1), p_card, p_status, p_reason);
end $$;

-- ---------- Читабельні предикати ----------

create or replace function pg_temp.p_ref(p_dim text, p_key text, p_group int default 1,
                                         p_scope text default 'current',
                                         p_include_rev boolean default false)
returns jsonb language sql immutable as $$
  select jsonb_build_object('dimension', p_dim, 'operator', 'eq',
    'ref_subject_id', pg_temp.sid(p_key), 'group_no', p_group,
    'config_scope', p_scope, 'include_revisions', p_include_rev);
$$;

create or replace function pg_temp.p_tag(p_dim text, p_tag text, p_group int default 1,
                                         p_op text default 'eq')
returns jsonb language sql immutable as $$
  select jsonb_build_object('dimension', p_dim, 'operator', p_op,
    'tag', p_tag, 'group_no', p_group, 'config_scope', 'na');
$$;

create or replace function pg_temp.p_attr(p_key text, p_value text, p_group int default 1)
returns jsonb language sql immutable as $$
  select jsonb_build_object('dimension', 'variant_attribute', 'operator', 'attr_eq',
    'attr_key', p_key, 'attr_value', p_value, 'group_no', p_group,
    'config_scope', 'current');
$$;

-- Числовий діапазон. NULL означає відкриту межу; невідома межа заборонена
-- схемою, тому предикат із невідомою межею не пишеться взагалі.
create or replace function pg_temp.p_num(p_dim text, p_from numeric, p_to numeric,
                                         p_group int default 1)
returns jsonb language sql immutable as $$
  select jsonb_build_object('dimension', p_dim, 'operator', 'in_range',
    'value_num_from', coalesce(p_from, '-Infinity'::numeric),
    'value_num_to', coalesce(p_to, 'Infinity'::numeric),
    'value_from_kind', case when p_from is null then 'open' else 'known' end,
    'value_to_kind', case when p_to is null then 'open' else 'known' end,
    'group_no', p_group, 'config_scope', 'na');
$$;

create or replace function pg_temp.p_date(p_dim text, p_from date, p_to date,
                                          p_group int default 1)
returns jsonb language sql immutable as $$
  select jsonb_build_object('dimension', p_dim, 'operator', 'in_range',
    'value_date_from', coalesce(p_from, date '0001-01-01'),
    'value_date_to', coalesce(p_to, date '9999-12-31'),
    'value_from_kind', case when p_from is null then 'open' else 'known' end,
    'value_to_kind', case when p_to is null then 'open' else 'known' end,
    'group_no', p_group, 'config_scope', 'na');
$$;

-- Доказ.
create or replace function pg_temp.ev(p_src text, p_group text default null,
                                      p_ctx jsonb default null,
                                      p_stance text default 'supports',
                                      p_excerpt text default null)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'src', p_src, 'group', coalesce(p_group, p_src), 'ctx', p_ctx,
    'stance', p_stance, 'excerpt', p_excerpt));
$$;
