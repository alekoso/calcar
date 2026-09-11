-- Відкат міграції 17.
--
-- Повертає вузький ключ (identity_version, fingerprint) і версію
-- mi.persist_pack із міграції 15, тобто разом із тимчасовою відмовою
-- писати при зіткненні призначень.
--
-- Якщо у базі вже лежать пакети різних призначень для однієї версії
-- ідентичності, звузити ключ неможливо без втрати рядків. Тому відкат
-- спершу перевіряє це і зупиняється, а не видаляє нічого сам.

do $$
declare n int;
begin
  select count(*) into n from (
    select identity_version, fingerprint from mi.knowledge_pack
     group by identity_version, fingerprint having count(*) > 1) t;
  if n > 0 then
    raise exception 'cannot narrow knowledge_pack_key: % identity_version/fingerprint groups hold more than one pack; remove the extra purposes by hand first', n;
  end if;
end $$;

alter table mi.knowledge_pack drop constraint if exists knowledge_pack_key;
alter table mi.knowledge_pack add constraint knowledge_pack_key
  unique (identity_version, fingerprint);

create or replace function mi.persist_pack(
  p_identity bigint, p_purpose mi.pack_purpose,
  p_locale char(2) default 'en', p_budget text default 'default')
returns bigint language plpgsql as $$
declare
  ident jsonb; compiled jsonb; v_pack bigint; v_frag bigint; v_snap bigint; v_iv text;
begin
  ident := mi.identity_json(p_identity);
  if ident->>'vmy' is null then
    raise exception 'identity % has no resolved version, market and year', p_identity;
  end if;

  compiled := mi.compile_pack(ident, p_purpose, p_locale, p_budget);
  -- Успішна компіляція повертає {pack, applicability_log}; прапорець
  -- доступності фрагмента лежить усередині пакета, а при промаху на
  -- верхньому рівні. Перевіряються обидва місця.
  if not coalesce((compiled->'pack'->>'fragment_available')::boolean,
                  (compiled->>'fragment_available')::boolean, false) then
    return null;
  end if;

  v_frag := (compiled->'pack'->'pack_meta'->>'fragment_id')::bigint;
  v_snap := (compiled->'pack'->'pack_meta'->>'snapshot_id')::bigint;
  if v_snap is null then select max(id) into v_snap from mi.knowledge_snapshot; end if;
  select identity_version into v_iv from mi_vm.resolved_identity where id = p_identity;

  -- ТЕРТЯ ЗІ СХЕМОЮ, зафіксоване тут навмисно.
  -- knowledge_pack_key це unique (identity_version, fingerprint) БЕЗ
  -- purpose, locale і budget_profile. Відбиток фрагмента однаковий для
  -- всіх призначень однієї версії, тому пакет рішення і пакет звіту тієї
  -- самої машини стикаються в одному рядку. Схема заморожена, тому
  -- замість тихого перезапису чужого рядка функція відмовляється
  -- працювати і називає причину.
  if exists (select 1 from mi.knowledge_pack kp
              where kp.identity_version = v_iv
                and kp.fingerprint = compiled->'pack'->'pack_meta'->>'fragment_fingerprint'
                and (kp.purpose <> p_purpose or kp.locale <> p_locale
                     or kp.budget_profile <> p_budget)) then
    raise exception using
      errcode = 'unique_violation',
      message = format('knowledge_pack cannot hold purpose %s for identity version %s: '
                       'the unique key is (identity_version, fingerprint) and does not '
                       'include purpose, locale or budget_profile', p_purpose, v_iv);
  end if;

  insert into mi.knowledge_pack (identity_id, identity_version, fragment_id, purpose,
      locale, budget_profile, compiler_version, fingerprint, payload, applicability_log,
      snapshot_id, stale)
  values (p_identity, v_iv, v_frag, p_purpose, p_locale, p_budget,
      mi.compiler_version(),
      compiled->'pack'->'pack_meta'->>'fragment_fingerprint',
      compiled->'pack', compiled->'applicability_log', v_snap, false)
  on conflict on constraint knowledge_pack_key do update
    set payload = excluded.payload, applicability_log = excluded.applicability_log,
        fragment_id = excluded.fragment_id, snapshot_id = excluded.snapshot_id,
        stale = false, created_at = now()
  returning id into v_pack;

  return v_pack;
end $$;
