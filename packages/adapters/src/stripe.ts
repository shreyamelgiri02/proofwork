import { now, type NormalizedSubscription, type SourceRead } from "@proofwork/domain";
import { httpRequest, isoOrNull } from "./http";
import { AdapterConfigurationError, type BillingAdapter, type ConnectionValidation, type ListResult, type OperationLookup, type WriteOutcome } from "./types";

/**
 * Stripe TEST-MODE adapter (server only). Implemented against the REST API with an
 * explicit pinned `Stripe-Version` header rather than the SDK so the normalized
 * field mapping is visible and versioned here. See docs/STRIPE-ADAPTER.md.
 *
 * Field meanings (API version pinned via STRIPE_API_VERSION, default 2026-08-26.dahlia):
 *  - current period boundaries live on the single subscription item
 *    (items.data[0].current_period_end), not the subscription root.
 *  - canceled_at = when cancellation was requested; ended_at = when service ended;
 *    cancel_at = effective custom cancellation time. These are kept distinct.
 */

export const DEFAULT_STRIPE_API_VERSION = "2026-08-26.dahlia";
const STRIPE_PRODUCTION_BASE = "https://api.stripe.com";

/**
 * API base. Always api.stripe.com, except that a LOOPBACK override is accepted outside
 * production so the adapter can be exercised against Stripe's official stripe-mock.
 */
export function stripeApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STRIPE_API_BASE;
  if (!override || env.NODE_ENV === "production") return STRIPE_PRODUCTION_BASE;
  try {
    const u = new URL(override);
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return u.origin;
  } catch {
    // fall through
  }
  return STRIPE_PRODUCTION_BASE;
}

export interface StripeAdapterConfig {
  secretKey: string;
  apiVersion?: string;
  /** Account identity verified during connection validation. */
  boundAccountId: string | null;
  timeoutMs?: number;
}

export function assertTestModeKey(key: string | undefined | null): asserts key is string {
  if (!key) throw new AdapterConfigurationError("NOT_CONFIGURED", "Stripe test mode is not configured.");
  if (/^(sk|rk)_live_/.test(key)) throw new AdapterConfigurationError("LIVE_MODE_BLOCKED", "Live-mode Stripe credentials are rejected.");
  if (!/^(sk|rk)_test_/.test(key)) throw new AdapterConfigurationError("NOT_CONFIGURED", "Only Stripe test-mode secret or restricted keys are accepted.");
}

interface StripeItem {
  current_period_start?: number;
  current_period_end?: number;
  price?: { recurring?: { usage_type?: string } | null } | null;
  plan?: { usage_type?: string } | null;
}

interface StripeSubscription {
  object?: string;
  id?: string;
  livemode?: boolean;
  customer?: string | { id?: string };
  status?: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  ended_at?: number | null;
  collection_method?: string;
  schedule?: string | { id?: string } | null;
  pause_collection?: unknown;
  pending_update?: unknown;
  items?: { data?: StripeItem[]; has_more?: boolean; total_count?: number };
}

export function normalizeStripeSubscription(sub: StripeSubscription, accountId: string): NormalizedSubscription | null {
  if (!sub || sub.object !== "subscription" || typeof sub.id !== "string" || typeof sub.status !== "string") return null;
  if (typeof sub.livemode !== "boolean" || typeof sub.cancel_at_period_end !== "boolean") return null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customer) return null;
  const items = sub.items?.data;
  if (!Array.isArray(items)) return null;
  const first = items.length === 1 ? items[0] : null;
  const usage = first?.price?.recurring?.usage_type ?? first?.plan?.usage_type ?? null;
  return {
    adapter: "STRIPE_TEST",
    environment: "STRIPE_TEST_MODE",
    livemode: sub.livemode,
    source_account_id: accountId,
    customer_id: customer,
    subscription_id: sub.id,
    customer_label: null,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    cancel_at: isoOrNull(sub.cancel_at),
    canceled_at: isoOrNull(sub.canceled_at),
    ended_at: isoOrNull(sub.ended_at),
    current_period_start: first ? isoOrNull(first.current_period_start) : null,
    // Only a single-item subscription has an unambiguous period boundary.
    current_period_end: first ? isoOrNull(first.current_period_end) : null,
    item_count: typeof sub.items?.total_count === "number" ? sub.items.total_count : items.length,
    items_complete: sub.items?.has_more !== true,
    usage_type: usage,
    collection_method: sub.collection_method ?? null,
    schedule_id: typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id ?? null,
    pause_collection: sub.pause_collection != null,
    pending_update: sub.pending_update != null,
    source_version: null,
  };
}

export class StripeTestAdapter implements BillingAdapter {
  readonly kind = "STRIPE_TEST" as const;
  private readonly apiVersion: string;

  constructor(private readonly config: StripeAdapterConfig) {
    assertTestModeKey(config.secretKey);
    this.apiVersion = config.apiVersion || DEFAULT_STRIPE_API_VERSION;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${this.config.secretKey}`,
      "stripe-version": this.apiVersion,
      accept: "application/json",
      ...extra,
    };
  }

  private mapReadStatus(status: number): Extract<SourceRead, { ok: false }>["error_code"] | null {
    if (status === 401 || status === 403) return "SOURCE_ACCESS_DENIED";
    if (status === 404) return "SOURCE_NOT_FOUND";
    if (status === 429) return "SOURCE_RATE_LIMITED";
    if (status >= 500) return "SOURCE_UNAVAILABLE";
    if (status !== 200) return "SOURCE_DATA_INVALID";
    return null;
  }

  async validateConnection(): Promise<ConnectionValidation> {
    const checked_at = now().toISOString();
    const res = await httpRequest(`${stripeApiBase()}/v1/account`, { method: "GET", headers: this.headers(), timeoutMs: this.config.timeoutMs });
    if (!res.ok) return { ok: false, error_code: "SOURCE_UNAVAILABLE", message: "Stripe did not respond.", checked_at };
    const { status, body, headers } = res.result;
    if (status === 401) return { ok: false, error_code: "SOURCE_ACCESS_DENIED", message: "Stripe rejected the test-mode credential.", checked_at };
    if (status === 403) {
      return { ok: false, error_code: "SOURCE_ACCESS_DENIED", message: "The restricted key cannot read account identity. Grant account read permission to bind the connection.", checked_at };
    }
    if (status !== 200) return { ok: false, error_code: "SOURCE_UNAVAILABLE", message: `Stripe returned HTTP ${status}.`, checked_at };
    const account = body as { id?: string; settings?: { dashboard?: { display_name?: string } }; business_profile?: { name?: string } };
    if (typeof account.id !== "string") return { ok: false, error_code: "SOURCE_DATA_INVALID", message: "Stripe account identity was missing.", checked_at };
    if (this.config.boundAccountId && this.config.boundAccountId !== account.id) {
      return { ok: false, error_code: "SOURCE_DATA_INVALID", message: "The credential belongs to a different Stripe account than the bound connection.", checked_at };
    }
    // Account objects do not carry livemode; the key prefix was verified and every
    // resource read additionally rejects livemode=true.
    return {
      ok: true,
      source_account_id: account.id,
      livemode: false,
      display_name: account.settings?.dashboard?.display_name || account.business_profile?.name || "Stripe test account",
      provider_request_id: headers.get("request-id"),
      checked_at,
    };
  }

  async listSubscriptions(limit = 50): Promise<ListResult> {
    if (!this.config.boundAccountId) return { ok: false, error_code: "NOT_CONFIGURED", message: "Validate the Stripe connection first." };
    const res = await httpRequest(`${stripeApiBase()}/v1/subscriptions?status=active&limit=${Math.min(Math.max(limit, 1), 100)}`, {
      method: "GET",
      headers: this.headers(),
      timeoutMs: this.config.timeoutMs,
    });
    if (!res.ok) return { ok: false, error_code: "SOURCE_UNAVAILABLE", message: "Stripe did not respond." };
    const code = this.mapReadStatus(res.result.status);
    if (code) return { ok: false, error_code: code, message: `Stripe returned HTTP ${res.result.status}.` };
    const data = (res.result.body as { data?: StripeSubscription[] })?.data ?? [];
    const account = this.config.boundAccountId;
    const items = data
      .map((s) => normalizeStripeSubscription(s, account))
      .filter((s): s is NormalizedSubscription => !!s && !s.livemode)
      .map((s) => ({
        subscription_id: s.subscription_id,
        customer_id: s.customer_id,
        customer_label: null,
        status: s.status,
        current_period_end: s.current_period_end,
        cancel_at_period_end: s.cancel_at_period_end,
      }));
    return { ok: true, items, observed_at: now().toISOString() };
  }

  async getSubscription(subscriptionId: string): Promise<SourceRead> {
    const observed_at = () => now().toISOString();
    if (!this.config.boundAccountId) return { ok: false, error_code: "NOT_CONFIGURED", http_status: null, observed_at: observed_at(), provider_request_id: null };
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) return { ok: false, error_code: "SOURCE_DATA_INVALID", http_status: null, observed_at: observed_at(), provider_request_id: null };
    const res = await httpRequest(`${stripeApiBase()}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "GET",
      headers: this.headers(),
      timeoutMs: this.config.timeoutMs,
    });
    if (!res.ok) {
      return { ok: false, error_code: res.failure.kind === "timeout" ? "SOURCE_TIMEOUT" : "SOURCE_UNAVAILABLE", http_status: null, observed_at: observed_at(), provider_request_id: null };
    }
    const { status, body, headers } = res.result;
    const requestId = headers.get("request-id");
    const code = this.mapReadStatus(status);
    if (code) {
      return { ok: false, error_code: code, http_status: status, observed_at: observed_at(), provider_request_id: requestId, retry_after_seconds: Number(headers.get("retry-after")) || null };
    }
    const snapshot = normalizeStripeSubscription(body as StripeSubscription, this.config.boundAccountId);
    if (!snapshot) return { ok: false, error_code: "SOURCE_DATA_INVALID", http_status: status, observed_at: observed_at(), provider_request_id: requestId };
    if (snapshot.livemode) return { ok: false, error_code: "LIVE_MODE_BLOCKED", http_status: status, observed_at: observed_at(), provider_request_id: requestId };
    return { ok: true, snapshot, observed_at: observed_at(), provider_request_id: requestId };
  }

  async schedulePeriodEndCancellation(input: { subscriptionId: string; idempotencyKey: string }): Promise<WriteOutcome> {
    if (!/^sub_[A-Za-z0-9]+$/.test(input.subscriptionId)) return { outcome: "REJECTED", http_status: 0, provider_request_id: null, error_code: "INVALID_SUBSCRIPTION_ID" };
    // Exact allowlisted parameter. No price, invoice, refund, proration or immediate-cancel fields.
    const form = new URLSearchParams({ cancel_at_period_end: "true" });
    const res = await httpRequest(`${stripeApiBase()}/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/x-www-form-urlencoded", "idempotency-key": input.idempotencyKey }),
      body: form.toString(),
      timeoutMs: this.config.timeoutMs,
    });
    if (!res.ok) return { outcome: "UNCERTAIN", http_status: null, provider_request_id: null, error_code: res.failure.kind === "timeout" ? "WRITE_TIMEOUT" : "WRITE_NETWORK_ERROR" };
    const { status, headers, body } = res.result;
    const requestId = headers.get("request-id");
    if (status === 200) {
      const sub = body as StripeSubscription;
      if (sub?.livemode === true) return { outcome: "REJECTED", http_status: status, provider_request_id: requestId, error_code: "LIVE_MODE_BLOCKED" };
      return { outcome: "ACCEPTED", http_status: status, provider_request_id: requestId, replayed: headers.get("idempotent-replayed") === "true" };
    }
    if (status >= 500 || status === 429) return { outcome: "UNCERTAIN", http_status: status, provider_request_id: requestId, error_code: `HTTP_${status}` };
    const code = (body as { error?: { code?: string; type?: string } })?.error;
    return { outcome: "REJECTED", http_status: status, provider_request_id: requestId, error_code: String(code?.code ?? code?.type ?? `HTTP_${status}`).toUpperCase() };
  }

  async lookupOperation(): Promise<OperationLookup> {
    // Stripe does not expose idempotency-key lookup. Reconciliation relies on an
    // independent read plus same-key retries within the provider's idempotency window.
    return { supported: false };
  }
}
