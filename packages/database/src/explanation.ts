import { AppError, REASON_COPY, type ReasonCode } from "@proofwork/domain";
import type { Sql } from "./client";
import type { ServiceContext } from "./context";

/**
 * "Why this result?" — deterministic reason-to-copy mapping first.
 * An optional model adapter (off by default) may rephrase EXISTING facts only.
 * It has no tools, cannot change verdicts, proposals or policy, and falls back on any problem.
 */

interface ExplanationResult {
  mode: "DETERMINISTIC" | "MODEL_ASSISTED";
  decision_id: string;
  title: string;
  text: string;
  fact_ids: string[];
  fallback_reason: string | null;
}

const cache = new Map<string, ExplanationResult>();

export async function explainDecision(sql: Sql, ctx: ServiceContext, taskId: string, decisionId: string): Promise<ExplanationResult> {
  const [decision] = await sql<{ id: string; verdict: string; reason_codes: string[]; facts: Record<string, unknown> }[]>`
    select id, verdict, reason_codes, facts from app.decisions where workspace_id = ${ctx.workspace.id} and task_id = ${taskId} and id = ${decisionId}
  `;
  if (!decision) throw new AppError("NOT_FOUND", "Decision not found.");
  const reason = decision.reason_codes[0] as ReasonCode;
  const copy = REASON_COPY[reason] ?? { title: reason, explanation: "See the recorded evidence." };
  const deterministic: ExplanationResult = {
    mode: "DETERMINISTIC",
    decision_id: decision.id,
    title: copy.title,
    text: copy.explanation,
    fact_ids: [],
    fallback_reason: null,
  };

  const provider = process.env.PROOFWORK_EXPLANATION_PROVIDER ?? "none";
  if (provider !== "anthropic" || !process.env.ANTHROPIC_API_KEY) {
    return { ...deterministic, fallback_reason: "Explanation uses the verification rules. Optional AI explanation is not configured." };
  }
  const cacheKey = `${decision.id}:explanation-copy.v1:${process.env.PROOFWORK_EXPLANATION_MODEL ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  // Redacted allowlist: no names, IDs, report text, URLs or source references.
  const facts = [
    { id: "f1", name: "authorized_period_end", value: decision.facts.authorized_period_end ?? null },
    { id: "f2", name: "source_cancel_at_period_end", value: decision.facts.source_cancel_at_period_end ?? null },
    { id: "f3", name: "source_status", value: decision.facts.source_status ?? null },
    { id: "f4", name: "source_current_period_end", value: decision.facts.source_current_period_end ?? null },
    { id: "f5", name: "source_ended_at", value: decision.facts.source_ended_at ?? null },
  ];
  const input = { schema_version: "explanation-input.v1", contract_id: "subscription.cancel_at_period_end.v1", verdict: decision.verdict, reason_codes: decision.reason_codes, facts };
  const system =
    "You explain an already completed Proofwork evaluation to a support operator. Use only the structured facts and reason codes supplied. The supplied verdict is authoritative. Do not authorize, perform or recommend a different billing action or change the target date. Do not infer absent facts, customer intent, savings, refunds or absence of other charges. If evidence is unavailable, say the outcome could not be verified. Distinguish a scheduled future cancellation from an ended subscription. At most 80 words, plain text, no markdown, links or code. Return only JSON {\"summary\": string, \"fact_ids\": string[]} where every fact id exists in the input.";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.PROOFWORK_EXPLANATION_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: JSON.stringify(input) }],
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { ...deterministic, fallback_reason: "The explanation provider was unavailable." };
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { summary?: unknown; fact_ids?: unknown };
    const keys = Object.keys(parsed);
    const validIds = new Set(facts.map((f) => f.id));
    if (
      keys.some((k) => k !== "summary" && k !== "fact_ids") ||
      typeof parsed.summary !== "string" ||
      parsed.summary.length < 1 ||
      parsed.summary.length > 600 ||
      !Array.isArray(parsed.fact_ids) ||
      parsed.fact_ids.length < 1 ||
      parsed.fact_ids.some((id) => typeof id !== "string" || !validIds.has(id)) ||
      /https?:|\$|€|refund|confidence|approved/i.test(parsed.summary)
    ) {
      return { ...deterministic, fallback_reason: "The generated explanation failed validation." };
    }
    const result: ExplanationResult = { mode: "MODEL_ASSISTED", decision_id: decision.id, title: copy.title, text: parsed.summary, fact_ids: parsed.fact_ids as string[], fallback_reason: null };
    cache.set(cacheKey, result);
    return result;
  } catch {
    return { ...deterministic, fallback_reason: "The explanation provider did not respond in time." };
  }
}
