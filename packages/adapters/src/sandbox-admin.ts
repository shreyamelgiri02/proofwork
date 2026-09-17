import type { SubscriptionSeed } from "@proofwork/domain";
import { httpRequest } from "./http";

/**
 * Restricted scenario-setup client for the local billing sandbox.
 * Uses the ADMIN credential; only demo provisioning and development tooling call it.
 * It is never available to the verification path or the ingestion API.
 */

export interface SandboxSeedRequest {
  subscription_id: string;
  customer_id: string;
  customer_label: string;
  scenario_key: string;
  /** Authorized boundary T (ISO). */
  period_end: string;
  status: "active" | "canceled";
  cancel_at_period_end: boolean;
  ended_at: string | null;
  canceled_at: string | null;
  item_count: number;
  read_fault: NonNullable<SubscriptionSeed["read_fault"]>;
  write_fault: NonNullable<SubscriptionSeed["write_fault"]>;
}

export type SourceChange = "SHIFT_PERIOD" | "REVERSE_SCHEDULE" | "SCHEDULE_EXTERNALLY" | "CHANGE_CUSTOMER" | "SOURCE_OUTAGE" | "SOURCE_RESTORE" | "SET_PERIOD_END";

export class SandboxAdminClient {
  constructor(private readonly baseUrl: string, private readonly adminToken: string) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SandboxAdminClient | null {
    if (!env.SANDBOX_API_URL || !env.SANDBOX_ADMIN_TOKEN) return null;
    return new SandboxAdminClient(env.SANDBOX_API_URL, env.SANDBOX_ADMIN_TOKEN);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await httpRequest(`${this.baseUrl.replace(/\/$/, "")}/admin${path}`, {
      method,
      headers: { authorization: `Bearer ${this.adminToken}`, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`SANDBOX_UNREACHABLE:${res.failure.kind}`);
    if (res.result.status >= 300) {
      const code = (res.result.body as { error?: { code?: string } })?.error?.code ?? `HTTP_${res.result.status}`;
      throw new Error(`SANDBOX_ADMIN_${code}`);
    }
    return res.result.body as T;
  }

  ensureAccount(input: { owner_reference: string; label: string; kind: "PRIVATE" | "DEMO" }) {
    return this.call<{ id: string; label: string }>("POST", "/accounts", input);
  }

  seedSubscription(accountId: string, seed: SandboxSeedRequest) {
    return this.call<{ id: string; customer: string; current_period_end: number }>("POST", `/accounts/${encodeURIComponent(accountId)}/subscriptions`, seed);
  }

  applyChange(accountId: string, subscriptionId: string, change: SourceChange, value?: string) {
    return this.call<{ id: string; version: number }>(
      "POST",
      `/accounts/${encodeURIComponent(accountId)}/subscriptions/${encodeURIComponent(subscriptionId)}/changes`,
      { change, value },
    );
  }

  resetAccount(accountId: string) {
    return this.call<{ reset: true }>("POST", `/accounts/${encodeURIComponent(accountId)}/reset`, {});
  }

  deleteAccount(accountId: string) {
    return this.call<{ deleted: true }>("DELETE", `/accounts/${encodeURIComponent(accountId)}`);
  }
}
