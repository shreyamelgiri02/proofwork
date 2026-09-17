import { AppError } from "@proofwork/domain";
import { recordAudit } from "./audit";
import type { Sql } from "./client";
import type { Actor, ServiceContext } from "./context";
import { generateIngestionToken, sha256 } from "./crypto";

export interface TokenSummary {
  id: string;
  name: string;
  token_prefix: string;
  scope: string;
  created_by_label: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export async function listTokens(sql: Sql, ctx: ServiceContext): Promise<TokenSummary[]> {
  return sql<TokenSummary[]>`
    select id, name, token_prefix, scope, created_by_label, created_at, last_used_at, revoked_at
    from app.agent_credentials where workspace_id = ${ctx.workspace.id}
    order by created_at desc
  `;
}

/** Creates a scoped ingestion token. The full value is returned exactly once. */
export async function createToken(sql: Sql, ctx: ServiceContext, name: string): Promise<{ token: string; summary: TokenSummary }> {
  if (ctx.workspace.kind === "DEMO") throw new AppError("PERMISSION_DENIED", "Ingestion tokens are not available in the demo. Create a workspace to connect an agent.");
  if (ctx.actor.type !== "USER") throw new AppError("PERMISSION_DENIED", "Only the owner can create ingestion tokens.");
  const generated = generateIngestionToken();
  const summary = await sql.begin(async (tx) => {
    const [row] = await tx<TokenSummary[]>`
      insert into app.agent_credentials (workspace_id, name, token_prefix, token_hash, created_by, created_by_label)
      values (${ctx.workspace.id}, ${name}, ${generated.prefix}, ${generated.hash}, ${ctx.actor.id}, ${ctx.actor.label})
      returning id, name, token_prefix, scope, created_by_label, created_at, last_used_at, revoked_at
    `;
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "token.created",
      summary: `Ingestion token "${name}" created (${generated.prefix}…).`,
      correlationId: ctx.correlationId,
      after: { token_prefix: generated.prefix, scope: "claims:write" },
    });
    return row;
  });
  return { token: generated.token, summary: summary as TokenSummary };
}

export async function revokeToken(sql: Sql, ctx: ServiceContext, tokenId: string): Promise<void> {
  if (ctx.actor.type !== "USER") throw new AppError("PERMISSION_DENIED", "Only the owner can revoke ingestion tokens.");
  await sql.begin(async (tx) => {
    const rows = await tx<{ token_prefix: string }[]>`
      update app.agent_credentials set revoked_at = now(), revoked_by = ${ctx.actor.id}
      where workspace_id = ${ctx.workspace.id} and id = ${tokenId} and revoked_at is null
      returning token_prefix
    `;
    if (!rows.length) throw new AppError("NOT_FOUND", "Token not found or already revoked.");
    await recordAudit(tx as unknown as Sql, {
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      eventType: "token.revoked",
      summary: `Ingestion token ${rows[0].token_prefix}… revoked.`,
      correlationId: ctx.correlationId,
    });
  });
}

/** Resolve an ingestion token to its workspace. The workspace is derived from the credential only. */
export async function authenticateIngestionToken(
  sql: Sql,
  presented: string | null | undefined,
): Promise<{ credentialId: string; workspaceId: string; actor: Actor } | null> {
  if (!presented || !/^pwk_[a-f0-9]{8}_[A-Za-z0-9_\-]{30,}$/.test(presented)) return null;
  const hash = sha256(presented);
  const [row] = await sql<{ id: string; workspace_id: string; name: string; token_prefix: string }[]>`
    select c.id, c.workspace_id, c.name, c.token_prefix
    from app.agent_credentials c
    join app.workspaces w on w.id = c.workspace_id and w.kind = 'PRIVATE'
    where c.token_hash = ${hash} and c.revoked_at is null
  `;
  if (!row) return null;
  await sql`update app.agent_credentials set last_used_at = now() where id = ${row.id}`;
  return {
    credentialId: row.id,
    workspaceId: row.workspace_id,
    actor: { type: "AGENT", id: `api:${row.id}`, label: `Ingestion token ${row.token_prefix}` },
  };
}
