"""Shared pytest fixtures for BrokerShark tests."""
import os
import sys

import pytest

# Add backend/ to path so tests can import project modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """Provide an isolated SQLite database for each test.

    Points ``config.DB_PATH`` at a temp file; the connection-factory seam in
    ``core.db.schema`` reads it lazily (``_default_connect``), so every sub-module's
    ``_connect`` opens the test DB without monkeypatching ``_connect`` per module — one
    config patch replaces the old four ``_connect`` patches plus the ``schema.DB_PATH``
    patch. The temp file is removed automatically by pytest's ``tmp_path``.
    """
    db_file = str(tmp_path / "test_brokershark.db")
    monkeypatch.setenv("DB_PATH", db_file)

    import config
    monkeypatch.setattr(config, "DB_PATH", db_file)

    # SSE notify is a no-op in tests (no browser to push to).
    import core.events as events_mod
    monkeypatch.setattr(events_mod, "notify", lambda: None)

    import core.db.schema as schema_mod
    schema_mod.init_db()
    return db_file
