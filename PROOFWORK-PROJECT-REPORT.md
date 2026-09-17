# Proofwork — Project Report

**Trust the outcome, not the claim.**
Build, hosting, testing, architecture, usage, model and token summary.

| | |
| --- | --- |
| Project owner | Shreya Melgiri |
| Project folder | `C:\Users\abhis\Desktop\PROOF WORK\proofwork` |
| Report date | 17 September 2026 |
| Built with | Claude Code (CLI) on Windows 11, model **Claude Opus 5** |
| Current status | **Built, hosted locally at http://localhost:3000, tested.** Real Supabase Auth (sign-up → email → sign-in → reset), worker crash recovery, the Stripe adapter contract, accessibility and load have now been tested. Still open: a real Stripe sandbox account (needs your `sk_test_` key), Google sign-in (needs Google credentials) and a human screen-reader session |

---

## 1. What Proofwork is

Proofwork checks whether an AI employee really finished a business task it says it finished, and safely fixes the task if it did not.

The first supported task is **"cancel this subscription at the end of the current paid period."**

1. An operator records what the customer asked for (the exact subscription and end date, read from the billing system).
2. The AI agent reports "done".
3. A background worker reads the billing record itself — the agent's report is never trusted as proof.
4. A fixed set of rules decides the result: **Cancellation scheduled**, **Cancellation completed**, **Needs action**, **Could not verify**, or **Outside supported scope**.
5. If the only problem is a missing cancellation schedule, Proofwork proposes one exact fix (`cancel_at_period_end = true`).
6. A person approves it (or a clearly enabled auto-recover policy authorizes it). Proofwork checks the billing record again, applies the fix once, and **reads the record a second time** to confirm.
7. Everything is recorded in an activity history and shown in honest metrics.

---

## 2. How to use it

### 2.1 Start the app (every time)

Open a terminal in `C:\Users\abhis\Desktop\PROOF WORK\proofwork` and run:

```bash
npm run db:local:start        # local PostgreSQL on 127.0.0.1:54322
npm run auth:start            # terminal 1 — Supabase Auth (:54321) + email inbox http://127.0.0.1:54324
npm run start:sandbox         # terminal 2 — billing sandbox on :4010
npm run start:worker          # terminal 3 — background worker
npm run start:web             # terminal 4 — web app on http://localhost:3000
```

Stop with `Ctrl+C` in each terminal, then `npm run db:local:stop`.

If you change code, rebuild the web app first: `npm run build:web`.

### 2.2 First-time setup (already done on this machine)

```bash
npm install
npm run db:local:init         # creates the local database cluster in proofwork/.local
npm run auth:setup            # installs Supabase Auth's schema (auth server built once from source, see LOCAL-SETUP.md)
npm run db:migrate            # creates tables, roles and protections
```

The `.env` file with generated secrets already exists (it is git-ignored and must never be shared).

### 2.3 Try the demo (works now)

1. Open **http://localhost:3000** → **Explore live demo**.
2. A yellow banner shows **Demo · Simulated billing data**. The demo is private to your browser for about an hour.
3. Six example tasks appear and are checked by the worker within seconds:

| Customer | Result | Why |
| --- | --- | --- |
| Rivera Logistics | Needs action | Cancellation schedule missing — a fix can be proposed |
| Northwind Studio | Cancellation scheduled | The billing record is already correct |
| Corvid Health | Could not verify | The billing source is "down" |
| Brightsea Media | Needs action | The billing period changed after authorization |
| Halden Press | Cancellation completed | The subscription ended on time |
| Atlas Metering | Outside supported scope | Two plan items (unsupported) |

4. Open **Rivera Logistics** → **Review recovery proposal** → **Approve and apply**.
5. Open the task again: after the independent re-read it shows **Cancellation scheduled** and **Recovered by Proofwork · verified**.
6. Try the full journey yourself: **Tasks → Register request** → choose **Linden Supply** → type a ticket reference → **Preview end date** → tick the confirmation → **Confirm request** → **Submit agent report** → **Open task evidence**.
7. Explore **Activity** (with **Export CSV**), **Insights** (every rate shows its denominator) and **Settings** (policy, pause writes).
8. The **Scenario library** at the bottom of Tasks creates harder situations: rejected write, lost response, expired approval, write pause, competing recovery, source changes.
9. **Reset demo** (top banner) starts over; it affects only your demo.

### 2.4 Screens

| # | Screen | Address |
| --- | --- | --- |
| 01 | Homepage | `/` |
| 02 | Sign in | `/sign-in` |
| 03 / 04 | Create account + confirm email | `/sign-up` |
| 05 / 06 | Forgot / new password | `/forgot-password`, `/reset-password` |
| 07 | Auth callback | `/auth/callback` |
| 08–10 | Onboarding (workspace, policy, source) | `/onboarding` |
| 11 | Task inbox | `/app/tasks` |
| 12 | Task evidence | `/app/tasks/<id>` |
| 13 | Approvals | `/app/approvals` |
| 14 | Activity | `/app/activity` |
| 15 | Insights | `/app/insights` |
| 16 | Settings | `/app/settings` |
| 17 | Register request | `/app/requests/new` |
| 18 | Submit report | `/app/claims/new` |
| 19 | Page not found | any unknown address |

Screenshots from testing: `proofwork\tests\screenshots\` (24 images, desktop and mobile).

### 2.5 Connecting a real AI agent (API)

In a private workspace: **Settings → Agent ingestion → Create token** (shown once). The agent then calls:

```bash
curl -X POST http://localhost:3000/api/v1/claims \
  -H "Authorization: Bearer pwk_xxxxxxxx_YOUR_TOKEN" \
  -H "Idempotency-Key: support-run-1042-attempt-1" \
  -H "Content-Type: application/json" \
  -d '{"authorized_request_id":"REQUEST_UUID","agent":{"name":"Support Agent"},"report_text":"Cancellation scheduled for the end of the current paid period."}'
```

The response is `202 Accepted` with a receipt and task id — never "verified". Status: `GET /api/v1/tasks/<taskId>` with the same token.

### 2.6 Real accounts (working now)

1. Open **http://localhost:3000/sign-up** and enter a name, email and password (8+ characters).
2. Open the email inbox at **http://127.0.0.1:54324** (Mailpit: every local email lands here and nothing goes to the internet), then click **Confirm your email address**.
3. Complete onboarding (workspace → policy → **Local billing sandbox**). Your private workspace opens on Tasks.
4. **Forgot password** sends a reset email to the same inbox. Each link works once.

Auth runs on the real Supabase Auth server, built from its official source because Docker cannot run on this PC. It is not a fake login. Google sign-in shows "not configured" until Google OAuth credentials are added.

---

## 3. Working architecture

### 3.1 Picture

```
                         ┌───────────────────────────────────────────┐
  Browser (React UI) ───►│ apps/web — Next.js 16 (port 3000)          │
                         │  • 19 pages, design system, TanStack Query │
                         │  • /api/*   session or signed demo cookie  │
                         │  • /api/v1/* hashed agent tokens           │
                         │  • proxy.ts: auth cookies + route guard    │
                         └──────────────┬────────────────────────────┘
                                        │ packages/database services
                                        ▼
   ┌───────────────────────┐   ┌───────────────────────────────────────┐
   │ Supabase Auth :54321   │   │ PostgreSQL 18 (127.0.0.1:54322)        │
   │ (built from source)    │   │  schema auth  ← supabase_auth_admin    │
   │ Mailpit inbox :54324   │   │  schema app   ← role proofwork_app     │
   └───────────────────────┘   │  schema billing_sandbox ← sandbox role │
                               │  durable job queue, audit history      │
                               └──────────────▲────────────────────────┘
                                              │ leases jobs, writes evidence
                         ┌────────────────────┴──────────────────────┐
                         │ apps/worker — background process           │
                         │  verify • monitor • recover • reconcile    │
                         └────────────────────┬──────────────────────┘
                                              │ packages/adapters
                     ┌────────────────────────┴───────────────────────┐
                     ▼                                                ▼
   ┌───────────────────────────────────┐        ┌───────────────────────────────┐
   │ apps/billing-sandbox (port 4010)   │        │ Stripe API — TEST MODE only    │
   │ independent synthetic billing:     │        │ (adapter built, not configured)│
   │ read / write / admin credentials,  │        └───────────────────────────────┘
   │ idempotency records, fault controls│
   └───────────────────────────────────┘
```

### 3.2 Components

| Part | Technology | Job |
| --- | --- | --- |
| Web app | Next.js 16.3, React 19.3, TypeScript 5.9, Tailwind CSS 4.3, Radix UI, Lucide icons | Pages, forms, API routes, auth guard |
| Forms & data | React Hook Form + Zod 4 (shared schemas), TanStack Query | Validation in browser **and** server; live polling of saved state |
| Domain package | Pure TypeScript | Contract, 21-rule evaluator, recovery gate, labels, scenarios |
| Database package | postgres.js | Transactions, queue, audit, requests, claims, verification, recovery, metrics, demo |
| Adapters package | fetch-based clients | Local sandbox adapter, Stripe test-mode adapter (pinned API `2026-08-26.dahlia`), sandbox admin client |
| Worker | Node process (tsx) | Leases up to 20 jobs, 5 at a time, heartbeats, retries with backoff, reclaims crashed work |
| Billing sandbox | Hono HTTP service | Stands in for a billing provider with its own database role |
| Database | PostgreSQL 18.4 (embedded-postgres locally; Supabase Postgres when Docker is available) | All records, including Supabase Auth's `auth` schema |
| Auth | Supabase Auth (GoTrue, built from source for Windows) via `@supabase/ssr`; Mailpit captures email | Email/password, confirmation, reset, optional Google |

### 3.3 The main flow (what happens on "Approve and apply")

1. **Approve** — the server checks the proposal fingerprint, expiry, policy version and request, records the decision and queues a job. It replies "Approval recorded. The fix is queued."
2. **Fresh precheck** — the worker reads the billing record again (must be ≤ 10 seconds old at write time). If it is already correct, no write happens.
3. **Prepare** — a durable operation record with a stable key is saved *before* contacting billing. Only one unresolved operation per subscription is allowed.
4. **Reserve dispatch** — policy, write pause, deadline (15 min, and not within 120 s of the period end) and the 3-attempt limit are re-checked.
5. **Write** — exactly `cancel_at_period_end = true`, with the stable idempotency key.
6. **Record response** — accepted, rejected, or "uncertain" (timeout / lost response).
7. **Independent read** — only this read can mark the task verified. Lost responses are reconciled by checking the source's own operation history; the same key is reused, never a new one.
8. **History** — every step is in Activity and in the task chronology.

### 3.4 Safety and data protections

- Workspace isolation on every query; client-supplied workspace ids are never trusted; composite foreign keys prevent cross-workspace links.
- Evidence, decisions, receipts, approvals, policies and audit events are **append-only** (database triggers). Authorized request dates are **immutable**.
- Agent tokens are stored only as SHA-256 hashes and shown once; the app role cannot read billing-sandbox tables.
- CSRF protection (origin check) on all browser writes; safe redirect rules; rate limits on sign-in, demo, preview and agent API.
- CSV export neutralizes spreadsheet formulas.
- Stripe live keys and live-mode data are rejected; demo workspaces can never use Stripe.
- Optional AI explanation is off by default and cannot change results.

---

## 4. Testing — what was run and results

All tests below were **actually executed** on 17 September 2026 against the locally hosted app. The second round (§4.5–4.9) ran after real Supabase Auth was installed, and the unit, end-to-end, crash and Stripe suites were re-run on that database.

### 4.1 Summary

| Test layer | Tool | Result |
| --- | --- | --- |
| Type checking (web, worker, sandbox, packages) | `tsc --noEmit` | **Pass** (0 errors) |
| Lint (web) | ESLint (Next.js rules) | **Pass** — 0 errors, 2 minor warnings (both intentional) |
| Production build | `next build` | **Pass** — all 62 routes |
| Database migrations on a clean database | `npm run db:migrate` | **Pass** — 5 migrations |
| Unit tests: evaluator, recovery gate, redirects, CSV, credentials | Node test runner (`npm test`) | **73 / 73 pass** |
| End-to-end API tests against the running stack | Node test runner (`npm run test:e2e`) | **43 / 43 pass** (≈2 min) |
| Browser journey (real clicks) | Playwright | **16 / 16 steps pass**, 0 page errors |
| Page audit (19 screens, desktop 1440px + mobile 390px) | Playwright | **Pass** — no horizontal overflow, headings and `<main>` present, drawer works |
| Auth-callback / policy / mobile navigation smoke | Playwright | **5 / 5 pass** |
| **Real account journeys** (Supabase Auth + Mailpit) | Playwright, real emails | **Pass** — 18 checks, see §4.5 |
| **Worker crash mid-write** (real processes killed) | Node test runner (`npm run test:crash`) | **4 / 4 pass** (≈1 min) |
| **Stripe test-mode adapter** | stripe-mock + request-capture server (`npm run test:stripe`) | **24 / 24 pass** |
| **Accessibility** | axe-core WCAG 2.2 AA + best practice, 17 pages × 5 layouts | **0 violations in 85 page checks** (after fixes) |
| **Load** | autocannon + agent burst + worker throughput (`npm run test:load`) | **0 errors, 0 server errors** |

Result logs: `proofwork\tests\unit-results.txt`, `e2e-results.txt`, `crash-results.txt`, `stripe-results.txt`, `load-results.json`, `a11y-results.json`. Test code: `proofwork\tests\*.test.ts`.

### 4.2 What the tests proved

**Verification rules (unit):** correct schedule, correct end (exactly at T and at T+300 s), early end, late end, missing end time, missing schedule, conflicting custom date, custom date with wrong mode, period changed, wrong customer / subscription / account / environment, live mode, 8 unsupported structures, timeout, 404, access denied, malformed data, stale read, future timestamp, finalization pending, not ended, inactive request, missing request, determinism.

**Recovery gate (unit):** observe-only, approval required, auto-recover, write pause, 120 s cutoff, unresolved operation, prior reversal, not eligible, already satisfied, dispatch allowed, old precheck, fingerprint drift, policy change, expiry, missing approval.

**Isolation & security (end-to-end):** anonymous access blocked; forged demo cookie rejected; two demos cannot see or approve each other's data; cross-site POST rejected; demo cannot create tokens, edit identity or use Stripe; invalid agent token rejected; errors return field messages without stack traces; auth routes fail safely ("requires setup" without Supabase, a generic 401 with it); protected pages redirect to sign-in with a safe return path; open-redirect attempts blocked.

**Durable execution (end-to-end):** same idempotency key + same body returns the original receipt; changed body gives 409; 10 simultaneous identical submissions create exactly one receipt; different keys attach to one task; two simultaneous approvals record exactly one decision; competing recovery jobs produce exactly one write; lost write response reconciled to **VERIFIED** with one dispatch.

**Recovery behavior (end-to-end):** billing rejects write → FAILED_CONFIRMED, still Needs action; rejection requires a reason and leaves the verdict unchanged; expired proposal cannot be approved; source changes after approval block the stale write; wrong identity blocks recovery; external fix before dispatch → no write; reversal after a verified fix → human review, no automatic re-write; source outage → Could not verify, then recovers after restore; write pause holds an approved fix until resumed; observe-only never proposes; auto-recover needs explicit confirmation and then repairs with a policy authorization.

**Reporting (end-to-end):** Insights and Tasks use the same cohort; hard cases stay in the denominator; human-approved recoveries are excluded from the "without intervention" number; correctness shows **Not measured** until a review label exists; CSV export contains exactly the filtered rows.

**Agent API (end-to-end, private workspace created directly in the database):** real preview → confirm registration; claim accepted with 202; duplicate returns 200 with the same receipt; worker decides SCHEDULE_MISSING; extra fields (e.g. an agent trying to set the end date) rejected; missing Idempotency-Key rejected; revoked token stops working; token stored hashed.

**Database guards (end-to-end, as the application role):** audit, decisions, receipts, policies and approvals reject UPDATE/DELETE; authorized end date cannot be changed; app role cannot read billing-sandbox tables.

**Browser journey (Playwright):** demo from homepage → register Linden Supply request (confirm disabled until attestation) → submit report (request preselected) → accepted as queued → worker shows Needs action + proposal → approve (decided card stays visible) → independent read shows Cancellation scheduled + "Recovered by Proofwork · verified" → CSV download → Insights "Not measured" → write pause shown in top bar → auto-recover confirmation dialog traps focus and closes with Escape → demo reset → keyboard tab order on sign-in is logical.

### 4.3 Bugs found by testing and fixed

| # | Problem found | Fix |
| --- | --- | --- |
| 1 | Web server did not read the root `.env` (database showed "not configured") | Forced env reload in `next.config.ts` |
| 2 | Type error: `cache` option not valid for Node fetch in adapter | Removed option |
| 3 | Billing sandbox route parameters typed as possibly undefined | Added a typed `param()` helper |
| 4 | Demo had no unregistered subscriptions, so **Register request** could not be tried | Demo now seeds Linden Supply and Maple & Finch |
| 5 | Task list said "Evidence older than 24h" for a source that was never read successfully | Now says "No successful read yet" |
| 6 | After approving, the decided proposal vanished and the next waiting one replaced it | The decided proposal stays on screen |
| 7 | 10 lint errors (React effect patterns, unescaped apostrophes) | Refactored auth callback, settings policy state, explanation reset, drawer close |
| 8 | **Crash-safety gap:** if the worker died after marking an operation "dispatched" but before saving the billing response, the next worker treated it as *accepted* and could not re-reserve it | "Dispatched with no recorded response" now counts as **uncertain** and is reconciled with the same idempotency key (found while writing the crash tests) |
| 9 | **Reused or expired password-reset link** showed "Google sign-in was cancelled" (the generic `access_denied` code was checked before the specific `otp_expired`) | Specific error codes are checked first; the page now says "This reset link can't be used" with **Request a new link** |
| 10 | Colour contrast below WCAG AA: grey helper text (3.72:1), red button (4.03:1), 404 numeral (2.23:1) | Darker colours; all now ≥ 4.5:1 |
| 11 | Demo banner sat outside any page landmark. Code blocks and wide tables on phones could scroll but could not be reached by keyboard | Banner is now a labelled `<aside>`. The scroll areas are focusable, labelled regions |
| 12 | Windows showed scrollbar arrows beside the Tasks filter tabs | Vertical overflow hidden on the tab list |
| 13 | Supabase Auth would not compile on Windows (it uses a Linux-only socket option) | Patched the local build to use a standard listener. Only the local auth binary changed, not Proofwork code |
| 14 | The e2e test created users in a form the real `auth.users` table rejects, and assumed auth was not configured | Test now inserts a valid user row and checks the correct safe behaviour for both setups |

### 4.4 Not tested (and why)

| Area | Reason |
| --- | --- |
| Google sign-in | Needs a Google Cloud OAuth client ID and secret; only the "not configured" state was checked |
| Stripe against a **real** Stripe sandbox account | Needs your `sk_test_…` key in `.env`. The adapter was tested against Stripe's official mock server instead (§4.7) |
| Human screen-reader session (NVDA / JAWS / Narrator) | Needs a person listening. Automated accessibility rules and keyboard checks ran instead (§4.8), but they cannot judge whether announcements *sound* right |
| Load on production-like hardware | Load ran on this laptop with every service on one machine, so the numbers are a lower bound, not a capacity plan |

### 4.5 Real account journeys (Supabase Auth + Mailpit, Playwright)

Docker cannot run on this PC: hardware virtualization is off in the BIOS and WSL is not installed. Instead, the **official Supabase Auth server was compiled from source** with Go and runs as a Windows process. Mailpit captures the emails, and a small gateway serves auth at the usual Supabase address. No Proofwork code was changed for this.

| # | Check | Result |
| --- | --- | --- |
| 1 | Sign-up shows "Check your email" and a real **Confirm your email address** email arrives | Pass |
| 2 | **Resend** stays disabled for a 60 s countdown, then sends a second email | Pass |
| 3 | Changing the email keeps the typed values | Pass |
| 4 | Confirmation link → auth callback → onboarding | Pass |
| 5 | Onboarding (3 steps) → Tasks, with the real name in the top bar and the "No reports yet" empty state | Pass |
| 6 | Private workspace: register request → submit report → worker → **Needs action** | Pass |
| 7 | Signing in before confirming the email gives a safe "confirm your email" response (`EMAIL_NOT_CONFIRMED`) | Pass |
| 8 | Wrong password gives a generic message and keeps the email | Pass |
| 9 | Sign-out clears every session cookie; protected pages redirect to sign-in with a safe `next` | Pass |
| 10 | Deep link restored after sign-in | Pass |
| 11 | User B cannot read user A's task (409 before onboarding, 404 after) and sees 0 tasks | Pass |
| 12 | Signing up with an existing email shows the same screen, so accounts can't be enumerated | Pass |
| 13 | Forgot password responds identically for known and unknown emails; no email goes to an unknown address | Pass |
| 14 | Reset email arrives; mismatched passwords are rejected; the new password saves → Tasks | Pass |
| 15 | Old password is rejected and the new one works; the earlier session is signed out | Pass |
| 16 | **Reusing the reset link** shows "This reset link can't be used" and **Request a new link** | Pass (after fix 9) |
| 17 | Repeated sign-in attempts hit the rate limit (HTTP 429) | Pass |
| 18 | Unknown-user sign-in through the API returns a generic 401 with no stack trace | Pass (e2e suite) |

### 4.6 Worker crash in the middle of a write (`npm run test:crash`)

A test-only hook, disabled when `NODE_ENV=production`, makes a **real worker process exit abruptly** at a chosen point in the recovery. A second, healthy worker takes over once the 5-second lease expires.

| Crash point | Expected | Result |
| --- | --- | --- |
| After the operation is prepared (before billing is contacted) | Same operation and idempotency key reused; exactly **1** write reaches billing; ends VERIFIED and attributed to Proofwork | Pass |
| After the dispatch is reserved (before the write) | Same as above | Pass |
| After billing accepted the write but **before the response was saved** | Treated as uncertain, then reconciled against billing's own history with the same key: **no second write**, ends VERIFIED | Pass |
| A worker that lost its lease tries to save late results | Its commit is rejected (fenced by version) | Pass |

### 4.7 Stripe test mode (`npm run test:stripe`, 24 tests)

No Stripe account keys were provided, so these tests run against **stripe-mock** (Stripe's official API mock) and a local server that captures requests.

**Proved:**
- Every request uses the pinned API version `2026-08-26.dahlia`.
- Only test keys are accepted; live `sk_live_`/`rk_live_` keys are rejected before any network call.
- `cancel_at_period_end` is form-encoded correctly.
- An `Idempotency-Key` is sent and reused.
- Subscription reads map correctly, and account validation works.
- Live-mode objects are rejected.
- 401, 404, 429, 5xx and timeouts become "could not verify", never success.
- The mock base URL is refused in production.

**Not proved:** how your real Stripe sandbox account behaves. To test that, add `STRIPE_TEST_SECRET_KEY=sk_test_…` to `.env`.

### 4.8 Accessibility

- **Automated:** axe-core (WCAG 2.0/2.1/2.2 A and AA, plus best practice) ran on 17 pages (every screen except the onboarding steps, which were checked earlier) at desktop, tablet and phone widths in light and dark mode. Result: **85 page checks, 0 violations** after fixes 10–11 in §4.3. Details: `tests/a11y-results.json`.
- **Keyboard:**
  - The first Tab reaches "Skip to content".
  - Filter tabs move with the arrow keys and update `aria-selected`.
  - Dialogs trap focus and close with Escape.
  - Sign-in tab order is logical, and scrollable areas can be reached.
- **Not done:** a person listening with NVDA, JAWS or Narrator.

### 4.9 Load (`npm run test:load`, this laptop, 1 web + 1 worker process)

| Endpoint | Connections | Requests/s | p99 latency | Errors |
| --- | --- | --- | --- | --- |
| Homepage (server-rendered) | 20 | 223 | 129 ms | 0 |
| `/api/health` | 50 | 1,140 | 87 ms | 0 |
| `/api/tasks` (task list) | 25 | 465 | 72 ms | 0 |
| `/api/tasks/:id` (evidence) | 25 | 355 | 103 ms | 0 |
| `/app/tasks` page | 20 | 229 | 134 ms | 0 |
| `/api/insights` | 20 | 458 | 63 ms | 0 |

- **Agent burst:** 150 reports in 0.3 s from one token. 60 were accepted and 90 were refused with 429 (rate limit). There were **0 server errors**, and all 60 attached to **one** task with no duplicates.
- **Worker throughput:** 200 tasks were created, and all 200 were verified within 1.5 s of the last one arriving (~130 tasks/s) with 0 failed jobs. Verdicts matched expectations: 100 needs action, 50 outside scope, 50 scheduled.

---

## 5. Model used and token usage

### 5.1 Model

| Item | Value |
| --- | --- |
| Assistant | Claude Code (command-line agent) |
| Model | **Claude Opus 5** (`claude-opus-5`) |
| Sub-agents | None — all work done by the single main agent |
| Tools used | File read/write/edit, Bash & PowerShell, Context7 documentation lookup, Playwright browser automation |

### 5.2 Token usage (approximate)

These numbers come from the session's context-token counter (budget remaining shown during the session). They are **estimates of tokens processed by the model**, not an official billing statement — exact billed input/output/cached tokens are available in your Claude account usage page.

| Phase | What happened | Approx. tokens |
| --- | --- | --- |
| 1. Read & build | Read all 24 old specs, the build prompt, README, index, manifest, 19 prompts and 19 mockup images; wrote ~200 source/doc files | **~720,000** |
| 2. Build & host locally | Local Postgres, migrations, type-check, fixes, production build, start services, smoke tests | **~31,000** |
| 3. Testing & this report | 3 test suites, browser testing, 7 fixes, rebuilds, report | **~95,000** |
| 4. Second test round | Built Supabase Auth, Mailpit and stripe-mock locally; crash, Stripe, auth, accessibility and load tests; 7 more fixes; docs | **~600,000** (rougher: this phase spanned a context reset, so the counter wasn't read continuously) |
| **Total** | | **≈ 1.45 million tokens** |

Where the tokens went: the largest share was the first phase — reading about 275 KB of specifications plus 19 images, and then generating the full codebase (the output is roughly 800 KB of TypeScript/SQL/CSS plus ~75 KB of project documentation).

### 5.3 Output size

| Item | Count |
| --- | --- |
| Source, config and documentation files in `proofwork/` (excluding dependencies) | ~210 |
| API routes | 45 |
| Pages | 19 screens (26 routes incl. states) |
| Database migrations | 5 |
| Automated tests | 144 (73 unit + 43 end-to-end + 4 crash + 24 Stripe) + load script + 85 accessibility page checks + ~40 browser checks |

---

## 6. Main hindrances

| # | Hindrance | Impact | How it was handled |
| --- | --- | --- | --- |
| 1 | **Docker cannot run on this PC**: hardware virtualization is disabled in firmware, WSL is not installed, and the shell has no admin rights | Supabase's normal local stack (and its CLI) cannot start | First round: an honest "requires setup" state. Second round: compiled the official Supabase Auth server from source with Go and ran it, Mailpit and a small gateway as plain Windows processes |
| 2 | **Installed PostgreSQL 18 was client tools only** (no server files) | No local database server available | Used the `embedded-postgres` npm package (real PostgreSQL 18.4, no admin rights) with data in `proofwork/.local` |
| 3 | Migrations depend on Supabase's `auth` schema | Migrations would fail on plain Postgres | Added an automatic compatibility shim used only when that schema is missing (it never enables fake login) |
| 4 | **Build-first instruction** (no compiling or testing during the first pass) | ~200 files written without compiler feedback | Type errors turned out to be very few (3); fixed during hosting |
| 5 | Very large specification set (24 documents + 19 mockups) with some conflicts | Needed careful priority rules | Followed the given priority (build prompt → new prompts → mockups → new README → old specs); decisions recorded in `CLAUDE_HANDOFF.md` |
| 6 | Mockup vs. build-prompt conflict on Stripe ("Planned — not connected" vs. a real adapter) | Risk of misleading labels | Implemented the real adapter; UI shows "Not configured" until the account is validated |
| 7 | Next.js env caching in a monorepo | Web app could not see the database | Forced reload of the root `.env` |
| 8 | Claude usage limit reached once during the build | Work paused | Resumed from the same point without repeating work |
| 9 | No Stripe credentials | Stripe path untested | Adapter implemented with live-key rejection; tests deferred |
| 10 | Windows process handling | Old web-server and worker processes kept ports busy, or kept taking jobs, after being stopped | Stopped stray Node processes before each restart and before the crash tests |
| 11 | Supabase Auth source does not compile on Windows | Blocked real auth | Replaced a Linux-only socket option in the local copy |
| 12 | No Stripe keys and no Google OAuth client | Real third-party paths could not be exercised | Tested against Stripe's official mock server; left Google in its honest "not configured" state |
| 13 | A screen-reader session needs a human | Cannot be automated honestly | Ran automated WCAG rules and keyboard checks, and stated the gap |

---

## 7. Known limitations and next steps

1. Add `STRIPE_TEST_SECRET_KEY=sk_test_…` to `.env` and validate a real Stripe sandbox subscription end to end.
2. Add Google OAuth credentials if Google sign-in is wanted.
3. Not implemented by design in this release: Stripe webhooks (scheduled re-reads are used instead), automatic deletion of private data after 90/180 days (demo cleanup is automatic), multiple team members per workspace.
4. Before any production use: a human screen-reader pass, load testing on the real hosting, and a hosted deployment (web on Vercel; worker and sandbox on a long-running host; Supabase cloud).
5. The local database was reset once while installing real auth; only test data was lost.

---

## 8. Where things are

| Path | Contents |
| --- | --- |
| `proofwork\README.md` | Overview and quick start |
| `proofwork\LOCAL-SETUP.md` | Full local setup, including the no-Docker mode |
| `proofwork\USER-GUIDE.md` | Plain-language user guide |
| `proofwork\ARCHITECTURE.md`, `DATA-MODEL.md`, `API-CONTRACT.md` | Technical design |
| `proofwork\VERIFICATION-CONTRACT.md`, `RECOVERY-CONTRACT.md`, `METRICS.md` | Rules for decisions, fixes and numbers |
| `proofwork\TEST_PLAN.md`, `BUILD_STATUS.md` | Test plan and status ledger |
| `proofwork\tests\` | Test code (unit, e2e, crash, Stripe, load), result logs, accessibility results, screenshots |
| `proofwork\apps\` | web, worker, billing-sandbox |
| `proofwork\packages\` | domain, database, adapters |
| `proofwork\supabase\` | migrations and Supabase config |
| `proofwork-source.zip` | Source archive (refreshed after testing; excludes dependencies, database data and `.env`) |
| `PROOFWORK-PROJECT-REPORT.md` | This report |
