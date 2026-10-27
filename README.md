# Social Scheduler API

FastAPI service for user authentication, connected social accounts, scheduled posts, and asynchronous publishing jobs.

## Local setup

1. Create and activate a Python 3.11+ environment.
2. Install the project with `pip install -e ".[dev]"`.
3. Copy `.env.example` to `.env` and set a unique `SECRET_KEY`. Set `TOKEN_ENCRYPTION_KEY` to a Fernet key generated with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` before storing real provider tokens.
4. Apply database migrations with `alembic upgrade head`.
5. Start Redis, then run the API with `uvicorn app.main:app --reload`, a worker with `celery -A app.tasks.celery_app:celery_app worker --loglevel=INFO`, and a scheduler with `celery -A app.tasks.celery_app:celery_app beat --loglevel=INFO`.

SQLite (`sqlite:///./local.db`) is only safe for one process. API and worker together should use Postgres:

```text
DATABASE_URL=postgresql+psycopg://APP_USER:APP_PASSWORD@localhost:5432/social_scheduler
```

`psycopg` is installed with the project. Run tests with `pytest`.

### React frontend

The content studio is a React + Vite application styled with Tailwind CSS. Install and build it once before opening the FastAPI-served frontend:

```bash
npm install
npm run build
uvicorn app.main:app --reload
```

FastAPI serves the compiled frontend at `/` and its assets from `/static/build/`. For frontend development with hot reload, start the API on port 8000 and run `npm run dev`; Vite proxies `/api` and `/static/uploads` to FastAPI. Set `VITE_API_BASE` at build time to use a different API URL.

The API docs are at `/docs`; health is `/api/v1/health`.

### Docker Compose

Compose starts Postgres, Redis, the API, a Celery worker, and Beat. The API and worker share Postgres, not a SQLite file. `.env` is optional; when present, Compose still forces `DATABASE_URL` and the Redis URLs to the Compose network.

```bash
docker compose up --build
```

Then `GET http://localhost:8000/api/v1/health` should return `{"status":"ok","database":"ok"}`, and signup at `http://localhost:8000` should create a user.

OAuth client ids are read from `.env` (`X_CLIENT_ID`, `X_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`). Without them, connect returns HTTP 503 and names the missing variables. `PUBLIC_BASE_URL` defaults to `http://localhost:8000`. Instagram can publish only when that origin is publicly reachable, or when the image URL already is. Uploaded files live in the `uploads` volume.

If `alembic upgrade head` fails because an older database already applied the revision that dropped `users`, `connected_accounts`, `scheduled_posts`, and `execution_logs`, delete that database and run the upgrade again. New databases keep those tables.

## API overview

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login` (also form-based `/api/v1/auth/token`)
- `POST /api/v1/auth/refresh` with `{ "refresh_token": "..." }` — login returns a refresh token (`REFRESH_TOKEN_EXPIRE_DAYS`, default 14). The studio uses it when the access token expires so a session is not limited to `ACCESS_TOKEN_EXPIRE_MINUTES`.
- `GET /api/v1/accounts/{platform}/connect` and `GET /api/v1/accounts/{platform}/callback` for `x`, `linkedin`, and `instagram`
- `GET`, `POST`, and `DELETE /api/v1/accounts` — manual token connect remains for the three publishable platforms
- `GET`, `POST`, `PATCH`, and `DELETE /api/v1/posts`, plus `POST /api/v1/posts/{id}/retry` and `POST /api/v1/posts/{id}/archive`
- `POST /api/v1/publish/drafts` and `POST /api/v1/publish/approvals/{id}/decision`

All account and post operations require a bearer access token. Account creation and OAuth callbacks encrypt provider tokens at rest. API responses and the OAuth redirect never include stored tokens. A refresh token cannot be used as an access token.

## Provider integrations

Account persistence, token encryption, scheduling, queue dispatch, retries, and execution logs are implemented. X, LinkedIn, and Instagram have publishers and OAuth connect flows. Facebook, TikTok, YouTube, Pinterest, and any other platform are rejected at connect time and cannot be scheduled.

X and LinkedIn publish text only. Instagram publishes one image. Image URLs must be publicly fetchable: a `/static/uploads/...` path is rewritten onto `PUBLIC_BASE_URL` when that host is public, and publish fails with a clear error when the URL is still local or private. LinkedIn's monthly API version is `LINKEDIN_VERSION`. Instagram's version is `INSTAGRAM_GRAPH_API_VERSION` (requests go to `graph.instagram.com`, matching Instagram Login tokens). Register each redirect URI from `.env.example` on the provider app.

A post stays `scheduled` or `queued` until the provider returns an id. Listing posts does not mark due rows published and does not write simulated analytics. Home and calendar counts treat a post as published only when `provider_post_id` is set, and they surface `last_error_message` plus the latest execution-log outcome.

Approving a draft creates one `scheduled_posts` row per selected account and enqueues it when it is due. The composer saves drafts with `POST /api/v1/publish/drafts`, including captions, formats, media URLs, and schedule metadata.
