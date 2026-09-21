# Hosted deployment runbook

Proofwork deploys as four independently configurable parts: Supabase Cloud for Postgres and Auth, Vercel for the Next.js application, and two Railway services for the durable worker and Proofwork Sandbox. Real credentials must be entered in the provider dashboards; they do not belong in this repository.

## 1. Supabase Cloud

1. Create a production project and copy its direct admin connection only into the machine used for migration.
2. Create generated passwords for the restricted `proofwork_app` and `billing_sandbox_service` roles.
3. Set `DATABASE_ADMIN_URL`, `DATABASE_URL`, and `SANDBOX_DATABASE_URL` locally, then run `npm run db:migrate`. The migration command applies every file in `supabase/migrations` and enables login for the two restricted roles. Remove the admin URL after migration.
4. Use the transaction pooler on port `6543` for the Vercel `DATABASE_URL`. Use the session pooler on port `5432` for Railway. Both runtime URLs require TLS.

Do not put `DATABASE_ADMIN_URL` in Vercel or Railway.

## 2. Railway

Create two services from this repository and set their config-file paths independently.

### Proofwork Sandbox

- Config file: `/railway.sandbox.json`
- Public domain: enabled
- Required variables: `NODE_ENV=production`, `DATABASE_RUNTIME=persistent`, `SANDBOX_DATABASE_URL`, `SANDBOX_READ_TOKEN`, `SANDBOX_WRITE_TOKEN`, and `SANDBOX_ADMIN_TOKEN`
- Railway supplies `PORT`; the service binds `0.0.0.0:$PORT`
- Readiness endpoint: `/health`

Only Vercel receives the read/write tokens used by the adapter. The admin token is required for isolated demo scenario setup and must not be exposed to browsers.

### Worker

- Config file: `/railway.worker.json`
- Public domain: disabled
- Required variables: `NODE_ENV=production`, `DATABASE_RUNTIME=persistent`, `DATABASE_URL`, `WORKER_NAME`, `WORKER_POLL_INTERVAL_MS=2000`, `WORKER_BATCH_SIZE=20`, `WORKER_CONCURRENCY=5`, `WORKER_LEASE_SECONDS=120`, `SANDBOX_API_URL`, `SANDBOX_READ_TOKEN`, and `SANDBOX_WRITE_TOKEN`

The worker records a database heartbeat after every poll cycle and drains gracefully on `SIGTERM`/`SIGINT`.

## 3. Vercel

Use the repository root, the existing `vercel.json`, and the stable production alias. `npm run build:hosted` runs the production environment preflight before the Next.js build.

Set these variables for Production:

- `NEXT_PUBLIC_APP_URL` — exact `https://` production alias
- `PROOFWORK_ALLOWED_ORIGINS` — includes that exact origin
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true`
- `DATABASE_RUNTIME=serverless`
- `DATABASE_URL` — `proofwork_app` through the transaction pooler on port `6543`
- `DEMO_COOKIE_SECRET` — at least 32 random characters
- `SANDBOX_API_URL` — Railway HTTPS domain
- `SANDBOX_READ_TOKEN`, `SANDBOX_WRITE_TOKEN`, and `SANDBOX_ADMIN_TOKEN`

For Preview, use an exact preview origin and keep `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=false`. Do not add wildcard preview callbacks to Google or Supabase.

Run `npm run deploy:check` whenever production variables change. It fails for missing values, placeholder secrets, insecure URLs, a non-transaction-pooled web database, or inconsistent origins.

## 4. Google sign-in

1. In Google Cloud, configure an External OAuth consent screen, publish it, and request only `openid`, `email`, and `profile`.
2. Create a Web OAuth client. Add the Supabase provider callback shown by the Supabase dashboard, normally `https://<project-ref>.supabase.co/auth/v1/callback`, as the authorized redirect URI. Add the stable Vercel production origin as an authorized JavaScript origin.
3. Enable Google in Supabase Auth and enter the Google client ID and secret there.
4. Set the Supabase Site URL to the stable Vercel production alias and add the exact Vercel `/auth/callback` URL to the redirect allowlist.
5. Enable `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` only for Vercel Production.

Proofwork keeps the existing PKCE callback. A first sign-in creates a private workspace and enters onboarding; a returning identity returns to its safe requested route. Supabase automatic identity linking keeps a password account and Google identity with the same verified email in the same workspace.

## 5. Rollout and smoke test

Deploy in this order:

1. Supabase migrations
2. Railway Sandbox
3. Railway worker
4. Vercel Preview with Google disabled
5. Google and Supabase production callback configuration
6. Vercel Production promotion

After promotion, verify that `/api/health` returns `status: "ok"` with `database` and `sandbox` equal to `"ok"`, `auth` equal to `"configured"`, and `worker` equal to `"healthy"`. Then complete one personal Gmail sign-in, one email/password sign-in and recovery, one isolated demo scenario, one approval, and one verified recovery.

Application services can be rolled back independently. Database migrations in this release are additive and should not be rolled back destructively.
