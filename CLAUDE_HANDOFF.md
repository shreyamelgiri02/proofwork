# Claude handoff

## Checkpoint

Phases 0–6 implemented. Phase 7 (testing) prepared in TEST_PLAN.md and **not started**. Next action when authorized: run TEST_PLAN section A (typecheck, lint, build, migrations on a disposable DB), fix compile errors, then B–J.

Because this pass forbade type-checking and running code, expect a round of compile fixes in phase A. Highest-risk areas to check first: `postgres.js` generic/transaction typings in `packages/database`, `radix-ui` `Slot.Root` in `button.tsx`, zod v4 + `@hookform/resolvers` type inference in forms, Next 16 route handler param typing in `lib/api.ts` `route()`.

## Key decisions

| Decision | Reason |
| --- | --- |
| Project in `PROOF WORK/proofwork` | Build prompt: parent folder not empty |
| Direct Postgres (`postgres.js`) with restricted `proofwork_app` role; Supabase used for Auth | Real transactions, `FOR UPDATE SKIP LOCKED`, advisory locks; services enforce workspace scope, RLS kept as defense in depth |
| App tables in unexposed `app` schema | No Data API exposure to browsers |
| Demo via signed httpOnly cookie, not Supabase anonymous auth | Build prompt requirement |
| Stripe via REST with pinned `Stripe-Version` (2026-08-26.dahlia from old spec) | Explicit field normalization; avoids SDK type drift. Account identity from `GET /v1/account` |
| Single Stripe credential bound to one workspace (`PROOFWORK_STRIPE_WORKSPACE_ID`) | Credential isolation per old spec |
| Stripe onboarding tile shows "Not configured" instead of mockup's "Planned" | Build prompt wins: adapter is implemented, connected only after validation |
| Hand-written shadcn-style components on `radix-ui` | Avoid interactive CLI; single component system |
| Native `<select>` controls | Keyboard/screen-reader reliability |
| Policy names OBSERVE_ONLY / REQUIRE_APPROVAL / AUTO_RECOVER | Build prompt labels |
| Verdicts SATISFIED_SCHEDULED / SATISFIED_ENDED | Build prompt enum over old `SATISFIED + phase` |
| Evidence max age 30 s for evaluation, 10 s precheck | Old spec 15 + build prompt freshness budget |
| Request statuses ACTIVE / SUPERSEDED / RETIRED | Build prompt |
| Sandbox subscription PK (account_id, id) | Readable IDs like `sub_demo_1048` per isolated account |
| Scenario fixtures establish T from an independent read, then apply post-registration source changes | Never seed verdicts; conditions arise at the source |
| Homepage evidence preview labeled "Illustrative example · simulated data" | Mockup layout without implying live data |
| No legal/help/security footer links | Build prompt: only real destinations |
| lucide-react pinned to 0.544 | Stable canonical icon names verified against installed typings |
| TypeScript 5.9 instead of 7.x | Next.js tooling compatibility |

## File map

- Domain: `packages/domain/src/{constants,types,clock,observation,evaluator,recovery,labels,errors,schemas,scenarios,format}.ts`
- Services: `packages/database/src/{client,context,crypto,audit,jobs,workspaces,connections,tokens,requests,claims,verification,recovery,tasks,approvals,activity,insights,demo,health,ratelimit,explanation}.ts`
- Adapters: `packages/adapters/src/{types,http,sandbox,stripe,resolve,sandbox-admin}.ts`
- Worker: `apps/worker/src/index.ts`; Sandbox: `apps/billing-sandbox/src/index.ts`
- Web libs: `apps/web/src/lib/{env,redirect,session,api,api-client,auth-errors,demo-cookie,utils}.ts`, `supabase/server.ts`, `src/proxy.ts`
- UI: `apps/web/src/components/**`, `apps/web/src/features/**`, routes in `apps/web/src/app/**`

## Blockers / external setup

- Docker + Supabase CLI not installed on the build machine → local Auth/Postgres/email not started.
- No Stripe test credentials; no Google OAuth credentials; no AI provider key (all optional).

## Not implemented (documented)

Stripe webhooks; automated private-workspace retention deletion; multi-member workspaces.
