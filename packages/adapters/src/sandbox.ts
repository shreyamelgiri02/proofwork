import { now, type NormalizedSubscription, type SourceRead } from "@proofwork/domain";
import { httpRequest, isoOrNull } from "./http";
import type { BillingAdapter, ConnectionValidation, ListResult, OperationLookup, SubscriptionSummary, WriteOutcome } from "./types";

/**
 * Adapter for the independent local billing sandbox (apps/billing-sandbox).
 * Reads use the read credential. The write credential is only supplied to
 * adapters constructed for the recovery identity.
 */

export interface SandboxAdapterConfig {
  baseUrl: string;
  accountId: string;
  readToken: string;
  /** Present only for recovery execution. */
  writeToken?: string;
  timeoutMs?: number;
}

interface SandboxSubscriptionBody {
  object?: string;
  id?: unknown;
  account?: unknown;
  customer?: unknown;
  customer_label?: unknown;
  status?: unknown;
  livemode?: unknown;
  cancel_at_period_end?: unknown;
  cancel_at?: unknown;
  canceled_at?: unknown;
  ended_at?: unknown;
  current_period_start?: unknown;
  current_period_end?: unknown;
  items?: { count?: unknown; complete?: unknown; usage_type?: unknown };
  collection_method?: unknown;
  schedule?: unknown;
  pause_collection?: unknown;
  pending_update?: unknown;
  version?: unknown;
}

export function normalizeSandboxSubscription(body: SandboxSubscriptionBody): NormalizedSubscription | null {
  if (!body || body.object !== "subscription") return null;
  if (typeof body.id !== "string" || typeof body.account !== "string" || typeof body.customer !== "string" || typeof body.status !== "string") return null;
  if (typeof body.cancel_at_period_end !== "boolean" || typeof body.livemode !== "boolean") return null;
  if (!body.items || typeof body.items.count !== "number" || typeof body.items.complete !== "boolean") return null;
  return {
    adapter: "LOCAL_SANDBOX",
    environment: "SYNTHETIC_SANDBOX",
    livemode: body.livemode,
    source_account_id: body.account,
    customer_id: body.customer,
    subscription_id: body.id,
    customer_label: typeof body.customer_label === "string" ? body.customer_label : null,
    status: body.status,
    cancel_at_period_end: body.cancel_at_period_end,
    cancel_at: isoOrNull(body.cancel_at),
    canceled_at: isoOrNull(body.canceled_at),
    ended_at: isoOrNull(body.ended_at),
    current_period_start: isoOrNull(body.current_period_start),
    current_period_end: isoOrNull(body.current_period_end),
    item_count: body.items.count,
    items_complete: body.items.complete,
    usage_type: typeof body.items.usage_type === "string" ? body.items.usage_type : null,
    collection_method: typeof body.collection_method === "string" ? body.collection_method : null,
    schedule_id: typeof body.schedule === "string" ? body.schedule : null,
    pause_collection: body.pause_collection === true,
    pending_update: body.pending_update === true,
    source_version: typeof body.version === "number" ? String(body.version) : null,
  };
}

const safeId = (id: string) => /^[A-Za-z0-9_\-]{1,120}$/.test(id);

export class SandboxBillingAdapter implements BillingAdapter {
  readonly kind = "LOCAL_SANDBOX" as const;
  constructor(private readonly config: SandboxAdapterConfig) {}

  private url(path: string) {
    return `${this.config.baseUrl.replace(/\/$/, "")}/v1/accounts/${encodeURIComponent(this.config.accountId)}${path}`;
  }

  private headers(token: string, extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${token}`, accept: "application/json", ...extra };
  }

  async validateConnection(): Promise<ConnectionValidation> {
    const checked_at = now().toISOString();
    const res = await httpRequest(this.url(""), { method: "GET", headers: this.headers(this.config.readToken), timeoutMs: this.config.timeoutMs });
    if (!res.ok) return { ok: false, error_code: "SOURCE_UNAVAILABLE", message: "The local billing sandbox is not reachable.", checked_at };
    const { status, body, headers } = res.result;
    if (status === 401 || status === 403) return { ok: false, error_code: "SOURCE_ACCESS_DENIED", message: "The sandbox rejected the read credential.", checked_at };
    if (status === 404) return { ok: false, error_code: "SOURCE_NOT_FOUND", message: "The sandbox account does not exist.", checked_at };
    const b = body as { id?: unknown; label?: unknown; livemode?: unknown };
    if (status !== 200 || typeof b?.id !== "string") return { ok: false, error_code: "SOURCE_DATA_INVALID", message: "Unexpected sandbox response.", checked_at };
    if (b.livemode !== false) return { ok: false, error_code: "LIVE_MODE_BLOCKED", message: "The source did not confirm a non-live environment.", checked_at };
    if (b.id !== this.config.accountId) return { ok: false, error_code: "SOURCE_DATA_INVALID", message: "The sandbox returned a different account identity.", checked_at };
    return {
      ok: true,
      source_account_id: b.id,
      livemode: false,
      display_name: typeof b.label === "string" ? b.label : "Local billing sandbox",
      provider_request_id: headers.get("x-request-id"),
      checked_at,
    };
  }

  async listSubscriptions(limit = 50): Promise<ListResult> {
    const res = await httpRequest(this.url(`/subscriptions?limit=${Math.min(Math.max(limit, 1), 100)}`), {
      method: "GET",
      headers: this.headers(this.config.readToken),
      timeoutMs: this.config.timeoutMs,
    });
    if (!res.ok) return { ok: false, error_code: "SOURCE_UNAVAILABLE", message: "The local billing sandbox is not reachable." };
    const { status, body } = res.result;
    if (status === 401 || status === 403) return { ok: false, error_code: "SOURCE_ACCESS_DENIED", message: "The sandbox rejected the read credential." };
    if (status >= 500) return { ok: false, error_code: "SOURCE_UNAVAILABLE", message: "The sandbox is temporarily unavailable." };
    const data = (body as { data?: SandboxSubscriptionBody[] })?.data;
    if (status !== 200 || !Array.isArray(data)) return { ok: false, error_code: "SOURCE_DATA_INVALID", message: "Unexpected sandbox response." };
    const items: SubscriptionSummary[] = data
      .map((row) => normalizeSandboxSubscription(row))
      .filter((s): s is NormalizedSubscription => s !== null)
      .map((s) => ({
        subscription_id: s.subscription_id,
        customer_id: s.customer_id,
        customer_label: s.customer_label,
        status: s.status,
        current_period_end: s.current_period_end,
        cancel_at_period_end: s.cancel_at_period_end,
      }));
    return { ok: true, items, observed_at: now().toISOString() };
  }

  async getSubscription(subscriptionId: string): Promise<SourceRead> {
    const observed_at = () => now().toISOString();
    if (!safeId(subscriptionId)) return { ok: false, error_code: "SOURCE_DATA_INVALID", http_status: null, observed_at: observed_at(), provider_request_id: null };
    const res = await httpRequest(this.url(`/subscriptions/${encodeURIComponent(subscriptionId)}`), {
      method: "GET",
      headers: this.headers(this.config.readToken),
      timeoutMs: this.config.timeoutMs,
    });
    if (!res.ok) {
      return {
        ok: false,
        error_code: res.failure.kind === "timeout" ? "SOURCE_TIMEOUT" : "SOURCE_UNAVAILABLE",
        http_status: null,
        observed_at: observed_at(),
        provider_request_id: null,
      };
    }
    const { status, body, headers } = res.result;
    const requestId = headers.get("x-request-id");
    const fail = (error_code: Extract<SourceRead, { ok: false }>["error_code"], retryAfter?: number | null): SourceRead => ({
      ok: false,
      error_code,
      http_status: status,
      observed_at: observed_at(),
      provider_request_id: requestId,
      retry_after_seconds: retryAfter ?? null,
    });
    if (status === 401 || status === 403) return fail("SOURCE_ACCESS_DENIED");
    if (status === 404) return fail("SOURCE_NOT_FOUND");
    if (status === 429) return fail("SOURCE_RATE_LIMITED", Number(headers.get("retry-after")) || null);
    if (status >= 500) return fail("SOURCE_UNAVAILABLE");
    if (status !== 200) return fail("SOURCE_DATA_INVALID");
    const snapshot = normalizeSandboxSubscription(body as SandboxSubscriptionBody);
    if (!snapshot) return fail("SOURCE_DATA_INVALID");
    if (snapshot.livemode) return fail("LIVE_MODE_BLOCKED");
    return { ok: true, snapshot, observed_at: observed_at(), provider_request_id: requestId };
  }

  async schedulePeriodEndCancellation(input: { subscriptionId: string; idempotencyKey: string }): Promise<WriteOutcome> {
    if (!this.config.writeToken) {
      return { outcome: "REJECTED", http_status: 0, provider_request_id: null, error_code: "WRITE_CREDENTIAL_NOT_PROVIDED" };
    }
    if (!safeId(input.subscriptionId)) return { outcome: "REJECTED", http_status: 0, provider_request_id: null, error_code: "INVALID_SUBSCRIPTION_ID" };
    const res = await httpRequest(this.url(`/subscriptions/${encodeURIComponent(input.subscriptionId)}/schedule-cancellation`), {
      method: "POST",
      headers: this.headers(this.config.writeToken, { "idempotency-key": input.idempotencyKey, "content-type": "application/json" }),
      // Fixed, allowlisted parameters. Nothing from the task, claim or UI is forwarded.
      body: JSON.stringify({ cancel_at_period_end: true }),
      timeoutMs: this.config.timeoutMs,
    });
    if (!res.ok) return { outcome: "UNCERTAIN", http_status: null, provider_request_id: null, error_code: res.failure.kind === "timeout" ? "WRITE_TIMEOUT" : "WRITE_NETWORK_ERROR" };
    const { status, headers, body } = res.result;
    const requestId = headers.get("x-request-id");
    if (status === 200) return { outcome: "ACCEPTED", http_status: status, provider_request_id: requestId, replayed: headers.get("idempotent-replayed") === "true" };
    if (status >= 500 || status === 429) return { outcome: "UNCERTAIN", http_status: status, provider_request_id: requestId, error_code: `HTTP_${status}` };
    const code = (body as { error?: { code?: string } })?.error?.code ?? `HTTP_${status}`;
    return { outcome: "REJECTED", http_status: status, provider_request_id: requestId, error_code: String(code).toUpperCase() };
  }

  async lookupOperation(input: { subscriptionId: string; idempotencyKey: string }): Promise<OperationLookup> {
    const res = await httpRequest(this.url(`/operations/${encodeURIComponent(input.idempotencyKey)}`), {
      method: "GET",
      headers: this.headers(this.config.readToken),
      timeoutMs: this.config.timeoutMs,
    });
    if (!res.ok) return { supported: true, ok: false, error_code: "SOURCE_UNAVAILABLE" };
    const { status, body } = res.result;
    if (status === 404) return { supported: true, ok: true, found: false };
    if (status !== 200) return { supported: true, ok: false, error_code: status === 401 || status === 403 ? "SOURCE_ACCESS_DENIED" : "SOURCE_UNAVAILABLE" };
    const b = body as { subscription_id?: string; applied?: boolean; created_at?: number };
    if (b.subscription_id !== input.subscriptionId) return { supported: true, ok: true, found: false };
    return { supported: true, ok: true, found: true, applied: b.applied === true, recorded_at: isoOrNull(b.created_at) ?? now().toISOString() };
  }
}
