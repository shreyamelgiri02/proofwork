import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalJson, materialProjection, type NormalizedSubscription } from "@proofwork/domain";

export const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const correlationId = () => randomUUID();

export function materialFingerprint(snapshot: NormalizedSubscription): string {
  return sha256(canonicalJson(materialProjection(snapshot)));
}

export function snapshotHash(snapshot: NormalizedSubscription): string {
  return sha256(canonicalJson(snapshot));
}

export function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Ingestion token format: pwk_<prefix>_<secret>. Only the SHA-256 hash is stored. */
export function generateIngestionToken(): { token: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `pwk_${prefix}_${secret}`;
  return { token, prefix: `pwk_${prefix}`, hash: sha256(token) };
}
