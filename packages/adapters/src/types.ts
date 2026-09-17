import type { AdapterKind, SourceErrorCode, SourceRead } from "@proofwork/domain";

/** Typed interface every independent billing source implements. */

export interface SubscriptionSummary {
  subscription_id: string;
  customer_id: string;
  customer_label: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export type ConnectionValidation =
  | { ok: true; source_account_id: string; livemode: false; display_name: string; provider_request_id: string | null; checked_at: string }
  | { ok: false; error_code: SourceErrorCode; message: string; checked_at: string };

export type ListResult =
  | { ok: true; items: SubscriptionSummary[]; observed_at: string }
  | { ok: false; error_code: SourceErrorCode; message: string };

export type WriteOutcome =
  /** The source confirmed the mutation was accepted. NOT proof of outcome: a separate read decides. */
  | { outcome: "ACCEPTED"; http_status: number; provider_request_id: string | null; replayed: boolean }
  /** The source definitively refused; nothing was applied. */
  | { outcome: "REJECTED"; http_status: number; provider_request_id: string | null; error_code: string }
  /** Timeout / connection loss / 5xx after dispatch: the write may or may not have happened. */
  | { outcome: "UNCERTAIN"; http_status: number | null; provider_request_id: string | null; error_code: string };

export type OperationLookup =
  | { supported: false }
  | { supported: true; ok: false; error_code: SourceErrorCode }
  | { supported: true; ok: true; found: false }
  | { supported: true; ok: true; found: true; applied: boolean; recorded_at: string };

export interface BillingAdapter {
  readonly kind: AdapterKind;
  validateConnection(): Promise<ConnectionValidation>;
  listSubscriptions(limit?: number): Promise<ListResult>;
  getSubscription(subscriptionId: string): Promise<SourceRead>;
  /** The ONLY mutation. Exact parameters are fixed inside the adapter. */
  schedulePeriodEndCancellation(input: { subscriptionId: string; idempotencyKey: string }): Promise<WriteOutcome>;
  /** Consult source-side operation history when the provider supports it. */
  lookupOperation(input: { subscriptionId: string; idempotencyKey: string }): Promise<OperationLookup>;
}

export class AdapterConfigurationError extends Error {
  readonly code: "NOT_CONFIGURED" | "LIVE_MODE_BLOCKED" | "DEMO_EXTERNAL_ACCESS_BLOCKED" | "WORKSPACE_NOT_BOUND";
  constructor(code: AdapterConfigurationError["code"], message: string) {
    super(message);
    this.name = "AdapterConfigurationError";
    this.code = code;
  }
}
