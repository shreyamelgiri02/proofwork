-- Proofwork migration 0002: core application tables.
-- Conventions: UUID keys, timestamptz in UTC, every tenant row carries workspace_id,
-- composite (workspace_id, id) uniqueness so foreign keys cannot cross workspaces.

set search_path = app, public;

-- ---------------------------------------------------------------------------
-- Profiles (auth user display information)
-- ---------------------------------------------------------------------------
create table app.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------
create table app.workspaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('PRIVATE', 'DEMO')),
  owner_user_id uuid references auth.users (id) on delete set null,
  organization text not null default '' check (char_length(organization) <= 120),
  name text not null default '' check (char_length(name) <= 80),
  timezone text not null default 'UTC',
  -- 0 = not started, 1 = workspace saved, 2 = policy saved, 3 = complete
  onboarding_step smallint not null default 0 check (onboarding_step between 0 and 3),
  onboarding_completed_at timestamptz,
  writes_paused boolean not null default false,
  writes_paused_reason text check (char_length(writes_paused_reason) <= 200),
  writes_paused_at timestamptz,
  current_policy_version integer,
  -- Demo-only fields
  demo_session_hash text,
  expires_at timestamptz,
  purge_after timestamptz,
  retention_days integer not null default 90,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_demo_fields check (
    (kind = 'DEMO' and owner_user_id is null and demo_session_hash is not null and expires_at is not null and purge_after is not null)
    or (kind = 'PRIVATE' and owner_user_id is not null and demo_session_hash is null)
  )
);
-- First release: one persistent private workspace per owner account.
create unique index workspaces_one_private_per_owner on app.workspaces (owner_user_id) where kind = 'PRIVATE';
create unique index workspaces_demo_session on app.workspaces (demo_session_hash) where kind = 'DEMO';
create index workspaces_demo_purge on app.workspaces (purge_after) where kind = 'DEMO';

-- ---------------------------------------------------------------------------
-- Membership (explicit owner relationship)
-- ---------------------------------------------------------------------------
create table app.memberships (
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'OWNER' check (role in ('OWNER')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index memberships_user on app.memberships (user_id, workspace_id);

-- ---------------------------------------------------------------------------
-- Immutable recovery policy versions
-- ---------------------------------------------------------------------------
create table app.policy_versions (
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  version integer not null check (version > 0),
  mode text not null check (mode in ('OBSERVE_ONLY', 'REQUIRE_APPROVAL', 'AUTO_RECOVER')),
  allowed_action text not null default 'SCHEDULE_PERIOD_END_CANCELLATION'
    check (allowed_action = 'SCHEDULE_PERIOD_END_CANCELLATION'),
  approval_ttl_seconds integer not null default 900 check (approval_ttl_seconds between 60 and 3600),
  recovery_cutoff_seconds integer not null default 120 check (recovery_cutoff_seconds >= 60),
  freshness_budget_seconds integer not null default 10 check (freshness_budget_seconds between 1 and 60),
  changed_by text not null,
  changed_by_label text not null,
  change_reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (workspace_id, version)
);

-- ---------------------------------------------------------------------------
-- Evidence source connections (metadata only; secrets never stored here)
-- ---------------------------------------------------------------------------
create table app.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  adapter text not null check (adapter in ('LOCAL_SANDBOX', 'STRIPE_TEST')),
  environment text not null check (environment in ('SYNTHETIC_SANDBOX', 'STRIPE_TEST_MODE')),
  source_account_id text,
  display_name text not null,
  is_active boolean not null default false,
  health text not null default 'NOT_CHECKED' check (health in ('CONNECTED', 'DISCONNECTED', 'NOT_CHECKED', 'ERROR')),
  config_version integer not null default 1,
  api_version text,
  binding_method text,
  last_checked_at timestamptz,
  last_successful_read_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, adapter),
  constraint connections_env_matches_adapter check (
    (adapter = 'LOCAL_SANDBOX' and environment = 'SYNTHETIC_SANDBOX')
    or (adapter = 'STRIPE_TEST' and environment = 'STRIPE_TEST_MODE')
  )
);
create unique index connections_one_active on app.connections (workspace_id) where is_active;

-- ---------------------------------------------------------------------------
-- Agent ingestion credentials (hashed at rest)
-- ---------------------------------------------------------------------------
create table app.agent_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_prefix text not null,
  token_hash text not null unique,
  scope text not null default 'claims:write' check (scope = 'claims:write'),
  created_by text not null,
  created_by_label text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  unique (workspace_id, id)
);
create index agent_credentials_workspace on app.agent_credentials (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- One-use registration previews (server-only)
-- ---------------------------------------------------------------------------
create table app.registration_previews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  actor_id text not null,
  connection_id uuid not null,
  connection_config_version integer not null,
  source_account_id text not null,
  customer_id text not null,
  subscription_id text not null,
  customer_label text,
  source_reference text not null,
  supersedes_request_id uuid,
  expected_period_end timestamptz not null,
  material_fingerprint text not null,
  snapshot jsonb not null,
  observed_at timestamptz not null,
  provider_request_id text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references app.connections (workspace_id, id) on delete cascade
);
create index registration_previews_expiry on app.registration_previews (expires_at);

-- ---------------------------------------------------------------------------
-- Immutable authorized customer requests (versioned)
-- ---------------------------------------------------------------------------
create table app.authorized_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  request_group_id uuid not null,
  version integer not null check (version > 0),
  contract_id text not null default 'subscription.cancel_at_period_end.v1'
    check (contract_id = 'subscription.cancel_at_period_end.v1'),
  connection_id uuid not null,
  adapter text not null check (adapter in ('LOCAL_SANDBOX', 'STRIPE_TEST')),
  connection_config_version integer not null,
  source_account_id text not null,
  customer_id text not null,
  subscription_id text not null,
  customer_label text,
  source_reference text not null check (char_length(source_reference) between 1 and 120),
  authorization_kind text not null check (authorization_kind in ('OPERATOR_CONFIRMED', 'DEMO_FIXTURE')),
  authorized_by text not null,
  authorized_by_label text not null,
  authorized_at timestamptz not null default now(),
  expected_period_end timestamptz not null,
  -- The observation used to establish the boundary (normalized snapshot + fingerprint).
  boundary_observation jsonb not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED', 'RETIRED')),
  status_changed_at timestamptz,
  status_reason text,
  superseded_by uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, request_group_id, version),
  foreign key (workspace_id, connection_id) references app.connections (workspace_id, id)
);
create index authorized_requests_active on app.authorized_requests (workspace_id, status, created_at desc);
create unique index authorized_requests_one_active_per_group on app.authorized_requests (workspace_id, request_group_id) where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Tasks: one workflow execution per authorized request version
-- ---------------------------------------------------------------------------
create table app.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  request_id uuid not null,
  contract_id text not null default 'subscription.cancel_at_period_end.v1',
  agent_name text not null,
  verdict text not null default 'PENDING'
    check (verdict in ('PENDING', 'SATISFIED_SCHEDULED', 'SATISFIED_ENDED', 'MISMATCH', 'UNVERIFIABLE', 'OUT_OF_SCOPE')),
  primary_reason_code text,
  processing_state text not null default 'QUEUED'
    check (processing_state in ('QUEUED', 'VERIFYING', 'WAITING_RECHECK', 'AWAITING_APPROVAL', 'RECOVERING', 'MONITORING', 'IDLE', 'ESCALATED')),
  recovery_state text not null default 'NONE'
    check (recovery_state in ('NONE', 'PROPOSED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'PREPARED', 'DISPATCHED', 'AWAITING_VERIFICATION', 'VERIFIED', 'REJECTED', 'EXPIRED', 'BLOCKED', 'FAILED_CONFIRMED', 'OUTCOME_UNKNOWN', 'RESOLVED_EXTERNALLY')),
  gate_decision text,
  latest_decision_id uuid,
  latest_trustworthy_decision_id uuid,
  last_checked_at timestamptz,
  last_trustworthy_read_at timestamptz,
  next_check_at timestamptz,
  first_verified_at timestamptz,
  human_intervention_count integer not null default 0,
  processing_version bigint not null default 0,
  read_retry_count integer not null default 0,
  monitoring_ended_at timestamptz,
  retired_at timestamptz,
  retired_by text,
  retirement_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, request_id),
  foreign key (workspace_id, request_id) references app.authorized_requests (workspace_id, id)
);
create index tasks_workspace_created on app.tasks (workspace_id, created_at desc, id);
create index tasks_workspace_verdict on app.tasks (workspace_id, verdict, created_at desc);
create index tasks_next_check on app.tasks (next_check_at) where next_check_at is not null and retired_at is null;

-- ---------------------------------------------------------------------------
-- Claim receipts (original report, identity, idempotency key, payload hash)
-- ---------------------------------------------------------------------------
create table app.claim_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  task_id uuid not null,
  request_id uuid not null,
  producer_identity text not null,
  credential_id uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  agent_name text not null,
  agent_reference text,
  report_text text not null check (char_length(report_text) <= 2000),
  payload_hash text not null,
  source_kind text not null check (source_kind in ('API', 'HUMAN', 'DEMO')),
  claimed_at timestamptz,
  correlation_id text not null,
  received_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, producer_identity, idempotency_key),
  foreign key (workspace_id, task_id) references app.tasks (workspace_id, id),
  foreign key (workspace_id, request_id) references app.authorized_requests (workspace_id, id),
  foreign key (workspace_id, credential_id) references app.agent_credentials (workspace_id, id)
);
create index claim_receipts_task on app.claim_receipts (workspace_id, task_id, received_at);

create table app.ingestion_rejections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces (id) on delete cascade,
  producer_identity text not null,
  reason_code text not null,
  submission_hash text,
  correlation_id text not null,
  occurred_at timestamptz not null default now()
);
create index ingestion_rejections_workspace on app.ingestion_rejections (workspace_id, occurred_at desc);
