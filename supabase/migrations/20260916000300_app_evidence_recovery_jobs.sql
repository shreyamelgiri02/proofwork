-- Proofwork migration 0003: evidence, decisions, recovery, jobs, audit, metrics support.

set search_path = app, public;

-- ---------------------------------------------------------------------------
-- Observations: immutable independently fetched normalized source evidence
-- ---------------------------------------------------------------------------
create table app.observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  task_id uuid,
  connection_id uuid not null,
  adapter text not null check (adapter in ('LOCAL_SANDBOX', 'STRIPE_TEST')),
  environment text not null check (environment in ('SYNTHETIC_SANDBOX', 'STRIPE_TEST_MODE')),
  subscription_id text not null,
  result_type text not null check (result_type in ('SUCCESS', 'ERROR')),
  error_code text,
  http_status integer,
  snapshot jsonb,
  material_fingerprint text,
  snapshot_hash text,
  source_version text,
  provider_request_id text,
  observed_at timestamptz not null,
  trigger text not null check (trigger in ('CLAIM', 'MANUAL', 'RETRY', 'MONITOR', 'PRECHECK', 'POST_RECOVERY', 'RECONCILE', 'POLICY_CHANGE', 'REGISTRATION')),
  -- A read whose commit was fenced out by a newer processing version is retained for diagnostics.
  discarded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references app.tasks (workspace_id, id),
  foreign key (workspace_id, connection_id) references app.connections (workspace_id, id),
  constraint observations_result_shape check (
    (result_type = 'SUCCESS' and snapshot is not null and material_fingerprint is not null)
    or (result_type = 'ERROR' and error_code is not null)
  )
);
create index observations_task on app.observations (workspace_id, task_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Decisions: evaluator version, verdict, reason codes, cited observation
-- ---------------------------------------------------------------------------
create table app.decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  task_id uuid not null,
  observation_id uuid not null,
  request_id uuid not null,
  request_version integer not null,
  evaluator_version text not null,
  policy_version integer,
  verdict text not null check (verdict in ('SATISFIED_SCHEDULED', 'SATISFIED_ENDED', 'MISMATCH', 'UNVERIFIABLE', 'OUT_OF_SCOPE')),
  reason_codes text[] not null,
  comparison jsonb not null default '[]'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  recovery_candidate boolean not null default false,
  gate_decision text,
  trigger text not null,
  processing_version bigint not null,
  trustworthy boolean not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references app.tasks (workspace_id, id),
  foreign key (workspace_id, observation_id) references app.observations (workspace_id, id),
  foreign key (workspace_id, request_id) references app.authorized_requests (workspace_id, id)
);
create index decisions_task on app.decisions (workspace_id, task_id, evaluated_at desc);

alter table app.tasks
  add constraint tasks_latest_decision_fk foreign key (workspace_id, latest_decision_id) references app.decisions (workspace_id, id),
  add constraint tasks_latest_trustworthy_fk foreign key (workspace_id, latest_trustworthy_decision_id) references app.decisions (workspace_id, id);

-- ---------------------------------------------------------------------------
-- Recovery proposals (exact diff, expiry, request/policy/source binding)
-- ---------------------------------------------------------------------------
create table app.recovery_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  task_id uuid not null,
  request_id uuid not null,
  request_version integer not null,
  connection_id uuid not null,
  connection_config_version integer not null,
  source_account_id text not null,
  customer_id text not null,
  subscription_id text not null,
  expected_period_end timestamptz not null,
  action text not null default 'SCHEDULE_PERIOD_END_CANCELLATION' check (action = 'SCHEDULE_PERIOD_END_CANCELLATION'),
  diff jsonb not null,
  observation_id uuid not null,
  decision_id uuid not null,
  source_fingerprint text not null,
  policy_version integer not null,
  policy_mode text not null,
  proposal_hash text not null,
  status text not null check (status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'CONSUMED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'BLOCKED')),
  status_reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references app.tasks (workspace_id, id),
  foreign key (workspace_id, request_id) references app.authorized_requests (workspace_id, id),
  foreign key (workspace_id, connection_id) references app.connections (workspace_id, id),
  foreign key (workspace_id, observation_id) references app.observations (workspace_id, id),
  foreign key (workspace_id, decision_id) references app.decisions (workspace_id, id)
);
-- At most one live proposal per task.
create unique index recovery_proposals_one_active on app.recovery_proposals (workspace_id, task_id)
  where status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED');
create index recovery_proposals_workspace_status on app.recovery_proposals (workspace_id, status, created_at desc);
create index recovery_proposals_expiry on app.recovery_proposals (expires_at) where status in ('PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'BLOCKED');

-- Approval decisions: append-only (approve, reject or policy authorization)
create table app.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  proposal_id uuid not null,
  proposal_hash text not null,
  decision text not null check (decision in ('APPROVE', 'REJECT', 'AUTO_POLICY')),
  actor_type text not null check (actor_type in ('USER', 'DEMO_OPERATOR', 'SYSTEM')),
  actor_id text not null,
  actor_label text not null,
  reason text not null default '',
  policy_version integer not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, proposal_id) references app.recovery_proposals (workspace_id, id)
);
-- One decision per proposal: racing approve/reject cannot both commit.
create unique index approval_decisions_one_per_proposal on app.approval_decisions (proposal_id);

-- ---------------------------------------------------------------------------
-- Recovery operations: durable write intent with stable idempotency key
-- ---------------------------------------------------------------------------
create table app.recovery_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  task_id uuid not null,
  proposal_id uuid not null unique,
  approval_decision_id uuid not null,
  connection_id uuid not null,
  connection_config_version integer not null,
  subscription_id text not null,
  action text not null default 'SCHEDULE_PERIOD_END_CANCELLATION' check (action = 'SCHEDULE_PERIOD_END_CANCELLATION'),
  parameters jsonb not null,
  parameter_hash text not null,
  idempotency_key text not null unique,
  state text not null check (state in ('PREPARED', 'DISPATCHED', 'AWAITING_VERIFICATION', 'VERIFIED', 'FAILED_CONFIRMED', 'OUTCOME_UNKNOWN', 'RESOLVED_EXTERNALLY', 'BLOCKED')),
  outcome_certainty text not null default 'CERTAIN' check (outcome_certainty in ('CERTAIN', 'UNCERTAIN')),
  attribution text check (attribution in ('PROOFWORK', 'UNATTRIBUTED')),
  dispatch_count integer not null default 0,
  max_dispatches integer not null default 3,
  authorized_until timestamptz not null,
  dispatch_reserved_at timestamptz,
  first_dispatched_at timestamptz,
  last_provider_request_id text,
  last_error_code text,
  verified_decision_id uuid,
  resolved_at timestamptz,
  resolution_reason text,
  resolution_observation_id uuid,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references app.tasks (workspace_id, id),
  foreign key (workspace_id, proposal_id) references app.recovery_proposals (workspace_id, id),
  foreign key (workspace_id, approval_decision_id) references app.approval_decisions (workspace_id, id),
  foreign key (workspace_id, connection_id) references app.connections (workspace_id, id),
  constraint operations_dispatch_budget check (dispatch_count <= max_dispatches)
);
-- Resource guard: at most one unresolved operation per source subscription.
create unique index recovery_operations_one_unresolved_per_resource
  on app.recovery_operations (connection_id, subscription_id) where resolved_at is null;
create index recovery_operations_task on app.recovery_operations (workspace_id, task_id, created_at desc);

create table app.operation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  operation_id uuid not null,
  event_type text not null,
  from_state text,
  to_state text,
  actor_type text not null,
  actor_id text not null,
  details jsonb not null default '{}'::jsonb,
  correlation_id text not null,
  occurred_at timestamptz not null default now(),
  foreign key (workspace_id, operation_id) references app.recovery_operations (workspace_id, id)
);
create index operation_events_operation on app.operation_events (workspace_id, operation_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Durable job queue (FOR UPDATE SKIP LOCKED + leases)
-- ---------------------------------------------------------------------------
create table app.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references app.workspaces (id) on delete cascade,
  task_id uuid,
  kind text not null check (kind in ('VERIFY', 'RECHECK', 'MONITOR', 'RECOVER', 'RECONCILE', 'PROPOSAL_EXPIRY', 'DEMO_PURGE', 'CONNECTION_HEALTH')),
  dedupe_key text,
  status text not null default 'READY' check (status in ('READY', 'LEASED', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELED')),
  priority smallint not null default 50,
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  lease_token uuid,
  leased_by text,
  leased_until timestamptz,
  last_error_code text,
  last_error_class text check (last_error_class in ('RETRYABLE', 'PERMANENT', 'UNCERTAIN_MUTATION')),
  result jsonb,
  correlation_id text not null default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
-- Deduplicate only live jobs so the same logical trigger can run again later.
create unique index jobs_dedupe_live on app.jobs (dedupe_key) where dedupe_key is not null and status in ('READY', 'LEASED');
create index jobs_ready on app.jobs (priority, due_at, id) where status = 'READY';
create index jobs_leased on app.jobs (leased_until) where status = 'LEASED';
create index jobs_workspace on app.jobs (workspace_id, created_at desc);

create table app.worker_heartbeats (
  worker_name text primary key,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error_code text,
  last_batch_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Append-only audit events
-- ---------------------------------------------------------------------------
create table app.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  task_id uuid,
  request_id uuid,
  proposal_id uuid,
  operation_id uuid,
  actor_type text not null check (actor_type in ('USER', 'DEMO_OPERATOR', 'AGENT', 'WORKER', 'SYSTEM')),
  actor_id text not null,
  actor_label text not null,
  event_type text not null,
  summary text not null,
  before_values jsonb,
  after_values jsonb,
  policy_version integer,
  evaluator_version text,
  reason_code text,
  correlation_id text not null,
  occurred_at timestamptz not null default now()
);
create index audit_events_workspace_time on app.audit_events (workspace_id, occurred_at desc, id desc);
create index audit_events_task on app.audit_events (workspace_id, task_id, occurred_at desc);
create index audit_events_type on app.audit_events (workspace_id, event_type, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Human interventions (canonical ledger for the autonomy metric)
-- ---------------------------------------------------------------------------
create table app.interventions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  task_id uuid not null,
  kind text not null check (kind in ('MANUAL_VERIFY', 'PROPOSAL_REQUESTED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'REQUEST_SUPERSEDED', 'REQUEST_RETIRED', 'EXTERNAL_REPAIR_RECORDED', 'MANUAL_ESCALATION', 'MANUAL_RESOLUTION', 'TASK_RETIRED')),
  actor_id text not null,
  actor_label text not null,
  note text,
  dedupe_key text not null,
  correlation_id text not null,
  occurred_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key),
  foreign key (workspace_id, task_id) references app.tasks (workspace_id, id)
);
create index interventions_task on app.interventions (workspace_id, task_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Correctness reviews (independent adjudication labels on specific decisions)
-- ---------------------------------------------------------------------------
create table app.correctness_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  decision_id uuid not null,
  reviewer_id text not null,
  reviewer_label text not null,
  label text not null check (label in ('CORRECT', 'INCORRECT', 'INSUFFICIENT_EVIDENCE')),
  evidence_basis text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, decision_id) references app.decisions (workspace_id, id)
);
create index correctness_reviews_decision on app.correctness_reviews (workspace_id, decision_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiting (auth-sensitive routes, ingestion, demo commands)
-- ---------------------------------------------------------------------------
create table app.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
create index rate_limits_window on app.rate_limits (window_start);
