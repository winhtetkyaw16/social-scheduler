# Publish Phase D — Failed posts + filters (LOCAL)

**Date:** 2026-10-28 (Asia/Bangkok)
**Scope:** Failed publishes on calendar/list, retry, filters (channel / status / account)
**Constraint:** LOCAL ONLY — no git commit/push/PR. Last letter; stop after D.

## Artifact
- `frontend/static/build/assets/index-D1Sk5jLf.js` (SHA256 `97F53323BDC6CD3A921099FC5B4A46D650493F3CA40E66732368C4DAEA0B3C5B`, ~428 KB, Asia/Bangkok 2026-10-28 15:34)
- CSS: `frontend/static/build/assets/index-CS5gz5qT.css`
- `npm run build` — OK (vite, no JSX warnings)

## Files touched
- `frontend/src/PublishSection.jsx` only (A/B/C + avatar rules left intact)

## What works
1. **Failed on calendar** — rose border/background, status chip, `last_error_message` line; uses `postPlacementAt` (scheduled_at → published_at → created_at).
2. **Posts tab** — new list with error banner (`last_error_code` + `last_error_message`), Open + **Retry** (`POST /posts/{id}/retry`).
3. **Filters** — shared state on Calendar + Posts: status (all / scheduled[=queued+publishing] / draft / failed / published), channel (platform), account; Clear; count badge with failed count.
4. **Retry** — Posts list button + existing ScheduledPostModal retry (backend `app/api/v1/endpoints/posts.py` + `retry_post` in `app/services/posts.py`).
5. **Tab badges** — calendar shows scheduled/queued/publishing count; Posts shows rose failed count when > 0.

## Gaps / not done
- No calendar-card inline Retry (open post → modal Retry).
- Filters are client-side only (no new API query params).
- Cancelled posts still appear under “all” (only archived excluded).
- No automated E2E; click-test checklist below is manual.

## Click-test checklist
1. Publish → Calendar: filter Status=Failed → failed cards show rose styling + error text.
2. Filter Channel / Account → calendar + Posts list narrow together when switching tabs (shared filter state).
3. Posts tab → failed row → Retry → status moves off failed after refresh (needs live API + failed row).
4. Open failed from calendar → modal Retry still works.
5. Avatars / Queue / Drafts (A–C) still render; AccountAvatar showBadge unchanged.

## Stop
Phase D complete. No further publish phases.

