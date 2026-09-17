import type { AdapterKind, SourceEnvironment } from "./types";

/**
 * Normalized, provider-independent subscription evidence. Adapters produce this;
 * the evaluator consumes it. Only fields needed by the cancellation contract are kept.
 */
export interface NormalizedSubscription {
  adapter: AdapterKind;
  environment: SourceEnvironment;
  livemode: boolean;
  source_account_id: string;
  customer_id: string;
  subscription_id: string;
  /** Synthetic/display label for the customer; never used for decisions. */
  customer_label: string | null;
  status: string;
  cancel_at_period_end: boolean;
  /** Explicit effective cancellation time (ISO) if the source has a custom date. */
  cancel_at: string | null;
  /** When cancellation was requested (ISO). Distinct from the service end. */
  canceled_at: string | null;
  /** Actual service end (ISO) where available. */
  ended_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  item_count: number;
  items_complete: boolean;
  usage_type: string | null;
  collection_method: string | null;
  schedule_id: string | null;
  pause_collection: boolean;
  pending_update: boolean;
  /** Provider version / material revision if the source exposes one. */
  source_version: string | null;
}

export type SourceErrorCode =
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_TIMEOUT"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_ACCESS_DENIED"
  | "SOURCE_RATE_LIMITED"
  | "SOURCE_DATA_INVALID"
  | "LIVE_MODE_BLOCKED"
  | "NOT_CONFIGURED";

export type SourceRead =
  | {
      ok: true;
      snapshot: NormalizedSubscription;
      observed_at: string;
      provider_request_id: string | null;
    }
  | {
      ok: false;
      error_code: SourceErrorCode;
      http_status: number | null;
      observed_at: string;
      provider_request_id: string | null;
      retry_after_seconds?: number | null;
      message?: string;
    };

/** Fields that define material state for fingerprints (excludes read time and request id). */
export const MATERIAL_FIELDS = [
  "adapter",
  "environment",
  "livemode",
  "source_account_id",
  "customer_id",
  "subscription_id",
  "status",
  "cancel_at_period_end",
  "cancel_at",
  "ended_at",
  "current_period_end",
  "item_count",
  "items_complete",
  "usage_type",
  "collection_method",
  "schedule_id",
  "pause_collection",
  "pending_update",
] as const satisfies readonly (keyof NormalizedSubscription)[];

export function materialProjection(s: NormalizedSubscription): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of MATERIAL_FIELDS) out[key] = s[key] ?? null;
  return out;
}

/** Deterministic JSON with sorted keys, used as hash input. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Validates the adapter output shape; missing required facts make evidence untrustworthy. */
export function isCompleteSnapshot(s: Partial<NormalizedSubscription> | null | undefined): s is NormalizedSubscription {
  if (!s) return false;
  const requiredStrings: (keyof NormalizedSubscription)[] = ["source_account_id", "customer_id", "subscription_id", "status"];
  for (const k of requiredStrings) if (typeof s[k] !== "string" || !(s[k] as string).length) return false;
  if (typeof s.cancel_at_period_end !== "boolean") return false;
  if (typeof s.livemode !== "boolean") return false;
  if (typeof s.item_count !== "number") return false;
  if (typeof s.items_complete !== "boolean") return false;
  return true;
}
