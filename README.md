# Social Scheduler API

FastAPI service for user authentication, connected social accounts, scheduled posts, and asynchronous publishing jobs.

## Local setup

1. Create and activate a Python 3.11+ environment.
2. Install the project with `pip install -e .`.
3. Copy `.env.example` to `.env` and set a unique `SECRET_KEY`. Set `TOKEN_ENCRYPTION_KEY` to a Fernet key generated with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` before storing real provider tokens.
4. Apply database migrations with `alembic upgrade head`.
5. Start Redis, then run the API with `uvicorn app.main:app --reload`, a worker with `celery -A app.tasks.celery_app:celery_app worker --loglevel=INFO`, and a scheduler with `celery -A app.tasks.celery_app:celery_app beat --loglevel=INFO`.

### React frontend

The content studio is a React + Vite application styled with Tailwind CSS. Install and build it once before opening the FastAPI-served frontend:

```bash
npm install
npm run build
uvicorn app.main:app --reload
```

FastAPI serves the compiled frontend at `/` and its assets from `/static/build/`. For frontend development with hot reload, start the API on port 8000 and run `npm run dev`; Vite proxies `/api` and `/static/uploads` to FastAPI. Set `VITE_API_BASE` at build time to use a different API URL.

The API docs are at `/docs`; health is `/api/v1/health`. Docker Compose starts the API, worker, Beat scheduler, and Redis.

## API overview

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login` (also form-based `/api/v1/auth/token`)
- `GET`, `POST`, and `DELETE /api/v1/accounts`
- `GET`, `POST`, `PATCH`, and `DELETE /api/v1/posts`

All account and post operations require a bearer token. Account creation accepts provider access tokens over HTTPS and encrypts them at rest. API responses never include stored tokens.

## Provider integrations

Account persistence, token encryption, scheduling, queue dispatch, retries, and execution logs are implemented. The provider adapters support text-only LinkedIn and X posts and single-image Instagram feed posts. They require provider-issued user access tokens with publish permissions; Instagram image URLs must be publicly fetchable. Provider OAuth flows, media uploads for LinkedIn and X, and multi-image/video posts are not implemented. Unsupported media types fail clearly, and posts are marked published only after a provider-confirmed response. LinkedIn's required monthly API version is configurable with `LINKEDIN_VERSION`; Instagram Graph API version is configurable with `INSTAGRAM_GRAPH_API_VERSION`.

Use PostgreSQL for production deployments with multiple workers. The default SQLite database is intended for local development and the single-host Docker Compose example.
