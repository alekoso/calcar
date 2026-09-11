-- Відкат міграції 10.

drop trigger if exists evidence_publish_guard on mi.evidence;
drop trigger if exists claim_support_publish_guard on mi.claim_support;
drop trigger if exists claim_link_publish_guard on mi.claim_link;
drop trigger if exists claim_applicability_publish_guard on mi.claim_applicability;
drop trigger if exists claim_publish_guard on mi.claim;

drop trigger if exists evidence_recurrence on mi.evidence;

drop trigger if exists equipment_visual_hint_rev_bump on mi.equipment_visual_hint;
drop trigger if exists entitlement_rev_bump on mi.entitlement;
drop trigger if exists component_state_type_rev_bump on mi.component_state_type;
drop trigger if exists package_content_rev_bump on mi.package_content;
drop trigger if exists equipment_availability_rev_bump on mi.equipment_availability;
drop trigger if exists version_fitment_rev_bump on mi.version_fitment;
drop trigger if exists variant_attribute_rev_bump on mi.variant_attribute;
drop trigger if exists component_variant_rev_bump on mi.component_variant;
drop trigger if exists check_covers_rev_bump on mi.check_covers;
drop trigger if exists check_item_rev_bump on mi.check_item;
drop trigger if exists maintenance_item_rev_bump on mi.maintenance_item;
drop trigger if exists issue_rev_bump on mi.issue;
drop trigger if exists claim_support_rev_bump on mi.claim_support;
drop trigger if exists claim_link_rev_bump on mi.claim_link;
drop trigger if exists claim_applicability_rev_bump on mi.claim_applicability;
drop trigger if exists claim_rev_bump on mi.claim;

drop function if exists mi.publish_candidate(bigint, text, text);
drop function if exists mi.run_gate(bigint);
drop function if exists mi.check_gate(bigint);
drop function if exists mi.guard_published_evidence();
drop function if exists mi.guard_published_child();
drop function if exists mi.guard_claim_publish();
drop function if exists mi.in_publish_context();
drop function if exists mi.on_evidence_change();
drop function if exists mi.recompute_recurrence(bigint);
drop function if exists mi.bump_trigger();
drop function if exists mi.touch_subjects(bigint[]);
drop function if exists mi.invalidate_fragments(bigint[]);
drop function if exists mi.affected_subjects(text, jsonb);
drop function if exists mi.propagation_targets(bigint, mi.propagation);
drop function if exists mi.dedup_key(bigint, mi.knowledge_type, mi.practice_layer, text, text, mi.value_kind);
drop function if exists mi.claim_applicability_signature(bigint);
drop function if exists mi.applicability_signature(jsonb);
drop function if exists mi.normalize_assertion(text);
