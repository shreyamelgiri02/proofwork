import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Signed, httpOnly demo session cookie: <workspaceId>.<sessionToken>.<expEpoch>.<hmac> */

export const DEMO_COOKIE = "pw_demo";

function secret(): string {
  const s = process.env.DEMO_COOKIE_SECRET;
  if (!s || s.length < 32 || s.startsWith("replace-")) {
    return "proofwork-cloud-demo-secret-salt-key-minimum-32-chars-long";
  }
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeDemoCookie(workspaceId: string, sessionToken: string, expiresAt: Date): string {
  const payload = `${workspaceId}.${sessionToken}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeDemoCookie(value: string | undefined | null): { workspaceId: string; sessionToken: string; expiresAt: Date } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [workspaceId, sessionToken, exp, mac] = parts;
  if (!/^[0-9a-f-]{36}$/.test(workspaceId) || !/^[A-Za-z0-9_-]{20,100}$/.test(sessionToken) || !/^\d+$/.test(exp)) return null;
  let expected: string;
  try {
    expected = sign(`${workspaceId}.${sessionToken}.${exp}`);
  } catch {
    return null;
  }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expiresAt = new Date(Number(exp) * 1000);
  if (expiresAt.getTime() <= Date.now()) return null;
  return { workspaceId, sessionToken, expiresAt };
}

export const demoCookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires: expiresAt,
});
