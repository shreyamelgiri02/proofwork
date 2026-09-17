/**
 * Manual trigger for the documented demo retention job (the worker also runs it every
 * 10 minutes). Deletes DEMO workspaces past purge_after, skipping any workspace with an
 * unresolved, possibly dispatched recovery operation. Private workspaces are never touched.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env") });

const db = await import("@proofwork/database");
const sql = db.getSql();
const result = await db.purgeExpiredDemos(sql);
console.log(`Purged ${result.purged} expired demo workspace(s); skipped ${result.skipped} with unresolved operations.`);
await sql.end({ timeout: 5 });
