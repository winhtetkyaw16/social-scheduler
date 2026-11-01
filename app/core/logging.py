"""Application-wide logging configuration."""

import logging
import os


def configure_logging() -> None:
    """Initialize the root logger using the configured log level."""
    level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # httpx logs full request URLs at INFO, which can include OAuth secrets/tokens in query strings.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
