# Design system

Direction (from the 19 mockups): calm, light, evidence-first; Apple productivity clarity, compact operational density, familiar desktop navigation. Structure comes from borders, spacing and type hierarchy; shadows only for floating layers; no decorative gradients in the app.

## Tokens (`apps/web/src/app/globals.css`, Tailwind v4 `@theme`)

| Token | Value | Utility |
| --- | --- | --- |
| Canvas | `#F5F6F8` | `bg-canvas` |
| Surface | `#FFFFFF` | `bg-surface` |
| Ink / muted / subtle | `#17191D` / `#5D6470` / `#7D8591` | `text-ink`, `text-muted`, `text-subtle` |
| Divider | `#E4E7EB` (strong `#D3D8DE`) | `border-line` |
| Primary | `#3567E8` (hover `#2957D1`, soft `#EBF1FE`, ink `#2552C7`) | `bg-primary`, `bg-primary-soft`, `text-primary-ink` |
| Verified | green `#1F9960` / soft `#E6F5ED` / ink `#166044` | `success*` |
| Mismatch | coral `#E0484F` / `#FDECEC` / `#B0262E` | `danger*` |
| Unknown / awaiting | amber `#E3A008` / `#FFF5DC` / `#8A5700` | `warning*` |
| Completed / info | blue `#3B82E6` / `#E9F1FD` / `#1D5BB3` | `info*` |
| Radius | control 7px, surface 10px | `rounded-control`, `rounded-surface` |
| Shadow | card (hairline), float (menus/dialogs/auth cards) | `shadow-card`, `shadow-float` |
| Motion | 150 ms, `cubic-bezier(.2,0,0,1)`; disabled under `prefers-reduced-motion` | `transition-ui` |

Typography: Inter (`next/font`, `--font-inter`) for UI, IBM Plex Mono for identifiers. Body 15px; page titles 28–34px semibold with tight tracking; auth/homepage display 44–64px bold.

## Layout

| Element | Rule |
| --- | --- |
| Sidebar | 248px, white, logo + "Outcome control", Tasks / Approvals (pending count) / Activity / Insights, Settings near bottom, workspace identity at bottom; active item pale blue with left accent |
| Top bar | 64px sticky: location, environment badge (Demo · Simulated billing / Local sandbox / Stripe test mode), write-pause badge, policy label, account menu |
| Main | max 1440px, 16–32px padding |
| Public | max 1200px; auth pages split (hero left, 440px card right) |
| Onboarding | 1180px, 260px setup rail + form surface, stepper with green completed checks |

## Components (`apps/web/src/components`)

- `ui/button.tsx` — primary, secondary, outline, ghost, danger, dangerSolid, link, dark; sm/md/lg/icon; loading state disables duplicate submits.
- `ui/form.tsx` — Input, Textarea, native Select, PasswordInput (reveal toggle), Label, Field (visible label, hint, error, aria wiring), Checkbox, FormError.
- `ui/primitives.tsx` — Card, CardHeader, Badge (tone + text), StatusIcon, Spinner, Skeleton, Alert, EmptyState, Mono, StepNumber.
- `ui/overlay.tsx` — Radix Dialog (focus trap/return), DropdownMenu, Switch.
- `ui/tabs.tsx` — ARIA tablist filter tabs (underline/pill) with arrow-key navigation.
- `ui/feedback.tsx` — polite toast region, CopyButton.
- `brand.tsx` — the single shield-check logo mark used on every page.
- `status.tsx` — VerdictBadge/VerdictInline (icon + label + color), EnvironmentBadge.
- `shell/*` — AppShell, AccountMenu, DemoBanner.

## Status language

Scheduled = green check, Completed = blue clock, Needs action = coral alert, Could not verify = amber question, Outside scope / Waiting = gray minus. Color is never the only cue.

## Responsive behavior

- ≥1024px: persistent sidebar, full evidence tables.
- 768–1023px: drawer navigation (hamburger), tables in horizontal-scroll containers.
- <768px: drawer, task list becomes stacked summaries, evidence sections stack, forms full width, primary actions remain in flow.
