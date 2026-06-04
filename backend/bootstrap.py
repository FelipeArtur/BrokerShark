"""Shared process bootstrap — used by the launcher (main.py) and every job entrypoint.

Loads ``.env`` BEFORE ``config`` is imported (config reads ``os.getenv`` at import
time), then configures logging, ensures the log dir, validates required env, and
initialises the database. Idempotent: safe to call once per process.

Import order matters: import ``bootstrap`` FIRST in an entrypoint so ``load_dotenv``
runs before anything imports ``config``.
"""
from dotenv import load_dotenv

load_dotenv()  # must precede the `import config` below (and in callers)

import logging
from pathlib import Path

import config
from core import database

_done = False


def bootstrap() -> None:
    """Initialise the process (logging, env validation, DB). Idempotent."""
    global _done
    if _done:
        return
    logging.basicConfig(level=logging.INFO, format=config.LOG_FORMAT)
    Path(config.LOG_DIR).mkdir(exist_ok=True)
    config.validate()  # fail fast on missing TELEGRAM_TOKEN / TELEGRAM_CHAT_ID
    database.init_db()
    _done = True
