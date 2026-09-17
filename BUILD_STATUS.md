# Build status

**IMPLEMENTATION COMPLETE — BUILT, HOSTED LOCALLY AND TESTED (2026-09-17), including real Supabase Auth, worker crash recovery, Stripe adapter contract, accessibility and load. Live Stripe sandbox and Google OAuth still need the owner's credentials.** Full report: `../PROOFWORK-PROJECT-REPORT.md`

## Validation run on 2026-09-17 (local, no Docker)

| Check | Result | Evidence |
| --- | --- | --- |
| Type-check worker + packages, billing sandbox, web | PASS (after fixing 1 adapter + sandbox param typing) | `tsc --noEmit` exit 0; web covered 113 source files |
| Production build (`next build`) | PASS | All 62 routes compiled |
| Migrations on clean Postgres 18.4 (project-local) + role logins | PASS | 5 migrations applied |
| Services start: sandbox :4010, worker, web :3000 | PASS | `/health` ok; `/api/health` database ok |
| Demo creation + worker verification of 6 starter scenarios | PASS | Scheduled 1, Completed 1, Needs action 2, Could not verify 1, Outside scope 1 |
| Approve Rivera Logistics → precheck → one write → independent read | PASS | Task SATISFIED_SCHEDULED; operation VERIFIED, attribution PROOFWORK, 1 dispatch |
| All pages / key APIs respond (demo session) | PASS | 200s; `/onboarding` redirects demo to tasks; unknown route 404 |
| CSV export | PASS | Header + rows streamed |
| Supabase Auth journeys (sign-up, confirm, resend, sign-in, sign-out, reset, reused link, cross-account isolation, rate limit) | PASS | Real Supabase Auth built from source + Mailpit, Playwright; see report §4.5 |
| Google OAuth | NOT_RUN — Requires Google credentials | Unconfigured state verified |
| Stripe adapter contract (stripe-mock + request-capture server + config guards) | PASS 24/24 | `npm run test:stripe`, `tests/stripe-results.txt` |
| Stripe against a real Stripe sandbox account | NOT_RUN — Requires `sk_test_` key | |
| Lint (ESLint) | PASS | 0 errors, 2 warnings after fixes |
| Unit tests: evaluator, recovery gate, redirects, CSV, credentials | PASS 73/73 | `npm test`, `tests/unit-results.txt` |
| End-to-end API (isolation, CSRF, idempotency, concurrency, recovery scenarios, policies, metrics, CSV, ingestion API, DB guards) | PASS 43/43 | `npm run test:e2e`, `tests/e2e-results.txt` |
| Browser journey + page audit desktop/mobile (Playwright) | PASS 16/16 steps, 0 page errors | `tests/screenshots/` |
| Worker killed after prepare / after dispatch reserved / after write, plus lease fencing | PASS 4/4 | `npm run test:crash`, `tests/crash-results.txt` |
| Load (autocannon, ingestion burst, 200-task worker throughput) | PASS, 0 errors | `npm run test:load`, `tests/load-results.json` |
| Accessibility (axe-core WCAG 2.2 AA + keyboard) | PASS — 85 page checks, 0 violations | `tests/a11y-results.json` |
| Human screen-reader session (NVDA/JAWS) | NOT_RUN | Needs a person listening; automated checks only |


- Project path: `C:\Users\abhis\Desktop\PROOF WORK\proofwork`
- Date: 2026-09-16 · Owner: Shreya Melgiri
- Build mode: build-only. No type-check, lint, production build, app run, browser check or test has been executed. `npm install` was run once to resolve dependencies and create `package-lock.json` (exit 0).
- Resolved versions (lockfile): next 16.3.5, react 19.3.0, @supabase/ssr 0.7.0, @supabase/supabase-js 2.116.0, zod 4.6.5, radix-ui 1.6.7, lucide-react 0.544.0, @tanstack/react-query 5.103.1, tailwindcss 4.3.3, postgres 3.4.9, hono 4.13.8, @hono/node-server 1.19.17, typescript 5.9.3.

Legend — Implementation: Complete / Partial / Missing · Configuration: Ready / Requires setup / Not applicable · Validation: NOT_RUN.

| Requirement | Implementation | Configuration | Validation | Notes |
| --- | --- | --- | --- | --- |
| Monorepo, npm workspaces, lockfile | Complete | Ready | NOT_RUN | `package.json`, `package-lock.json` |
| Environment examples + secret generator | Complete | Requires setup | NOT_RUN | `.env.example`, `scripts/generate-secrets.ts` |
| Domain contracts, enums, Zod schemas | Complete | Not applicable | NOT_RUN | `packages/domain` |
| Deterministic evaluator (21 ordered rules) | Complete | Not applicable | NOT_RUN | `packages/domain/src/evaluator.ts` |
| Recovery gate | Complete | Not applicable | NOT_RUN | `packages/domain/src/recovery.ts` |
| Migrations: schema, composite FKs, indexes, append-only & immutability triggers, grants, RLS | Complete | Requires setup (Docker + Supabase CLI absent on build machine) | NOT_RUN | `supabase/migrations/*` |
| Supabase local config + local email inbox | Complete | Requires setup | NOT_RUN | `supabase/config.toml` |
| Migration runner + role login setup | Complete | Requires setup | NOT_RUN | `scripts/migrate.ts` |
| Public homepage | Complete | Ready | NOT_RUN | `apps/web/src/app/page.tsx` |
| Email/password auth (Supabase) | Complete | Requires setup | NOT_RUN | `app/api/auth/*`, `(auth)` pages |
| Email confirmation + resend cooldown | Complete | Requires setup | NOT_RUN | `sign-up-form.tsx` |
| Password recovery + reset | Complete | Requires setup | NOT_RUN | `password-forms.tsx`, `reset-password` |
| Auth callback routing | Complete | Requires setup | NOT_RUN | `features/auth/auth-callback.tsx`, `api/auth/exchange` |
| Google OAuth (optional) | Complete | Requires setup (disabled by default) | NOT_RUN | `api/auth/oauth/google` |
| Safe return paths / open-redirect protection | Complete | Ready | NOT_RUN | `lib/redirect.ts` |
| Proxy session refresh + route guard | Complete | Ready | NOT_RUN | `src/proxy.ts` |
| Three-step onboarding with server-side progress | Complete | Requires setup | NOT_RUN | `features/onboarding` |
| Private workspace + explicit owner membership | Complete | Requires setup | NOT_RUN | `workspaces.ts` |
| Isolated anonymous demo (signed cookie, 1 h, purge 24 h, reset) | Complete | Requires setup (DEMO_COOKIE_SECRET, sandbox) | NOT_RUN | `demo.ts`, `api/demo/*` |
| Protected app shell (sidebar, top bar, drawer, demo banner) | Complete | Ready | NOT_RUN | `components/shell` |
| Task inbox (metrics, priority, tabs, search, cohort, pagination, empty) | Complete | Ready | NOT_RUN | `features/tasks/tasks-page.tsx` |
| Task evidence (request/claim/observation, comparison, reason, next action, chronology, technical evidence, copy) | Complete | Ready | NOT_RUN | `task-detail-page.tsx`, `evidence.tsx` |
| Register request (preview → confirm, fresh re-read, versions) | Complete | Requires setup | NOT_RUN | `requests.ts`, `register-request-page.tsx` |
| Submit report form | Complete | Ready | NOT_RUN | `submit-report-page.tsx` |
| Ingestion API with scoped hashed tokens + idempotency | Complete | Requires setup | NOT_RUN | `api/v1/claims`, `claims.ts`, `tokens.ts` |
| Recovery proposals + approvals | Complete | Ready | NOT_RUN | `verification.ts`, `recovery.ts`, `approvals-page.tsx` |
| Durable recovery execution, uncertainty, reconciliation | Complete | Ready | NOT_RUN | `recovery.ts` |
| Background worker (leases, backoff, fairness, heartbeat, maintenance) | Complete | Requires setup | NOT_RUN | `apps/worker`, `jobs.ts` |
| Independent local billing sandbox (read/write/admin creds, idempotency, faults) | Complete | Requires setup | NOT_RUN | `apps/billing-sandbox` |
| Stripe test-mode adapter (pinned API version, live rejection, account binding) | Complete | Requires setup (no credentials) — Configured: no / Connection: not checked | NOT_RUN | `packages/adapters/src/stripe.ts` |
| Scenario controls (12 conditions) | Complete | Requires setup | NOT_RUN | `scenarios.ts`, `demo.ts`, `task-actions.tsx` |
| Activity history + filters + CSV export (formula-safe) | Complete | Ready | NOT_RUN | `activity.ts`, `activity-page.tsx` |
| Insights with denominators, interventions, correctness | Complete | Ready | NOT_RUN | `insights.ts`, `insights-page.tsx` |
| Settings: profile, policy versions, write pause, sources, tokens, account, operations health | Complete | Ready | NOT_RUN | `settings-page.tsx` |
| Interventions ledger + correctness reviews | Complete | Ready | NOT_RUN | `tasks.ts` |
| Rate limits (auth, ingestion, demo, preview, explanation) | Complete | Ready | NOT_RUN | `ratelimit.ts` |
| CSRF origin checks, standard error shape, correlation ids | Complete | Ready | NOT_RUN | `lib/api.ts` |
| Optional AI explanation (off, deterministic fallback) | Complete | Requires setup (optional) | NOT_RUN | `explanation.ts` |
| 404, loading and error states | Complete | Ready | NOT_RUN | `not-found.tsx`, `app/app/loading.tsx`, `error.tsx` |
| Seed / purge utilities | Complete | Requires setup | NOT_RUN | `scripts/seed-local.ts`, `purge-demo.ts` |
| Documentation set (14 documents) | Complete | Not applicable | NOT_RUN | repository root |
| Source ZIP | Complete | Not applicable | NOT_RUN | `../proofwork-source.zip` |

## Known limitations (by design / not implemented)

- Private evidence/audit retention windows (90/180 days) are documented but not yet automated; demo purge is automated.
- Stripe webhooks are not implemented; monitoring relies on scheduled reads (documented in ARCHITECTURE.md).
- One owner per workspace; no team members or invitations.
- `npm install` warned that `esbuild` and `unrs-resolver` install scripts were not approved (`npm install-scripts approve`); platform binaries usually still resolve — verify in phase A.
