import { cookies } from "next/headers";
import { createDemoWorkspace, enforceRateLimit, getSql } from "@proofwork/database";
import { AppError, LIMITS, RETENTION } from "@proofwork/domain";
import { clientIp, json, route } from "@/lib/api";
import { demoCookieOptions, encodeDemoCookie, DEMO_COOKIE } from "@/lib/demo-cookie";
import { isDatabaseReady } from "@/lib/env";
import { getSession } from "@/lib/session";

/** Explore demo: creates (or resumes) this visitor's isolated demo workspace. */
export const POST = route(async (req, { correlationId }) => {
  const session = await getSession();
  if (session.kind === "user") {
    throw new AppError("CONFLICT", "You are signed in to a private workspace. Sign out to explore the isolated demo.");
  }
  if (session.kind === "demo") return json({ redirect: "/app/tasks", resumed: true }, correlationId);

  const ttl = Number(process.env.DEMO_SESSION_TTL_SECONDS ?? RETENTION.DEMO_SESSION_SECONDS);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  if (!isDatabaseReady()) {
    const { createStandaloneDemoWorkspace } = await import("@/lib/standalone-demo");
    const { workspaceId, sessionToken } = createStandaloneDemoWorkspace();
    (await cookies()).set(DEMO_COOKIE, encodeDemoCookie(workspaceId, sessionToken, expiresAt), demoCookieOptions(expiresAt));
    return json({ redirect: "/app/tasks", resumed: false, expires_at: expiresAt.toISOString() }, correlationId, { status: 201 });
  }

  const sql = getSql();
  await enforceRateLimit(sql, `demo:create:${clientIp(req)}`, LIMITS.DEMO_COMMANDS_PER_MINUTE, 60);
  const { workspaceId, sessionToken } = await createDemoWorkspace(sql, correlationId);
  (await cookies()).set(DEMO_COOKIE, encodeDemoCookie(workspaceId, sessionToken, expiresAt), demoCookieOptions(expiresAt));
  return json({ redirect: "/app/tasks", resumed: false, expires_at: expiresAt.toISOString() }, correlationId, { status: 201 });
});
