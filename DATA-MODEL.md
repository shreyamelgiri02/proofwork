# Data model

Migrations: `supabase/migrations/20260916000100…000500`. All timestamps are `timestamptz` stored in UTC and converted for display with the workspace timezone.

## Schemas and identities

| Schema / role | Purpose | Access |
| --- | --- | --- |
| `app` | Application records | `proofwork_app` (BYPASSRLS, SELECT/INSERT/UPDATE/DELETE); `anon` none; `authenticated` read-only RLS policies (no table grants by default) |
| `billing_sandbox` | Independent synthetic billing source | `billing_sandbox_service` only; `proofwork_app` has no access |
| `auth` | Supabase Auth users | Supabase; `app.profiles/workspaces/memberships` reference `auth.users` |
| `postgres` (admin) | Migrations and local seed lookup only | Never used by web or worker |

Because `proofwork_app` bypasses RLS, **every service filters by the resolved workspace** (`ServiceContext.workspace.id`); RLS is defense in depth.

## Entities

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `profiles` | Auth user display info | PK user_id → auth.users |
| `workspaces` | PRIVATE (owner) or DEMO (session hash, expiry, purge_after); onboarding step; write pause; current policy version | One PRIVATE per owner; demo field check |
| `memberships` | Explicit OWNER relationship | PK (workspace_id, user_id) |
| `policy_versions` | Immutable mode + limits | PK (workspace_id, version); append-only trigger |
| `connections` | Adapter, environment, account identity, health, config version, last read | One per adapter; one active per workspace; env ↔ adapter check |
| `agent_credentials` | Hashed ingestion tokens with prefix, scope, last use, revocation | `token_hash` unique |
| `registration_previews` | One-use, 5-minute preview tokens bound to actor, connection version and fingerprint | token hash unique |
| `authorized_requests` | Immutable customer authority: group/version, contract, connection + config version, account/customer/subscription, source reference, authorizer, authorized_at, **expected_period_end**, boundary observation, status ACTIVE/SUPERSEDED/RETIRED | Unique (workspace, group, version); one ACTIVE per group; immutability trigger (status fields only) |
| `tasks` | One execution per request version: verdict, reason, processing state, recovery state, gate, latest/trustworthy decision, read times, next check, intervention count, processing_version, retirement | Unique (workspace, request_id) |
| `claim_receipts` | Verbatim report (≤ 2000), producer identity, idempotency key, payload hash, source kind | Unique (workspace, producer_identity, idempotency_key); append-only |
| `ingestion_rejections` | Redacted rejected submissions | |
| `observations` | Normalized source evidence or typed error, fingerprint, snapshot hash, provider request id, trigger, discarded flag | Append-only (only `discarded` may change) |
| `decisions` | Evaluator version, verdict, reason codes, comparison, facts, gate, trustworthy, processing version | Append-only |
| `recovery_proposals` | Exact diff and full binding, hash, status, expiry | One live proposal per task |
| `approval_decisions` | APPROVE / REJECT / AUTO_POLICY with actor, reason, policy version | One per proposal; append-only |
| `recovery_operations` | Durable write intent, stable key, state, certainty, attribution, dispatch budget, deadlines, resolution | Unique proposal; unique key; **one unresolved per (connection, subscription)**; guard trigger (no delete while possibly dispatched; key/params immutable; count monotonic) |
| `operation_events` | Operation transitions | Append-only |
| `jobs` | Durable queue: kind, dedupe key, status, priority, due, attempts, lease token/expiry, error class, correlation id | Dedupe unique only while READY/LEASED |
| `worker_heartbeats` | Worker start/complete timestamps | |
| `audit_events` | Append-only history with actor, resources, before/after (redacted), policy/evaluator versions, reason, correlation id | |
| `interventions` | Canonical human-intervention ledger | Unique (workspace, dedupe_key) |
| `correctness_reviews` | Adjudication labels on specific decisions | Append-only |
| `rate_limits` | Fixed-window counters | |
| `billing_sandbox.accounts / subscriptions / operations / request_log` | Independent source state, fault controls, source-side idempotency, request log | Subscriptions PK (account, id); operations unique (account, idempotency_key) |

**Cross-workspace protection:** every child table references parents through composite `(workspace_id, id)` foreign keys.

## Indexes

Queue: `jobs_ready (priority, due_at, id) where READY`, `jobs_leased (leased_until)`. Proposals: active and expiry partial indexes. Tasks: `(workspace_id, created_at desc, id)`, `(workspace_id, verdict, created_at desc)`, due `next_check_at`. Audit: `(workspace_id, occurred_at desc, id desc)`, by task, by type. Interventions and reviews for metric joins.

## Concurrency mechanisms

- Queue claiming: `FOR UPDATE SKIP LOCKED` + lease token; fenced completion.
- Projection commits: `tasks.processing_version` + live lease check.
- Recovery: advisory transaction lock per resource + partial unique index for unresolved operations + row locks on proposals/operations.
- Approvals: row lock + unique decision per proposal.
- Claims: unique receipt and task keys; races resolve by reading the winner and comparing payload hashes.

## Who can mutate what

| Table group | Web services (owner/demo) | Worker | Ingestion token |
| --- | --- | --- | --- |
| Workspace, policy, connections, tokens | Owner (demo: own policy/pause only) | Connection health | — |
| Requests, previews | Owner/demo operator | — | — |
| Receipts, tasks (create) | Yes | — | Receipts/tasks for its workspace |
| Observations, decisions | Via recheck job only | Yes | — |
| Proposals, operations | Approve/reject; scenario controls | Yes | — |
| Audit, interventions, reviews | Append | Append | Append (claim audit) |

## Retention

- Demo: session expires after 1 h; purge after 24 h by the worker (or `npm run db:purge-demo`), skipping workspaces with unresolved dispatched operations; the sandbox account is deleted too.
- Private (proposed defaults, not yet automated): evidence 90 days and audit metadata 180 days after monitoring ends; never while an operation is unresolved. Previews purge 1 day after expiry; rate-limit rows after 1 day.
- Personal data kept: profile display name and email; source identifiers and synthetic customer labels; report text as submitted. No card data, transcripts or raw provider payloads.
