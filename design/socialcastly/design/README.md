# socialcastly — UI/UX redesign

Open `index.html` (light/dark toggle top-right; persisted in localStorage `sc-theme`, or `?theme=dark`).

## Screens (25; desktop 1440px + mobile 390px, light & dark PNGs in `screenshots/`)
- `analytics`
- `approvals`
- `calendar-week`
- `calendar`
- `channels`
- `composer`
- `dashboard`
- `design-system`
- `drafts`
- `landing`
- `m-calendar`
- `m-composer`
- `m-dashboard`
- `m-queue`
- `m-signin`
- `media`
- `onboarding`
- `queue`
- `settings-billing`
- `settings-notifications`
- `settings`
- `signin`
- `signup`
- `states`
- `team`


## Design rationale
- **Brand**: concentric-arc "C" mark + lowercase wordmark. Light: `social` #0F172A, `castly`/mark gradient #4F46E5→#7C3AED. Dark: `social` white, gradient #818CF8→#A78BFA. Real logo files in `assets/logo/`.
- **Scope matches the product**: X, LinkedIn, Instagram are live; Facebook/TikTok/YouTube/Pinterest shown as "Coming soon". X/LinkedIn text-only, Instagram single-image, reflected in the composer & previews.
- **Workflow first**: dashboard surfaces failures (with retry/execution-log detail), approvals and channel health before vanity metrics.
- **Calm, dense UI**: Inter, 4px spacing grid, 6/8/12/16px radii, soft layered shadows; indigo/violet reserved for primary actions and brand.
- **Channel colours** are always paired with icons/labels, never colour alone.

## Tokens
`tokens.css` (CSS variables, `[data-theme=dark]` overrides) and `tokens.json`.

## Accessibility (WCAG AA)
Text contrast vs surface — light: text 17.9, secondary 7.6, tertiary 4.8, primary 6.3, success/warning/error ≥4.8; dark: all ≥5.8. White on primary button: 6.3 (both themes). Visible focus rings on all interactive components.
