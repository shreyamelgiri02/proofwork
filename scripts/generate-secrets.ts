/**
 * Prints freshly generated local secrets. Copy the lines into your .env.
 * Nothing is written to disk and nothing is sent anywhere.
 */
import { randomBytes } from "node:crypto";

const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");
const dbPassword = () => randomBytes(24).toString("hex");

const appPw = dbPassword();
const sandboxPw = dbPassword();

console.log(`# Generated ${new Date().toISOString()} — local development only
DEMO_COOKIE_SECRET=${secret(48)}
SANDBOX_READ_TOKEN=${secret()}
SANDBOX_WRITE_TOKEN=${secret()}
SANDBOX_ADMIN_TOKEN=${secret()}
DATABASE_URL=postgres://proofwork_app:${appPw}@127.0.0.1:54322/postgres
SANDBOX_DATABASE_URL=postgres://billing_sandbox_service:${sandboxPw}@127.0.0.1:54322/postgres`);
