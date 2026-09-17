/** Display helpers. Storage is UTC; display converts to the workspace timezone. */

export function formatDateTime(iso: string | Date | null | undefined, timeZone = "UTC", opts: { withZone?: boolean } = {}): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(opts.withZone ? { timeZoneName: "short" } : {}),
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function formatDate(iso: string | Date | null | undefined, timeZone = "UTC"): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatTime(iso: string | Date | null | undefined, timeZone = "UTC"): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

export function formatRelative(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "never";
  const diff = Math.round((new Date(iso).getTime() - nowMs) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function percent(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}
