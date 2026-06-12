"""Two-tier WAL-safe SQLite backup — local (HDD) snapshots via the SQLite backup API.

Tiers (same directory, disjoint name patterns):

- daily   ``brokershark_YYYY-MM-DD.db`` — keeps the last ``DAILY_BACKUPS_KEPT``
- monthly ``brokershark_YYYY-MM.db``    — keeps the last ``MONTHLY_BACKUPS_KEPT``

Runs via a systemd user timer 3×/day (07/13/19) — ``Persistent=true`` only replays
*missed* runs, never *failed* ones, so the extra daily slots are the retry mechanism
for an HDD that wasn't mounted at 07:00. Each run is idempotent: a tier is only
written when its file for the current day/month is absent. The monthly snapshot is
keyed on file ABSENCE (never on "today is the 1st"), so a late ``Persistent``
catch-up on the 3rd still produces the month's snapshot.

``run_backup`` is tri-state (``"created" | "skipped" | "failed"``) so the job
entrypoint can exit non-zero on real failures (visible in ``systemctl --user
--failed`` and the OnFailure alert unit) without flagging legitimate same-day
skips — a boolean cannot distinguish the two, which is how backup failures stayed
silent historically.

Every snapshot is written to a ``.tmp`` sidecar, integrity-checked, then moved into
place with ``os.replace`` — a failed snapshot can never destroy the last good one.

``request_post_import_snapshot`` refreshes today's daily snapshot from a background
thread (single-flight) right after an import is confirmed/undone, so the day's
manual categorization work is never more than one import behind. The snapshot uses
the SQLite online backup API and is WAL-safe against the live dashboard.

``restore_backup`` is the recovery path — run it with the app STOPPED (see
``deploy/restore.sh``, which enforces that). Backup/restore failures never
propagate — they are logged and reported via the return value.
"""
import logging
import os
import shutil
import sqlite3
import threading
from datetime import date
from pathlib import Path

import config

DB_PATH = config.DB_PATH
BACKUP_DIR = config.LOCAL_BACKUP_DIR
DAILY_BACKUPS_KEPT = config.DAILY_BACKUPS_KEPT
MONTHLY_BACKUPS_KEPT = config.MONTHLY_BACKUPS_KEPT

# Strict per-tier globs: the backup dir may hold foreign files and the OTHER tier —
# pruning one tier must never count or delete the other ("brokershark_2026-06-11.db"
# does not match the monthly pattern, "brokershark_2026-06.db" not the daily one).
_DAILY_GLOB = "brokershark_????-??-??.db"
_MONTHLY_GLOB = "brokershark_????-??.db"

_logger = logging.getLogger(__name__)


def _daily_path(day: date) -> Path:
    """Path of the daily snapshot for ``day``."""
    return Path(BACKUP_DIR) / f"brokershark_{day:%Y-%m-%d}.db"


def _monthly_path(day: date) -> Path:
    """Path of the monthly snapshot for ``day``'s month."""
    return Path(BACKUP_DIR) / f"brokershark_{day:%Y-%m}.db"


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
            # The destination inherits WAL mode from the copied header; switch the
            # SNAPSHOT to rollback journal so it stays a single clean file — no
            # -wal/-shm sidecars now or when someone later opens it to inspect.
            dest.execute("PRAGMA journal_mode=DELETE")
        finally:
            dest.close()
    finally:
        src.close()
    for suffix in ("-wal", "-shm"):
        _safe_unlink(Path(dest_path + suffix))


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


def _write_snapshot(dest: Path) -> bool:
    """Snapshot ``DB_PATH`` into ``dest`` atomically (tmp → verify → ``os.replace``).

    A snapshot that fails to write or fails the integrity check is discarded and
    NEVER clobbers an existing good ``dest``. Returns True on success, False
    (logged) on any failure.
    """
    tmp = dest.with_name(dest.name + ".tmp")
    try:
        _snapshot(DB_PATH, str(tmp))
    except (sqlite3.Error, OSError) as exc:
        _logger.warning("Failed to write snapshot %s: %s", tmp, exc)
        _safe_unlink(tmp)
        return False
    if not verify_backup(str(tmp)):
        _logger.error("Snapshot failed integrity check — discarding %s", tmp)
        _safe_unlink(tmp)
        return False
    try:
        os.replace(tmp, dest)
    except OSError as exc:
        _logger.warning("Failed to move snapshot into place (%s): %s", dest, exc)
        _safe_unlink(tmp)
        return False
    return True


def run_backup(today: date | None = None) -> str:
    """Create the daily and/or monthly snapshot if absent; prune each tier.

    Args:
        today: Anchor date (defaults to ``date.today()``) — injectable for tests.

    Returns:
        ``"created"`` if at least one tier was written, ``"skipped"`` if both
        snapshots for the period already exist, ``"failed"`` on any real failure
        (missing source DB, unwritable backup dir, snapshot/integrity error).
        Failures are logged, never raised.
    """
    day = today or date.today()
    if not Path(DB_PATH).exists():
        _logger.warning("Database file not found, skipping backup")
        return "failed"

    backup_dir = Path(BACKUP_DIR)
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        _logger.warning("Cannot create backup directory %s: %s", backup_dir, exc)
        return "failed"

    daily = _daily_path(day)
    created = False
    if not daily.exists():
        if not _write_snapshot(daily):
            return "failed"
        _logger.info("Daily backup created: %s", daily)
        _prune(backup_dir, _DAILY_GLOB, DAILY_BACKUPS_KEPT)
        created = True

    monthly = _monthly_path(day)
    if not monthly.exists():
        # Reuse today's verified daily snapshot — same bytes, no second backup pass.
        try:
            shutil.copy2(daily, monthly)
        except OSError as exc:
            _logger.warning("Failed to write monthly backup %s: %s", monthly, exc)
            return "failed"
        _logger.info("Monthly backup created: %s", monthly)
        _prune(backup_dir, _MONTHLY_GLOB, MONTHLY_BACKUPS_KEPT)
        created = True

    if not created:
        _logger.info("Backups for %s already exist — skipping.", day)
        return "skipped"
    return "created"


def refresh_daily_snapshot(today: date | None = None) -> bool:
    """Force-refresh today's daily snapshot (post-import hook), overwrite-safe.

    Unlike :func:`run_backup`, this OVERWRITES today's daily snapshot so the
    freshest import/categorization work is captured. The atomic tmp+verify+replace
    in :func:`_write_snapshot` guarantees a failure leaves the previous good
    snapshot untouched. Returns True on success, False (logged) on failure.
    """
    day = today or date.today()
    if not Path(DB_PATH).exists():
        _logger.warning("Database file not found, skipping post-import snapshot")
        return False
    try:
        Path(BACKUP_DIR).mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        _logger.warning("Cannot create backup directory %s: %s", BACKUP_DIR, exc)
        return False
    return _write_snapshot(_daily_path(day))


_post_import_lock = threading.Lock()
_post_import_pending = False


def request_post_import_snapshot() -> None:
    """Fire-and-forget refresh of today's daily snapshot (single-flight).

    Called from request handlers right after an import is confirmed or undone.
    Runs in a background thread so the HTTP response never waits on the HDD
    (cold spin-up can take seconds). Single-flight: while one snapshot is queued
    or running, further requests are dropped — a multi-account drop fires several
    confirms back-to-back and needs only one snapshot. A snapshot raced by a
    later confirm misses at most that confirm's rows; the next import refreshes.
    """
    global _post_import_pending
    with _post_import_lock:
        if _post_import_pending:
            return
        _post_import_pending = True

    def _worker() -> None:
        global _post_import_pending
        try:
            refresh_daily_snapshot()
        except Exception:  # thread boundary: nothing above can catch — log, never crash
            _logger.exception("Post-import snapshot failed unexpectedly")
        finally:
            with _post_import_lock:
                _post_import_pending = False

    threading.Thread(target=_worker, daemon=True, name="post-import-snapshot").start()


def restore_backup(backup_path: str) -> bool:
    """Restore a verified backup file into ``DB_PATH`` (run with the app STOPPED).

    Verifies the backup's integrity first (refuses on failure), copies the current
    database to a ``.pre-restore`` sidecar, clears any stale ``-wal``/``-shm`` so the
    restored file isn't shadowed by old WAL frames, then writes the backup over
    ``DB_PATH``. Returns True on success, False (logged) on any failure; never raises.

    With the dashboard running as an always-on service, stop it first —
    ``deploy/restore.sh`` wraps this function and enforces that.
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


def _prune(backup_dir: Path, pattern: str, keep: int) -> None:
    """Delete the oldest files matching ``pattern``, keeping the newest ``keep``.

    ISO date stamps in the names sort lexicographically = chronologically. The
    strict per-tier ``pattern`` guarantees foreign files and the other tier are
    never counted nor deleted.
    """
    backups = sorted(backup_dir.glob(pattern))
    for old in backups[:-keep]:
        old.unlink()
        _logger.info("Removed old local backup: %s", old)
