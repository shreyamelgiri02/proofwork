# Proofwork user guide

> This guide describes the implemented application. Its behavior has **not yet been tested**; see TEST_PLAN.md.

## What Proofwork does

When an AI employee says it scheduled a customer's subscription to cancel at the end of the paid period, Proofwork checks the billing record itself. It tells you whether the cancellation is really scheduled, has already ended, needs action, or could not be verified — and, if only the schedule is missing, it can apply that one fix within the authority you set.

## Try the demo

1. Open the homepage and choose **Explore live demo**.
2. The yellow banner confirms **Demo · Simulated billing data**. Your demo is private to this browser session for about an hour.
3. Six example tasks appear and are verified by the background worker within a few seconds.
4. Open **Rivera Logistics** (Needs action). Compare the authorized request, the agent's report and the observed source.
5. Choose **Review recovery proposal**, read the exact change, and select **Approve and apply**.
6. The task first shows *Recovery in progress*. After Proofwork reads the source again it shows **Cancellation scheduled**.
7. Open **Activity** to see the full chain, and **Insights** for counts with denominators.
8. **Corvid Health** shows how an unreachable source stays *Could not verify*.
9. Open **Scenario library** at the bottom of Tasks to create more situations (lost write response, rejected write, expired approval, competing recovery…). **Reset demo** starts over.

## Set up your workspace

1. **Build your workspace** → enter your name, organization, work email and password.
2. Open the confirmation email (locally: http://127.0.0.1:54324).
3. **Workspace:** organization, workspace name, timezone.
4. **Recovery policy:** Observe only, Require human approval (recommended), or Auto-recover allowed actions.
5. **Evidence source:** Local billing sandbox (synthetic records) or Stripe test mode (only when configured by the deployment owner).

## Result labels

| Label | Meaning | What to do |
| --- | --- | --- |
| Waiting for verification | Report accepted; source not read yet | Wait |
| Cancellation scheduled | Source shows the period-end cancellation | Nothing; Proofwork checks again near the end date |
| Cancellation completed | Source shows the subscription ended at the authorized time | Nothing |
| Needs action | Source differs from the authorized request | Review the proposal or handle manually |
| Could not verify | Source unavailable or evidence incomplete | Wait for retries or use Check now |
| Outside supported scope | Unsupported subscription structure | Handle manually |

A subscription can stay active while its cancellation is correctly scheduled.

## Register a customer request

Tasks → **Register request** → choose the subscription → enter the support ticket reference → **Preview end date** → tick the confirmation → **Confirm request**. The date comes from the source, not from you, and is fixed for this request version. If the customer's intent changes, register a corrected version.

## Submit the agent's report

Tasks → **Submit report** → choose the authorized request → agent name → report text → **Submit report**. Integrated agents use an ingestion token (Settings → Agent ingestion) and `POST /api/v1/claims`.

## Approve or reject a fix

Approvals shows the customer, subscription, effective date, the one changed field (`cancel_at_period_end: No → Yes`), unchanged fields and the expiry (15 minutes). **Approve and apply** records your approval and queues the fix; the result appears only after a new source read. **Reject** requires a reason and leaves the verification result unchanged.

## Pause, policy and tokens

Settings lets you change the policy (a new version invalidates older proposals), **Pause recovery writes** (verification continues; already-dispatched writes may still complete and are reconciled), check evidence sources, and create or revoke ingestion tokens (shown once).

## Other task actions

- **Check now** — request a fresh read.
- **Stop monitoring** — stop routine checks; history and verdict stay.
- **Record intervention** — note manual work done elsewhere.
- **Add correctness review** — label a recorded decision; this powers *Incorrectly accepted completions* in Insights.

## Troubleshooting

| You see | Why | Next step |
| --- | --- | --- |
| Requires setup | Services not configured | Follow LOCAL-SETUP.md |
| Tasks stay waiting | Worker not running | Settings → Operations |
| Proposal expired | 15 minutes passed | Open the task → Check now |
| "The subscription changed" | Source changed after the proposal | Review the new evidence |
| Demo expired | Session ended | Start a new demo |
