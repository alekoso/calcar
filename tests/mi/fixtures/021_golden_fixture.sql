-- ТІЛЬКИ ДЛЯ ТЕСТОВОГО СТЕНДУ. У продакшн НЕ застосовувати.
--
-- Кілька структур, яких еталонний корпус не містить, але без яких
-- заморожені golden tests неможливо поставити. Усе тут проходить той
-- самий staging і ту саму перевірку якості, що і решта знання: нічого
-- не вставляється у канонічні таблиці напряму.
--
-- Джерела позначені навмисно синтетично, щоб їх не можна було сплутати
-- з реєстром еталонних карток.

do $$
declare
  v_sub bigint; v_fam bigint; v_8hp45 bigint; v_8hp70 bigint; v_issue bigint;
  v_540 bigint; v_540vmy bigint; v_b58 bigint; v_g30 bigint;
  v_85d bigint; v_85dvmy bigint; v_sdu bigint; v_pack90 bigint;
  v_n63 bigint; v_src bigint; v_cid bigint; v_claim bigint;
begin
  select subject_id into v_fam from mi.component_family where family_key = 'ZF_8HP';
  select subject_id into v_b58 from mi.component_variant where variant_code = 'B58B30';
  select subject_id into v_540 from mi.vehicle_version where version_code = '540I';
  select subject_id into v_g30 from mi.generation where platform_code = 'G30';
  select subject_id into v_85d from mi.vehicle_version where version_code = '85D';
  select subject_id into v_sdu from mi.component_variant where variant_code = 'SDU_INDUCTION';
  select subject_id into v_pack90 from mi.component_variant where variant_code = 'PACK_90_GEN1';
  select subject_id into v_n63 from mi.component_family where family_key = 'BMW_N63';

  -- ---------- 1. Сусідні варіанти тієї самої родини коробок ----------
  insert into mi.knowledge_subject (kind, label) values ('component_variant', 'ZF 8HP45') returning id into v_8hp45;
  insert into mi.component_variant (subject_id, family_id, variant_code, name_en)
  values (v_8hp45, v_fam, 'ZF_8HP45', 'ZF 8HP45');

  insert into mi.knowledge_subject (kind, label) values ('component_variant', 'ZF 8HP70') returning id into v_8hp70;
  insert into mi.component_variant (subject_id, family_id, variant_code, name_en)
  values (v_8hp70, v_fam, 'ZF_8HP70', 'ZF 8HP70');

  insert into mi.knowledge_subject (kind, label) values ('issue', 'ZF mechatronic sleeve leak') returning id into v_issue;
  insert into mi.issue (subject_id, issue_key, about_subject_id, name_en, mechanism_en, severity, sensitivity)
  values (v_issue, 'zf_mechatronic_sleeve_leak', v_8hp45,
          'Mechatronic sleeve leak', 'The sleeve between the valve body and the wiring loom leaks.',
          'major', 'mileage');

  -- ---------- 2. Версія порівняння з іншим мотором ----------
  insert into mi.knowledge_subject (kind, label)
  values ('version_market_year', 'BMW 540i US MY2018') returning id into v_540vmy;
  insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
      prod_from, prod_from_kind, prod_to, prod_to_kind)
  values (v_540vmy, v_540, 'US', 2018, date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');
  insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment)
  values (v_540vmy, 'engine', v_b58, 'standard'),
         (v_540vmy, 'transmission', v_8hp45, 'standard');

  -- ---------- 3. Версія без великого приводу ззаду ----------
  insert into mi.knowledge_subject (kind, label)
  values ('version_market_year', 'Tesla Model S 85D US MY2015') returning id into v_85dvmy;
  insert into mi.version_market_year (subject_id, version_id, market_code, model_year,
      prod_from, prod_from_kind, prod_to, prod_to_kind)
  values (v_85dvmy, v_85d, 'US', 2015, date '2014-11-01', 'known', date '2016-02-29', 'known');
  insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment)
  values (v_85dvmy, 'drive_unit_front', v_sdu, 'standard'),
         (v_85dvmy, 'drive_unit_rear', v_sdu, 'standard');
  -- Рядок комплектації з НЕВІДОМОЮ межею вікна: він не має розвʼязувати
  -- роль ні для якої дати складання.
  insert into mi.version_fitment (vmy_id, role_code, variant_id, fitment,
      prod_from, prod_from_kind, prod_to, prod_to_kind)
  values (v_85dvmy, 'battery_pack', v_pack90, 'standard',
          date '0001-01-01', 'unknown', date '9999-12-31', 'unknown');

  -- ---------- 4. Синтетичні джерела ----------
  insert into mi.source (source_type, quality, reference, title, platform, market_code)
  values ('official', 'primary', 'golden-fixture:zf-bulletin', 'Golden fixture bulletin', 'golden', 'EU')
  returning id into v_src;

  -- ---------- 5. Клейми через staging і перевірку якості ----------

  -- Проблема сусіднього варіанта коробки: exact, тому на 8HP75 не дістає.
  insert into mi.candidate_claim (task_ref, proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, proposed_buyer_importance,
      proposed_propagation, review_status, extractor)
  values ('GOLD-01', 'zf_mechatronic_sleeve_leak', v_issue, 'known_issue',
      'The mechatronic sleeve leaks on this transmission variant.', 'high', 4,
      'exact', 'new', 'golden-fixture')
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, independence_group)
  values (v_cid, v_src, 'supports', 'doc:golden-zf');
  v_claim := mi.publish_candidate(v_cid, 'golden-fixture');

  -- Клейм про родину моторів з поширенням exact: не має дістати жодного
  -- встановленого варіанта.
  insert into mi.candidate_claim (task_ref, proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, proposed_buyer_importance,
      proposed_propagation, review_status, extractor)
  values ('GOLD-02', 'BMW_N63', v_n63, 'official_fact',
      'A family level statement that was deliberately published without propagation.',
      'high', 2, 'exact', 'new', 'golden-fixture')
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, independence_group)
  values (v_cid, v_src, 'supports', 'doc:golden-family');
  v_claim := mi.publish_candidate(v_cid, 'golden-fixture');

  -- Клейм про варіант, що стоїть у 540i: доводить, що сусідня версія
  -- того самого покоління отримує СВОЄ знання, а не знання M550i.
  insert into mi.candidate_claim (task_ref, proposed_subject_text, resolved_subject_id,
      proposed_knowledge_type, text_en, proposed_confidence, proposed_buyer_importance,
      proposed_propagation, review_status, extractor)
  values ('GOLD-03', 'B58B30', v_b58, 'official_fact',
      'A statement that belongs to the six cylinder engine of this generation.',
      'high', 3, 'exact', 'new', 'golden-fixture')
  returning id into v_cid;
  insert into mi.candidate_evidence (candidate_id, source_id, stance, independence_group)
  values (v_cid, v_src, 'supports', 'doc:golden-b58');
  v_claim := mi.publish_candidate(v_cid, 'golden-fixture');
end $$;
