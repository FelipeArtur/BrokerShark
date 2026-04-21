"""Daily SQLite backup — creates timestamped copy and prunes old files."""
import logging
import shutil
from datetime import datetime
from pathlib import Path

import config

DB_PATH = config.DB_PATH
BACKUP_DIR = config.BACKUP_DIR
MAX_BACKUPS = config.MAX_BACKUPS

_logger = logging.getLogger(__name__)


def run_backup() -> None:
    source = Path(DB_PATH)
    if not source.exists():
        _logger.warning("Database file not found, skipping backup")
        return

    backup_dir = Path(BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y-%m-%d")
    dest = backup_dir / f"brokershark_{stamp}.db"
    shutil.copy2(source, dest)
    _logger.info("Backup created: %s", dest)

    _prune_old_backups(backup_dir)


def _prune_old_backups(backup_dir: Path) -> None:
    backups = sorted(backup_dir.glob("brokershark_*.db"))
    for old in backups[:-MAX_BACKUPS]:
        old.unlink()
        _logger.info("Removed old backup: %s", old)
