"""Shared pytest fixtures for BrokerShark tests."""
import os
import sys

import pytest

# Add backend/ to path so tests can import project modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """Provide an isolated in-memory-like SQLite database for each test.

    Patches config.DB_PATH and core.db.schema.DB_PATH to a temp file,
    then calls init_db() to create the schema. The temp file is
    automatically removed after each test by pytest's tmp_path fixture.
    """
    db_file = str(tmp_path / "test_brokershark.db")
    monkeypatch.setenv("DB_PATH", db_file)

    import config
    monkeypatch.setattr(config, "DB_PATH", db_file)

    import core.db.schema as schema_mod
    monkeypatch.setattr(schema_mod, "DB_PATH", db_file)

    import core.db.crud as crud_mod
    import core.db.analytics as analytics_mod
    import core.db.categories as categories_mod

    # Re-patch _connect in each sub-module so they all use the test DB
    def _test_connect():
        import sqlite3
        conn = sqlite3.connect(db_file)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    monkeypatch.setattr(schema_mod, "_connect", _test_connect)
    monkeypatch.setattr(crud_mod, "_connect", _test_connect)
    monkeypatch.setattr(analytics_mod, "_connect", _test_connect)
    monkeypatch.setattr(categories_mod, "_connect", _test_connect)

    # Also patch events.notify so tests don't need SSE
    import core.events as events_mod
    monkeypatch.setattr(events_mod, "notify", lambda: None)

    schema_mod.init_db()
    return db_file
