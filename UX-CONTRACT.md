# UX contract

## Routes

| Mockup | Route | Implementation |
| --- | --- | --- |
| 01 | `/` | `app/page.tsx` |
| 02 | `/sign-in` | `app/(auth)/sign-in` + `features/auth/sign-in-form.tsx` |
| 03 | `/sign-up` | `app/(auth)/sign-up` + `sign-up-form.tsx` |
| 04 | `/sign-up` confirmation state | `ConfirmEmailState` (resend with 60 s cooldown, change email) |
| 05 | `/forgot-password` | `password-forms.tsx` (generic response; expired-link banner) |
| 06 | `/reset-password` | Requires recovery session; otherwise redirects to `/forgot-password?expired=1` |
| 07 | `/auth/callback` | `features/auth/auth-callback.tsx` |
| 08–10 | `/onboarding` steps 1–3 | `features/onboarding/onboarding-wizard.tsx` |
| 11 | `/app/tasks` | `features/tasks/tasks-page.tsx` |
| 12 | `/app/tasks/[taskId]` | `features/tasks/task-detail-page.tsx` |
| 13 | `/app/approvals` | `features/approvals/approvals-page.tsx` |
| 14 | `/app/activity` | `features/activity/activity-page.tsx` |
| 15 | `/app/insights` | `features/insights/insights-page.tsx` |
| 16 | `/app/settings` | `features/settings/settings-page.tsx` |
| 17 | `/app/requests/new` | `features/requests/register-request-page.tsx` |
| 18 | `/app/claims/new` | `features/claims/submit-report-page.tsx` |
| 19 | unknown | `app/not-found.tsx` |

`/app` redirects to Tasks; the app layout sends unfinished private workspaces to onboarding.

## Account journeys

- **New account:** Home → Build your workspace → Sign up (name, organization, email, password) → confirmation screen → email link → `/auth/callback` → onboarding (resumes at the saved step) → Tasks.
- **Returning:** Sign in → onboarding if unfinished, else safe `next` or Tasks. Deep links survive sign-in via `?next=` (internal `/app`, `/onboarding`, `/reset-password` only).
- **Password recovery:** Forgot → email → callback (recovery) → Choose a new password → Tasks. Expired/invalid links offer a new request.
- **Google:** shown enabled only when configured; cancellation returns to sign-in with a message; failures show safe copy.
- **Demo:** Explore live demo → signed cookie → Tasks with starter scenarios. Every app page shows the "Demo · Simulated billing data" banner with expiry and a confirmed Reset. Expired demo shows "This demo session expired" with Start a new demo. Signing in or signing up clears the demo cookie; demo data is never merged.
- **Sign out:** clears auth cookies, demo cookie and all cached client data.

## Page states

| Page | Loading | Empty | Error | Other |
| --- | --- | --- | --- | --- |
| Tasks | Row skeletons | "No reports yet" with Register/Submit; "No tasks match" with Clear filters | Retry alert | Priority exception card; stale evidence note; live polling while work is in flight |
| Task evidence | Skeleton | Not-read-yet evidence card | Not found (same for inaccessible) / retry | Could-not-verify-after-trusted banner; retired; request inactive; blocked reason; operation progress; scenario controls (demo/dev) |
| Approvals | Skeleton | "Nothing is waiting" | Retry | Live expiry countdown; expired; stale/changed → error + refresh; writes paused notice; decided read-only view |
| Activity | Skeleton | "No activity in this scope" | Alert | Day grouping; task filter chip; CSV of exact scope |
| Insights | Skeleton | "No data for this cohort" | Alert | Correctness "Not measured" |
| Settings | Skeleton | Tokens empty row | Alert | Dirty indicator; demo read-only identity; Stripe instructions; worker health guidance |
| Register request | Select skeleton | — | Source unavailable alert | Preview countdown; stale preview → re-preview; existing active request → corrected version |
| Submit report | Skeleton | "No authorized requests yet" | Form error with reference | Accepted state never says verified |
| App shell | — | — | `app/app/error.tsx` | Requires setup page when services are missing |

## Interaction rules

- One primary action per region; visible labels; focus rings; skip link; semantic landmarks and headings.
- Dialogs (Radix) trap and return focus and close with Escape; confirmations for reset, retire, revoke and auto-recover.
- Duplicate submissions blocked with loading states; entered values preserved after recoverable errors.
- State-changing operations show pending then server-confirmed results; tasks are never optimistically marked verified.
- Filters and pagination live in the URL; Back to tasks returns to Tasks.

## Permissions

Single OWNER role per private workspace (no dead team controls). Demo operators can act only inside their own demo, cannot change identity, create tokens or use Stripe. Scenario controls appear only in the demo or in development with a local sandbox. Every API enforces the same rules server-side.
