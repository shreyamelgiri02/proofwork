-- Proofwork seed.
-- Intentionally empty of verdicts, tasks and metrics: decisions are never seeded.
-- Synthetic journeys are created through real application paths:
--   * Anonymous demo:    "Explore demo" on the homepage (POST /api/demo)
--   * Local workspace:   `npm run db:seed -- --email you@company.com` (scripts/seed-local.ts)
-- Both register requests, submit claims and queue jobs; the worker and the
-- independent billing sandbox produce every verdict.
select 1;
