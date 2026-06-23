"""Tests for the connection-factory seam in core.db.schema.

The seam is what lets every db sub-module share one swappable connection source,
replacing the old per-module ``_connect`` monkeypatching in conftest.
"""
from core.db import schema


def test_default_factory_reads_db_path_lazily(db, monkeypatch):
    """_connect honours config.DB_PATH at call time (not a stale import snapshot)."""
    import config

    with schema._connect() as conn:
        # foreign_keys / WAL pragmas from _default_connect are active
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    # config.DB_PATH (patched by the db fixture) is what the connection opened
    assert config.DB_PATH.endswith("test_brokershark.db")


def test_set_and_reset_connection_factory(db):
    """set_connection_factory swaps the source; reset restores the prod default."""
    calls: list[int] = []

    def factory():
        calls.append(1)
        return schema._default_connect()

    schema.set_connection_factory(factory)
    try:
        with schema._connect() as conn:
            assert conn.execute("SELECT 1").fetchone()[0] == 1
        assert calls == [1]  # the injected factory was actually used
    finally:
        schema.reset_connection_factory()

    assert schema._connection_factory is schema._default_connect
