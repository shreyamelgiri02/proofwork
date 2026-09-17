# Verification contract

Contract `subscription.cancel_at_period_end.v1`, evaluator `cancel-period-end-evaluator.v1` (`packages/domain/src/evaluator.ts`).

The evaluator is pure: inputs are the authorized request, a normalized source read (or typed error) and the evaluation time. Agent report text, sentiment and model scores are **not inputs**.

## Verdicts

| Internal | UI label | Meaning |
| --- | --- | --- |
| PENDING | Waiting for verification | Accepted, not yet evaluated (task state only) |
| SATISFIED_SCHEDULED | Cancellation scheduled | Correct future cancellation observed |
| SATISFIED_ENDED | Cancellation completed | Service ended within the accepted window |
| MISMATCH | Needs action | Reliable evidence shows a material difference |
| UNVERIFIABLE | Could not verify | Reliable evidence unavailable |
| OUT_OF_SCOPE | Outside supported scope | Unsupported structure |

## Ordered rules (first match wins)

`T` = immutable authorized period end. Timestamps are truncated to whole seconds (provider precision) and compared exactly; no broader tolerance.

| # | Condition | Verdict / reason | Recovery candidate |
| --- | --- | --- | --- |
| 1 | Request missing or invalid boundary | UNVERIFIABLE / MISSING_CONTEXT | No |
| 2 | Request not ACTIVE (superseded/retired) | MISMATCH / REQUEST_NOT_ACTIVE | No |
| 3 | Timeout, unavailable, rate limited | UNVERIFIABLE / SOURCE_UNAVAILABLE (transient, retry) | No |
| 4 | 404 | UNVERIFIABLE / SOURCE_NOT_FOUND | No |
| 5 | 401/403, not configured, live mode | UNVERIFIABLE / SOURCE_ACCESS_DENIED | No |
| 6 | Malformed/incomplete payload or future observation time | UNVERIFIABLE / SOURCE_DATA_INVALID | No |
| 7 | Read older than 30 s | UNVERIFIABLE / EVIDENCE_STALE | No |
| 8 | Live mode, adapter/environment, account, customer or subscription differs | MISMATCH / IDENTITY_MISMATCH | No |
| 9 | Canceled, `ended_at` missing | UNVERIFIABLE / END_TIME_MISSING | No |
| 10 | Canceled, `ended_at` after the read | UNVERIFIABLE / END_TIME_INVALID | No |
| 11 | Canceled, `T ≤ ended_at ≤ T+300` | SATISFIED_ENDED / ENDED_ON_TIME | No |
| 12 | Canceled outside window | MISMATCH / ENDED_EARLY or ENDED_LATE | No |
| 13 | Non-ended and not: active, 1 item, complete, licensed, automatic collection, no schedule, no pause, no pending update | OUT_OF_SCOPE / UNSUPPORTED_SHAPE | No |
| 14 | `current_period_end ≠ T` | MISMATCH / PERIOD_CHANGED | No |
| 15 | `cancel_at` set and `≠ T` | MISMATCH / CONFLICTING_CANCEL_DATE | No |
| 16 | now < T, flag true | SATISFIED_SCHEDULED / CANCELLATION_SCHEDULED | No |
| 17 | now < T, flag false, no custom date | MISMATCH / SCHEDULE_MISSING | **Yes** (still gated) |
| 18 | now < T, flag false, custom date = T | MISMATCH / CANCELLATION_MODE_MISMATCH | No |
| 19 | T ≤ now < T+300, flag true | UNVERIFIABLE / FINALIZATION_PENDING (recheck at T+300) | No |
| 20 | T ≤ now < T+300, flag false | MISMATCH / SCHEDULE_MISSING | No |
| 21 | now ≥ T+300, still active | MISMATCH / NOT_ENDED | No |

## Evidence stored per decision

- `observations`: normalized snapshot (no raw provider payload), material fingerprint (excludes read time and request id), snapshot hash, provider request id, read time, adapter/environment, trigger, `discarded` flag.
- `decisions`: evaluator version, policy/request versions, verdict, reason codes, field comparison, facts, recovery candidate, gate decision, trustworthy flag, processing version.

## Historical truth

Every observation and decision is append-only. The task shows its latest decision and time; when a later read fails, the task becomes *Could not verify* and the UI states that the last trustworthy read is preserved in history and is not a guarantee of current state. A reversed schedule after a verified recovery becomes a new mismatch with `PRIOR_REVERSAL` (human review, no automatic write).

## Adapter normalization

- Sandbox: epoch seconds → ISO; `items.count/complete/usage_type`.
- Stripe (pinned `2026-08-26.dahlia`): period boundaries from the single item's `current_period_end`; `items.has_more` → incomplete; `canceled_at` (requested) and `ended_at` (service end) kept distinct; `schedule`, `pause_collection`, `pending_update` non-null → unsupported; `livemode=true` → rejected. Source account identity comes from the validated `GET /v1/account` binding.
