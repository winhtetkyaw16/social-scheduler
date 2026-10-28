# Phase C — Publishers (Facebook, YouTube, TikTok, Pinterest, Threads)

Connect (OAuth + destination pick) and **real publisher adapters** are implemented for Facebook, YouTube, TikTok, Pinterest, and Threads. They are registered in `app.integrations.registry` and listed in `PUBLISHABLE_PLATFORMS`.

| Network | Module | Destinations | Text | Media | Notes |
|---------|--------|--------------|------|-------|-------|
| Facebook | `platforms/facebook.py` | Pages (primary); Groups when Meta returns them | Yes | One image via `/photos`; video not yet | Page access token from connect. Personal profiles never publishable. |
| YouTube | `platforms/youtube.py` | Channel / Brand channel | Title/description from caption | Exactly one video (local `/static/uploads` or public URL) | Resumable `videos.insert`. Needs upload-capable Google scopes (`youtube.force-ssl` and/or `youtube.upload`). |
| TikTok | `platforms/tiktok.py` | Creator / Business | Caption (≤2200) | Exactly one video | Tries **Direct Post**; falls back to **Inbox** draft (`inbox:{publish_id}`) when unaudited. PULL_FROM_URL needs a TikTok-verified URL property; FILE_UPLOAD works from local uploads. |
| Pinterest | `platforms/pinterest.py` | Boards | Title/description from caption | Exactly one image URL | User parent is not pin-able. Video Pins not yet. |
| Threads | `platforms/threads.py` | Threads profile | ≤500 chars | Optional one image or video (public URL) | Create container → publish. Carousels not yet. |

## Enabling / verifying

1. Publishers are in `_PROVIDERS` in `app/integrations/registry.py`.
2. Platform ids are in `PUBLISHABLE_PLATFORMS` in `app/integrations/platform_catalog.py`.
3. Never return a fake provider post id. Honest `ProviderConfigurationError` when scopes, media, or account type are wrong.
4. Adapter unit tests live in `tests/test_adapters.py` (httpx mocked).

## Env / API prerequisites

See `.env.example`. Live publish still needs:

- Real OAuth client credentials per network (already documented for connect).
- `PUBLIC_BASE_URL` set to a **public https** origin whenever a provider must fetch `/static/uploads/...` (Facebook image, Pinterest, Threads, TikTok PULL_FROM_URL).
- TikTok: Content Posting product + (for Direct Post) app audit; verify URL prefixes for PULL_FROM_URL.
- YouTube: Google Cloud OAuth client with YouTube Data API enabled; unverified apps may be limited to test users.
- Facebook: Page token with `pages_manage_posts` (App Review for production).
- Threads: Meta Threads app with `threads_content_publish`.
- Pinterest: app with `pins:write` / `boards:read`.

## Click-test (local)

1. Ensure Redis (if using Celery worker) and `uvicorn` on `:8000`.
2. Connect a destination under **Manage Accounts**.
3. **Create Post** → select that destination → schedule or post-now.
4. Confirm execution log shows a real `provider_post_id` (or `inbox:…` for TikTok inbox fallback), not a stub error.
