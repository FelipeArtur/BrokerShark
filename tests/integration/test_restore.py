"""Safe operational restore wrapper (python -m jobs.restore).

The money-critical guard: refuse to restore while the dashboard is serving (a
restore under the live writer corrupts the DB). On top of core.backup.restore_backup
(verify + .pre-restore sidecar + atomic swap), the wrapper adds backup selection,
the liveness guard, and a confirmation that fails closed without a TTY.
"""
import socket
import sqlite3

import pytest


def _make_db(path) -> None:
    """A small WAL db with one row 'a'."""
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO t (v) VALUES ('a')")
    conn.commit()
    conn.close()


def _rows(path) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        return [r[0] for r in conn.execute("SELECT v FROM t ORDER BY id").fetchall()]
    finally:
        conn.close()


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture()
def renv(tmp_path, monkeypatch):
    """Wire restore_backup (backup.DB_PATH, import-time) + the wrapper (config.*) to temp."""
    import config
    from core import backup
    import jobs.restore as restore

    data = tmp_path / "data"
    data.mkdir()
    db = data / "brokershark.db"
    bdir = tmp_path / "backups"
    bdir.mkdir()
    monkeypatch.setattr(backup, "DB_PATH", str(db))
    monkeypatch.setattr(backup, "BACKUP_DIR", str(bdir))
    monkeypatch.setattr(config, "DB_PATH", str(db))
    monkeypatch.setattr(config, "LOCAL_BACKUP_DIR", str(bdir))
    monkeypatch.setattr(config, "DASHBOARD_PORT", _free_port())  # nothing serving → guard passes
    monkeypatch.setattr(restore, "bootstrap", lambda: None)      # db is set up per-test
    return restore, backup, db, bdir


def _run(restore, monkeypatch, *argv):
    monkeypatch.setattr("sys.argv", ["prog", *argv])
    return restore.main()


def test_dashboard_serving_detects_listener(monkeypatch):
    import config
    import jobs.restore as restore
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen()
    monkeypatch.setattr(config, "DASHBOARD_PORT", srv.getsockname()[1])
    try:
        assert restore._dashboard_serving() is True
    finally:
        srv.close()
    assert restore._dashboard_serving() is False  # port now free


def test_refuses_while_app_live(renv, monkeypatch):
    restore, backup, db, bdir = renv
    _make_db(db)
    backup._snapshot(str(db), str(bdir / "brokershark_2026-06.db"))
    monkeypatch.setattr(restore, "_dashboard_serving", lambda: True)
    calls = []
    monkeypatch.setattr(restore.core_backup, "restore_backup", lambda p: calls.append(p) or True)
    assert _run(restore, monkeypatch, "--latest", "--yes") == 2
    assert calls == []  # never touched the DB while the app was live


def test_restores_latest(renv, monkeypatch):
    restore, backup, db, bdir = renv
    _make_db(db)
    backup._snapshot(str(db), str(bdir / "brokershark_2026-06.db"))  # snapshot has only 'a'
    # diverge the live DB after the snapshot
    conn = sqlite3.connect(str(db))
    conn.execute("INSERT INTO t (v) VALUES ('b')")
    conn.commit()
    conn.close()
    assert _rows(db) == ["a", "b"]

    assert _run(restore, monkeypatch, "--latest", "--yes") == 0
    assert _rows(db) == ["a"]                                   # restored to snapshot state
    assert db.with_name(db.name + ".pre-restore").exists()      # undo sidecar kept
    assert not db.with_name(db.name + ".restore-tmp").exists()  # atomic swap left no temp


def test_refuses_corrupt_backup(renv, monkeypatch):
    restore, backup, db, bdir = renv
    _make_db(db)
    bad = bdir / "brokershark_2026-06.db"
    bad.write_bytes(b"not a sqlite file")
    assert _run(restore, monkeypatch, "--latest", "--yes") == 2
    assert _rows(db) == ["a"]                                   # live DB untouched
    assert not db.with_name(db.name + ".pre-restore").exists()


def test_no_backups(renv, monkeypatch):
    restore, backup, db, bdir = renv
    _make_db(db)
    assert _run(restore, monkeypatch, "--latest", "--yes") == 2


def test_confirm_fails_closed_without_tty(renv, monkeypatch):
    restore, backup, db, bdir = renv
    _make_db(db)
    backup._snapshot(str(db), str(bdir / "brokershark_2026-06.db"))
    # no --yes and no TTY (pytest) → must decline, not swap
    assert _run(restore, monkeypatch, "--latest") == 2
    assert not db.with_name(db.name + ".pre-restore").exists()


def test_list_changes_nothing(renv, monkeypatch):
    restore, backup, db, bdir = renv
    _make_db(db)
    backup._snapshot(str(db), str(bdir / "brokershark_2026-06.db"))
    assert _run(restore, monkeypatch, "--list") == 0
    assert not db.with_name(db.name + ".pre-restore").exists()
