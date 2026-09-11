-- CalCar Model Intelligence, міграція 17: призначення входить у
-- ідентичність скомпільованого пакета.
--
-- Phase 5 довела зіткнення на реальних даних. Унікальність
-- mi.knowledge_pack була (identity_version, fingerprint), а відбиток
-- фрагмента однаковий для всіх призначень однієї версії СВІДОМО: він
-- рахується з набору залежностей, а не з бюджету. Тому пакет рішення і
-- пакет звіту тієї самої машини лягали в один рядок: перший запис
-- зберігався, другий мовчки переписував його, лишаючи у колонці
-- `purpose` слово попереднього пакета при вмісті наступного.
--
-- Сенс відбитка НЕ змінюється: він і далі про залежності знання.
-- Змінюється лише те, що ідентичністю пакета стає трійка
-- «версія ідентичності + відбиток + призначення».
--
-- До ключа додані також `locale` і `budget_profile`. Це не розширення
-- обсягу, а та сама поправка: обидві колонки вже лежать у цьому ж рядку,
-- вже розрізняють пакет за контрактом Appendix H.2, і без них та сама
-- помилка повернеться тієї миті, коли зʼявиться друга локаль. Зараз
-- локаль завжди 'en', а профіль завжди 'default', тому на наявні дані це
-- не впливає ніяк.
--
-- Безпека для наявних даних. Схеми `mi` і `mi_vm` у продакшні не
-- існують: перевірено читанням системного каталогу 2026-09-11. Рядків
-- mi.knowledge_pack немає ніде, тому зливати нема чого і вгадувати
-- злиття не доводиться. На локальних базах міграція просто розширює
-- ключ.

-- ---------- 1. Захист від мовчазного злиття ----------

-- Якщо у якійсь базі вже лежать рядки, які після розширення ключа стали
-- б різними сутностями, а зараз є одним рядком, міграція зупиняється і
-- показує їх. Автоматичного злиття тут немає свідомо.
do $$
declare n int;
begin
  select count(*) into n from (
    select identity_version, fingerprint
      from mi.knowledge_pack
     group by identity_version, fingerprint
    having count(distinct (purpose, locale, budget_profile)) > 1) t;
  if n > 0 then
    raise exception 'knowledge_pack has % identity_version/fingerprint groups with more than one purpose, locale or budget profile; resolve them by hand before widening the key', n;
  end if;
end $$;

-- ---------- 2. Розширення ключа ----------

alter table mi.knowledge_pack drop constraint if exists knowledge_pack_key;
alter table mi.knowledge_pack add constraint knowledge_pack_key
  unique (identity_version, fingerprint, purpose, locale, budget_profile);

comment on constraint knowledge_pack_key on mi.knowledge_pack is
  'Ідентичність пакета: версія ідентичності, відбиток залежностей, призначення, локаль і профіль бюджету. Відбиток однаковий для всіх призначень однієї версії, тому без призначення у ключі пакет рішення переписував би пакет звіту.';

-- ---------- 3. Збереження пакета ----------

-- Тимчасова відмова писати, яка існувала ЛИШЕ через зіткнення ключа,
-- прибрана: причини для неї більше немає. Повторне збереження того
-- самого пакета лишається ідемпотентним, а різні призначення тепер
-- живуть у різних рядках і не бачать одне одного.
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
        identity_id = excluded.identity_id,
        stale = false, created_at = now()
  returning id into v_pack;

  return v_pack;
end $$;
