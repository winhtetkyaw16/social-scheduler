# Deploy SocialCastly on Win's laptop

The site is one FastAPI process. It serves the API and the built React app.

- `https://socialcastly.com` is the studio.
- `https://api.socialcastly.com` is the API, and the public media host Instagram, Threads, and TikTok fetch.

Cloudflare Tunnel on the Windows laptop forwards both hostnames to `http://127.0.0.1:8000`. Do not commit `.env`, `*.db`, `_run_api.py`, or `frontend/static/build`.

## .env

Copy `.env.example` to `.env` on the laptop and set these. The values below are examples. Generate `SECRET_KEY` and `TOKEN_ENCRYPTION_KEY` yourself. Leave client secrets in `.env` only.

```text
APP_ENV=production
DEBUG=false
LOG_LEVEL=INFO
PUBLIC_BASE_URL=https://api.socialcastly.com
FRONTEND_URL=https://socialcastly.com

DATABASE_URL=postgresql+psycopg://APP_USER:REPLACE_WITH_DB_PASSWORD@127.0.0.1:5432/social_scheduler
REDIS_URL=redis://127.0.0.1:6379/0
CELERY_BROKER_URL=redis://127.0.0.1:6379/1
TOKEN_REFRESH_INTERVAL_SECONDS=3600

SECRET_KEY=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=14
TOKEN_ENCRYPTION_KEY=REPLACE_WITH_A_FERNET_KEY

CORS_ALLOWED_ORIGINS=https://socialcastly.com,https://api.socialcastly.com
ALLOWED_HOSTS=socialcastly.com,www.socialcastly.com,api.socialcastly.com,localhost,127.0.0.1
FORWARDED_ALLOW_IPS=127.0.0.1

INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
INSTAGRAM_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/instagram/callback
INSTAGRAM_CONFIG_ID=
INSTAGRAM_GRAPH_API_VERSION=v24.0

FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
FACEBOOK_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/facebook/callback
FACEBOOK_GRAPH_API_VERSION=v21.0

THREADS_CLIENT_ID=
THREADS_CLIENT_SECRET=
THREADS_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/threads/callback
THREADS_API_VERSION=v1.0

X_CLIENT_ID=
X_CLIENT_SECRET=
X_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/x/callback

LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/linkedin/callback
LINKEDIN_VERSION=202610

YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/youtube/callback

TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/tiktok/callback

PINTEREST_CLIENT_ID=
PINTEREST_CLIENT_SECRET=
PINTEREST_REDIRECT_URI=https://api.socialcastly.com/api/v1/accounts/pinterest/callback
```

`CORS_ALLOWED_ORIGINS` is the list the browser may call. `ALLOWED_ORIGINS` is only the fallback if `CORS_ALLOWED_ORIGINS` is unset. Do not use `*`.

A Fernet key:

```bat
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

SQLite (`sqlite:///./local.db`) is only safe while a single process uses it. The API and the Celery worker together need Postgres, as in `DATABASE_URL` above.

`VITE_API_BASE_URL` is optional for this tunnel. Both hostnames hit the same process, and the built app calls same-origin `/api/v1` when the variable is unset. Set it only if a build must call the API host explicitly:

```bat
set VITE_API_BASE_URL=https://api.socialcastly.com/api/v1
```

`VITE_API_BASE` is the old name for the same setting. `VITE_API_BASE_URL` wins when both are set.

## Build and run (Windows)

From the repo root, in three terminals. Redis must already be listening on `127.0.0.1:6379`.

```bat
cd /d C:\path\to\social-scheduler
py -m venv .venv
.venv\Scripts\activate
pip install -e .
alembic upgrade head
npm install
npm run build
uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

Worker (the default prefork pool does not run on Windows):

```bat
cd /d C:\path\to\social-scheduler
.venv\Scripts\activate
celery -A app.tasks.celery_app:celery_app worker --loglevel=INFO -P solo
```

Beat:

```bat
cd /d C:\path\to\social-scheduler
.venv\Scripts\activate
celery -A app.tasks.celery_app:celery_app beat --loglevel=INFO
```

`--proxy-headers` and `--forwarded-allow-ips 127.0.0.1` tell uvicorn to trust `X-Forwarded-Proto` from cloudflared on this machine. The app also applies that trust, and `TrustedHostMiddleware` allows only `ALLOWED_HOSTS`. Login sets an HttpOnly refresh cookie with `Secure` when the request scheme is https.

Local development can keep `APP_ENV=development`, `DEBUG=false`, and `uvicorn app.main:app --reload` without the proxy flags. `npm run dev` proxies `/api`, `/media`, and `/static/uploads` to port 8000.

## Cloudflare Tunnel

`C:\Users\Win\.cloudflared\config.yml`:

```yaml
tunnel: socialcastly
credentials-file: C:\Users\Win\.cloudflared\TUNNEL_ID.json
ingress:
  - hostname: socialcastly.com
    service: http://127.0.0.1:8000
  - hostname: www.socialcastly.com
    service: http://127.0.0.1:8000
  - hostname: api.socialcastly.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

Replace `TUNNEL_ID` with the tunnel id from `cloudflared tunnel create`. Then:

```bat
cloudflared tunnel route dns socialcastly socialcastly.com
cloudflared tunnel route dns socialcastly www.socialcastly.com
cloudflared tunnel route dns socialcastly api.socialcastly.com
cloudflared tunnel --config C:\Users\Win\.cloudflared\config.yml run socialcastly
```

## OAuth redirect URIs

Register these exactly. Each one is `https://api.socialcastly.com` plus the callback route `GET /api/v1/accounts/{platform}/callback`.

| Network | Redirect URI |
| --- | --- |
| Facebook (Meta) | `https://api.socialcastly.com/api/v1/accounts/facebook/callback` |
| Instagram (Meta, Facebook Login for Business) | `https://api.socialcastly.com/api/v1/accounts/instagram/callback` |
| Threads (Meta) | `https://api.socialcastly.com/api/v1/accounts/threads/callback` |
| X | `https://api.socialcastly.com/api/v1/accounts/x/callback` |
| LinkedIn | `https://api.socialcastly.com/api/v1/accounts/linkedin/callback` |
| YouTube (Google) | `https://api.socialcastly.com/api/v1/accounts/youtube/callback` |
| TikTok | `https://api.socialcastly.com/api/v1/accounts/tiktok/callback` |
| Pinterest | `https://api.socialcastly.com/api/v1/accounts/pinterest/callback` |

Meta also needs these public callbacks (not OAuth redirects):

- Deauthorize: `https://api.socialcastly.com/api/v1/accounts/facebook/deauthorize` (same path for `instagram` and `threads`)
- Data deletion: `https://api.socialcastly.com/api/v1/accounts/facebook/data-deletion` (same path for `instagram` and `threads`)
- Privacy policy: `https://socialcastly.com/privacy`

There are no other connectable networks in `app/`.

Uploaded files are public at `https://api.socialcastly.com/media/<file>`. Set TikTok's URL prefix, and any Meta media domain check, to that origin.

## What is public

These API routes do not require a bearer token:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/token` (OAuth2 password form for the same login)
- `POST /api/v1/auth/refresh` (exchanges a refresh token; it is not an access token)
- `GET /api/v1/health`
- `GET /api/v1/accounts/{platform}/callback` for each network above
- `POST /api/v1/accounts/{facebook,instagram,threads}/uninstall`
- `POST /api/v1/accounts/{facebook,instagram,threads}/deauthorize`
- `POST /api/v1/accounts/{facebook,instagram,threads}/delete`
- `POST /api/v1/accounts/{facebook,instagram,threads}/data-deletion`
- `GET /api/v1/accounts/{facebook,instagram,threads}/data-deletion`

These pages and files are public:

- `GET /` (landing, login, signup)
- `GET /privacy` and `GET /terms`
- `GET /media/{filename}` and legacy `GET /static/uploads/{filename}`
- `GET /static/build/*` (the studio's JavaScript and CSS, so the login page can load)

Every other `/api/` route returns 401 without a bearer token, including the publish routes added for approvals history, Evergreen, and Bulk CSV:

- `GET /api/v1/publish/approvals/history`
- `GET /api/v1/publish/evergreen`
- `PUT /api/v1/publish/evergreen/{post_id}`
- `GET /api/v1/publish/bulk/template`
- `POST /api/v1/publish/bulk`

The studio shell (dashboard, composer, channels, calendar, queue, settings, and the other signed-in views) does not mount without a session token.

## What production hides

`app/` has no debug, seed, or test routes. With `APP_ENV=production` and `DEBUG` not true, these are 404:

- `GET /docs`
- `GET /docs/oauth2-redirect`
- `GET /redoc`
- `GET /openapi.json`
- `GET /docs-assets/*`

Set `DEBUG=true` only for a short local look at the docs. Leave it false on the public tunnel.
