/** Standard, safe API error shape shared by every route. */

export type ApiErrorCode =
  | "INVALID_PAYLOAD"
  | "PAYLOAD_TOO_LARGE"
  | "AUTH_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_CONFIRMED"
  | "INVALID_INGESTION_TOKEN"
  | "PERMISSION_DENIED"
  | "ORIGIN_REJECTED"
  | "DEMO_EXPIRED"
  | "DEMO_EXTERNAL_ACCESS_BLOCKED"
  | "LIVE_MODE_BLOCKED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "DUPLICATE_PAYLOAD_CONFLICT"
  | "PREVIEW_STALE"
  | "PREVIEW_EXPIRED"
  | "APPROVAL_STALE"
  | "APPROVAL_EXPIRED"
  | "OPERATION_ALREADY_PENDING"
  | "REQUEST_NOT_ACTIVE"
  | "UNSUPPORTED_WORKFLOW"
  | "ONBOARDING_INCOMPLETE"
  | "RATE_LIMITED"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_NOT_CONFIGURED"
  | "SETUP_REQUIRED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    field_errors?: Record<string, string[]>;
    retryable?: boolean;
    retry_after_seconds?: number;
    correlation_id: string;
  };
}

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  INVALID_PAYLOAD: 400,
  PAYLOAD_TOO_LARGE: 413,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  AUTH_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_CONFIRMED: 403,
  INVALID_INGESTION_TOKEN: 401,
  PERMISSION_DENIED: 403,
  ORIGIN_REJECTED: 403,
  DEMO_EXPIRED: 401,
  DEMO_EXTERNAL_ACCESS_BLOCKED: 403,
  LIVE_MODE_BLOCKED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_PAYLOAD_CONFLICT: 409,
  PREVIEW_STALE: 409,
  PREVIEW_EXPIRED: 409,
  APPROVAL_STALE: 409,
  APPROVAL_EXPIRED: 409,
  OPERATION_ALREADY_PENDING: 409,
  REQUEST_NOT_ACTIVE: 422,
  UNSUPPORTED_WORKFLOW: 422,
  ONBOARDING_INCOMPLETE: 409,
  RATE_LIMITED: 429,
  SOURCE_UNAVAILABLE: 503,
  SOURCE_NOT_CONFIGURED: 503,
  SETUP_REQUIRED: 503,
  INTERNAL_ERROR: 500,
};

/** Thrown by application services; converted to ApiErrorBody at the HTTP boundary. */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  readonly retryAfterSeconds?: number;
  constructor(code: ApiErrorCode, message: string, opts: { fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = opts.fieldErrors;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
  get status() {
    return ERROR_STATUS[this.code];
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "AppError");
}
