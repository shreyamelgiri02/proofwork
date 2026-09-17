# Proofwork — Claude master build prompt

Use this prompt in Claude Code or Claude inside your coding IDE, with the intended parent folder open. Attach **Proofwork-page-mockups.zip** as the visual reference if available. Paste everything below the divider.

The requested deliverable is a complete local application. This pass implements the app and saves all source files. **Testing comes last and is deferred in this pass.**

---

## 1. Your assignment

You are the lead product engineer, frontend engineer, backend engineer, and product designer for **Proofwork**.

Build Proofwork from scratch as a complete local web application. Own implementation across the user journey, professional interface, authentication, database, APIs, background processing, billing-source adapters, permissions, and documentation.

Project owner: **Shreya Melgiri**. This project has no HSBC or Abhishek context. Do not import their names, experience, content, or branding.

Work directly in the current coding workspace:

- If the selected directory is empty and intended for this project, use it as the project root.
- Otherwise, create a new **proofwork/** directory inside the current directory.
- If that target already contains unrelated work, use **proofwork-rebuild/**.
- Preserve existing files, source archives, Git history, and supplied reference material.
- Print the resolved absolute project path at the beginning and record it in BUILD_STATUS.md.
- Write the complete implementation to disk. Keep working until every required implementation phase below is finished or a specific external dependency is documented.
- Make reasonable routine implementation decisions and record them. Do not repeatedly ask whether to proceed.
- If the context window becomes full, save an accurate continuation checkpoint and resume from it.
- Prepare the project for a future GitHub push and Vercel web deployment, with a separately hosted worker if needed. This pass is local only; do not push or deploy.

### The build-first rule

For this pass, **implement everything first and leave testing for the final, deferred phase**.

During implementation:

- You may inspect files, read official documentation, install dependencies, generate code, and write migrations and configuration.
- You may provision the local development services needed for implementation, if the environment supports them.
- Do not run unit, integration, API, end-to-end, browser, visual, accessibility, load, or security tests.
- Do not run lint, type-checking, production build commands, smoke checks, preview walkthroughs, or automated validation as substitutes for tests.
- Do not open the app to assess how it looks or behaves during this pass.
- Do not create or execute test suites in the middle of implementation.
- Do not treat ordinary file editing or an installation succeeding as proof the app works.
- If an install command surfaces an error, fix that concrete setup error without expanding into a validation run.
- Do not alter business rules or remove functionality merely to avoid a difficult implementation.

“Build” in this pass means **write and connect the application**. Compilation, runtime verification, and acceptance testing belong to the last phase.

At the end, record **IMPLEMENTATION COMPLETE — TESTING NOT RUN**, or the truthful partial status if any requirement is unfinished. Prepare TEST_PLAN.md with the final testing sequence. Do not automatically begin that phase in this pass.

## 2. Product definition

### One-sentence purpose

Proofwork independently verifies whether an AI employee completed an authorized business action, then recovers confirmed incomplete work within explicitly granted permissions.

### Customer and operator

The customer is a customer-support leader responsible for AI employees performing business actions. The daily operator reviews exceptions, inspects source evidence, authorizes eligible recovery, and monitors verified outcomes.

### Core problem

An agent can say “done” while a subscription remains scheduled to renew. A completion message is a claim. The actual billing-system state determines whether the intended outcome happened.

### Initial supported workflow

Implement one complete workflow:

**subscription.cancel_at_period_end.v1**

The customer requests cancellation at the end of the current paid period. The request is recorded independently of the agent's completion claim. Proofwork then checks that the correct subscription has the correct cancellation scheduled for the authorized date.

The only automated recovery permitted in this workflow is to schedule that exact cancellation at the authorized paid-period end.

Keep refunds, immediate cancellations, subscription restoration, invoice changes, generic agent-building, and unrelated account updates outside the first release.

### Product promise

Every accepted claim has a traceable chain:

1. Authorized customer request.
2. Original agent report.
3. Independently read billing evidence.
4. Deterministic verification decision.
5. Recovery proposal if an allowed correction is available.
6. Human approval or an applicable automatic-recovery policy.
7. Durable write attempt.
8. Independent read after the write.
9. Persistent task and audit history.

If the source cannot be read reliably, say **Could not verify**. Never convert unknown into success.

## 3. Deliver a complete first product

“Complete” means the whole defined workflow and account journey are implemented. It does not mean adding dozens of unrelated enterprise features.

Required:

- Public homepage.
- Real email/password authentication.
- Email confirmation.
- Password recovery and reset.
- Optional Google OAuth when configured.
- Correct session return/callback behavior.
- Three-step onboarding.
- Persistent private account workspace.
- Isolated anonymous demo.
- Protected application shell.
- Task inbox and evidence details.
- Register-customer-request form.
- Agent-report submission form and authenticated ingestion API.
- Recovery proposal and approval flow.
- Activity history and CSV export.
- Honest outcome metrics.
- Workspace, policy, connection, and API-token settings.
- Background verification and recovery processing.
- Executable independent local billing sandbox.
- Implemented Stripe test-mode adapter, activated only after real configuration.
- Database migrations, seed utilities, local service configuration, and implementation documentation.
- Loading, empty, error, permission, stale-data, and unavailable-source states.

An optional AI explanation can summarize existing facts. The core product must work without an LLM key, and an LLM must never decide verification or authorize a write.

## 4. Technical architecture

Use this default architecture unless a concrete environment constraint requires an adjustment:

| Layer | Choice |
| --- | --- |
| Web application | Next.js App Router, React, TypeScript |
| Styling | Tailwind CSS, shared design tokens |
| UI primitives | shadcn/ui and Radix where appropriate |
| Icons | Lucide |
| Forms | React Hook Form with shared Zod schemas |
| Client data | TanStack Query where polling or background refresh is needed |
| Authentication | Supabase Auth |
| Database | Postgres through local Supabase for local development |
| Worker | Dedicated TypeScript process with a durable Postgres job queue |
| Local billing source | Separate TypeScript HTTP service and restricted Postgres schema |
| External billing source | Stripe test mode through a server-only adapter |
| Local email | Supabase local email capture service or another local SMTP inbox |
| Repository | One TypeScript workspace with a lockfile |
| Packaging | Local development configuration plus deployable web and worker definitions |

Resolve compatible stable dependency versions from official documentation during setup. Pin dependencies through the lockfile. Record version decisions; do not assume remembered package APIs are current.

Use one package manager consistently. Prefer npm workspaces for simple setup unless the environment already standardizes another manager.

### Suggested directory structure

~~~
proofwork/
  apps/
    web/
      src/
        app/
        components/
        features/
        lib/
    worker/
      src/
    billing-sandbox/
      src/
  packages/
    domain/
      src/
    database/
      src/
    adapters/
      src/
    ui/
      src/
  supabase/
    config.toml
    migrations/
    seed.sql
  scripts/
  docs/
  references/
  .env.example
  .gitignore
  package.json
  package-lock.json
  README.md
  DESIGN.md
  UX-CONTRACT.md
  ARCHITECTURE.md
  DATA-MODEL.md
  API-CONTRACT.md
  BUILD_STATUS.md
  TEST_PLAN.md
  CLAUDE_HANDOFF.md
~~~

Adjust the structure when necessary, but retain clear boundaries between presentation, authorized application actions, the verification engine, durable jobs, and billing-source access.

### Connection topology

- Browser → web application → authenticated, workspace-scoped application services.
- Application services → Postgres.
- Application services → durable job/outbox records.
- Worker → jobs → billing adapter → independent billing source.
- Worker → immutable observations, decisions, operation records, and audit events.
- Browser → task/status APIs for updates.
- External AI employee → scoped ingestion API → immutable claim receipt → verification job.
- Authentication → Supabase Auth.
- Password and confirmation email → configured email delivery.

The browser never holds billing secrets, service-role keys, database administrator credentials, or token-signing secrets.

The web request should persist work quickly. Verification and recovery must survive the web request finishing, a tab closing, or the worker restarting. Do not depend on a long-running function inside a Vercel request for durable execution.

## 5. Visual direction and references

Use the supplied 19 Proofwork mockups as the layout direction.

The intended feel is a calm professional product with the clarity of Apple productivity apps, the compact operational layout of Codex, and familiar desktop-app navigation. Preserve original Proofwork branding.

### Tokens

| Token | Value or rule |
| --- | --- |
| Canvas | #F5F6F8 |
| Surface | #FFFFFF |
| Primary text | #17191D |
| Secondary text | #5D6470 |
| Divider | #E4E7EB |
| Primary action | #3567E8 |
| Active navigation | Pale blue with blue text/icon |
| Verified | Green with a text label |
| Confirmed mismatch | Coral/red with a text label |
| Unknown or awaiting decision | Amber with a text label |
| Body font | Inter or a comparable clean local fallback |
| Machine identifiers | IBM Plex Mono or a monospace fallback |
| Surface radius | 8–12px |
| Control radius | 6–8px |
| Desktop sidebar | Approximately 248px |
| Top context bar | Approximately 64px |
| Main padding | Approximately 24–32px |
| Public content width | Approximately 1200px |
| Operational content width | Up to approximately 1440px |

Use borders, spacing, type hierarchy, and alignment for structure. Use restrained shadows for menus, dialogs, and floating layers. Avoid decorative gradients in the authenticated app.

### Shared shell

Desktop sidebar:

- Proofwork logo.
- Tasks.
- Approvals, with an accurate pending count.
- Activity.
- Insights.
- Settings near the bottom.
- Workspace identity at the bottom.

Top bar:

- Current location/breadcrumb.
- Clearly labeled environment: Demo, Local sandbox, or Stripe test mode.
- Applicable recovery-policy label.
- Account menu with the actual signed-in identity and sign-out.

Do not hardcode Shreya as every user. Her name identifies the project owner. Real accounts display their own profile; anonymous demo uses “Demo operator.”

Use a single logo and component system across all pages.

### Responsive behavior

- Desktop: persistent navigation and full evidence table.
- Tablet: collapsible navigation with the active route visible.
- Mobile: navigation drawer, readable task summaries, evidence sections stacked vertically, forms at full width.
- Preserve table information with a usable horizontal-scroll area or purposeful responsive row layout.
- Keep primary actions reachable.
- Do not shrink desktop text to fit a phone.
- Keep headers and controls from overlapping at narrower widths.

### Interaction requirements

- One clear primary action per task region.
- Visible form labels.
- Visible focus states.
- Semantic landmarks and headings.
- Keyboard-operable menus, dialogs, and tables where applicable.
- Dialog focus trap and focus return.
- Respect reduced-motion preferences.
- Approximately 120–180ms transitions.
- Minimum comfortable touch targets.
- Preserve entered values after a recoverable error.
- Prevent duplicate submission while a request is in progress.
- For a state-changing operation, show pending and final server-confirmed states.
- Do not optimistically mark a task verified.

### Interpret generated mockups correctly

The images are visual references. Exact data, sample names, badges, small copy, and logo details may vary.

Use the business contract in this prompt for behavior. In particular:

- A human approval permits a write; source evidence determines the outcome.
- A source-freshness threshold is not an automatic polling-frequency promise.
- Stripe test mode is connected only after server-side configuration and account validation.
- A receipt for an agent claim is not a successful verification.
- A cancellation scheduled for a future date is distinct from a subscription that has ended.
- Do not add legal, security, help, or integration links unless you implement a real destination.
- Show only measured analytics from persisted records.

If images are unavailable, continue using the design rules here. Do not block the implementation waiting for them.

## 6. Pages and routes

Implement these pages and important states.

| Reference | Route | Purpose |
| --- | --- | --- |
| 01-homepage.png | / | Explain the product and enter signup, signin, or isolated demo |
| 02-sign-in.png | /sign-in | Sign in to a real account |
| 03-create-account.png | /sign-up | Create an owner account |
| 04-confirm-email.png | /sign-up confirmation state | Explain email verification and allow resend/change-email navigation |
| 05-forgot-password.png | /forgot-password | Request a reset link |
| 06-new-password.png | /reset-password | Set a new password with a valid recovery session |
| 07-auth-callback.png | /auth/callback | Complete signin and route to the correct destination |
| 08-onboarding-workspace.png | /onboarding, step 1 | Workspace identity and timezone |
| 09-onboarding-policy.png | /onboarding, step 2 | Recovery authority |
| 10-onboarding-source.png | /onboarding, step 3 | Select and configure evidence source |
| 11-task-inbox.png | /app/tasks | Triage accepted claims and exceptions |
| 12-task-evidence.png | /app/tasks/:taskId | Inspect evidence, history, and next action |
| 13-approvals.png | /app/approvals | Review a bounded proposed change |
| 14-activity.png | /app/activity | Review and export audit events |
| 15-insights.png | /app/insights | Understand observed outcomes and human effort |
| 16-settings.png | /app/settings | Manage workspace, recovery policy, connections, and ingestion tokens |
| 17-register-request.png | /app/requests/new | Record customer authority |
| 18-submit-agent-report.png | /app/claims/new | Accept an agent's completion claim |
| 19-page-not-found.png | Unknown route | Recover from an invalid URL |

Use actual Next.js dynamic-route conventions internally while preserving these URL meanings.

A root /app visit should resolve to Tasks or onboarding as appropriate.

## 7. Authentication and access journey

### New account

1. User opens the homepage.
2. Selects Create workspace.
3. Enters name, organization, work email, and password.
4. Server creates the account through the auth provider.
5. User sees email confirmation instructions.
6. Confirmation returns to the app through a valid callback.
7. A new account enters onboarding.
8. Completed onboarding opens Tasks.

Implement provider-appropriate validation and human-readable error messages. Map provider errors to safe copy.

The confirmation page needs resend behavior with cooldown and a way to return to signup to correct an email address.

### Existing account

1. User signs in.
2. An unfinished workspace resumes onboarding.
3. An onboarded workspace opens Tasks.
4. An authorized deep link can be restored after signin.

Allow only safe internal return paths. Reject open redirects to external URLs.

### Password recovery

- Use a generic response that does not disclose whether an email exists.
- Reset links use the auth provider's intended recovery flow.
- Expired or invalid links have a clear way to request another.
- New password and confirmation have visible labels.
- Preserve secure session behavior after the password changes.
- Do not put password values into logs or analytics.

### Google OAuth

Implement the provider flow, callback, loading, cancellation, and failure handling.

Show the Google option only if configured, or render a clearly explained unavailable state. Missing OAuth credentials must not block email/password access.

### Local development

Local account flows must have a real auth service and local email capture. Do not accept any email/password combination as a pretend login.

Provide the local email-inbox instructions in README.md.

### Session and access enforcement

- Validate identity on the server using the auth provider's supported server integration.
- Enforce workspace membership/ownership on every endpoint and operation.
- A submitted workspace ID is a selector, never authorization.
- First release: one owner and one persistent workspace per account is sufficient.
- Model membership cleanly so the owner relationship is explicit.
- Avoid dead team-management or invitation controls if team collaboration is not implemented.
- Protect API routes as well as page routes.
- Secure cookies and tokens appropriately for development and production.
- Use CSRF protection or framework-supported origin/session protections for cookie-authenticated writes.
- Sign-out clears auth state and workspace-specific cached data.

## 8. Onboarding and isolated demo

### Step 1 — Workspace

Fields:

- Organization.
- Workspace name.
- Timezone.

Save progress server-side so interrupted onboarding can resume.

### Step 2 — Recovery policy

Offer:

1. **Observe only** — Read and verify; do not issue recovery writes.
2. **Require human approval** — Prepare a correction and wait for the owner.
3. **Auto-recover allowed actions** — Automatically apply only this workflow's eligible correction.

Default to Require human approval.

Explain the exact supported action in plain language. Store an immutable policy version when settings change.

### Step 3 — Evidence source

Offer:

- **Local billing sandbox**: executable source with isolated synthetic subscriptions.
- **Stripe test mode**: real test-mode adapter, available when the account is configured.

The local route must be sufficient to use the whole product without paid services.

For Stripe, a credential being present is not enough to claim a successful connection. Validate the account identity and reject production/live-mode use. During this build-only pass, connectivity remains “Not checked” until the application actually performs that check later.

Complete onboarding only when the selected source configuration is valid for the mode being used.

### Anonymous demo

Provide an Explore demo action.

- Issue a signed, httpOnly session cookie.
- Create an isolated demo workspace and isolated sandbox source records.
- Use a short expiry, such as one hour.
- Purge expired demo data through a documented job after a retention window.
- Keep demo state separate from persistent accounts.
- Label every demo page and metric.
- Provide a Reset demo action that affects only that demo workspace.
- Require a confirmation for resetting the demo's records.
- Creating an account starts a private workspace; do not silently merge demo data.

Populate synthetic subscriptions and requests with different source conditions. Generate task decisions through the actual verification engine. Never seed success verdicts or chart percentages as fixed values.

## 9. Domain entities and persistence

Create migrations, constraints, indexes, and typed domain models for these concepts.

| Entity | Required purpose |
| --- | --- |
| Profile | Auth user display information |
| Workspace | Owner, name, timezone, mode, onboarding status, retention |
| Membership | User-to-workspace relationship and owner role |
| Connection | Adapter, environment, source-account identity, health, configuration reference |
| Agent credential | Hashed scoped ingestion token, prefix, creation and revocation |
| Authorized request | Immutable customer authority and expected outcome |
| Claim receipt | Original report, identity, idempotency key, payload hash |
| Task | One workflow execution per authorized request version |
| Observation | Immutable independently fetched normalized source evidence |
| Decision | Evaluator version, verdict, reason codes, cited observations |
| Policy version | Immutable allowed action and recovery posture |
| Recovery proposal | Exact diff, expiry, request/policy/source binding |
| Approval decision | Actor, approve/reject, reason, timestamp, proposal binding |
| Operation | Durable write intent, stable key, attempts, outcome certainty |
| Job | Durable queue item, lease, retry schedule, result |
| Audit event | Append-only event with actor, correlation, and resource references |
| Intervention | Human involvement relevant to task outcome |
| Correctness review | Human audit label and evidence basis for measured acceptance errors |
| Sandbox subscription | Independently stored synthetic billing-source state |
| Sandbox operation | Source-side idempotency and mutation history |

Every domain record that belongs to a workspace must be scoped to it.

Use server timestamps in UTC and convert for display. Fix the authorized period-end instant at request creation. Do not quietly update it when source billing data changes.

Store hashes, identifiers, and normalized evidence needed for audit, while avoiding unnecessary customer personal data.

### Request immutability

An authorized request records:

- Request ID and version.
- Workflow contract version.
- Workspace and connection identity.
- Source account/customer/subscription identity.
- Source reference, such as a support ticket.
- Authorizing operator.
- Authorization timestamp.
- Expected cancellation boundary.
- The source observation used to establish that boundary.
- Status such as active, superseded, or retired.

A correction to customer intent creates a new version. Preserve the earlier version and its history.

### Database protections

- Foreign keys must prevent cross-workspace relationships.
- Add unique constraints for claim idempotency, task/request version, and provider operation keys.
- Index queues, active proposals, task filters, and audit pagination.
- Use transactions for multi-record state transitions.
- Use row locks, optimistic versions, or an equivalent documented mechanism to prevent racing recovery decisions.
- Keep source evidence and audit events append-only for ordinary application identities.
- Apply row-level security or restricted database roles as appropriate.
- A service-role connection can bypass RLS; do not rely on RLS alone when the server uses one.
- Authorization and workspace filters remain mandatory in server services.
- Do not expose unrestricted database functions to browser roles.

Document which identities can read and mutate each table.

## 10. Register an authorized customer request

Route: /app/requests/new

The form should:

1. Select a known subscription within the active source connection.
2. Capture a customer-request source reference.
3. Read the subscription through the adapter.
4. Display the current paid-period end and source-read timestamp.
5. Ask the operator to confirm that this is the customer's requested outcome.
6. Persist an immutable request with that exact expected boundary.

The server must bind the confirmation to the previewed source identity/version. If material state changes before confirmation, require a fresh preview.

Do not accept arbitrary expected dates, customers, or subscriptions supplied by a client as trusted authorization.

User-facing actions:

- Preview end date.
- Confirm request.
- Cancel.

After creation, show a clear success message and a next action to submit an agent report.

## 11. Accept the agent report

Route: /app/claims/new

Fields:

- Authorized customer request.
- Agent identity/name.
- Report text.

The report is preserved verbatim within documented size limits. Treat it as untrusted content and render it safely.

### Ingestion API

Provide an endpoint such as:

**POST /api/v1/claims**

Authenticate with a scoped, revocable ingestion token.

A request contains an authorized_request_id, agent reference, and report text. It must not let the agent define the authoritative target outcome.

Require an Idempotency-Key.

- Same key and same canonical payload: return the existing receipt/task.
- Same key with changed payload: return a conflict.
- Concurrent duplicates: database constraints guarantee one accepted record.
- Multiple reports for the same request version must not create conflicting active tasks.
- Record additional receipts according to a documented rule.

In one transaction:

1. Check token scope and request/workspace relationship.
2. Store the receipt.
3. Create or resolve the task.
4. Queue verification through a durable job/outbox record.
5. Record the audit event.

Return a clear accepted response with receipt/task IDs and a status URL. Do not return “Verified” before source evaluation occurs.

Use consistent error objects and request/correlation IDs. Provide a copyable curl example in API-CONTRACT.md with fake token placeholders.

## 12. Independent billing-source adapters

Define a typed adapter interface covering:

- Connection/account validation.
- Subscription lookup or limited listing for authorized UI selection.
- Fetching a normalized source observation.
- Applying the one supported recovery mutation.
- Resolving or reconciling an uncertain operation when provider capabilities allow it.

Normalized observations should capture enough supported facts to evaluate:

- Source account, customer, and subscription IDs.
- Subscription lifecycle status.
- Current period boundary.
- Cancellation scheduling state.
- Explicit effective cancellation time where applicable.
- Actual service end time where available.
- Provider/source version or material fingerprint.
- Read time and provider request identifier.
- Environment: synthetic sandbox or Stripe test mode.

### Local billing sandbox

Implement it as a separate local HTTP service with independently persisted state.

- The verification engine reads source evidence through HTTP.
- The agent-report endpoint cannot modify source state.
- Only the recovery identity can call the allowed source mutation endpoint.
- Scenario setup/reset uses a separate restricted mechanism.
- Separate application tables from billing-source tables and credentials.
- The source maintains idempotency records so retried identical operations return the same result.
- Persist state across application and worker restarts.
- Support deterministic scenario configuration for eventual final testing.
- Never embed expected answers into the verification endpoint.

Implement scenario controls available only in demo/development:

- Missing cancellation schedule.
- Cancellation already scheduled correctly.
- Subscription correctly ended.
- Source temporarily unavailable.
- Source mutation rejected.
- Mutation applied but response lost.
- Material source change before approval.
- Wrong source/customer identity.
- Unsupported subscription structure.
- Expired approval.
- Changed policy or write pause.
- Two competing recovery requests.

These are capabilities to implement now and exercise in the final testing phase.

### Stripe test-mode adapter

Implement real server-side reads and the bounded cancellation update against Stripe's supported test-mode API.

- Use official current documentation for field meanings and mutation/idempotency behavior.
- Pin an explicit provider API version where supported and record it.
- Reject live/production credentials and live-mode resources.
- Bind every connection to a verified test account identity.
- Keep credentials server-side and out of logs.
- Re-read the actual resource to confirm the result after writing.
- Distinguish the time cancellation was requested from the actual effective service end.
- Normalize provider fields carefully rather than assuming similarly named timestamps mean the same thing.
- Detect unsupported scheduling/configuration cases and return Outside scope.
- If the API cannot perform the exact authorized correction, escalate instead of approximating.

With no Stripe credentials, the adapter remains Configured: no / Connection: not checked. The local sandbox continues to support the complete product journey.

Do not use a fake successful Stripe response as the fallback.

## 13. Deterministic verification contract

Use a pure, versioned evaluator. Store the inputs and reason codes for each decision.

Keep verification verdict separate from recovery-operation status.

### Verdicts

| Internal verdict | UI label | Meaning |
| --- | --- | --- |
| PENDING | Waiting for verification | Accepted but not yet evaluated |
| SATISFIED_SCHEDULED | Cancellation scheduled | Correct future cancellation is independently observed |
| SATISFIED_ENDED | Cancellation completed | Supported evidence shows service ended at the authorized boundary |
| MISMATCH | Needs action | Reliable evidence confirms a material difference from the authorized outcome |
| UNVERIFIABLE | Could not verify | Reliable evidence is unavailable |
| OUT_OF_SCOPE | Outside supported scope | The source structure or requested workflow is unsupported |

### Evaluation order

1. Establish source-read success and sufficient trustworthy evidence.
2. Validate source account, customer, and subscription identity.
3. Confirm the workflow and source structure are supported.
4. Compare the authorized boundary and lifecycle evidence.
5. Decide scheduled, ended, mismatch, or unverifiable using explicit rules.
6. Derive eligible next actions separately from the verdict.

Examples:

- Timeout or provider authentication failure: UNVERIFIABLE, no recovery write.
- Malformed or materially incomplete source response: UNVERIFIABLE.
- A 404 without reliable deletion/lifecycle evidence: UNVERIFIABLE; do not infer successful cancellation.
- Wrong customer or subscription in a reliable response: identity mismatch with recovery blocked.
- Supported active subscription, future authorized boundary, correct schedule: SATISFIED_SCHEDULED.
- Correctly ended subscription at the authorized boundary with adequate evidence: SATISFIED_ENDED.
- Early termination: MISMATCH; no automatic restoration.
- Missing cancellation schedule with the rest of the identity and boundary intact: MISMATCH; possibly eligible for the bounded recovery.
- Source period boundary changed from the authorized boundary: MISMATCH; manual investigation.
- Unsupported subscription schedule, linked structure, or semantics: OUT_OF_SCOPE.

Define timestamp comparison using provider precision and a narrow documented normalization rule. Do not invent a broad tolerance that hides a wrong date.

An agent's narrative confidence, sentiment, or model score has no effect on the decision.

### Historical truth

Keep every observation and decision.

The task shows its latest trustworthy assessment and when it was checked. If a later source read fails, show the latest verification as unverifiable/stale while preserving the prior observation as history.

A past successful check is not a guarantee of the current source state.

## 14. Safe recovery and approval

Recovery is eligible only when all required conditions hold:

- An active authorized request exists.
- Reliable evidence identifies the expected source account, customer, and subscription.
- The only correction needed is the supported cancellation schedule.
- The authorized boundary has not materially changed.
- The request is sufficiently far from the period-end cutoff.
- Current policy permits the write.
- Writes are not paused.
- No unresolved operation already owns the same recovery/resource.
- Approval is present and valid if required.

Use explicit defaults such as:

- Source freshness budget: 10 seconds.
- Proposal/approval validity: 15 minutes.
- No new automatic write within 120 seconds of the authorized boundary.

Make these policy values documented and server-enforced. Do not confuse the freshness budget with a polling cadence.

### Proposal binding

A recovery proposal binds:

- Request ID/version.
- Task.
- Source connection/account and subscription identity.
- Exact before/after diff.
- Material source fingerprint.
- Policy version.
- Expiry.
- Proposed action type.

Show those details in human language.

### Human decision

The approval page shows:

- Customer and subscription.
- Requested outcome.
- Observed mismatch.
- Exact proposed change.
- Fields that remain unchanged when relevant.
- Expiry.
- Decision reason.
- Approve and apply / Reject / Open task.

The server validates the actor and proposal. A stale, expired, superseded, or policy-invalid proposal cannot be applied.

Record both approvals and rejections. Rejecting a proposal does not change the verification verdict into success.

### Automatic mode

Use the same proposal, guards, operation records, and post-write verification as human-approved mode. Replace only the human-decision requirement with a recorded applicable policy authorization.

Re-check policy at dispatch time. A prior proposal cannot bypass a newly paused or changed policy.

### Durable operation execution

1. Persist an operation intent before contacting the source.
2. Assign a stable operation/idempotency key.
3. Reserve the resource under a transaction/lock.
4. Fetch a fresh observation when required.
5. Revalidate authority, policy, source fingerprint, cutoff, and identity.
6. Dispatch the exact allowed mutation.
7. Persist the response or uncertainty.
8. Read the source independently.
9. Update the task based on that read.
10. Record complete audit history.

Do not claim exactly-once delivery across a network. Use durable intent, source-supported idempotency, and reconciliation.

### Ambiguous write outcomes

A timeout after dispatch can mean the write happened.

- Mark the operation outcome uncertain.
- Reconcile by reading source state and consulting source-side operation history where available.
- Do not issue a new operation key for the same unresolved intent.
- Do not blindly repeat a non-idempotent write.
- Retrying a provider-supported idempotent request uses the original key.
- Block competing recovery mutations while an operation remains unresolved.
- If source state matches but attribution is unclear, record the task outcome and the operation uncertainty separately.
- Do not claim Proofwork recovered the task when the evidence only proves that someone or something corrected it.
- If safe reconciliation cannot resolve uncertainty, request human intervention.

### Recovery states

Represent states such as:

PROPOSED → AWAITING_APPROVAL → AUTHORIZED → PREPARED → DISPATCHED → AWAITING_VERIFICATION → VERIFIED

Also support:

REJECTED, EXPIRED, BLOCKED, FAILED_CONFIRMED, OUTCOME_UNKNOWN, and RESOLVED_EXTERNALLY where appropriate.

Document transitions. Do not infer a verified business outcome from HTTP 200 alone.

## 15. Background jobs and concurrency

Implement durable jobs for:

- First verification after claim ingestion.
- Operator-requested recheck.
- Eligible recovery execution.
- Post-write verification.
- Unknown-outcome reconciliation.
- Rechecking scheduled cancellations near/after the authorized boundary.
- Demo cleanup.
- Necessary connection-health refresh.

Use leases and recoverable ownership. A crashed worker must not leave a permanent “Processing” state.

Implement:

- Atomic job claim.
- Lease expiry and heartbeat where needed.
- Bounded attempts with backoff and jitter.
- Error classification: retryable, permanent, uncertain mutation.
- Resource concurrency control.
- Fair workspace handling.
- Durable correlation IDs.
- Safe cancellation/supersession rules.
- A clear final failed/manual-review state after exhausted safe retries.

A Postgres queue using transactional row locking is sufficient. Do not add a message broker without a concrete need.

Preserve an unresolved dispatched operation even if a user retires its task or changes the request. Stop new writes, retain history, and continue the safe reconciliation required to determine what happened.

Polling in the browser is acceptable for this release. Poll actual persisted state and slow down or stop when appropriate. Do not simulate progress with arbitrary timers.

## 16. Task inbox and evidence experience

### Tasks

Provide:

- Useful heading and one-sentence explanation.
- Register request and Submit report actions.
- Search by customer, subscription, request, or agent.
- Status filters.
- Date/cohort filter with documented meaning.
- Server-side pagination.
- Accurate counts based on the same filter/cohort.
- Priority exception section when relevant.
- Clear links into task details.
- A helpful empty state.

Avoid decorative charts when a table answers the operator's question faster.

Each row should communicate:

- Customer/subscription.
- Agent identity.
- Verification result.
- Next action.
- Last checked time.
- Whether source evidence is stale.

### Task details

Present evidence in this order:

1. Authorized customer request.
2. Agent report.
3. Observed billing state.
4. Field-by-field comparison.
5. Verification reason.
6. Allowed next action.
7. Event chronology.

Include:

- Current verdict and separate operation state.
- Source environment and account.
- Read timestamp.
- Expected versus observed values.
- Plain-language explanation.
- Check now.
- Review proposal / Approve where appropriate.
- Explicitly blocked-action reason.
- Expandable technical evidence for operators who need it.
- Copy controls for useful identifiers.

Show request, claim, and observation as separate facts. Do not place a success check beside the agent's report in a way that implies the business action was independently verified.

## 17. Activity, intervention, and exports

Activity supports:

- Date range.
- Event-type filter.
- Task/customer search.
- Actor identity.
- Paginated event history.
- Links to related task/proposal.
- CSV export of the selected scope.

Audit events include:

- Who or what acted.
- Workspace.
- Event type.
- Resource IDs.
- UTC timestamp.
- Correlation/request ID.
- Before/after values where appropriate.
- Policy and evaluator versions when relevant.
- Safe error/reason codes.

Redact secrets and unnecessary personal data. Escape user-controlled content in CSV to prevent spreadsheet formula execution.

Record human intervention separately from background processing:

- Approval.
- Rejection.
- Manual correction reported or observed.
- Manual escalation/resolution.
- Adjudicated correctness review.

Keep setup and initial customer-request registration visible in the audit trail. If the autonomy metric starts after request registration, state that exclusion clearly rather than claiming the whole customer journey required no human effort.

## 18. Insights and metric definitions

Use persisted records, server-side aggregation, and explicit denominators.

Required:

- Accepted unique tasks.
- Cancellation scheduled correctly.
- Cancellation completed.
- Needs action.
- Could not verify.
- Outside supported scope.
- Verified outcomes without human intervention during the defined execution window.
- Recovery attempts and recoveries independently verified.
- Human interventions.
- Pending work.

### Main outcome metric

**Verified intended outcome without human intervention / accepted unique tasks in the selected cohort**

Define:

- Cohort by task acceptance time in the selected date range.
- Status as of the displayed calculation time.
- One task per authorized request version.
- The exact intervention types that disqualify autonomous completion.
- Initial request-registration/setup exclusion, visibly explained.
- Unverifiable and unresolved tasks stay in the denominator.
- Outside-scope counts are visible. If an additional eligible-task rate is shown, display its different denominator explicitly.

Do not hide difficult cases to improve the percentage.

### Incorrectly accepted completions

A source-based verifier is not automatically its own correctness audit.

Show **Not measured** until independent adjudication labels exist.

When labels exist, define a measured false-acceptance rate such as:

**Adjudicated incorrect accepted outcomes / adjudicated accepted outcomes**

Show sample size, coverage, review period, and who reviewed them. Do not equate “no known incidents” with “0% error.”

### Metric integrity

- Show counts beside percentages.
- Keep demo cohorts separate from private or Stripe test cohorts.
- Separate direct verification from a correction attributable to Proofwork.
- Keep human-approved recovery distinct from autonomous recovery.
- Do not fabricate revenue saved, hours saved, confidence scores, growth charts, or benchmark comparisons.
- Use meaningful empty states when there is no data.

## 19. Settings

Create understandable sections:

### Workspace

Organization, workspace name, timezone, owner identity.

### Recovery policy

Observe only / Require approval / Auto-recover allowed actions.

Changing policy creates a new version and invalidates incompatible active proposals.

### Write pause

Stop future recovery dispatch while continuing safe reads and reconciliation. Explain the effect on already-dispatched operations.

### Evidence source

- Selected adapter and environment.
- Account identity.
- Connected / Disconnected / Not checked / Error.
- Last successful read time.
- Credential update or configuration instructions.
- Clearly separated simulated billing and Stripe test mode.

No raw secrets should be revealed after saving.

### Agent ingestion

- Create a scoped token.
- Show it once.
- Display token prefix, scope, creation, last use, and revoked state.
- Revoke token.
- Copy endpoint and example payload.

Tokens must be cryptographically generated, hashed at rest, and bound to the workspace.

### Account

Display current account identity and appropriate sign-out/account-recovery navigation.

### Operations

Keep operating limits and source/worker health in a secondary section. Show actual state and useful recovery guidance. Do not place development-only release-status checklists in the ordinary customer workflow.

## 20. API and application-service boundaries

Implement consistent server-side actions/endpoints for at least:

- Session/workspace resolution.
- Onboarding progress and completion.
- Workspace profile.
- Policy versions and pause control.
- Connection configuration/status.
- Scoped token creation/revocation.
- Subscription preview.
- Authorized request creation.
- Claim ingestion.
- Task list and detail.
- Recheck request.
- Proposal creation/read.
- Approval/rejection.
- Activity and export.
- Insights.
- Demo creation/reset.

Document method, route, auth, input, output, errors, idempotency, and rate limits.

Use a standard error shape containing a safe code, human message, optional field errors, and correlation ID.

Do not return a provider stack trace to the browser.

Separate:

- Bad form/input.
- Authentication required.
- Permission denied.
- Resource missing.
- Conflict/stale version.
- Rate limit.
- Source unavailable.
- Internal error.

Validate input on the server, even when the frontend already validates it.

## 21. Security and data boundaries

Implement safeguards required by the actual product:

- Authenticated and workspace-scoped reads/writes.
- Trusted server-side authority for request creation.
- Least-privilege source identities.
- Server-only provider credentials.
- Hashed ingestion tokens.
- CSRF/origin defenses for cookie-based state changes.
- Secure callback and redirect allowlists.
- Payload size limits.
- Rate limits for auth-sensitive and ingestion endpoints.
- Safe rendering of agent reports and source references.
- No arbitrary URL fetching from report text or ticket references.
- Secret redaction in logs and exports.
- Parameterized queries.
- Append-only audit/evidence records for application identities.
- Environment isolation so demo access cannot reach other workspaces or Stripe credentials.
- Explicit production/live-mode rejection in the Stripe adapter.
- No unauthenticated worker dispatch endpoint.
- Restricted development scenario endpoints.

If optional AI explanations are included, treat report/source text as untrusted input. The model has no tool access to billing mutations and cannot change policy, verdicts, or proposals.

Store only the minimal necessary personal data. Document retention and deletion behavior for persistent and demo workspaces.

## 22. Local setup and developer experience

Provide a documented local setup that does not require a paid account.

Include:

- Runtime prerequisites.
- Dependency install command.
- Local Supabase configuration.
- Billing sandbox and worker configuration.
- Schema migrations.
- Reproducible synthetic seed utilities.
- Local email inbox.
- Environment-variable examples with safe placeholders.
- Commands to start web, worker, and sandbox.
- Commands to stop services.
- Local reset instructions with clear data-loss scope.
- Troubleshooting for missing Docker, ports, or credentials.

Choose and document nonconflicting ports.

### Environment variables

Document, as appropriate:

- Public application URL.
- Public Supabase URL and publishable key.
- Server-only Supabase/service connection values.
- Database URL for the relevant service role.
- Demo-cookie signing secret.
- Sandbox API URL.
- Sandbox read/write credentials.
- Stripe test-mode secret or encrypted credential-store key.
- Optional Google OAuth configuration.
- Optional AI explanation provider configuration.
- Worker concurrency and safe operational limits.

Do not generate or commit real secrets. Use a local secret-generation utility when useful. Keep local environment files ignored.

If Docker or an external credential is unavailable, still write all source, migrations, service definitions, and setup docs. Record that dependency as **Requires setup**. Do not switch to insecure auth or in-memory persistence to make the limitation disappear.

## 23. Seeded example journey

Implement a coherent sample dataset with fictional organizations such as:

- Rivera Logistics: cancellation schedule missing.
- Northwind Studio: correct cancellation already scheduled.
- Corvid Health: source unavailable.
- Brightsea Media: confirmed mismatch.
- Halden Press: cancellation already ended correctly.
- Atlas Metering: unsupported source structure.

Use relative dates derived from a controllable clock, so the demo remains meaningful after today.

A typical demonstration should be possible through real UI actions:

1. Open an isolated demo or sign into a local workspace.
2. Register a customer request.
3. Submit a report claiming cancellation is complete.
4. Worker reads the independent source.
5. Task shows Needs action.
6. Operator opens the evidence comparison.
7. Operator reviews the exact permitted change.
8. Operator approves it.
9. Worker applies the change with a stable operation key.
10. Worker reads the source again.
11. UI shows Cancellation scheduled with new evidence.
12. Activity shows the complete chain.
13. Insights derives updated counts from the same records.

Also implement the source-unavailable scenario so it remains Could not verify.

Creating this capability is part of implementation. Do not execute the walkthrough during this build-only pass.

## 24. Optional explanation layer

Only after all required implementation is present, you may add a compact “Why this result?” explanation.

Prefer deterministic reason-to-copy mappings first.

If a model adapter is included:

- Off by default.
- Server-side only.
- Strict structured output.
- Short timeout.
- Cite existing observation fields.
- No new facts.
- No verdict changes.
- No action execution.
- Deterministic fallback on errors or missing credentials.

Do not turn the product into a generic chat interface.

## 25. Implementation order

Complete the implementation in this order. Maintain BUILD_STATUS.md after each phase.

### Phase 0 — Workspace and foundations

- Resolve the project directory.
- Read applicable project instructions.
- Inspect supplied mockups/reference documents.
- Record scope and assumptions.
- Resolve dependency compatibility from official sources.
- Create the workspace, environment examples, and documentation skeleton.

### Phase 1 — Domain and database

- Define versioned contracts and domain types.
- Write schema, constraints, indexes, and migrations.
- Implement application database access and workspace scoping.
- Implement immutable requests, receipts, observations, decisions, and audit events.
- Implement the durable queue and operation ledger.

### Phase 2 — Authentication and account journey

- Real authentication.
- Email confirmation.
- Recovery and reset.
- Optional OAuth.
- Callback routing.
- Workspace membership.
- Onboarding.
- Isolated demo and persistence boundaries.

### Phase 3 — Source and engine

- Independent billing sandbox.
- Stripe test-mode adapter.
- Deterministic evaluator.
- Claim ingestion.
- Recovery eligibility.
- Proposals and approvals.
- Worker execution and leases.
- Idempotency, concurrency, unknown outcomes, and reconciliation.
- Reverification and lifecycle jobs.

### Phase 4 — Complete interface

- Shared tokens and app shell.
- All 19 referenced pages/states.
- Responsive layouts.
- Empty/loading/error/permission states.
- Real forms and API connections.
- Search, filters, pagination, and navigation.
- Evidence comparison and activity chronology.

### Phase 5 — Reporting and operations

- Insights and denominators.
- Intervention and correctness-review records.
- CSV export.
- Settings.
- Connection health.
- Scoped ingestion tokens.
- Write pause.
- Demo cleanup.
- Safe logging and operational configuration.

### Phase 6 — Integration and handoff preparation

- Finish every UI-to-service connection.
- Remove unfinished required-path stubs.
- Ensure every visible action has an implementation and meaningful state.
- Write setup and deployment architecture documentation.
- Record environment-dependent setup.
- Save all source files and continuation notes.
- Prepare a source ZIP if the environment supports artifact output, excluding secrets, dependencies, database volumes, and build output.

This phase is implementation work. Do not turn it into a test or preview session.

### Phase 7 — Final testing, deferred

Create TEST_PLAN.md covering the gates below. Leave every result **NOT_RUN** in this pass.

Do not begin Phase 7 automatically.

## 26. Final testing plan to prepare

Write concrete scenarios and expected results, with no fabricated outcomes.

### A. Static and build gates

Dependency consistency, type checking, lint, production compilation, environment validation, and migration execution against a clean disposable local database.

### B. Authentication journey

Signup, email confirmation, resend, signin, signout, invalid credentials, password reset, expired link, OAuth cancellation, callback handling, authorized deep links, and session expiry.

### C. Workspace isolation

Two users cannot read each other's requests, claims, tasks, evidence, connections, tokens, or approvals. Demo cannot access a private workspace. Forged workspace IDs do not change authorization.

### D. Verification correctness

Correct schedule, correct ended state, missing schedule, early cancellation, changed boundary, wrong identity, unsupported source, missing fields, 404, provider denial, timeout, stale observation, and later source regression.

### E. Recovery behavior

Observe-only blocks writes, approval is required, valid approval works, rejection persists, expiry blocks, policy change invalidates, write pause blocks, cutoff blocks, source drift blocks, post-write read confirms, provider response alone does not verify.

### F. Durable execution

Duplicate claim, same key/different payload, concurrent approval, duplicate job delivery, worker restart before/after dispatch, lease expiry, source applies then response is lost, provider idempotency replay, uncertain operation blocks competing mutation, reconciliation preserves attribution uncertainty.

### G. Interface and accessibility

All routes, browser navigation, keyboard interaction, dialogs, forms, loading/error/empty states, account menu, narrow screens, readable evidence, non-color status cues, reduced motion, and readable contrasts.

### H. Reporting

Consistent cohort filters, denominators, intervention counting, demo separation, unknown cases retained, no-data states, correctness shown as Not measured without labels, accurate CSV scope, and safe CSV escaping.

### I. External sandbox

Use actual Stripe test credentials only in the later test phase. Confirm read/write/confirm behavior against test subscriptions and verify that live-mode resources are rejected.

### J. Release readiness

Only after local acceptance passes: secrets configuration, worker deployment topology, migration process, queue monitoring, backups, and deployment smoke checks. Do not label the untested implementation production-ready.

## 27. Documentation to leave in the project

Write useful, project-specific documents:

1. **README.md** — What Proofwork does and how to set it up locally.
2. **DESIGN.md** — Tokens, typography, components, layout, responsive behavior.
3. **UX-CONTRACT.md** — Account journey, page states, navigation, permission behavior.
4. **ARCHITECTURE.md** — Components, service connections, durable execution, trust boundaries.
5. **DATA-MODEL.md** — Entities, relationships, constraints, workspace scoping, retention.
6. **API-CONTRACT.md** — Routes, schemas, authentication, idempotency, errors, examples.
7. **VERIFICATION-CONTRACT.md** — Ordered decision rules and evidence requirements.
8. **RECOVERY-CONTRACT.md** — Authority, policy, proposal binding, concurrency, uncertainty.
9. **METRICS.md** — Cohorts, denominators, intervention scope, correctness measurement.
10. **LOCAL-SETUP.md** — Complete local service and environment instructions.
11. **USER-GUIDE.md** — Plain-language instructions for using the app.
12. **TEST_PLAN.md** — Final deferred testing plan with NOT_RUN results.
13. **BUILD_STATUS.md** — Truthful implementation/configuration/validation ledger.
14. **CLAUDE_HANDOFF.md** — Decisions, file locations, blockers, and continuation checkpoint.

Use compact diagrams only where they clarify architecture or state transitions. Keep the documents aligned with the source you actually wrote.

### Build-status format

Keep separate columns:

| Requirement | Implementation | Configuration | Validation | Notes |
| --- | --- | --- | --- | --- |
| Example feature | Complete / Partial / Missing | Ready / Requires setup / Not applicable | NOT_RUN | Concrete file or dependency |

A complete implementation can still require credentials. A configured component is not automatically validated.

## 28. Final handoff format

When implementation is finished, respond with:

1. Absolute project folder.
2. Concise list of the implemented product areas.
3. Any incomplete required work, named precisely.
4. Setup prerequisites still needed.
5. Commands for the user to start the local services.
6. Paths to README.md, BUILD_STATUS.md, USER-GUIDE.md, and TEST_PLAN.md.
7. Source ZIP location if created.
8. Explicit statement: **Testing has not been run. The final testing phase is prepared and deferred.**

Do not say “all tests pass,” “fully verified,” “production-ready,” or “works perfectly” without running the later phase and recording actual evidence.

Start now by resolving the project folder, creating BUILD_STATUS.md, and implementing Phase 0. Continue through Phase 6 without stopping after a plan or scaffold.

