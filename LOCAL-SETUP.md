# Local setup

Everything runs locally without paid services. Stripe test mode and Google OAuth are optional.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 20.19+ (22/24 LTS recommended) | Web, worker, sandbox, scripts |
| npm | 10+ | Single package manager (npm workspaces, `package-lock.json`) |
| Docker Desktop | current | Required by the Supabase CLI local stack |
| Supabase CLI | current | `supabase start` — Auth, Postgres 17, local email inbox |

> On the build machine Docker cannot run, so the no-Docker mode below is used. It uses the same Supabase Auth server, not a fake login.

## Ports

| Service | Port |
| --- | --- |
| Web app (Next.js) | 3000 |
| Billing sandbox | 4010 (bound to 127.0.0.1) |
| Supabase API / Auth | 54321 |
| Postgres | 54322 |
| Supabase Studio | 54323 |
| Local email inbox (Inbucket/Mailpit) | 54324 |

## Running without Docker (project-local Postgres + locally built Supabase Auth) — currently hosted this way

This machine cannot run Docker (hardware virtualization is disabled in firmware and WSL is not installed). Instead, every service runs as a normal Windows process:

| Piece | How it runs | Port |
| --- | --- | --- |
| PostgreSQL 18.4 | `embedded-postgres` npm package, data in `.local/pgdata` | 54322 |
| Supabase Auth (GoTrue) | Official `supabase/auth` source built with Go → `.local/bin/supabase-auth.exe` | 9999 (internal) |
| API gateway | `scripts/local-auth-run.mjs` maps `/auth/v1/*` like Supabase does | 54321 |
| Mailpit (email capture) | `.local/bin/mailpit.exe` | 54324 UI, 54325 SMTP |
| stripe-mock (tests only) | `go install github.com/stripe/stripe-mock@latest` → `.local/bin/stripe-mock.exe` | 12111 |

One-time setup (already done here):

```bash
npm run db:local:init          # creates .local/pgdata (superuser postgres/postgres, 127.0.0.1 only)
npm run db:local:start
# build auth once (needs Go 1.23+ and git):
#   git clone https://github.com/supabase/auth .local/src/auth
#   Windows only: in cmd/serve_cmd.go replace the SO_REUSEPORT ListenConfig with net.ListenConfig{} (Linux-only socket option)
#   cd .local/src/auth && go build -o ../../bin/supabase-auth.exe .
npm run auth:setup             # generates JWT secret + anon/service keys into .local/auth.env and .env, creates auth roles, runs 75 auth migrations
npm run db:migrate             # Proofwork migrations (uses the real auth.users table)
```

Every start (separate terminals):

```bash
npm run db:local:start
npm run auth:start             # Mailpit + Supabase Auth + gateway
npm run start:sandbox
npm run start:worker
npm run build:web && npm run start:web   # http://localhost:3000
```

Confirmation and password-reset emails appear at **http://127.0.0.1:54324**. `auth:setup --reset-shim` is only needed when converting a database that was created with the old plain-Postgres auth shim; it **deletes all local Proofwork data**.

Google sign-in stays disabled until `LOCAL_GOOGLE_CLIENT_ID` / `LOCAL_GOOGLE_SECRET` are set and `auth:setup` is re-run.

## 1. Install

```bash
cd proofwork
npm install
```

## 2. Environment

```bash
cp .env.example .env
npm run secrets:generate   # prints DEMO_COOKIE_SECRET, sandbox tokens and DB role URLs
```

Paste the generated lines into `.env`. Then start Supabase and copy its values:

```bash
supabase start
supabase status            # shows API URL and the publishable/anon key
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Keep `DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres` for migrations only.

The single root `.env` is loaded by the web app (`next.config.ts`), worker, sandbox and scripts. It is git-ignored.

## 3. Database

`supabase start` applies `supabase/migrations/*` automatically. Then run:

```bash
npm run db:migrate
```

This applies anything not yet applied and **enables LOGIN** for the restricted roles `proofwork_app` and `billing_sandbox_service` using the passwords inside `DATABASE_URL` and `SANDBOX_DATABASE_URL`.

## 4. Start services (three terminals)

```bash
npm run dev:sandbox    # independent billing source
npm run dev:worker     # durable verification + recovery worker
npm run dev            # web app → http://localhost:3000
```

## 5. Use it

- **Isolated demo:** open http://localhost:3000 → *Explore live demo*. Six starter scenarios are created through the real request → claim → worker path.
- **Private workspace:** *Build your workspace* → sign up → open the confirmation link from **http://127.0.0.1:54324** → onboarding → choose *Local billing sandbox*.
- **Optional seed for your account:** `npm run db:seed -- --email you@company.com` (add `--scenarios all` for all 13 scenarios). Requires the sandbox to be running.
- **Scenario library in a private workspace:** set `PROOFWORK_ENABLE_DEV_SCENARIOS=true` (development only).

## Stripe test mode (optional)

Automated adapter tests run without an account against stripe-mock: `npm run test:stripe` (needs stripe-mock on :12111). `STRIPE_API_BASE` may point at a loopback URL outside production only.


1. Create a Stripe **sandbox/test** account and a simple active subscription with one licensed recurring item.
2. Set `STRIPE_TEST_SECRET_KEY` (`sk_test_…` or `rk_test_…` with subscription read/write and account read), keep `STRIPE_API_VERSION=2026-08-26.dahlia`.
3. Set `PROOFWORK_STRIPE_WORKSPACE_ID` to your private workspace id (shown in Settings → Evidence sources instructions).
4. Restart the web app and worker. Settings → *Validate account* reads `GET /v1/account`; only then can it be selected.
Live keys (`sk_live_`/`rk_live_`) and live-mode resources are rejected.

## Google OAuth (optional)

Enable `[auth.external.google]` in `supabase/config.toml` with `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`, add the redirect URI shown by Google console, restart Supabase, set `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true`. Without it, the button renders an explained unavailable state.

## Optional AI explanation

Off by default. Set `PROOFWORK_EXPLANATION_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. It only rephrases recorded facts; failures fall back to deterministic copy.

## Stopping

`Ctrl+C` each Node process (the worker drains in-flight jobs). `supabase stop` stops the local stack while keeping data.

## Reset (data-loss scope)

| Command | What is lost |
| --- | --- |
| *Reset demo* (in app) | Only that demo workspace's records and its synthetic sandbox account data |
| `npm run db:purge-demo` | Demo workspaces past their 24h purge window |
| `supabase db reset` | **All local data**: accounts, workspaces, tasks, evidence, sandbox. Run `npm run db:migrate` afterwards |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Requires setup" page | Missing `DATABASE_URL` or Supabase public values in `.env` |
| `supabase start` fails | Docker Desktop not running |
| Port already in use | Stop the other process or change `SANDBOX_PORT` / Next `--port` and matching URLs |
| `password authentication failed for user proofwork_app` | Run `npm run db:migrate` after setting the password in `DATABASE_URL` |
| Onboarding: "local billing sandbox is not reachable" | Start `npm run dev:sandbox`; check `SANDBOX_API_URL` and tokens |
| Tasks stay *Waiting for verification* | Worker not running; Settings → Operations shows worker health |
| Confirmation email missing | Open http://127.0.0.1:54324 |
| Health shows `database: unavailable`, log says `received fast shutdown request` or `0xC0000142` | Postgres got Ctrl+C from a closing terminal, or Windows ran out of memory. Close other apps and run `npm run db:local:start` from a terminal you keep open (or run `postgres.exe -D .local/pgdata -p 54322` in its own terminal) |
| Stripe shows *Not configured* | Key missing/live, or `PROOFWORK_STRIPE_WORKSPACE_ID` not set to this workspace |
