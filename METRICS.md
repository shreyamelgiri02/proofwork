# Metrics

Implementation: `packages/database/src/insights.ts`, UI `apps/web/src/features/insights`. All values are computed on request from persisted rows of **one workspace** (demo cohorts never mix with private or Stripe cohorts). Every rate is shown with its numerator and denominator; nothing is seeded or estimated.

## Cohort

- Membership: tasks whose agent report was **accepted** (`tasks.created_at`) within the selected range (7 d / 30 d / 90 d / all).
- Status: latest recorded decision **as of the calculation time** (displayed).
- Unit: one task per authorized request version. Duplicate receipts, retries, monitoring reads and recovery attempts never add tasks.
- Tasks page counts use the same cohort definition plus the active search.

## Outcome counts

Accepted tasks; Cancellation scheduled (SATISFIED_SCHEDULED); Cancellation completed (SATISFIED_ENDED); Needs action (MISMATCH); Could not verify (UNVERIFIABLE); Outside supported scope (OUT_OF_SCOPE); Waiting (PENDING).

## Main metric

**Verified intended outcome without human intervention / accepted unique tasks in the cohort**

- Numerator: latest verdict SATISFIED_SCHEDULED or SATISFIED_ENDED, request still ACTIVE, and **no** `interventions` row for the task at or after acceptance.
- Denominator: all accepted tasks in the cohort — unverifiable, unresolved, retired and outside-scope tasks stay in.
- Intervention window starts at report acceptance. Registering the customer request and submitting the initial report are **excluded** (explained in the UI).
- Disqualifying interventions: `MANUAL_VERIFY` (Check now), `PROPOSAL_REQUESTED`, `APPROVAL_APPROVED`, `APPROVAL_REJECTED`, `REQUEST_SUPERSEDED`, `REQUEST_RETIRED`, `EXTERNAL_REPAIR_RECORDED`, `MANUAL_ESCALATION`, `MANUAL_RESOLUTION`, `TASK_RETIRED`. Reading evidence, exporting and adding correctness reviews do not count. Source changes by unknown actors cannot be attributed.

Secondary rates (explicit denominators): resolved with observed evidence (satisfied / all); excluding outside scope (satisfied / all − outside scope); evidence availability (tasks with a trustworthy read / all).

## Recovery and effort

- Recovery attempts: distinct tasks with an operation whose `dispatch_count > 0`.
- Recoveries verified: distinct tasks with an operation `VERIFIED` and attribution `PROOFWORK` (i.e. confirmed by a later independent read), split into human-approved vs auto-policy.
- Corrected, attribution unclear (`RESOLVED_EXTERNALLY`), rejected by source (`FAILED_CONFIRMED`) and unresolved operations are shown separately — a correction is never credited to Proofwork without evidence.
- Human interventions: tasks with ≥ 1 intervention and total intervention events.
- Pending work: waiting, awaiting approval, unresolved operations, exhausted jobs, retired.

## Incorrectly accepted completions

- Population: satisfied decisions of cohort tasks.
- Label: latest `correctness_reviews` row per decision (ordered by created_at, id).
- Rate: `INCORRECT / (CORRECT + INCORRECT)`; `INSUFFICIENT_EVIDENCE` shown separately.
- Shown as **Not measured** until at least one conclusive label exists; otherwise also shows sample size, coverage (reviewed / eligible), review period and reviewers. "No known incidents" is never shown as 0%.

## Not reported

Revenue saved, hours saved, confidence scores, growth trends and benchmarks are deliberately absent.
