import { LIMITS } from "@proofwork/domain";

export interface HttpResult {
  status: number;
  body: unknown;
  headers: Headers;
}

export type HttpFailure = { kind: "timeout" } | { kind: "network"; message: string };

/**
 * fetch with a hard timeout. Returns either a response or a transport failure.
 * Never follows URLs derived from user content: callers build URLs from config.
 */
export async function httpRequest(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<{ ok: true; result: HttpResult } | { ok: false; failure: HttpFailure }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? LIMITS.SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "error" });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { __unparseable: true };
      }
    }
    return { ok: true, result: { status: res.status, body, headers: res.headers } };
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") return { ok: false, failure: { kind: "timeout" } };
    return { ok: false, failure: { kind: "network", message: err instanceof Error ? err.message : "network error" } };
  } finally {
    clearTimeout(timer);
  }
}

export const isoOrNull = (epochSeconds: unknown): string | null =>
  typeof epochSeconds === "number" && Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000).toISOString() : null;
