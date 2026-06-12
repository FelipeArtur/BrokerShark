"""Entrypoint: local monthly backup (systemd user timer: daily 07:00, Persistent).

    PYTHONPATH=backend python -m jobs.backup

Exits 1 only when the backup actually FAILED — that marks the unit failed (visible
in ``systemctl --user --failed``) and fires the OnFailure alert. A same-month
``"skipped"`` exits 0, so ``Persistent=true`` catch-ups and the daily retry slots
never raise false alarms. ``run_backup`` is idempotent (the month's snapshot is
only written when absent; post-import refreshes go through the dashboard, not here).
"""
import sys

from bootstrap import bootstrap

from core import backup as core_backup


def main() -> None:
    """Run the monthly backup; exit 1 on real failure (systemd visibility)."""
    bootstrap()
    if core_backup.run_backup() == "failed":
        sys.exit(1)


if __name__ == "__main__":
    main()
