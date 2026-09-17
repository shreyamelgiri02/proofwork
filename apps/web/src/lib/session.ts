import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  actorForUser,
  DEMO_ACTOR,
  ensurePrivateWorkspace,
  findDemoWorkspace,
  getProfile,
  getSql,
  sha256,
  type ServiceContext,
  type WorkspaceRow,
} from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { decodeDemoCookie, DEMO_COOKIE } from "@/lib/demo-cookie";
import { isDatabaseReady, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  organization: string | null;
  emailConfirmed: boolean;
}

export type Session =
  | { kind: "user"; user: SessionUser; workspace: WorkspaceRow }
  | { kind: "demo"; workspace: WorkspaceRow; expiresAt: Date }
  | { kind: "anonymous"; demoExpired: boolean };

/**
 * Resolve the caller from server-validated state only:
 *  1. Supabase user (auth.getUser validates the JWT with the Auth server), then
 *  2. a signed demo cookie whose hash matches an unexpired demo workspace.
 * A workspace id supplied by the client is never used for authorization.
 */
export const getSession = cache(async (): Promise<Session> => {
  if (!isDatabaseReady()) return { kind: "anonymous", demoExpired: false };

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (user && user.email) {
        const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string; organization?: string };
        const sql = getSql();
        const workspace = await ensurePrivateWorkspace(
          sql,
          { id: user.id, email: user.email, fullName: meta.full_name ?? meta.name ?? null, organization: meta.organization ?? null },
          randomUUID(),
        );
        const profile = await getProfile(sql, user.id);
        return {
          kind: "user",
          user: {
            id: user.id,
            email: user.email,
            displayName: profile?.display_name ?? meta.full_name ?? user.email,
            organization: meta.organization ?? null,
            emailConfirmed: Boolean(user.email_confirmed_at),
          },
          workspace,
        };
      }
    } catch (err) {
      if (err instanceof AppError && err.code !== "SETUP_REQUIRED") throw err;
    }
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(DEMO_COOKIE)?.value;
  if (raw) {
    const decoded = decodeDemoCookie(raw);
    if (!decoded) return { kind: "anonymous", demoExpired: true };
    const workspace = await findDemoWorkspace(getSql(), decoded.workspaceId, sha256(decoded.sessionToken));
    if (!workspace || !workspace.expires_at || new Date(workspace.expires_at).getTime() <= Date.now()) {
      return { kind: "anonymous", demoExpired: true };
    }
    return { kind: "demo", workspace, expiresAt: new Date(workspace.expires_at) };
  }
  return { kind: "anonymous", demoExpired: false };
});

export function contextFor(session: Exclude<Session, { kind: "anonymous" }>, correlationId: string = randomUUID()): ServiceContext {
  if (session.kind === "user") {
    return {
      workspace: { id: session.workspace.id, kind: "PRIVATE" },
      actor: actorForUser({ id: session.user.id, email: session.user.email }, session.user.displayName),
      correlationId,
    };
  }
  return { workspace: { id: session.workspace.id, kind: "DEMO" }, actor: DEMO_ACTOR(session.workspace.id), correlationId };
}

/** For API routes: require an authenticated context, optionally a completed onboarding. */
export async function requireContext(correlationId: string, opts: { allowIncompleteOnboarding?: boolean } = {}) {
  if (!isDatabaseReady()) throw new AppError("SETUP_REQUIRED", "The application database is not configured.");
  const session = await getSession();
  if (session.kind === "anonymous") {
    if (session.demoExpired) throw new AppError("DEMO_EXPIRED", "This demo session expired. Start a new session to continue.");
    throw new AppError("AUTH_REQUIRED", "Sign in to continue.");
  }
  if (!opts.allowIncompleteOnboarding && session.kind === "user" && !session.workspace.onboarding_completed_at) {
    throw new AppError("ONBOARDING_INCOMPLETE", "Finish workspace setup first.");
  }
  return { session, ctx: contextFor(session, correlationId) };
}
