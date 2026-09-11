-- CalCar Model Intelligence, міграція 06: staging для дослідження.
--
-- Research і LLM-витяг НЕ пишуть у канонічні клейми. Потік:
-- candidate -> normalize -> evidence -> gate -> publish / reject / merge.
-- Сама функція публікації і перевірка gate це Phase 2; тут лише структури
-- і поля, потрібні для ревʼю.
--
-- Джерела не бувають чернетковими: вони одразу створюються у mi.source,
-- тому candidate_evidence посилається на канонічне джерело.

create table if not exists mi.candidate_claim (
  id                     bigint generated always as identity primary key,
  task_ref               text,
  -- Як subject названо у джерелі, до нормалізації через аліаси.
  proposed_subject_text  text not null,
  resolved_subject_id    bigint references mi.knowledge_subject (id) on delete restrict,
  proposed_knowledge_type mi.knowledge_type,
  text_en                text not null,
  value_kind             mi.value_kind,
  structured_value       jsonb,
  proposed_confidence    mi.confidence,
  proposed_layer         mi.practice_layer,
  proposed_causal_status mi.causal_status,
  proposed_propagation   mi.propagation not null default 'exact',
  -- Єдине місце, де застосовність тимчасово живе як JSONB: до публікації
  -- вона ще не канонічна. При публікації розгортається у рядки
  -- mi.claim_applicability.
  proposed_applicability jsonb,
  proposed_links         jsonb,
  extractor              text,
  review_status          mi.review_status not null default 'new',
  gate_result            jsonb,
  gate_checked_at        timestamptz,
  rejection_reason_code  text references mi.rejection_reason (code),
  merge_into_claim_id    bigint references mi.claim (id) on delete restrict,
  published_claim_id     bigint references mi.claim (id) on delete restrict,
  reviewer               text,
  review_note            text,
  created_at             timestamptz not null default now(),
  reviewed_at            timestamptz,
  constraint candidate_claim_rejected_ck
    check (review_status <> 'rejected' or rejection_reason_code is not null),
  constraint candidate_claim_merged_ck
    check (review_status <> 'merged' or merge_into_claim_id is not null),
  constraint candidate_claim_approved_ck
    check (review_status <> 'approved' or published_claim_id is not null)
);
alter table mi.candidate_claim enable row level security;
create index if not exists candidate_claim_status_idx on mi.candidate_claim (review_status);
create index if not exists candidate_claim_subject_idx on mi.candidate_claim (resolved_subject_id);
create index if not exists candidate_claim_published_idx on mi.candidate_claim (published_claim_id);

create table if not exists mi.candidate_evidence (
  id                 bigint generated always as identity primary key,
  candidate_id       bigint not null references mi.candidate_claim (id) on delete cascade,
  source_id          bigint not null references mi.source (id) on delete restrict,
  stance             mi.stance not null,
  excerpt            text,
  excerpt_lang       char(2),
  independence_group text not null,
  context            jsonb,
  created_at         timestamptz not null default now(),
  constraint candidate_evidence_key unique (candidate_id, source_id, independence_group),
  constraint candidate_evidence_excerpt_ck check (excerpt is null or length(excerpt) <= 2000)
);
alter table mi.candidate_evidence enable row level security;
create index if not exists candidate_evidence_candidate_idx on mi.candidate_evidence (candidate_id);
create index if not exists candidate_evidence_source_idx on mi.candidate_evidence (source_id);
