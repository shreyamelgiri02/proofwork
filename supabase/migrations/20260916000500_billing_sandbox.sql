-- Proofwork migration 0005: independent local billing sandbox.
-- Owned by `billing_sandbox_service`. The application role has no access; the
-- verification engine reaches this state ONLY through the sandbox HTTP service.

set search_path = billing_sandbox, public;

create table billing_sandbox.accounts (
  id text primary key check (id ~ '^acct_sbx_[a-z0-9]{8,32}$'),
  label text not null,
  -- Opaque reference to the owning Proofwork workspace (not a foreign key: separate system).
  owner_reference text not null unique,
  kind text not null check (kind in ('PRIVATE', 'DEMO')),
  created_at timestamptz not null default now()
);

create table billing_sandbox.subscriptions (
  id text not null check (id ~ '^sub_[A-Za-z0-9_]{6,64}$'),
  account_id text not null references billing_sandbox.accounts (id) on delete cascade,
  customer_id text not null,
  customer_label text not null,
  status text not null check (status in ('active', 'canceled', 'past_due', 'trialing')),
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  item_count integer not null default 1 check (item_count >= 0),
  items_complete boolean not null default true,
  usage_type text not null default 'licensed',
  collection_method text not null default 'charge_automatically',
  schedule_id text,
  pause_collection boolean not null default false,
  pending_update boolean not null default false,
  -- Fault controls, set only through the restricted admin API (demo/development).
  read_fault text not null default 'NONE' check (read_fault in ('NONE', 'UNAVAILABLE', 'NOT_FOUND', 'DENIED', 'MALFORMED')),
  write_fault text not null default 'NONE' check (write_fault in ('NONE', 'REJECT', 'RESPONSE_LOST')),
  scenario_key text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Identifiers are scoped per synthetic account so isolated workspaces can reuse
  -- readable demo IDs (e.g. sub_demo_1048) without seeing each other's records.
  primary key (account_id, id)
);
create index subscriptions_account on billing_sandbox.subscriptions (account_id, created_at);

-- Source-side idempotency and mutation history.
create table billing_sandbox.operations (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references billing_sandbox.accounts (id) on delete cascade,
  subscription_id text not null,
  idempotency_key text not null,
  operation text not null check (operation in ('schedule_period_end_cancellation', 'admin_mutation')),
  request_hash text not null,
  result_status integer not null,
  result_body jsonb not null,
  version_before integer,
  version_after integer,
  created_at timestamptz not null default now(),
  unique (account_id, idempotency_key)
);
create index operations_subscription on billing_sandbox.operations (account_id, subscription_id, created_at desc);

create table billing_sandbox.request_log (
  id bigserial primary key,
  account_id text,
  request_id text not null,
  method text not null,
  path text not null,
  status integer not null,
  credential text not null check (credential in ('read', 'write', 'admin', 'none')),
  occurred_at timestamptz not null default now()
);
create index request_log_time on billing_sandbox.request_log (occurred_at desc);

grant select, insert, update, delete on all tables in schema billing_sandbox to billing_sandbox_service;
grant usage, select on all sequences in schema billing_sandbox to billing_sandbox_service;
alter default privileges in schema billing_sandbox grant select, insert, update, delete on tables to billing_sandbox_service;
