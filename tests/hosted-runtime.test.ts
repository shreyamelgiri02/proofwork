import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as environment from "../apps/web/src/lib/env";
import * as authFlow from "../apps/web/src/lib/auth-flow";
import * as databaseClient from "../packages/database/src/client";
import * as databaseHealth from "../packages/database/src/health";

describe("hosted runtime configuration", () => {
  it("uses a single unprepared SSL connection for a serverless database client", () => {
    assert.deepEqual(databaseClient.databaseClientConfig({ DATABASE_RUNTIME: "serverless", NODE_ENV: "production" }), {
      max: 1,
      prepare: false,
      ssl: "require",
      applicationName: "proofwork-web",
    });
  });

  it("keeps a bounded prepared pool for the persistent worker", () => {
    assert.deepEqual(
      databaseClient.databaseClientConfig({ DATABASE_RUNTIME: "persistent", DATABASE_POOL_SIZE: "6", NODE_ENV: "production", WORKER_NAME: "worker-production" }),
      { max: 6, prepare: true, ssl: "require", applicationName: "proofwork-worker" },
    );
  });

  it("reports invalid production settings without exposing secrets", () => {
    const errors = environment.validateProductionEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "http://proofwork.example",
      PROOFWORK_ALLOWED_ORIGINS: "https://different.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "replace-key",
      NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: "true",
      DATABASE_URL: "postgres://proofwork_app:secret@pooler.example:5432/postgres",
      DATABASE_RUNTIME: "serverless",
      DEMO_COOKIE_SECRET: "short",
      SANDBOX_API_URL: "http://sandbox.example",
      SANDBOX_READ_TOKEN: "replace-read",
      SANDBOX_WRITE_TOKEN: "replace-write",
      SANDBOX_ADMIN_TOKEN: "replace-admin",
    });

    assert.deepEqual(errors, [
      "NEXT_PUBLIC_APP_URL must use https in production.",
      "PROOFWORK_ALLOWED_ORIGINS must include NEXT_PUBLIC_APP_URL.",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or still a placeholder.",
      "DATABASE_URL must use the Supabase transaction pooler on port 6543 in serverless mode.",
      "DEMO_COOKIE_SECRET must contain at least 32 characters.",
      "SANDBOX_API_URL must use https in production.",
      "SANDBOX_READ_TOKEN is missing or still a placeholder.",
      "SANDBOX_WRITE_TOKEN is missing or still a placeholder.",
      "SANDBOX_ADMIN_TOKEN is missing or still a placeholder.",
    ]);
  });

  it("allows Google OAuth to stay disabled until its provider credentials are configured", () => {
    const errors = environment.validateProductionEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://proofwork.example",
      PROOFWORK_ALLOWED_ORIGINS: "https://proofwork.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_real",
      NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: "false",
      DATABASE_URL: "postgres://proofwork_app:secret@pooler.example:6543/postgres",
      DATABASE_RUNTIME: "serverless",
      DEMO_COOKIE_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
      SANDBOX_API_URL: "https://proofwork-sandbox.example",
      SANDBOX_READ_TOKEN: "sandbox_read_real",
      SANDBOX_WRITE_TOKEN: "sandbox_write_real",
      SANDBOX_ADMIN_TOKEN: "sandbox_admin_real",
    });

    assert.deepEqual(errors, []);
  });

  it("rejects a placeholder database credential even when it uses the pooler port", () => {
    const errors = environment.validateProductionEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://proofwork.example",
      PROOFWORK_ALLOWED_ORIGINS: "https://proofwork.example",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_real",
      NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: "true",
      DATABASE_URL: "postgres://proofwork_app:replace-password@pooler.example:6543/postgres",
      DATABASE_RUNTIME: "serverless",
      DEMO_COOKIE_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
      SANDBOX_API_URL: "https://proofwork-sandbox.example",
      SANDBOX_READ_TOKEN: "sandbox_read_real",
      SANDBOX_WRITE_TOKEN: "sandbox_write_real",
      SANDBOX_ADMIN_TOKEN: "sandbox_admin_real",
    });

    assert.deepEqual(errors, ["DATABASE_URL is missing or still a placeholder."]);
  });

  it("classifies public worker heartbeats without workspace data", () => {
    const now = Date.parse("2026-09-20T10:00:00.000Z");
    assert.equal(databaseHealth.workerHeartbeatStatus(new Date("2026-09-20T09:59:00.000Z"), now), "healthy");
    assert.equal(databaseHealth.workerHeartbeatStatus(new Date("2026-09-20T09:55:00.000Z"), now), "stale");
    assert.equal(databaseHealth.workerHeartbeatStatus(null, now), "never_seen");
  });

  it("uses Railway's host and port for the hosted sandbox", async () => {
    const runtime = await import("../apps/billing-sandbox/src/runtime");
    assert.deepEqual(runtime.sandboxListenConfig({ NODE_ENV: "production", PORT: "8080" }), { hostname: "0.0.0.0", port: 8080 });
    assert.deepEqual(runtime.sandboxListenConfig({ SANDBOX_PORT: "4010" }), { hostname: "127.0.0.1", port: 4010 });
  });
});

describe("Google and email callback routing", () => {
  it("sends a new account to onboarding before honoring a requested app route", () => {
    assert.equal(authFlow.authDestination({ onboardingCompletedAt: null, next: "/app/approvals" }), "/onboarding");
  });

  it("returns an existing account to a safe requested route", () => {
    assert.equal(authFlow.authDestination({ onboardingCompletedAt: new Date(), next: "/app/approvals?proposal=123" }), "/app/approvals?proposal=123");
    assert.equal(authFlow.authDestination({ onboardingCompletedAt: new Date(), next: "https://evil.example" }), "/app/tasks");
  });

  it("routes recovery links to password reset", () => {
    assert.equal(authFlow.authDestination({ onboardingCompletedAt: new Date(), next: "/app/tasks", type: "recovery" }), "/reset-password");
  });

  it("renders cancellation, provider failure, and missing callback states safely", () => {
    assert.equal(authFlow.authCallbackIntent(new URLSearchParams("error=access_denied")).oauthCancelled, true);
    assert.equal(authFlow.authCallbackIntent(new URLSearchParams("error=server_error")).error?.title, "This link can't be used");
    assert.equal(authFlow.authCallbackIntent(new URLSearchParams()).error?.title, "Missing sign-in details");
    assert.equal(authFlow.authCallbackIntent(new URLSearchParams("code=pkce-code&next=%2Fapp%2Ftasks")).error, null);
  });
});
