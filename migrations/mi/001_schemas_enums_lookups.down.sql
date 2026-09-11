-- Відкат міграції 01. Виконується ОСТАННІМ у ланцюжку відкатів.
-- Схеми знімаються у режимі restrict: якщо в них щось лишилось, відкат
-- впаде, і це навмисна перевірка повноти ланцюжка.

drop table if exists mi.fluid_spec;
drop table if exists mi.condition_tag;
drop table if exists mi.attribute_key;
drop table if exists mi.market;
drop table if exists mi.rejection_reason;
drop table if exists mi.link_role;
drop table if exists mi.service_kind;
drop table if exists mi.test_method;
drop table if exists mi.component_kind;
drop table if exists mi.component_role;

drop type if exists mi.assumption_strength;
drop type if exists mi.pack_purpose;
drop type if exists mi.access_status;
drop type if exists mi.source_quality;
drop type if exists mi.source_type;
drop type if exists mi.performer;
drop type if exists mi.reason_affects;
drop type if exists mi.reason_kind;
drop type if exists mi.cover_role;
drop type if exists mi.priority;
drop type if exists mi.powertrain;
drop type if exists mi.alias_scope;
drop type if exists mi.alias_kind;
drop type if exists mi.equipment_kind;
drop type if exists mi.equipment_change;
drop type if exists mi.entitlement_status;
drop type if exists mi.binding;
drop type if exists mi.request_status;
drop type if exists mi.build_reason;
drop type if exists mi.review_status;
drop type if exists mi.recurrence;
drop type if exists mi.stance;
drop type if exists mi.entity_status;
drop type if exists mi.sensitivity;
drop type if exists mi.severity;
drop type if exists mi.state_kind;
drop type if exists mi.availability;
drop type if exists mi.fitment_kind;
drop type if exists mi.visual_specificity;
drop type if exists mi.boundary_kind;
drop type if exists mi.resolution_status;
drop type if exists mi.config_slot;
drop type if exists mi.identity_dimension;
drop type if exists mi.pred_operator;
drop type if exists mi.refresh_class;
drop type if exists mi.value_kind;
drop type if exists mi.policy_status;
drop type if exists mi.causal_status;
drop type if exists mi.practice_layer;
drop type if exists mi.claim_status;
drop type if exists mi.propagation;
drop type if exists mi.confidence;
drop type if exists mi.knowledge_type;
drop type if exists mi.subject_kind;

drop schema if exists mi_vm;
drop schema if exists mi;
