import os

# Create directory sturcture and files
structure = [
    # App core files
    "app/main.py",
    "app/api/deps.py",
    "app/api/v1/router.py",
    "app/api/v1/endpoints/auth.py",
    "app/api/v1/endpoints/accounts.py",
    "app/api/v1/endpoints/posts.py",
    "app/api/v1/endpoints/health.py",
    "app/core/config.py",
    "app/core/security.py",
    "app/core/logging.py",
    "app/core/exceptions.py",
    "app/core/exceptions.py",
    "app/db/base.py",
    "app/db/session.py",
    "app/db/migrations/.gitkeep",
    # Modules, Schemas, Repositories, Services
    "app/models/user.py",
    "app/models/connected_account.py",
    "app/models/scheduled_post.py",
    "app/models/execution_log.py",
    "app/schemas/user.py",
    "app/schemas/account.py",
    "app/schemas/post.py",
    "app/repositories/.gitkeep",
    "app/services/auth.py",
    "app/services/accounts.py",
    "app/services/posts.py",
    "app/services/puclishing.py",
    # Integrations
    "app/integrations/base.py",
    "app/integrations/registry.py",
    "app/integrations/platforms/instagram.py",
    "app/integrations/platforms/linkedin.py",
    "app/integrations/platforms/x.py",
    # Tasks & Templates
    "app/tasks/celery_app.py",
    "app/tasks/dispatch_due_posts.py",
    "app/tasks/publish_post.py",
    "app/templates/.gitkeep",
    # Frontend
    "frontend/templates/.gitkeep",
    "frontend/static/css/.gitkeep",
    "frontend/static/js/.gitkeep",
    # Tests
    "tests/unit/.gitkeep",
    "tests/integration/.gitkeep",
    "tests/conftest.py",
    # Root Config Files
    "alembic.ini",
    "Dockerfile",
    "compose.yaml",
    "pyproject.toml",
    ".env.example",
    ".gitignore",
    "README.md",
]

for filepath in structure:
    # Ensure folder path exists
    folder = os.path.dirname(filepath)
    if folder:
        os.makedirs(folder, exist_ok=True)

    # Create empty file if not exists
    if not os.path.exists(filepath):
        with open(filepath, "w", encoding="utf-8") as f:
            pass

print("Building finshed Project Folder Structure")
