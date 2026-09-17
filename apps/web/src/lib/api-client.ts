"use client";

import type { ApiErrorBody } from "@proofwork/domain";

/** Browser fetch wrapper. Surfaces the standard error shape with its correlation id. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;
  constructor(status: number, body: ApiErrorBody["error"] | null) {
    super(body?.message ?? "Something went wrong. Try again.");
    this.name = "ApiClientError";
    this.status = status;
    this.code = body?.code ?? "INTERNAL_ERROR";
    this.fieldErrors = body?.field_errors;
    this.correlationId = body?.correlation_id;
    this.retryAfterSeconds = body?.retry_after_seconds;
  }
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch {
    throw new ApiClientError(0, { code: "SOURCE_UNAVAILABLE", message: "Could not reach Proofwork. Check your connection and try again.", correlation_id: "" });
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiClientError(res.status, (data as ApiErrorBody | null)?.error ?? null);
  return data as T;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `ui-${crypto.randomUUID()}` : `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
