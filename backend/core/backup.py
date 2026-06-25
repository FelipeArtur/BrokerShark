"""Monthly WAL-safe SQLite backup — local (HDD) snapshots via the SQLite backup API.

Single tier: ``brokershark_YYYY-MM.db`` — one file per month, keeps the last
``MONTHLY_BACKUPS_KEPT``. (The daily tier was removed 2026-06-12 by owner decision:
monthly-only.)

Runs via a systemd user timer (daily 07:00) — ``Persistent=true`` only replays
*missed* runs, never *failed* ones, so the daily schedule is the retry mechanism:
an HDD that wasn't mounted when the month rolled over is covered on the next
morning the run succeeds. The run is idempotent and keyed on file ABSENCE (never
on "today is the 1st"), so a late catch-up on the 3rd still produces the month's
snapshot.

``run_backup`` is tri-state (``"created" | "skipped" | "failed"``) so the job
entrypoint can exit non-zero on real failures (visible in ``systemctl --user
--failed`` and the OnFailure alert unit) without flagging legitimate same-month
skips — a boolean cannot distinguish the two, which is how backup failures stayed
silent historically.

Every snapshot is written to a ``.tmp`` sidecar, integrity-checked, then moved into
place with ``os.replace`` — a failed snapshot can never destroy the last good one.

``request_post_import_snapshot`` refreshes the CURRENT month's snapshot from a
background thread (single-flight) right after an import is confirmed/undone, so the
month's file is never more than one import behind (and ends the month as the
month-end close). The snapshot uses the SQLite online backup API and is WAL-safe
against the live dashboard.

``restore_backup`` is the recovery primitive — verify + ``.pre-restore`` sidecar +
atomic swap. Drive it through the safe operational wrapper ``python -m jobs.restore``,
which refuses to run while the dashboard is serving (restoring under a live writer
corrupts the DB) and confirms before swapping. Backup/restore failures never
propagate — they are logged and reported via the return value.
"""
import logging
import os
import shutil
import sqlite3
import threading
import time
from datetime import date
from pathlib import Path

import config

DB_PATH = config.DB_PATH
BACKUP_DIR = config.LOCAL_BACKUP_DIR
MONTHLY_BACKUPS_KEPT = config.MONTHLY_BACKUPS_KEPT

# Strict glob: the backup dir may hold foreign files (and legacy daily snapshots
# ``brokershark_YYYY-MM-DD.db``) — pruning must never count or delete them
# ("brokershark_2026-06-11.db" does not match the monthly pattern).
_MONTHLY_GLOB = "brokershark_????-??.db"

_logger = logging.getLogger(__name__)


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
    """Create the month's snapshot if absent; prune old months.

    Args:
        today: Anchor date (defaults to ``date.today()``) — injectable for tests.

    Returns:
        ``"created"`` if the month's snapshot was written, ``"skipped"`` if it
        already exists, ``"failed"`` on any real failure (missing source DB,
        unwritable backup dir, snapshot/integrity error). Failures are logged,
        never raised.
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

    monthly = _monthly_path(day)
    if monthly.exists():
        _logger.info("Backup for %s already exists — skipping.", f"{day:%Y-%m}")
        return "skipped"

    if not _write_snapshot(monthly):
        return "failed"
    _logger.info("Monthly backup created: %s", monthly)
    _prune(backup_dir, _MONTHLY_GLOB, MONTHLY_BACKUPS_KEPT)
    return "created"


def refresh_monthly_snapshot(today: date | None = None) -> bool:
    """Force-refresh the current month's snapshot (post-import hook), overwrite-safe.

    Unlike :func:`run_backup`, this OVERWRITES the month's snapshot so the
    freshest import/categorization work is captured (the file ends the month as
    the month-end close). The atomic tmp+verify+replace in :func:`_write_snapshot`
    guarantees a failure leaves the previous good snapshot untouched. Returns True
    on success, False (logged) on failure.
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
    return _write_snapshot(_monthly_path(day))


_post_import_lock = threading.Lock()
_post_import_pending = False


def request_post_import_snapshot() -> None:
    """Fire-and-forget refresh of the month's snapshot (single-flight).

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
        """Run the snapshot off-thread; always release the single-flight latch."""
        global _post_import_pending
        try:
            refresh_monthly_snapshot()
        except Exception:  # thread boundary: nothing above can catch — log, never crash
            _logger.exception("Post-import snapshot failed unexpectedly")
        finally:
            with _post_import_lock:
                _post_import_pending = False

    threading.Thread(target=_worker, daemon=True, name="post-import-snapshot").start()


def _live_db_mtime() -> float:
    """Newest mtime among the DB file and its ``-wal`` sidecar (captures recent commits)."""
    newest = 0.0
    for suffix in ("", "-wal"):
        p = Path(DB_PATH + suffix)
        if p.exists():
            newest = max(newest, p.stat().st_mtime)
    return newest


def request_startup_snapshot() -> None:
    """On app open: refresh the month's snapshot if the DB changed since the last one.

    Fire-and-forget from a background thread so the HDD spin-up never blocks serving.
    Change-gated: if the current month's snapshot is already newer than the live DB
    (including uncheckpointed ``-wal``), it's a no-op — re-opening the app without
    edits writes nothing. Otherwise it captures everything done since the last
    snapshot (categorization, edits) and prunes old months. The owner runs no
    scheduler; this ties the backup to *using* the app (decision 2026-06-24).
    """
    def _worker() -> None:
        """Snapshot off-thread when stale; never crash the boot."""
        try:
            _snapshot_if_stale()
        except Exception:  # thread boundary — log, never take the dashboard down
            _logger.exception("Startup snapshot failed unexpectedly")

    threading.Thread(target=_worker, daemon=True, name="startup-snapshot").start()


def _snapshot_if_stale(today: date | None = None) -> bool:
    """Refresh the month's snapshot only if the live DB changed since it; prune on write.

    Returns True when a snapshot was written. Change-gate keeps repeated app-opens
    with no edits from spinning the HDD.
    """
    day = today or date.today()
    snap = _monthly_path(day)
    if snap.exists() and snap.stat().st_mtime >= _live_db_mtime():
        return False
    if refresh_monthly_snapshot(day):
        _prune(Path(BACKUP_DIR), _MONTHLY_GLOB, MONTHLY_BACKUPS_KEPT)
        return True
    return False


def last_backup_info() -> dict:
    """Freshness of the newest monthly snapshot, for the dashboard indicator.

    Returns ``{exists, name, age_seconds}``. ``exists=False`` when there is no
    snapshot yet or the backup dir is unreachable (HDD unmounted) — the dashboard
    surfaces that so a silently-failing backup (the historical footgun) can't hide.
    """
    try:
        snaps = sorted(Path(BACKUP_DIR).glob(_MONTHLY_GLOB))
    except OSError:
        snaps = []
    if not snaps:
        return {"exists": False, "name": None, "age_seconds": None}
    newest = snaps[-1]
    age = max(0, int(time.time() - newest.stat().st_mtime))
    return {"exists": True, "name": newest.name, "age_seconds": age}


def restore_backup(backup_path: str) -> bool:
    """Restore a verified backup file into ``DB_PATH`` (run with the app STOPPED).

    Verifies the backup's integrity first (refuses on failure), copies the current
    database to a ``.pre-restore`` sidecar, clears any stale ``-wal``/``-shm`` so the
    restored file isn't shadowed by old WAL frames, then atomically swaps the backup
    into ``DB_PATH``. Returns True on success, False (logged) on any failure; never raises.

    Prefer the wrapper ``python -m jobs.restore`` — it refuses to run while the
    dashboard is serving (restoring under the live writer corrupts the DB) and
    confirms first. Call this directly only with the app already stopped.
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
        # Stage then atomically swap: a mid-copy failure never leaves DB_PATH
        # half-written (and the .pre-restore sidecar is the explicit undo path).
        tmp = db.with_name(db.name + ".restore-tmp")
        try:
            shutil.copy2(src, tmp)  # backup is a clean single-file snapshot
            os.replace(tmp, db)
        except OSError:
            _safe_unlink(tmp)
            raise
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
    strict ``pattern`` guarantees foreign files (incl. legacy daily snapshots)
    are never counted nor deleted.
    """
    backups = sorted(backup_dir.glob(pattern))
    for old in backups[:-keep]:
        old.unlink()
        _logger.info("Removed old local backup: %s", old)
