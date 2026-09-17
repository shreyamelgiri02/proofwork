# Architecture

## Components

```
Browser ──► apps/web (Next.js 16, Node runtime)
              ├─ pages (React 19, TanStack Query polling persisted state)
              ├─ /api/*        cookie session (Supabase Auth) or signed demo cookie
              ├─ /api/v1/*     scoped ingestion tokens (external AI employees)
              └─ packages/database services ──► Postgres (schema app, role proofwork_app)
                                                   ▲
apps/worker (dedicated process) ──────────────────┘  leases jobs, writes evidence/decisions/operations/audit
      └─ packages/adapters ──► apps/billing-sandbox (HTTP, role billing_sandbox_service, schema billing_sandbox)
                           └─► Stripe API (test mode only, server-side key)
Supabase Auth ◄── web (email/password, confirmation, recovery, optional Google OAuth)
Local email capture ◄── Supabase Auth
```

| Layer | Choice | Notes |
| --- | --- | --- |
| Web | Next.js App Router 16, React 19, TypeScript | `proxy.ts` (Node) refreshes auth cookies and guards `/app`, `/onboarding` |
| Styling | Tailwind CSS v4 tokens in `globals.css` | shadcn-style components hand-written on Radix (`radix-ui`) |
| Icons | lucide-react | |
| Forms | React Hook Form + shared Zod schemas (`packages/domain/src/schemas.ts`) | Server re-validates every body |
| Client data | TanStack Query | Polls persisted state; slows when idle |
| Auth | Supabase Auth via `@supabase/ssr` | Identity validated with `auth.getUser()` server-side |
| Database | Postgres (local Supabase) accessed with `postgres.js` | Parameterized tagged templates, explicit transactions |
| Worker | `apps/worker` TypeScript process | Postgres queue with `FOR UPDATE SKIP LOCKED` |
| Billing sandbox | `apps/billing-sandbox` Hono HTTP service | Separate schema, role and bearer credentials |
| Stripe | REST adapter with pinned `Stripe-Version` | Chosen over the SDK to keep field mapping explicit |

## Boundaries

- **Presentation** — `apps/web/src/app`, `components`, `features`. No verdict logic; labels come from `@proofwork/domain`.
- **Authorized actions** — `apps/web/src/app/api/**` resolve the actor (`lib/session.ts`) and call services with a `ServiceContext`. Workspace IDs are never accepted from clients.
- **Verification engine** — `packages/domain/src/evaluator.ts` (pure) + `packages/database/src/verification.ts` (persistence and projection).
- **Recovery** — `packages/domain/src/recovery.ts` (pure gate) + `packages/database/src/recovery.ts` (proposal decisions, operation ledger, dispatch, reconciliation).
- **Durable jobs** — `packages/database/src/jobs.ts`, run by `apps/worker`.
- **Source access** — `packages/adapters`, only reachable from server code.

## Durable execution

1. Web requests persist quickly: claim acceptance commits receipt + task + job + audit in one transaction and returns `202`.
2. Worker loop (every `WORKER_POLL_INTERVAL_MS`): record heartbeat → reclaim expired leases → expire proposals → requeue orphaned reconciliations → purge demos (10 min) → refresh stale connection health (5 min) → lease ≤ 20 jobs (≤ 5 per workspace) and run ≤ 5 concurrently, extending leases every 30 s.
3. Each evaluation increments `tasks.processing_version`; commits are fenced by that version **and** the live job lease. Late reads are stored as `discarded` observations for diagnostics only.
4. Failures are classified RETRYABLE / PERMANENT / UNCERTAIN_MUTATION; retryable jobs back off with jitter until `max_attempts`, then become `DEAD` (visible in Settings → Operations and Insights).
5. Read retries of unavailable sources follow the 1 / 5 / 15 minute schedule on the task; exhaustion escalates while keeping *Could not verify*.
6. Monitoring: scheduled cancellations are re-read at least daily and at `T + 120 s`; finalization pending re-reads at `T + 300 s`.

See [RECOVERY-CONTRACT.md](RECOVERY-CONTRACT.md) for the write path.

## Trust boundaries

| Input | Trusted for | Never trusted for |
| --- | --- | --- |
| Supabase session | Actor identity | Access to any workspace except its membership |
| Signed demo cookie | Access to one unexpired demo workspace | Private data, Stripe |
| Ingestion token (hashed) | Submitting claims to its workspace | Authorizing requests, approvals, outcomes |
| Report text | A recorded statement | Verdicts, parameters, URLs |
| Source read | Observed fields at a time | Future permanence |
| Human approval | One bound proposal until expiry | Bypassing changed facts or policy |
| Optional model | Wording of recorded facts | Verdict, action, policy |

The browser never receives Supabase service credentials, database URLs, sandbox tokens, Stripe keys or the demo cookie secret. There is no HTTP endpoint that dispatches worker jobs.

## Deployment shape (future, not performed)

- Web: Vercel (Node runtime). Worker and billing sandbox: a long-running host (container/VM). Postgres + Auth: hosted Supabase.
- Durable work never depends on a web request staying open.
