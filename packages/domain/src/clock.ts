/**
 * Controllable clock. Every server component (web, worker, sandbox) reads time
 * through this helper so demo fixtures and final testing can shift "now"
 * deliberately with PROOFWORK_CLOCK_OFFSET_SECONDS. Stored timestamps are UTC.
 */

function offsetMs(): number {
  const raw = typeof process !== "undefined" ? process.env?.PROOFWORK_CLOCK_OFFSET_SECONDS : undefined;
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n * 1000 : 0;
}

export function now(): Date {
  return new Date(Date.now() + offsetMs());
}

export function nowMs(): number {
  return Date.now() + offsetMs();
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function secondsBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 1000;
}

/**
 * Timestamp normalization rule: both providers expose whole-second precision
 * for billing boundaries, so instants are truncated to whole seconds before an
 * exact comparison. No wider tolerance is applied to boundaries.
 */
export function toEpochSeconds(value: Date | string | number): number {
  if (typeof value === "number") return Math.floor(value);
  const d = typeof value === "string" ? new Date(value) : value;
  return Math.floor(d.getTime() / 1000);
}

export function sameInstant(a: Date | string | number | null | undefined, b: Date | string | number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return toEpochSeconds(a) === toEpochSeconds(b);
}

export function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}
