"""Tests for the two-tier WAL-safe SQLite backup/restore.

run_backup() snapshots via the SQLite backup API (not shutil.copy2) so the copy is
consistent even when another process holds uncheckpointed WAL frames. It is
tri-state ("created" / "skipped" / "failed") so the job entrypoint can exit
non-zero on real failures without flagging same-day skips. Snapshots are written
tmp → verify → os.replace, so a failure never destroys the last good snapshot.
restore_backup verifies integrity, keeps a .pre-restore sidecar, and clears stale
WAL sidecars.
"""
import sqlite3
import threading
import time
from datetime import date
from pathlib import Path

import pytest

TODAY = date(2026, 6, 11)


def _make_wal_db(path: Path) -> sqlite3.Connection:
    """Create a WAL-mode db with a table; return an OPEN connection (caller closes)."""
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.commit()
    return conn


def _daily(bdir: Path, d: date = TODAY) -> Path:
    return bdir / f"brokershark_{d:%Y-%m-%d}.db"


def _monthly(bdir: Path, d: date = TODAY) -> Path:
    return bdir / f"brokershark_{d:%Y-%m}.db"


@pytest.fixture()
def backup_env(tmp_path, monkeypatch):
    from core import backup
    db_dir = tmp_path / "data"
    db_dir.mkdir()
    db_file = db_dir / "brokershark.db"
    bdir = tmp_path / "backups"
    monkeypatch.setattr(backup, "DB_PATH", str(db_file))
    monkeypatch.setattr(backup, "BACKUP_DIR", str(bdir))
    monkeypatch.setattr(backup, "DAILY_BACKUPS_KEPT", 14)
    monkeypatch.setattr(backup, "MONTHLY_BACKUPS_KEPT", 12)
    return backup, db_file, bdir


def test_run_backup_creates_both_tiers_verified(backup_env):
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('a')")
    conn.commit()
    conn.close()

    assert backup.run_backup(TODAY) == "created"
    # snapshots are single clean files — no -wal/-shm clutter, no leftover .tmp
    assert sorted(p.name for p in bdir.iterdir()) == [
        f"brokershark_{TODAY:%Y-%m-%d}.db", f"brokershark_{TODAY:%Y-%m}.db",
    ]
    for snap in (_daily(bdir), _monthly(bdir)):
        assert backup.verify_backup(str(snap)) is True
        conn = sqlite3.connect(str(snap))
        rows = conn.execute("SELECT v FROM t").fetchall()
        conn.close()
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

    assert backup.run_backup(TODAY) == "created"     # backup while writer is still open
    conn.close()

    rows = sqlite3.connect(str(_daily(bdir))).execute("SELECT v FROM t ORDER BY id").fetchall()
    assert [r[0] for r in rows] == ["a", "b"]         # copy2 of just .db would miss 'b'


def test_run_backup_skips_same_day_and_failed_on_missing_db(backup_env):
    backup, db_file, bdir = backup_env
    assert backup.run_backup(TODAY) == "failed"       # no source DB yet

    conn = _make_wal_db(db_file)
    conn.close()
    assert backup.run_backup(TODAY) == "created"
    assert backup.run_backup(TODAY) == "skipped"      # both tiers already exist


def test_monthly_created_on_late_catchup(backup_env):
    # Machine off on the 1st: a Persistent catch-up on the 3rd must still create
    # the month's snapshot (keyed on file ABSENCE, never on "today is the 1st").
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.close()
    day3 = date(2026, 7, 3)
    assert backup.run_backup(day3) == "created"
    assert _monthly(bdir, day3).exists()

    # next day: daily is new, monthly already covered → still "created" (daily only)
    day4 = date(2026, 7, 4)
    assert backup.run_backup(day4) == "created"
    assert _daily(bdir, day4).exists()
    monthlies = list(bdir.glob("brokershark_????-??.db"))
    assert len(monthlies) == 1


def test_refresh_overwrites_daily_and_failure_preserves_previous(backup_env, monkeypatch):
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('first')")
    conn.commit()
    assert backup.run_backup(TODAY) == "created"

    # post-import refresh captures the new row (run_backup alone would skip)
    conn.execute("INSERT INTO t (v) VALUES ('second')")
    conn.commit()
    conn.close()
    assert backup.refresh_daily_snapshot(TODAY) is True
    rows = sqlite3.connect(str(_daily(bdir))).execute("SELECT v FROM t ORDER BY id").fetchall()
    assert [r[0] for r in rows] == ["first", "second"]

    # a refresh whose snapshot fails verification must NOT clobber the good file
    good_bytes = _daily(bdir).read_bytes()
    monkeypatch.setattr(backup, "verify_backup", lambda path: False)
    assert backup.refresh_daily_snapshot(TODAY) is False
    assert _daily(bdir).read_bytes() == good_bytes
    assert not list(bdir.glob("*.tmp"))               # tmp sidecar cleaned up


def test_prune_is_per_tier_and_ignores_foreign_files(backup_env, monkeypatch):
    backup, db_file, bdir = backup_env
    monkeypatch.setattr(backup, "DAILY_BACKUPS_KEPT", 3)
    monkeypatch.setattr(backup, "MONTHLY_BACKUPS_KEPT", 2)
    conn = _make_wal_db(db_file)
    conn.close()

    bdir.mkdir(parents=True, exist_ok=True)
    for d in range(1, 6):                              # 5 old dailies
        (bdir / f"brokershark_2026-05-{d:02d}.db").write_bytes(b"old daily")
    for m in range(1, 4):                              # 3 old monthlies
        (bdir / f"brokershark_2026-{m:02d}.db").write_bytes(b"old monthly")
    foreign = bdir / "garbage.db"
    foreign.write_bytes(b"not ours")

    assert backup.run_backup(TODAY) == "created"
    dailies = sorted(p.name for p in bdir.glob("brokershark_????-??-??.db"))
    monthlies = sorted(p.name for p in bdir.glob("brokershark_????-??.db"))
    assert len(dailies) == 3 and dailies[-1] == f"brokershark_{TODAY:%Y-%m-%d}.db"
    assert len(monthlies) == 2 and monthlies[-1] == f"brokershark_{TODAY:%Y-%m}.db"
    assert foreign.exists()                            # never counted, never deleted


def test_post_import_snapshot_is_single_flight(backup_env, monkeypatch):
    backup, db_file, bdir = backup_env
    started = threading.Event()
    release = threading.Event()
    calls = []

    def slow_refresh(today=None):
        calls.append(1)
        started.set()
        release.wait(timeout=5)
        return True

    def wait_pending_clear():
        for _ in range(500):
            with backup._post_import_lock:
                if not backup._post_import_pending:
                    return
            time.sleep(0.01)
        raise AssertionError("snapshot worker never finished")

    monkeypatch.setattr(backup, "refresh_daily_snapshot", slow_refresh)
    backup.request_post_import_snapshot()
    assert started.wait(timeout=5)
    backup.request_post_import_snapshot()              # dropped: one already in flight
    release.set()
    wait_pending_clear()
    assert len(calls) == 1                             # second request was dropped

    started.clear()
    backup.request_post_import_snapshot()              # flag cleared → runs again
    assert started.wait(timeout=5)
    wait_pending_clear()
    assert len(calls) == 2                             # 3 requests → 2 executions


def test_restore_round_trip(backup_env):
    backup, db_file, bdir = backup_env
    conn = _make_wal_db(db_file)
    conn.execute("INSERT INTO t (v) VALUES ('original')")
    conn.commit()
    conn.close()
    assert backup.run_backup(TODAY) == "created"
    snap = _daily(bdir)

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
