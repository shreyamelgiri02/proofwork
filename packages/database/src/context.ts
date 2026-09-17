import type { ActorType, WorkspaceKind } from "@proofwork/domain";

/** Server-resolved actor. Never constructed from browser-supplied identifiers. */
export interface Actor {
  type: ActorType;
  id: string;
  label: string;
  userId?: string;
  email?: string;
}

export interface WorkspaceRef {
  id: string;
  kind: WorkspaceKind;
}

/** Every workspace-scoped service call receives this, resolved from session or token. */
export interface ServiceContext {
  workspace: WorkspaceRef;
  actor: Actor;
  correlationId: string;
}

export const WORKER_ACTOR = (name: string): Actor => ({ type: "WORKER", id: `worker:${name}`, label: "Proofwork worker" });
export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", id: "system:proofwork", label: "Proofwork" };
