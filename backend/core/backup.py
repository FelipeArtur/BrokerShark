"""Monthly SQLite backup — local (HDD).

Backup runs on the 1st of each month via APScheduler cron.
`should_backup()` guards against double-runs within the same calendar month.
"""
import logging
import shutil
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


def run_backup() -> bool:
    """Copy the database to the local backup directory if due.

    Returns:
        True if a backup was created, False if skipped (not due yet).
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
        shutil.copy2(source, dest)
    except OSError as exc:
        _logger.warning("Failed to write backup %s: %s", dest, exc)
        return False

    _logger.info("Local backup created: %s", dest)
    _prune_old_backups(backup_dir)
    return True


def _prune_old_backups(backup_dir: Path) -> None:
    backups = sorted(backup_dir.glob("brokershark_*.db"))
    for old in backups[:-MAX_BACKUPS]:
        old.unlink()
        _logger.info("Removed old local backup: %s", old)
