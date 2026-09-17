import { z } from "zod";
import { activateConnection, checkConnection, configureLocalSandbox, configureStripeTest, getSql } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

const bodySchema = z.object({
  action: z.enum(["configure", "check", "activate"]),
  adapter: z.enum(["LOCAL_SANDBOX", "STRIPE_TEST"]),
});

export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, bodySchema, 512);
  const sql = getSql();
  if (ctx.workspace.kind === "DEMO" && input.adapter === "STRIPE_TEST") {
    throw new AppError("DEMO_EXTERNAL_ACCESS_BLOCKED", "Demo workspaces cannot use external billing sources.");
  }
  if (ctx.workspace.kind === "DEMO" && input.action !== "check") {
    throw new AppError("PERMISSION_DENIED", "The demo evidence source is fixed to simulated billing.");
  }
  if (input.action === "configure") {
    const connection = input.adapter === "LOCAL_SANDBOX" ? await configureLocalSandbox(sql, ctx, { seedStarter: true }) : await configureStripeTest(sql, ctx);
    return json({ connection }, correlationId);
  }
  const [row] = await sql<{ id: string }[]>`select id from app.connections where workspace_id = ${ctx.workspace.id} and adapter = ${input.adapter}`;
  if (!row) throw new AppError("NOT_FOUND", "Configure this evidence source first.");
  if (input.action === "check") return json({ connection: await checkConnection(sql, ctx, row.id) }, correlationId);
  return json({ connection: await activateConnection(sql, ctx, input.adapter) }, correlationId);
});
