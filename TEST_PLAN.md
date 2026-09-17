# Final test plan

## Execution summary (2026-09-17, local no-Docker stack with real Supabase Auth)

The per-row `NOT_RUN` markers below are the original plan. What was actually executed, by section:

| Section | Executed by | Outcome |
| --- | --- | --- |
| A. Static and build gates | `tsc --noEmit`, ESLint, `next build`, `npm run db:migrate` | PASS (0 type errors, 0 lint errors) |
| B. Authentication journey | Playwright against locally built Supabase Auth + Mailpit | PASS 18 checks (Google OAuth: not configured, NOT_RUN) |
| C. Isolation and access | `npm run test:e2e` + two real accounts in Playwright | PASS |
| D/E. Verification and recovery rules | `npm test` (73) + `npm run test:e2e` (43) | PASS |
| F. Durable execution, idempotency, concurrency | `npm run test:e2e` + `npm run test:crash` (worker killed at 3 points + lease fencing) | PASS 4/4 crash; F10 covered against stripe-mock only |
| G. Interface and accessibility | Playwright page audit, axe-core WCAG 2.2 AA at 1280/768/390 light+dark (85 page checks), keyboard checks | PASS, 0 violations. Human screen-reader session NOT_RUN |
| H. Reporting | `npm run test:e2e` | PASS |
| I. External sandbox (Stripe) | `npm run test:stripe` against stripe-mock + capture server (24) | Adapter contract PASS. Real Stripe sandbox account NOT_RUN (no `sk_test_` key) |
| Load (added) | `npm run test:load` | PASS, 0 errors, see `tests/load-results.json` |
| J. Release readiness | — | NOT_RUN (no hosted deployment) |

Logs: `tests/*-results.txt`, `tests/load-results.json`, `tests/a11y-results.json`. Full narrative: `../PROOFWORK-PROJECT-REPORT.md` §4.

Record for each run: scenario id, commit, environment, actor, input, expected, observed, evidence references (task/decision/operation/correlation ids), timestamp, PASS/FAIL, defect id.

## A. Static and build gates

| ID | Check | Expected | Result |
| --- | --- | --- | --- |
| A1 | `npm ci` from lockfile | Clean install; note unapproved install scripts (esbuild, unrs-resolver) | NOT_RUN |
| A2 | `npm run typecheck` | No TypeScript errors in web, worker, sandbox, packages | NOT_RUN |
| A3 | `npm run lint` | No errors | NOT_RUN |
| A4 | `npm run build:web` | Next.js production build succeeds; proxy compiles on Node runtime | NOT_RUN |
| A5 | Env validation: start each service with a missing variable | Clear setup message; no crash loop leaking values | NOT_RUN |
| A6 | Fresh DB: `supabase db reset` then `npm run db:migrate` | All migrations apply; roles get LOGIN; re-run is idempotent | NOT_RUN |
| A7 | Append-only guards | UPDATE/DELETE on observations/decisions/audit/receipts rejected for `proofwork_app` | NOT_RUN |

## B. Authentication journey

| ID | Scenario | Expected | Result |
| --- | --- | --- | --- |
| B1 | Sign up | Confirmation screen; email in local inbox; no session before confirming | NOT_RUN |
| B2 | Resend | Disabled for 60 s; second resend inside window → 429 message | NOT_RUN |
| B3 | Change email | Returns to form with values | NOT_RUN |
| B4 | Confirm link | Callback → onboarding | NOT_RUN |
| B5 | Sign in wrong password | Safe message, values preserved, rate limit after 20 | NOT_RUN |
| B6 | Sign in unconfirmed | EMAIL_NOT_CONFIRMED copy | NOT_RUN |
| B7 | Sign out | Cookies cleared; `/app` redirects to sign-in; query cache cleared | NOT_RUN |
| B8 | Forgot password (existing / unknown email) | Identical responses | NOT_RUN |
| B9 | Reset link → new password | Password changed; other sessions revoked | NOT_RUN |
| B10 | Expired/used reset link | Error with "Request a new link" | NOT_RUN |
| B11 | Google not configured | Disabled button with explanation | NOT_RUN |
| B12 | Google configured: success / cancel / failure | Onboarding or next / cancelled message / oauth_failed message | NOT_RUN |
| B13 | Deep link `/app/tasks/<id>` while signed out | Sign-in with next → returns to task | NOT_RUN |
| B14 | `next=https://evil.example` and `//evil` | Falls back to /app/tasks | NOT_RUN |
| B15 | Session expiry | Protected routes require sign-in again | NOT_RUN |

## C. Workspace isolation

| ID | Scenario | Expected | Result |
| --- | --- | --- | --- |
| C1 | User A requests user B task/approval/activity/export/token revoke | 404 / no data | NOT_RUN |
| C2 | Demo session calls private-only routes (tokens, profile, Stripe) | 403 | NOT_RUN |
| C3 | Two demo sessions | Separate workspaces and sandbox accounts | NOT_RUN |
| C4 | Forged/modified demo cookie | Treated as expired; no access | NOT_RUN |
| C5 | Cross-origin POST with valid cookies | 403 ORIGIN_REJECTED | NOT_RUN |
| C6 | Ingestion token of workspace A with request of B | 404, rejection recorded | NOT_RUN |

## D. Verification correctness (unit-level evaluator + end-to-end)

Correct schedule; correct ended (T and T+300); ended T−1 s (early); ended after grace (late); missing schedule; custom date ≠ T; custom date = T with flag false; changed period; wrong customer/subscription/account; unsupported shape (2 items, schedule, pause, pending update); malformed payload; 404; 401/403; timeout; stale read (> 30 s); future observation time; finalization pending at T+299; NOT_ENDED at T+300; later regression after satisfied → new mismatch; source recovers after outage. Expected results per VERIFICATION-CONTRACT.md. **All NOT_RUN.**

## E. Recovery behavior

| ID | Scenario | Expected | Result |
| --- | --- | --- | --- |
| E1 | Observe only | No proposal, no write | NOT_RUN |
| E2 | Require approval | Proposal awaiting approval; no write before decision | NOT_RUN |
| E3 | Approve | Precheck → operation → dispatch → post-read → VERIFIED, task Cancellation scheduled | NOT_RUN |
| E4 | Reject | Proposal rejected; verdict unchanged; intervention counted | NOT_RUN |
| E5 | Expired proposal (control) | Approval returns APPROVAL_EXPIRED | NOT_RUN |
| E6 | Policy change while awaiting | Proposal superseded; new proposal under new version | NOT_RUN |
| E7 | Write pause then approve | No dispatch; resume dispatches if still valid | NOT_RUN |
| E8 | Boundary within 120 s | CUTOFF_REACHED, no write | NOT_RUN |
| E9 | Source drift (shift period) before approval | APPROVAL_STALE or PERIOD_CHANGED; no write | NOT_RUN |
| E10 | Source schedules externally before dispatch | NO_OP; no write | NOT_RUN |
| E11 | Mutation rejected | FAILED_CONFIRMED after independent read | NOT_RUN |
| E12 | Provider 200 but post-read fails | Operation unresolved; task not verified | NOT_RUN |
| E13 | Auto-recover | AUTO_POLICY decision; same guards; excluded from autonomy only if interventions exist | NOT_RUN |

## F. Durable execution

| ID | Scenario | Expected | Result |
| --- | --- | --- | --- |
| F1 | Same Idempotency-Key + same body twice | Same receipt/task, 200 | NOT_RUN |
| F2 | Same key, changed body | 409 DUPLICATE_PAYLOAD_CONFLICT | NOT_RUN |
| F3 | 20 concurrent identical claims | One receipt | NOT_RUN |
| F4 | Different keys, same request | One task, multiple receipts, one deduped read | NOT_RUN |
| F5 | Two concurrent approvals | One decision; other gets CONFLICT/STALE | NOT_RUN |
| F6 | Duplicate job delivery / competing recovery control | One operation; second blocked and audited | NOT_RUN |
| F7 | Kill worker after PREPARED | Reconcile continues same operation/key | NOT_RUN |
| F8 | Kill worker after DISPATCHED | Lease reclaimed; reconciliation read before any retry | NOT_RUN |
| F9 | Response lost scenario | OUTCOME_UNKNOWN → source op lookup → VERIFIED (attributed) | NOT_RUN |
| F10 | Stripe retry with original key | Idempotent replay; no duplicate change | NOT_RUN |
| F11 | Lease expiry with slow worker | Late commit discarded (observation `discarded=true`) | NOT_RUN |
| F12 | Unattributable correction | RESOLVED_EXTERNALLY, not counted as Proofwork recovery | NOT_RUN |
| F13 | Demo purge with unresolved dispatched op | Workspace skipped | NOT_RUN |

## G. Interface and accessibility

All 19 routes render at 1440, 1024, 768 and 390 px; keyboard-only journeys (tabs, menus, dialogs with focus trap/return, Escape); visible focus; screen-reader names for icon buttons, status text alongside color; polite live regions; reduced motion; contrast of muted/warning text; loading/empty/error states per UX-CONTRACT.md; browser back/forward with URL filters; no horizontal page scroll on mobile. Tools: Playwright flows + screenshots, axe, Chrome DevTools console/network. **All NOT_RUN.**

## H. Reporting

Cohort filter consistency between Tasks and Insights; one task per request; unverifiable/outside-scope in denominators; approval-driven recovery excluded from the autonomy numerator; Check now counts as intervention; correctness "Not measured" with no labels and correct rate/coverage with labels; demo and private cohorts separate; CSV contains exactly the filtered scope; cells starting with `= + - @` are escaped; no secrets in CSV. **All NOT_RUN.**

## I. External sandbox (Stripe test mode, credentials required)

Validate account; reject `sk_live_`; bound-workspace enforcement; register request from a real test subscription; claim; mismatch; approve; `cancel_at_period_end=true` only; post-write read confirms; conflicting custom date → no write; multi-item subscription → outside scope; livemode resource rejected. **All NOT_RUN.**

## J. Release readiness (only after A–I pass)

Secrets management, worker/sandbox hosting topology, migration process, queue monitoring and alerts, backups/restore with writes paused, deployment smoke checks. The implementation must not be labeled production-ready before this phase. **NOT_RUN.**
