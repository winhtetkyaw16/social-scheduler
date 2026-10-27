"""Celery application and periodic due-post dispatcher configuration."""

from celery import Celery

from app.core.config import CELERY_BROKER_URL, CELERY_RESULT_BACKEND, SCHEDULER_POLL_SECONDS

celery_app = Celery(
    "social_scheduler",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=["app.tasks.publish_post", "app.tasks.dispatch_due_posts"],
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=False,
    # No API code consumes AsyncResult values; avoid unnecessary result writes.
    task_ignore_result=True,
    task_store_errors_even_if_ignored=False,
    # Keep broker outages bounded and make producer calls return promptly.
    broker_connection_timeout=3,
    broker_connection_retry=True,
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=5,
    broker_transport_options={"socket_connect_timeout": 3, "socket_timeout": 3},
    task_publish_retry=True,
    task_publish_retry_policy={
        "max_retries": 1,
        "interval_start": 0.2,
        "interval_step": 0.2,
        "interval_max": 0.4,
    },
    beat_schedule={
        "dispatch-due-posts": {
            "task": "app.tasks.dispatch_due_posts.dispatch_due_posts",
            "schedule": SCHEDULER_POLL_SECONDS,
        }
    },
)
