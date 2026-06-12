"""Entrypoint: local two-tier backup (systemd user timer: 07/13/19h, Persistent).

    PYTHONPATH=backend python -m jobs.backup

Exits 1 only when the backup actually FAILED — that marks the unit failed (visible
in ``systemctl --user --failed``) and fires the OnFailure alert. A same-day
``"skipped"`` exits 0, so ``Persistent=true`` catch-ups and the extra daily slots
never raise false alarms. ``run_backup`` is idempotent per tier (daily/monthly
snapshots are only written when absent).
"""
import sys

from bootstrap import bootstrap

from core import backup as core_backup


def main() -> None:
    """Run the two-tier backup; exit 1 on real failure (systemd visibility)."""
    bootstrap()
    if core_backup.run_backup() == "failed":
        sys.exit(1)


if __name__ == "__main__":
    main()
