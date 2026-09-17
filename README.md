# Proofwork

**Trust the outcome, not the claim.** Proofwork independently verifies whether an AI employee completed an authorized business action, then recovers confirmed incomplete work within explicitly granted permissions.

Project owner: **Shreya Melgiri**.

> Status: **IMPLEMENTATION COMPLETE — TESTING NOT RUN.** See [BUILD_STATUS.md](BUILD_STATUS.md) and [TEST_PLAN.md](TEST_PLAN.md). Nothing in this repository has been compiled, type-checked, run or tested yet.

## What it does

The first (and only) supported workflow is `subscription.cancel_at_period_end.v1`:

1. An operator registers the customer's request — Proofwork reads the billing source and fixes the authorized paid-period end.
2. An AI employee (or an operator) submits the agent's completion report.
3. A background worker reads the billing source independently.
4. A pure, versioned evaluator decides: **Cancellation scheduled**, **Cancellation completed**, **Needs action**, **Could not verify** or **Outside supported scope**.
5. If only the period-end schedule is missing, Proofwork proposes one bounded fix (`cancel_at_period_end = true`).
6. A human approves (or an explicit auto-recover policy authorizes) it; the worker re-checks, writes with a stable operation key and reads the source again.
7. Every step lands in the append-only activity history and in honest, denominator-first Insights.

## Repository layout

```
apps/web              Next.js 16 app (UI + authenticated API routes + ingestion API)
apps/worker           Durable background worker (Postgres queue, leases, recovery)
apps/billing-sandbox  Independent local billing source (separate HTTP service + DB role)
packages/domain       Contracts, evaluator, recovery gate, labels, Zod schemas, scenarios
packages/database     Application services (transactions, queue, audit, metrics, demo)
packages/adapters     Billing adapters: local sandbox, Stripe test mode, admin client
supabase/             config.toml, migrations, seed.sql
scripts/              migrate, generate-secrets, seed-local, purge-demo
```

## Quick start (local)

Full instructions, ports and troubleshooting: **[LOCAL-SETUP.md](LOCAL-SETUP.md)**.

```bash
npm install
npm run secrets:generate          # copy output into .env (start from .env.example)
supabase start                    # requires Docker; Auth, Postgres, local email inbox
npm run db:migrate                # schemas, roles, RLS, append-only guards
npm run dev:sandbox               # http://127.0.0.1:4010
npm run dev:worker
npm run dev                       # http://localhost:3000
```

Local email (confirmation and password reset links): **http://127.0.0.1:54324**.

## Documentation

| Document | Purpose |
| --- | --- |
| [DESIGN.md](DESIGN.md) | Tokens, typography, components, layout, responsive rules |
| [UX-CONTRACT.md](UX-CONTRACT.md) | Account journey, page states, navigation, permissions |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, connections, durable execution, trust boundaries |
| [DATA-MODEL.md](DATA-MODEL.md) | Entities, constraints, scoping, identities, retention |
| [API-CONTRACT.md](API-CONTRACT.md) | Routes, auth, errors, idempotency, rate limits, curl |
| [VERIFICATION-CONTRACT.md](VERIFICATION-CONTRACT.md) | Ordered decision rules and evidence requirements |
| [RECOVERY-CONTRACT.md](RECOVERY-CONTRACT.md) | Authority, proposal binding, concurrency, uncertainty |
| [METRICS.md](METRICS.md) | Cohorts, denominators, interventions, correctness |
| [LOCAL-SETUP.md](LOCAL-SETUP.md) | Services, environment, commands, reset, troubleshooting |
| [USER-GUIDE.md](USER-GUIDE.md) | Plain-language guide |
| [TEST_PLAN.md](TEST_PLAN.md) | Deferred final testing plan (all NOT_RUN) |
| [BUILD_STATUS.md](BUILD_STATUS.md) | Implementation / configuration / validation ledger |
| [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) | Decisions, file map, blockers, continuation checkpoint |

Reference material (original specifications and mockups) is preserved outside this folder; see [references/README.md](references/README.md).
