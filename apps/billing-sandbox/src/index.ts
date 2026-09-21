/**
 * Proofwork independent local billing sandbox.
 *
 * A separate HTTP service with its own database role and schema. It stands in for
 * an external billing provider so the whole product works without paid services.
 *
 *  - Read credential:  account identity, subscription list/reads, operation lookup.
 *  - Write credential: the single allowed mutation (schedule period-end cancellation),
 *                      with source-side idempotency records.
 *  - Admin credential: scenario setup/reset for demo and development only.
 *
 * It never evaluates outcomes and never knows what a "correct" verdict would be.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { config as loadEnv } from "dotenv";
import { Hono, type Context } from "hono";
import postgres from "postgres";
import { sandboxListenConfig } from "./runtime";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

const listen = sandboxListenConfig();
const DATABASE_URL = process.env.SANDBOX_DATABASE_URL;
const TOKENS = {
  read: process.env.SANDBOX_READ_TOKEN ?? "",
  write: process.env.SANDBOX_WRITE_TOKEN ?? "",
  admin: process.env.SANDBOX_ADMIN_TOKEN ?? "",
};

if (!DATABASE_URL) {
  console.error("[sandbox] SANDBOX_DATABASE_URL is required. See LOCAL-SETUP.md.");
  process.exit(1);
}
for (const [k, v] of Object.entries(TOKENS)) {
  if (!v || v.length < 24) {
    console.error(`[sandbox] SANDBOX_${k.toUpperCase()}_TOKEN must be set to a generated secret (npm run secrets:generate).`);
    process.exit(1);
  }
}

const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  ssl: process.env.NODE_ENV === "production" ? "require" : false,
  connection: { application_name: "proofwork-sandbox", search_path: "billing_sandbox" },
});

const clockOffsetMs = () => (Number(process.env.PROOFWORK_CLOCK_OFFSET_SECONDS ?? 0) || 0) * 1000;
const nowDate = () => new Date(Date.now() + clockOffsetMs());
const epoch = (d: Date | string | null | undefined) => (d ? Math.floor(new Date(d).getTime() / 1000) : null);

type Credential = "read" | "write" | "admin";

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function credentialOf(c: Context): Credential | null {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  if (tokenMatches(token, TOKENS.admin)) return "admin";
  if (tokenMatches(token, TOKENS.write)) return "write";
  if (tokenMatches(token, TOKENS.read)) return "read";
  return null;
}

/** Route params are always present for matched routes; normalize the type. */
const param = (c: Context, name: string): string => c.req.param(name) ?? "";

function error(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as 400);
}

interface SubscriptionRow {
  id: string;
  account_id: string;
  customer_id: string;
  customer_label: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at: Date | null;
  canceled_at: Date | null;
  ended_at: Date | null;
  current_period_start: Date;
  current_period_end: Date;
  item_count: number;
  items_complete: boolean;
  usage_type: string;
  collection_method: string;
  schedule_id: string | null;
  pause_collection: boolean;
  pending_update: boolean;
  read_fault: string;
  write_fault: string;
  version: number;
}

function serialize(row: SubscriptionRow) {
  return {
    object: "subscription",
    id: row.id,
    account: row.account_id,
    livemode: false,
    customer: row.customer_id,
    customer_label: row.customer_label,
    status: row.status,
    cancel_at_period_end: row.cancel_at_period_end,
    cancel_at: epoch(row.cancel_at),
    canceled_at: epoch(row.canceled_at),
    ended_at: epoch(row.ended_at),
    current_period_start: epoch(row.current_period_start),
    current_period_end: epoch(row.current_period_end),
    items: { count: row.item_count, complete: row.items_complete, usage_type: row.usage_type },
    collection_method: row.collection_method,
    schedule: row.schedule_id,
    pause_collection: row.pause_collection,
    pending_update: row.pending_update,
    version: row.version,
  };
}

const app = new Hono<{ Variables: { requestId: string; credential: Credential | null } }>();

// Request id + credential resolution + request log.
app.use("*", async (c, next) => {
  const requestId = `req_sbx_${randomBytes(9).toString("hex")}`;
  c.set("requestId", requestId);
  c.set("credential", credentialOf(c));
  c.header("x-request-id", requestId);
  await next();
  const accountMatch = c.req.path.match(/accounts\/([^/]+)/);
  sql`
    insert into request_log (account_id, request_id, method, path, status, credential)
    values (${accountMatch?.[1] ?? null}, ${requestId}, ${c.req.method}, ${c.req.path.slice(0, 300)}, ${c.res.status}, ${c.get("credential") ?? "none"})
  `.catch(() => undefined);
});

app.get("/health", async (c) => {
  try {
    await sql`select 1`;
    return c.json({ status: "ok", service: "proofwork-billing-sandbox", time: nowDate().toISOString() });
  } catch {
    return c.json({ status: "degraded", service: "proofwork-billing-sandbox" }, 503);
  }
});

// ---------------------------------------------------------------------------
// Read API (read, write or admin credential may read; the recovery identity needs reads for prechecks)
// ---------------------------------------------------------------------------
const requireCredential = (allowed: Credential[]) => async (c: Context, next: () => Promise<void>) => {
  const cred = c.get("credential") as Credential | null;
  if (!cred) return error(c, 401, "authentication_required", "A valid bearer credential is required.");
  if (!allowed.includes(cred)) return error(c, 403, "permission_denied", "This credential cannot perform this operation.");
  await next();
};

app.get("/v1/accounts/:account", requireCredential(["read", "write", "admin"]), async (c) => {
  const [account] = await sql<{ id: string; label: string }[]>`select id, label from accounts where id = ${param(c, "account")}`;
  if (!account) return error(c, 404, "account_not_found", "No such account.");
  return c.json({ object: "account", id: account.id, label: account.label, livemode: false, environment: "synthetic" });
});

app.get("/v1/accounts/:account/subscriptions", requireCredential(["read", "write", "admin"]), async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);
  const rows = await sql<SubscriptionRow[]>`
    select * from subscriptions where account_id = ${param(c, "account")}
    order by created_at asc limit ${limit}
  `;
  // Listing is for authorized UI selection; faulted records still list their identity.
  return c.json({ object: "list", data: rows.map(serialize), has_more: rows.length === limit });
});

app.get("/v1/accounts/:account/subscriptions/:id", requireCredential(["read", "write", "admin"]), async (c) => {
  const [row] = await sql<SubscriptionRow[]>`
    select * from subscriptions where account_id = ${param(c, "account")} and id = ${param(c, "id")}
  `;
  if (!row) return error(c, 404, "resource_missing", "No such subscription.");
  switch (row.read_fault) {
    case "UNAVAILABLE":
      return error(c, 503, "service_unavailable", "The billing source is temporarily unavailable.");
    case "NOT_FOUND":
      return error(c, 404, "resource_missing", "No such subscription.");
    case "DENIED":
      return error(c, 403, "permission_denied", "This credential cannot read this subscription.");
    case "MALFORMED": {
      const body = serialize(row) as Record<string, unknown>;
      delete body.cancel_at_period_end;
      delete body.items;
      return c.json(body);
    }
    default:
      return c.json(serialize(row));
  }
});

app.get("/v1/accounts/:account/operations/:key", requireCredential(["read", "write", "admin"]), async (c) => {
  const [op] = await sql<{ subscription_id: string; result_status: number; created_at: Date }[]>`
    select subscription_id, result_status, created_at from operations
    where account_id = ${param(c, "account")} and idempotency_key = ${param(c, "key")}
      and operation = 'schedule_period_end_cancellation'
  `;
  if (!op) return error(c, 404, "operation_not_found", "No operation recorded for this idempotency key.");
  return c.json({ object: "operation", subscription_id: op.subscription_id, applied: op.result_status === 200, created_at: epoch(op.created_at) });
});

// ---------------------------------------------------------------------------
// Write API: the single allowed mutation. Only the write credential.
// ---------------------------------------------------------------------------
app.post("/v1/accounts/:account/subscriptions/:id/schedule-cancellation", requireCredential(["write"]), async (c) => {
  const key = c.req.header("idempotency-key");
  if (!key || key.length < 8 || key.length > 255) return error(c, 400, "idempotency_key_required", "An Idempotency-Key header is required.");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return error(c, 400, "invalid_body", "Body must be JSON.");
  }
  const keys = body && typeof body === "object" ? Object.keys(body as object) : [];
  if (keys.length !== 1 || (body as { cancel_at_period_end?: unknown }).cancel_at_period_end !== true) {
    return error(c, 400, "unsupported_parameters", "Only {\"cancel_at_period_end\": true} is supported.");
  }
  const accountId = param(c, "account");
  const subscriptionId = param(c, "id");
  const requestHash = createHash("sha256").update(`${subscriptionId}|cancel_at_period_end=true`).digest("hex");

  const outcome = await sql.begin(async (tx) => {
    const [existing] = await tx<{ request_hash: string; result_status: number; result_body: unknown }[]>`
      select request_hash, result_status, result_body from operations
      where account_id = ${accountId} and idempotency_key = ${key} for update
    `;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        return { status: 409, body: { error: { code: "idempotency_key_reuse", message: "This key was used with different parameters." } }, replayed: false, lose: false };
      }
      return { status: existing.result_status, body: existing.result_body, replayed: true, lose: false };
    }
    const [row] = await tx<SubscriptionRow[]>`
      select * from subscriptions where account_id = ${accountId} and id = ${subscriptionId} for update
    `;
    if (!row) return { status: 404, body: { error: { code: "resource_missing", message: "No such subscription." } }, replayed: false, lose: false };

    const record = async (status: number, resultBody: unknown, before: number, after: number) => {
      await tx`
        insert into operations (account_id, subscription_id, idempotency_key, operation, request_hash, result_status, result_body, version_before, version_after)
        values (${accountId}, ${subscriptionId}, ${key}, 'schedule_period_end_cancellation', ${requestHash}, ${status}, ${tx.json(resultBody as never)}, ${before}, ${after})
      `;
    };

    if (row.write_fault === "REJECT") {
      const rejected = { error: { code: "subscription_update_rejected", message: "The billing source rejected this update." } };
      await record(422, rejected, row.version, row.version);
      return { status: 422, body: rejected, replayed: false, lose: false };
    }
    if (row.status !== "active") {
      const rejected = { error: { code: "subscription_not_active", message: "Only active subscriptions can be scheduled for cancellation." } };
      await record(422, rejected, row.version, row.version);
      return { status: 422, body: rejected, replayed: false, lose: false };
    }
    const [updated] = await tx<SubscriptionRow[]>`
      update subscriptions
      set cancel_at_period_end = true, canceled_at = coalesce(canceled_at, ${nowDate()}), version = version + 1, updated_at = now()
      where account_id = ${accountId} and id = ${subscriptionId}
      returning *
    `;
    const resultBody = serialize(updated);
    await record(200, resultBody, row.version, updated.version);
    return { status: 200, body: resultBody, replayed: false, lose: row.write_fault === "RESPONSE_LOST" };
  });

  if (outcome.lose) {
    // Simulated lost response: the mutation committed, but the caller receives a gateway timeout.
    return error(c, 504, "upstream_timeout", "The request timed out before a response was returned.");
  }
  if (outcome.replayed) c.header("idempotent-replayed", "true");
  return c.json(outcome.body as object, outcome.status as 200);
});

// ---------------------------------------------------------------------------
// Restricted admin API: scenario setup/reset (demo + development only)
// ---------------------------------------------------------------------------
const admin = new Hono<{ Variables: { requestId: string; credential: Credential | null } }>();
admin.use("*", requireCredential(["admin"]));

admin.post("/accounts", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { owner_reference?: string; label?: string; kind?: string };
  if (!body.owner_reference || !/^[A-Za-z0-9:_\-]{8,120}$/.test(body.owner_reference)) return error(c, 400, "invalid_owner_reference", "owner_reference is required.");
  const kind = body.kind === "DEMO" ? "DEMO" : "PRIVATE";
  const label = (body.label ?? "Synthetic billing account").slice(0, 120);
  const [existing] = await sql<{ id: string; label: string }[]>`select id, label from accounts where owner_reference = ${body.owner_reference}`;
  if (existing) return c.json(existing);
  const id = `acct_sbx_${randomBytes(8).toString("hex")}`;
  const [created] = await sql<{ id: string; label: string }[]>`
    insert into accounts (id, label, owner_reference, kind) values (${id}, ${label}, ${body.owner_reference}, ${kind})
    returning id, label
  `;
  return c.json(created, 201);
});

admin.post("/accounts/:account/subscriptions", async (c) => {
  const b = (await c.req.json().catch(() => null)) as null | {
    subscription_id: string;
    customer_id: string;
    customer_label: string;
    scenario_key: string;
    period_end: string;
    status: "active" | "canceled";
    cancel_at_period_end: boolean;
    ended_at: string | null;
    canceled_at: string | null;
    item_count: number;
    read_fault: string;
    write_fault: string;
  };
  if (!b || !/^sub_[A-Za-z0-9_]{6,64}$/.test(b.subscription_id) || !/^cus_[A-Za-z0-9_]{4,64}$/.test(b.customer_id) || Number.isNaN(new Date(b.period_end).getTime())) {
    return error(c, 400, "invalid_seed", "Seed is missing required fields.");
  }
  const periodEnd = new Date(b.period_end);
  const periodStart = new Date(periodEnd.getTime() - 30 * 86_400_000);
  const [row] = await sql<SubscriptionRow[]>`
    insert into subscriptions (
      id, account_id, customer_id, customer_label, status, cancel_at_period_end, canceled_at, ended_at,
      current_period_start, current_period_end, item_count, read_fault, write_fault, scenario_key
    ) values (
      ${b.subscription_id}, ${param(c, "account")}, ${b.customer_id}, ${b.customer_label.slice(0, 120)}, ${b.status},
      ${b.cancel_at_period_end}, ${b.canceled_at ? new Date(b.canceled_at) : null}, ${b.ended_at ? new Date(b.ended_at) : null},
      ${periodStart}, ${periodEnd}, ${Math.max(0, Math.min(b.item_count, 10))}, ${b.read_fault}, ${b.write_fault}, ${b.scenario_key}
    )
    on conflict (account_id, id) do nothing
    returning *
  `;
  if (!row) return error(c, 409, "subscription_exists", "A subscription with this id already exists in this account.");
  return c.json(serialize(row), 201);
});

admin.post("/accounts/:account/subscriptions/:id/changes", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { change?: string; value?: string };
  const accountId = param(c, "account");
  const id = param(c, "id");
  let updated: SubscriptionRow[] = [];
  switch (b.change) {
    case "SHIFT_PERIOD":
      updated = await sql<SubscriptionRow[]>`
        update subscriptions set current_period_start = current_period_start + interval '30 days',
          current_period_end = current_period_end + interval '30 days', version = version + 1, updated_at = now()
        where account_id = ${accountId} and id = ${id} returning *`;
      break;
    case "SET_PERIOD_END":
      if (!b.value || Number.isNaN(new Date(b.value).getTime())) return error(c, 400, "invalid_value", "value must be an ISO timestamp.");
      updated = await sql<SubscriptionRow[]>`
        update subscriptions set current_period_end = ${new Date(b.value)}, version = version + 1, updated_at = now()
        where account_id = ${accountId} and id = ${id} returning *`;
      break;
    case "REVERSE_SCHEDULE":
      updated = await sql<SubscriptionRow[]>`
        update subscriptions set cancel_at_period_end = false, canceled_at = null, version = version + 1, updated_at = now()
        where account_id = ${accountId} and id = ${id} returning *`;
      break;
    case "SCHEDULE_EXTERNALLY":
      updated = await sql<SubscriptionRow[]>`
        update subscriptions set cancel_at_period_end = true, canceled_at = ${nowDate()}, version = version + 1, updated_at = now()
        where account_id = ${accountId} and id = ${id} returning *`;
      break;
    case "CHANGE_CUSTOMER":
      updated = await sql<SubscriptionRow[]>`
        update subscriptions set customer_id = 'cus_other_' || substr(md5(customer_id), 1, 8), version = version + 1, updated_at = now()
        where account_id = ${accountId} and id = ${id} returning *`;
      break;
    case "SOURCE_OUTAGE":
      updated = await sql<SubscriptionRow[]>`
        update subscriptions set read_fault = 'UNAVAILABLE', updated_at = now()
        where account_id = ${accountId} and id = ${id} returning *`;
      break;
    case "SOURCE_RESTORE":
      updated = await sql<SubscriptionRow[]>`
        update subscriptions set read_fault = 'NONE', write_fault = 'NONE', updated_at = now()
        where account_id = ${accountId} and id = ${id} returning *`;
      break;
    default:
      return error(c, 400, "unsupported_change", "Unsupported change.");
  }
  if (!updated[0]) return error(c, 404, "resource_missing", "No such subscription.");
  await sql`
    insert into operations (account_id, subscription_id, idempotency_key, operation, request_hash, result_status, result_body, version_before, version_after)
    values (${accountId}, ${id}, ${`admin_${randomBytes(12).toString("hex")}`}, 'admin_mutation', ${b.change}, 200, ${sql.json({ change: b.change })}, ${updated[0].version - 1}, ${updated[0].version})
  `;
  return c.json({ id: updated[0].id, version: updated[0].version });
});

admin.post("/accounts/:account/reset", async (c) => {
  const accountId = param(c, "account");
  await sql.begin(async (tx) => {
    await tx`delete from operations where account_id = ${accountId}`;
    await tx`delete from subscriptions where account_id = ${accountId}`;
  });
  return c.json({ reset: true });
});

admin.delete("/accounts/:account", async (c) => {
  await sql`delete from accounts where id = ${param(c, "account")}`;
  return c.json({ deleted: true });
});

app.route("/admin", admin);

app.notFound((c) => error(c, 404, "route_not_found", "Unknown sandbox route."));
app.onError((err, c) => {
  console.error("[sandbox] unhandled error", err instanceof Error ? err.message : "unknown");
  return error(c, 500, "internal_error", "The sandbox encountered an internal error.");
});

serve({ fetch: app.fetch, port: listen.port, hostname: listen.hostname }, (info) => {
  console.log(`[sandbox] Proofwork billing sandbox listening on ${listen.hostname}:${info.port}`);
});

const shutdown = async () => {
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
