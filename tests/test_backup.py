"""Tests for the WAL-safe SQLite backup/restore (P1a).

run_backup() snapshots via the SQLite backup API (not shutil.copy2) so the copy is
consistent even when another process holds uncheckpointed WAL frames. restore_backup
verifies integrity, keeps a .pre-restore sidecar, and clears stale WAL sidecars.
"""
import sqlite3
from datetime import datetime
from pathlib import Path

import pytest


def _make_wal_db(path: Path) -> sqlite3.Connection:
    """Create a WAL-mode db with a table; return an OPEN connection (caller closes)."""
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.commit()
    return conn


def _stamp() -> str:
    return datetime.now().strftime("%Y-%m")


@pytest.fixture()
def backup_env(tmp_path, monkeypatch):
    from core import backup
    db_dir = tmp_path / "data"
    db_dir.mkdir()
    db_file = db_dir / "brokershark.db"
    bdir = tmp_path / "backups"
    monkeypatch.setattr(backup, "DB_PATH", str(db_file))
    monkeypatch.setattr(backup, "BACKUP_DIR", str(bdir))
    monkeypatch.setattr(backup, "MAX_BACKUPS", 12)
    return backup, db_file, bdir


def test_run_backup_creates_verified_snapshot(backup_env):
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('a')")
    conn.commit()
    conn.close()

    assert backup.run_backup() is True
    snap = bdir / f"brokershark_{_stamp()}.db"
    assert snap.exists()
    assert backup.verify_backup(str(snap)) is True
    rows = sqlite3.connect(str(snap)).execute("SELECT v FROM t").fetchall()
    assert [r[0] for r in rows] == ["a"]


def test_backup_captures_uncheckpointed_wal(backup_env):
    # The reason we dropped shutil.copy2: a commit sitting in -wal (not yet
    # checkpointed into the .db) must still appear in the snapshot. We keep the
    # writer connection OPEN during the backup to simulate the live dashboard.
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('a')")
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # 'a' now in the main .db
    conn.execute("INSERT INTO t (v) VALUES ('b')")
    conn.commit()                                    # 'b' lives in -wal, not checkpointed

    assert backup.run_backup() is True               # backup while writer is still open
    conn.close()

    snap = bdir / f"brokershark_{_stamp()}.db"
    rows = sqlite3.connect(str(snap)).execute("SELECT v FROM t ORDER BY id").fetchall()
    assert [r[0] for r in rows] == ["a", "b"]         # copy2 of just .db would miss 'b'


def test_restore_round_trip(backup_env):
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('original')")
    conn.commit()
    conn.close()
    assert backup.run_backup() is True
    snap = bdir / f"brokershark_{_stamp()}.db"

    # mutate the live db after the backup was taken
    conn = sqlite3.connect(str(db_file))
    conn.execute("INSERT INTO t (v) VALUES ('mutation')")
    conn.commit()
    conn.close()

    assert backup.restore_backup(str(snap)) is True
    rows = sqlite3.connect(str(db_file)).execute("SELECT v FROM t").fetchall()
    assert [r[0] for r in rows] == ["original"]                       # mutation gone
    assert db_file.with_name(db_file.name + ".pre-restore").exists()  # safety sidecar kept


def test_verify_backup_false_on_garbage(backup_env):
    backup, db_file, bdir = backup_env
    bdir.mkdir(parents=True, exist_ok=True)
    junk = bdir / "garbage.db"
    junk.write_bytes(b"this is not a sqlite database at all")
    assert backup.verify_backup(str(junk)) is False
    assert backup.verify_backup(str(bdir / "does-not-exist.db")) is False


def test_restore_refuses_corrupt_backup(backup_env):
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('keep')")
    conn.commit()
    conn.close()
    bdir.mkdir(parents=True, exist_ok=True)
    bad = bdir / "corrupt.db"
    bad.write_bytes(b"garbage")

    assert backup.restore_backup(str(bad)) is False
    # the live db is untouched (no .pre-restore written, original row intact)
    rows = sqlite3.connect(str(db_file)).execute("SELECT v FROM t").fetchall()
    assert [r[0] for r in rows] == ["keep"]


def test_run_backup_skips_when_already_done(backup_env):
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('a')")
    conn.commit()
    conn.close()
    assert backup.run_backup() is True
    assert backup.should_backup() is False
    assert backup.run_backup() is False  # not due again this calendar month
