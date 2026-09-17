import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, ERROR_STATUS, LIMITS, type ApiErrorBody, type ApiErrorCode } from "@proofwork/domain";
import { allowedOrigins } from "@/lib/env";

/** Standard error response: safe code, human message, optional field errors, correlation id. */
export function errorResponse(code: ApiErrorCode, message: string, correlationId: string, extra: Partial<ApiErrorBody["error"]> = {}) {
  const body: ApiErrorBody = { error: { code, message, correlation_id: correlationId, ...extra } };
  const headers: Record<string, string> = { "x-correlation-id": correlationId, "cache-control": "no-store" };
  if (extra.retry_after_seconds) headers["retry-after"] = String(extra.retry_after_seconds);
  return NextResponse.json(body, { status: ERROR_STATUS[code], headers });
}

export function json<T>(data: T, correlationId: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: { "x-correlation-id": correlationId, "cache-control": "no-store", ...init.headers },
  });
}

function zodFieldErrors(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Origin check for cookie-authenticated state-changing requests (CSRF defense). */
function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const allowed = allowedOrigins();
  if (origin) return allowed.includes(origin) || origin === req.nextUrl.origin;
  const site = req.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

type Handler<P> = (req: NextRequest, ctx: { params: P; correlationId: string }) => Promise<Response>;

export function route<P = Record<string, string>>(handler: Handler<P>, opts: { csrf?: boolean } = {}) {
  return async (req: NextRequest, segment: { params: Promise<P> }) => {
    const correlationId = randomUUID();
    try {
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating && opts.csrf !== false && !originAllowed(req)) {
        return errorResponse("ORIGIN_REJECTED", "This request did not come from an allowed origin.", correlationId);
      }
      const params = segment?.params ? await segment.params : ({} as P);
      return await handler(req, { params, correlationId });
    } catch (err) {
      if (err instanceof AppError) {
        return errorResponse(err.code, err.message, correlationId, {
          field_errors: err.fieldErrors,
          retry_after_seconds: err.retryAfterSeconds,
          retryable: err.code === "SOURCE_UNAVAILABLE" || err.code === "RATE_LIMITED",
        });
      }
      if (err instanceof ZodError) {
        return errorResponse("INVALID_PAYLOAD", "Some fields need attention.", correlationId, { field_errors: zodFieldErrors(err) });
      }
      // Never return provider stack traces; log a redacted line with the correlation id.
      console.error(JSON.stringify({ level: "error", correlation_id: correlationId, route: req.nextUrl.pathname, message: err instanceof Error ? err.message.slice(0, 200) : "unknown" }));
      return errorResponse("INTERNAL_ERROR", "Something went wrong on our side. Try again, and quote the reference if it continues.", correlationId);
    }
  };
}

/** Read and validate a JSON body with a size limit, on the server, regardless of client validation. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>, maxBytes: number = LIMITS.INGESTION_BODY_MAX_BYTES): Promise<T> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "The request body is too large.");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "The request body is too large.");
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("INVALID_PAYLOAD", "The request body must be valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local").slice(0, 60);
}
