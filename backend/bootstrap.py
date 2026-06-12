"""Shared process bootstrap — used by the dashboard (main.py) and every job entrypoint.

Loads ``.env`` BEFORE ``config`` is imported (config reads ``os.getenv`` at import
time), then configures logging, validates the environment, and initialises the
database. Idempotent: safe to call once per process.

Import order matters: import ``bootstrap`` FIRST in an entrypoint so ``load_dotenv``
runs before anything imports ``config``.
"""
from dotenv import load_dotenv

load_dotenv()  # must precede the `import config` below (and in callers)

import logging

import config
from core import database

_done = False


def bootstrap() -> None:
    """Initialise the process (logging, env validation, DB). Idempotent."""
    global _done
    if _done:
        return
    logging.basicConfig(level=logging.INFO, format=config.LOG_FORMAT)
    config.validate()  # fail fast on an unusable DB_PATH
    database.init_db()
    _done = True
