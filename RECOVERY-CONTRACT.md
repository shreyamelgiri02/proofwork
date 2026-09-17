# Recovery contract

Allowed action: **SCHEDULE_PERIOD_END_CANCELLATION** — exactly `cancel_at_period_end = true` on the authorized subscription. No refunds, immediate cancellations, restorations, price or invoice changes.

## Policy

| Mode | Behavior |
| --- | --- |
| OBSERVE_ONLY | Verify; never propose or write |
| REQUIRE_APPROVAL (default) | Create a proposal; wait for an owner decision |
| AUTO_RECOVER | Same proposal, guards and post-write read; a recorded `AUTO_POLICY` authorization replaces the human decision. Enabling requires explicit confirmation |

Policies are immutable versions (`app.policy_versions`). A new version supersedes live proposals bound to the old version and re-queues their tasks. **Write pause** blocks new dispatch reservations; reads and reconciliation continue; resuming re-queues authorized proposals and re-derives paused ones.

## Operating limits (server-enforced, `packages/domain/src/constants.ts`)

| Constant | Value |
| --- | --- |
| Precheck freshness (source freshness budget) | 10 s — not a polling cadence |
| Evaluation evidence max age | 30 s |
| Proposal/approval validity | 15 min |
| Recovery cutoff before T | 120 s |
| Finalization grace after T | 300 s |
| Job lease | 120 s |
| Write retry window | 15 min |
| Dispatches per operation | 3 (same key) |

## Eligibility gate (`evaluateRecoveryGate`)

Decisions: `ALREADY_SATISFIED`, `REQUEST_NOT_ACTIVE`, `NOT_CANDIDATE`, `PRIOR_REVERSAL`, `OPERATION_UNRESOLVED`, `OBSERVE_ONLY`, `CUTOFF_REACHED`, `APPROVAL_EXPIRED`, `APPROVAL_STALE` (request/policy/fingerprint), `CONNECTION_CHANGED`, `EVIDENCE_TOO_OLD`, `WRITES_PAUSED`, `APPROVAL_REQUIRED`, `EXECUTION_ALLOWED`. The same function runs at proposal creation, approval and dispatch.

## Proposal binding

`app.recovery_proposals` binds task, request id/version, connection id/config version, account/customer/subscription, authorized boundary, exact diff (changes + unchanged fields), observation + decision, material fingerprint, policy version/mode and expiry. `proposal_hash` = SHA-256 of the canonical binding; approvals must present it. At most one live proposal per task (partial unique index).

## Human decision

`POST /api/approvals/:id/decision` locks the proposal, re-validates hash, expiry, status, active request, current policy version (not observe-only) and connection version, then records an append-only `approval_decisions` row (unique per proposal — racing approve/reject cannot both commit), an intervention, audit, and (approve) a deduplicated `RECOVER` job. Response copy: "Approval recorded. The fix is queued." Rejection never changes the verdict.

## Durable execution (`processRecoverJob`)

1. **Fresh precheck** read stored as evidence (`PRECHECK`). Already satisfied → no write (`recovery.no_op`). Unreadable → no write, retry job.
2. **Gate at dispatch stage** with current policy, pause, fingerprint and evidence age.
3. **Prepare** (transaction, `pg_advisory_xact_lock` on connection+subscription): insert `recovery_operations` (`PREPARED`, `idempotency_key = pw_op_<operation id>`, `authorized_until = min(proposal expiry, T − cutoff, now + 15 min)`), consume the proposal. Partial unique index `(connection_id, subscription_id) where resolved_at is null` guarantees one unresolved operation per resource; a competing recovery is blocked and audited.
4. **Reserve dispatch** (transaction): re-check pause, policy version/mode, request, connection version, deadline, budget, precheck age → `DISPATCHED`, `dispatch_count + 1`. A never-dispatched operation that loses authority resolves as `BLOCKED`.
5. **Dispatch** the fixed parameters with the stable key.
6. **Persist the response**: accepted → `AWAITING_VERIFICATION`; refused → `AWAITING_VERIFICATION` with `REJECTED:<code>`; timeout/5xx/network → `OUTCOME_UNKNOWN` ("The fix may have been applied…").
7. **Independent read** (`POST_RECOVERY`), then resolve:

| Evidence | Response | Result |
| --- | --- | --- |
| Satisfied | Accepted, or source operation history shows applied | `VERIFIED`, attribution PROOFWORK |
| Satisfied | Uncertain/refused and not attributable | `RESOLVED_EXTERNALLY`, attribution UNATTRIBUTED |
| Schedule still missing | Refused, or source history shows not applied | `FAILED_CONFIRMED` |
| Schedule still missing | Uncertain, budget and window remain | Retry **same operation and key** |
| Read failed / other state / budget exhausted | — | Stays unresolved, escalated; reconciliation reads every 1–15 min for 24 h |

HTTP 200 alone never verifies an outcome. Exactly-once delivery is not claimed.

## States

Task recovery projection: `NONE → PROPOSED/AWAITING_APPROVAL → AUTHORIZED → PREPARED → DISPATCHED → AWAITING_VERIFICATION → VERIFIED`, plus `REJECTED, EXPIRED, BLOCKED, FAILED_CONFIRMED, OUTCOME_UNKNOWN, RESOLVED_EXTERNALLY`. Operation transitions are appended to `operation_events`.

## In-flight commands

Retirement, request supersession and write pause stop *future* writes; unresolved, possibly dispatched operations keep reconciling and cannot be deleted (trigger guard), including during demo purge/reset.

## Scenario controls (demo / development only)

Mutation rejected, response lost, material change before approval (shift period), wrong identity, expired approval (expire now), write pause, competing recovery (queue duplicate job). Never available for Stripe connections.
