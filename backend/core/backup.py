"""Monthly SQLite backup — local (HDD), WAL-safe snapshot via the SQLite backup API.

Backup runs via a systemd user timer (oneshot) — see ``deploy/``.
``should_backup()`` guards against double-runs within the same calendar month.

The snapshot uses :meth:`sqlite3.Connection.backup` instead of ``shutil.copy2`` so it
is **consistent even if the dashboard is writing in another process**: in WAL mode,
copying only the ``.db`` file can miss commits still living in the ``-wal``. Each
snapshot is integrity-checked before it is kept. ``restore_backup`` is the recovery
path. Backup/restore failures never propagate — they are logged and return ``False``.
"""
import logging
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

import config

DB_PATH = config.DB_PATH
BACKUP_DIR = config.LOCAL_BACKUP_DIR
MAX_BACKUPS = config.MAX_BACKUPS

_logger = logging.getLogger(__name__)


def should_backup() -> bool:
    """Return True if this calendar month has no backup yet."""
    backup_dir = Path(BACKUP_DIR)
    if not backup_dir.exists():
        return True
    stamp = datetime.now().strftime("%Y-%m")
    return not (backup_dir / f"brokershark_{stamp}.db").exists()


def _snapshot(source_path: str, dest_path: str) -> None:
    """Write a consistent snapshot of ``source_path`` to ``dest_path``.

    Uses the SQLite online backup API, which is WAL-safe and works while another
    process writes the source. Raises ``sqlite3.Error``/``OSError`` on failure.
    """
    src = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    try:
        dest = sqlite3.connect(dest_path)
        try:
            src.backup(dest)
        finally:
            dest.close()
    finally:
        src.close()


def verify_backup(path: str) -> bool:
    """Return True if the SQLite file at ``path`` passes ``PRAGMA integrity_check``."""
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            row = conn.execute("PRAGMA integrity_check").fetchone()
            return bool(row) and row[0] == "ok"
        finally:
            conn.close()
    except sqlite3.Error as exc:
        _logger.warning("Backup integrity check failed for %s: %s", path, exc)
        return False


def run_backup() -> bool:
    """Create a verified monthly snapshot of the database if due.

    Returns:
        True if a verified backup was created, False if skipped or on any failure
        (failures are logged, never raised).
    """
    if not should_backup():
        _logger.info("Backup not due yet — skipping.")
        return False

    source = Path(DB_PATH)
    if not source.exists():
        _logger.warning("Database file not found, skipping backup")
        return False

    backup_dir = Path(BACKUP_DIR)
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
    except (PermissionError, OSError) as exc:
        _logger.warning("Cannot create backup directory %s: %s", backup_dir, exc)
        return False

    stamp = datetime.now().strftime("%Y-%m")
    dest = backup_dir / f"brokershark_{stamp}.db"
    try:
        _snapshot(str(source), str(dest))
    except (sqlite3.Error, OSError) as exc:
        _logger.warning("Failed to write backup %s: %s", dest, exc)
        _safe_unlink(dest)
        return False

    if not verify_backup(str(dest)):
        _logger.error("Backup failed integrity check — discarding %s", dest)
        _safe_unlink(dest)
        return False

    _logger.info("Local backup created: %s", dest)
    _prune_old_backups(backup_dir)
    return True


def restore_backup(backup_path: str) -> bool:
    """Restore a verified backup file into ``DB_PATH`` (run with the app stopped).

    Verifies the backup's integrity first (refuses on failure), copies the current
    database to a ``.pre-restore`` sidecar, clears any stale ``-wal``/``-shm`` so the
    restored file isn't shadowed by old WAL frames, then writes the backup over
    ``DB_PATH``. Returns True on success, False (logged) on any failure; never raises.
    """
    src = Path(backup_path)
    if not src.exists():
        _logger.warning("Backup not found: %s", src)
        return False
    if not verify_backup(str(src)):
        _logger.error("Refusing to restore — backup failed integrity check: %s", src)
        return False

    db = Path(DB_PATH)
    try:
        db.parent.mkdir(parents=True, exist_ok=True)
        if db.exists():
            shutil.copy2(db, db.with_name(db.name + ".pre-restore"))
        for side in (db.with_name(db.name + "-wal"), db.with_name(db.name + "-shm")):
            _safe_unlink(side)
        shutil.copy2(src, db)  # backup is a clean single-file snapshot
    except OSError as exc:
        _logger.warning("Restore failed from %s: %s", src, exc)
        return False

    _logger.info("Restored database from backup: %s", src)
    return True


def _safe_unlink(path: Path) -> None:
    """Best-effort unlink that never raises."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _prune_old_backups(backup_dir: Path) -> None:
    backups = sorted(backup_dir.glob("brokershark_*.db"))
    for old in backups[:-MAX_BACKUPS]:
        old.unlink()
        _logger.info("Removed old local backup: %s", old)
