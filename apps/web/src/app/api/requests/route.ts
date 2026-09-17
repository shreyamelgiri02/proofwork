import { confirmRequest, getSql, listAuthorizedRequests } from "@proofwork/database";
import { confirmRequestSchema } from "@proofwork/domain";
import { json, parseBody, route } from "@/lib/api";
import { requireContext } from "@/lib/session";

export const GET = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const status = req.nextUrl.searchParams.get("status") === "all" ? "ALL" : "ACTIVE";
  const rows = await listAuthorizedRequests(getSql(), ctx, { status });
  return json(
    {
      items: rows.map((r) => ({
        id: r.id,
        version: r.version,
        status: r.status,
        customer_label: r.customer_label,
        customer_id: r.customer_id,
        subscription_id: r.subscription_id,
        expected_period_end: r.expected_period_end,
        source_reference: r.source_reference,
        authorized_by_label: r.authorized_by_label,
        authorized_at: r.authorized_at,
        task_id: r.task_id,
        task_verdict: r.task_verdict,
      })),
    },
    correlationId,
  );
});

/** Confirm a preview. Only the one-use token is accepted — never a date, customer or subscription. */
export const POST = route(async (req, { correlationId }) => {
  const { ctx } = await requireContext(correlationId);
  const input = await parseBody(req, confirmRequestSchema, 1024);
  const request = await confirmRequest(getSql(), ctx, { preview_token: input.preview_token });
  return json(
    {
      id: request.id,
      version: request.version,
      customer_label: request.customer_label,
      subscription_id: request.subscription_id,
      expected_period_end: request.expected_period_end,
      authorized_at: request.authorized_at,
      message: "Customer request registered. Submit the agent's report next.",
    },
    correlationId,
    { status: 201 },
  );
});
