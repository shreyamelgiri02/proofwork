import { authenticateIngestionToken, enforceRateLimit, getSql, getTaskStatusForAgent } from "@proofwork/database";
import { AppError } from "@proofwork/domain";
import { json, route } from "@/lib/api";

/** GET /api/v1/tasks/:taskId — status of persisted state for the token's workspace only. */
export const GET = route<{ taskId: string }>(
  async (req, { params, correlationId }) => {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const sql = getSql();
    const credential = await authenticateIngestionToken(sql, token);
    if (!credential) throw new AppError("INVALID_INGESTION_TOKEN", "A valid, non-revoked ingestion token is required.");
    await enforceRateLimit(sql, `ingest-status:${credential.credentialId}`, 120, 60);
    if (!/^[0-9a-f-]{36}$/.test(params.taskId)) throw new AppError("NOT_FOUND", "Task not found.");
    return json(await getTaskStatusForAgent(sql, credential.workspaceId, params.taskId), correlationId);
  },
  { csrf: false },
);
