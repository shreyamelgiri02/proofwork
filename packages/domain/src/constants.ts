/**
 * Versioned contracts and server-enforced operating limits.
 * Values are product defaults (see RECOVERY-CONTRACT.md), not provider guarantees.
 */

export const CONTRACT_ID = "subscription.cancel_at_period_end.v1" as const;
export const EVALUATOR_VERSION = "cancel-period-end-evaluator.v1" as const;
export const RECOVERY_ACTION = "SCHEDULE_PERIOD_END_CANCELLATION" as const;
export const EXPLANATION_TEMPLATE_VERSION = "explanation-copy.v1" as const;

export const LIMITS = {
  /** Maximum age of a source read used for an ordinary evaluation. */
  EVIDENCE_MAX_AGE_SECONDS: 30,
  /** Maximum age of the fresh precheck immediately before a write ("source freshness budget"). */
  PRECHECK_MAX_AGE_SECONDS: 10,
  /** One-use registration preview validity. */
  REGISTRATION_PREVIEW_TTL_SECONDS: 300,
  /** Proposal / approval validity. */
  APPROVAL_TTL_SECONDS: 900,
  /** No new write within this many seconds of the authorized boundary. */
  RECOVERY_CUTOFF_SECONDS: 120,
  /** Tolerance after the authorized end for the source to report the subscription ended. */
  FINALIZATION_GRACE_SECONDS: 300,
  /** Job lease duration. */
  LEASE_SECONDS: 120,
  /** Continuation window for a single recovery operation. */
  WRITE_RETRY_WINDOW_SECONDS: 900,
  /** Original dispatch plus at most two retries of the same operation and key. */
  MAX_WRITE_DISPATCHES: 3,
  /** Read retry schedule after transient source failure (seconds). */
  READ_RETRY_DELAYS_SECONDS: [60, 300, 900] as readonly number[],
  /** Routine monitoring cadence for a correctly scheduled cancellation. */
  MONITOR_INTERVAL_SECONDS: 86_400,
  /** A task whose latest trustworthy read is older than this is shown as stale. */
  STALE_EVIDENCE_SECONDS: 86_400,
  /** Agent report text limit. */
  REPORT_TEXT_MAX_CHARS: 2000,
  /** Ingestion body limit (bytes). */
  INGESTION_BODY_MAX_BYTES: 16 * 1024,
  /** Claims per minute per ingestion token. */
  INGESTION_RATE_PER_MINUTE: 60,
  /** Auth-sensitive requests per 10 minutes per IP + route. */
  AUTH_RATE_PER_WINDOW: 20,
  AUTH_RATE_WINDOW_SECONDS: 600,
  /** Demo create/reset/scenario commands per minute per demo session. */
  DEMO_COMMANDS_PER_MINUTE: 10,
  /** Worker read/write timeout against a billing source. */
  SOURCE_TIMEOUT_MS: 8000,
  /** Page size for server-side pagination. */
  PAGE_SIZE: 20,
  /** Confirmation-email resend cooldown shown in the UI. */
  RESEND_COOLDOWN_SECONDS: 60,
} as const;

export const RETENTION = {
  DEMO_SESSION_SECONDS: 3600,
  DEMO_PURGE_AFTER_SECONDS: 86_400,
  PRIVATE_EVIDENCE_DAYS_AFTER_MONITORING: 90,
  PRIVATE_AUDIT_DAYS_AFTER_MONITORING: 180,
} as const;
