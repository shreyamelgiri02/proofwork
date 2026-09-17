# API contract

All routes live in `apps/web/src/app/api`. Responses carry `x-correlation-id` and `cache-control: no-store`. Bodies are validated on the server with the shared Zod schemas regardless of client validation.

## Authentication

| Kind | Mechanism | Routes |
| --- | --- | --- |
| Session | Supabase Auth cookies, validated with `auth.getUser()`; or signed httpOnly `pw_demo` cookie for one unexpired demo workspace | `/api/*` except `/api/v1/*` and `/api/health` |
| Ingestion token | `Authorization: Bearer pwk_<prefix>_<secret>`; SHA-256 hashed at rest; workspace derived from token | `/api/v1/*` |
| CSRF | Non-GET cookie requests must come from an allowed `Origin` (`PROOFWORK_ALLOWED_ORIGINS`) or `Sec-Fetch-Site: same-origin` | All session routes |

A submitted workspace id is never accepted. Missing and inaccessible resources return the same `404`.

## Error shape

```json
{ "error": { "code": "APPROVAL_STALE", "message": "The subscription changed. Review the latest evidence before approving again.", "field_errors": {}, "retryable": false, "retry_after_seconds": 30, "correlation_id": "6c1e…" } }
```

| HTTP | Codes |
| --- | --- |
| 400 | INVALID_PAYLOAD, IDEMPOTENCY_KEY_REQUIRED |
| 401 | AUTH_REQUIRED, INVALID_CREDENTIALS, INVALID_INGESTION_TOKEN, DEMO_EXPIRED |
| 403 | PERMISSION_DENIED, ORIGIN_REJECTED, EMAIL_NOT_CONFIRMED, DEMO_EXTERNAL_ACCESS_BLOCKED, LIVE_MODE_BLOCKED |
| 404 | NOT_FOUND |
| 409 | CONFLICT, DUPLICATE_PAYLOAD_CONFLICT, PREVIEW_STALE, PREVIEW_EXPIRED, APPROVAL_STALE, APPROVAL_EXPIRED, OPERATION_ALREADY_PENDING, ONBOARDING_INCOMPLETE |
| 413 | PAYLOAD_TOO_LARGE |
| 422 | REQUEST_NOT_ACTIVE, UNSUPPORTED_WORKFLOW |
| 429 | RATE_LIMITED (+ `retry-after`) |
| 500 | INTERNAL_ERROR (no stack traces) |
| 503 | SOURCE_UNAVAILABLE, SOURCE_NOT_CONFIGURED, SETUP_REQUIRED |

## Routes

### Auth and session

| Method & path | Input | Output / notes | Limit |
| --- | --- | --- | --- |
| POST `/api/auth/sign-in` | `{email, password, next?}` | `{redirect}` (onboarding or safe `next`) | 20 / 10 min per IP |
| POST `/api/auth/sign-up` | `{fullName, organization, email, password}` | `{status: "confirmation_sent"}` (no enumeration) | 10 / 10 min per IP |
| POST `/api/auth/resend` | `{email}` | `{status, cooldown_seconds: 60}` | 1 / 60 s per email |
| POST `/api/auth/forgot-password` | `{email}` | Generic response always | 20 / 10 min per IP |
| POST `/api/auth/update-password` | `{password, confirmPassword}` | Requires recovery session; signs out other sessions | |
| POST `/api/auth/exchange` | `{code? , token_hash?, type?, next?}` | `{redirect}` | |
| GET `/api/auth/oauth/google?next=` | — | 302 to provider (only if configured) | |
| POST `/api/auth/sign-out` | — | Clears auth + demo cookies | |
| GET `/api/session` | — | Identity, workspace, policy, connection, counts | |

### Demo (demo workspace; scenario routes also private LOCAL_SANDBOX when `PROOFWORK_ENABLE_DEV_SCENARIOS=true`)

| Method & path | Input | Notes |
| --- | --- | --- |
| POST `/api/demo` | — | Creates/resumes isolated demo; sets signed cookie; 10/min per IP |
| POST `/api/demo/reset` | `{confirm: true}` | Only this demo |
| GET/POST `/api/demo/scenarios` | `{key}` | Seeds source → request → claim → queued job |
| POST `/api/demo/source-changes` | `{task_id, change}` | External synthetic change; Proofwork must re-read |
| POST `/api/demo/controls` | `{task_id, control: EXPIRE_PROPOSAL | QUEUE_COMPETING_RECOVERY}` | |

### Onboarding and settings

| Method & path | Input |
| --- | --- |
| GET `/api/onboarding` | — |
| POST `/api/onboarding/workspace` | `{organization, name, timezone}` |
| POST `/api/onboarding/policy` | `{mode, confirmAutoRecover?}` |
| POST `/api/onboarding/source` | `{adapter}` — completes only after the source validates |
| GET `/api/settings` | Workspace, policy history, connections, tokens, health, account |
| PATCH `/api/settings/profile` | `{organization, name, timezone}` |
| POST `/api/settings/policy` | `{mode, reason?, confirmAutoRecover?}` → new immutable version |
| POST `/api/settings/pause` | `{paused, reason?}` |
| POST `/api/settings/connections` | `{action: configure|check|activate, adapter}` |
| GET/POST `/api/settings/tokens` | `{name}` → `{token}` shown once |
| POST `/api/settings/tokens/:id/revoke` | — |

### Work

| Method & path | Input | Output / idempotency |
| --- | --- | --- |
| GET `/api/subscriptions` | — | Limited source listing for selection |
| POST `/api/requests/preview` | `{subscription_id, source_reference, supersedes_request_id?}` | `{preview_token, expected_period_end, …, expires_at}` (5 min, one use); 30/min |
| POST `/api/requests` | `{preview_token, confirm: true}` | 201; fresh re-read; `409 PREVIEW_STALE` on material change |
| GET `/api/requests?status=all` | — | Requests with task linkage |
| POST `/api/requests/:id/retire` | `{reason}` | |
| POST `/api/claims` | Header `Idempotency-Key`; `{authorized_request_id, agent_name, report_text}` | 202 new / 200 duplicate / 409 changed payload |
| GET `/api/tasks?status&q&range&page` | — | Counts for the same cohort + page |
| GET `/api/tasks/:id` | — | Request, receipts, decisions + observations, proposals, operations, events, allowed actions |
| POST `/api/tasks/:id/recheck` | — | 202; one outstanding read per task |
| POST `/api/tasks/:id/retire` | `{reason}` | |
| POST `/api/tasks/:id/interventions` | `{kind, note}` | |
| POST `/api/tasks/:id/reviews` | `{decision_id, label, evidence_basis}` | |
| GET `/api/tasks/:id/explanation?decision_id` | — | Deterministic, optional model-assisted; 10/min |
| GET `/api/approvals?filter=waiting|decided|all` | — | |
| POST `/api/approvals/:id/decision` | `{decision, proposal_hash, reason}` | "Approval recorded. The fix is queued." |
| GET `/api/activity?q&type&range&actor&task&page` | — | |
| GET `/api/activity/export?…` | — | Streaming CSV of exactly that scope; formula-escaped |
| GET `/api/insights?range` | — | Server-side aggregates with denominators |
| GET `/api/health` | — | Liveness only |

### External ingestion

**POST `/api/v1/claims`** — 60 requests/min per token, 16 KiB body limit.

Headers: `Authorization: Bearer pwk_…`, `Idempotency-Key` (8–200 URL-safe chars).
Body (strict; unknown fields rejected):

```json
{
  "authorized_request_id": "22222222-2222-4222-8222-222222222222",
  "agent": { "name": "Support Agent", "reference": "support-run-1042" },
  "report_text": "Cancellation scheduled for the end of the current paid period.",
  "claimed_at": "2026-09-16T10:42:00Z"
}
```

Response `202` (or `200` for an identical duplicate):

```json
{
  "accepted": true, "duplicate": false,
  "receipt_id": "44444444-4444-4444-8444-444444444444",
  "task_id": "33333333-3333-4333-8333-333333333333",
  "verification": { "verdict": "PENDING", "processing_state": "QUEUED" },
  "status_url": "/api/v1/tasks/33333333-3333-4333-8333-333333333333",
  "correlation_id": "…"
}
```

Rules: same key + same canonical payload → original receipt/task; same key + changed payload → `409 DUPLICATE_PAYLOAD_CONFLICT`; concurrent duplicates → database uniqueness guarantees one receipt; additional reports for the same request version (different keys) attach to the same task and request one deduplicated re-read. The agent cannot supply the target outcome, customer or date. `claimed_at` must be within the last 24 h and ≤ 5 min in the future.

```bash
curl -X POST http://localhost:3000/api/v1/claims \
  -H "Authorization: Bearer pwk_xxxxxxxx_REPLACE_WITH_TOKEN" \
  -H "Idempotency-Key: support-run-1042-attempt-1" \
  -H "Content-Type: application/json" \
  -d '{"authorized_request_id":"REQUEST_UUID","agent":{"name":"Support Agent"},"report_text":"Cancellation scheduled for the end of the current paid period."}'
```

**GET `/api/v1/tasks/:taskId`** — persisted status for the token's workspace (120/min).

## Billing sandbox HTTP API (internal)

| Credential | Route |
| --- | --- |
| read/write/admin | `GET /v1/accounts/:acct`, `GET …/subscriptions`, `GET …/subscriptions/:id`, `GET …/operations/:idempotencyKey` |
| write only | `POST …/subscriptions/:id/schedule-cancellation` with `Idempotency-Key` and body exactly `{"cancel_at_period_end": true}` |
| admin only | `POST /admin/accounts`, `POST /admin/accounts/:acct/subscriptions`, `POST …/subscriptions/:id/changes`, `POST /admin/accounts/:acct/reset`, `DELETE /admin/accounts/:acct` |
