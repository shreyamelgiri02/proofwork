import type { AdapterKind, WorkspaceKind } from "@proofwork/domain";
import { SandboxBillingAdapter } from "./sandbox";
import { assertTestModeKey, DEFAULT_STRIPE_API_VERSION, StripeTestAdapter } from "./stripe";
import { AdapterConfigurationError, type BillingAdapter } from "./types";

/**
 * Server-side adapter resolution. The adapter is derived from the stored,
 * server-controlled connection row — never from a browser parameter.
 */

export interface ConnectionRef {
  adapter: AdapterKind;
  source_account_id: string | null;
}

export interface ResolveOptions {
  workspaceId: string;
  workspaceKind: WorkspaceKind;
  /** "read" for verification; "write" only for the recovery executor. */
  purpose: "read" | "write";
  env?: NodeJS.ProcessEnv;
}

export function sandboxConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SANDBOX_API_URL && env.SANDBOX_READ_TOKEN);
}

export function stripeStatus(env: NodeJS.ProcessEnv = process.env): { configured: boolean; reason: string | null; boundWorkspaceId: string | null } {
  const key = env.STRIPE_TEST_SECRET_KEY;
  if (!key) return { configured: false, reason: "STRIPE_TEST_SECRET_KEY is not set.", boundWorkspaceId: null };
  try {
    assertTestModeKey(key);
  } catch (e) {
    return { configured: false, reason: e instanceof Error ? e.message : "Invalid Stripe credential.", boundWorkspaceId: null };
  }
  if (!env.PROOFWORK_STRIPE_WORKSPACE_ID) {
    return { configured: false, reason: "PROOFWORK_STRIPE_WORKSPACE_ID must name the single workspace bound to this credential.", boundWorkspaceId: null };
  }
  return { configured: true, reason: null, boundWorkspaceId: env.PROOFWORK_STRIPE_WORKSPACE_ID };
}

export function resolveAdapter(connection: ConnectionRef, opts: ResolveOptions): BillingAdapter {
  const env = opts.env ?? process.env;
  if (connection.adapter === "LOCAL_SANDBOX") {
    if (!sandboxConfigured(env)) throw new AdapterConfigurationError("NOT_CONFIGURED", "Proofwork Sandbox is temporarily unavailable.");
    if (!connection.source_account_id) throw new AdapterConfigurationError("NOT_CONFIGURED", "The sandbox connection has no account identity.");
    return new SandboxBillingAdapter({
      baseUrl: env.SANDBOX_API_URL!,
      accountId: connection.source_account_id,
      readToken: env.SANDBOX_READ_TOKEN!,
      writeToken: opts.purpose === "write" ? env.SANDBOX_WRITE_TOKEN : undefined,
    });
  }

  // Stripe test mode: demo workspaces are rejected before any credential is loaded.
  if (opts.workspaceKind === "DEMO") {
    throw new AdapterConfigurationError("DEMO_EXTERNAL_ACCESS_BLOCKED", "Demo workspaces cannot use external billing sources.");
  }
  const status = stripeStatus(env);
  if (!status.configured) throw new AdapterConfigurationError("NOT_CONFIGURED", status.reason ?? "Stripe test mode is not configured.");
  if (status.boundWorkspaceId !== opts.workspaceId) {
    throw new AdapterConfigurationError("WORKSPACE_NOT_BOUND", "This deployment's Stripe test credential is bound to a different workspace.");
  }
  return new StripeTestAdapter({
    secretKey: env.STRIPE_TEST_SECRET_KEY!,
    apiVersion: env.STRIPE_API_VERSION || DEFAULT_STRIPE_API_VERSION,
    boundAccountId: connection.source_account_id,
  });
}
