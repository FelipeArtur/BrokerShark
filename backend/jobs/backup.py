"""Entrypoint: monthly local backup (systemd timer: 1st 07:00, Persistent).

    PYTHONPATH=backend python -m jobs.backup

No Telegram needed. ``run_backup`` is idempotent (``should_backup`` guards the month),
so a ``Persistent=true`` catch-up after the PC was off simply runs once on boot.
"""
from bootstrap import bootstrap
from core import backup as core_backup


def main() -> None:
    bootstrap()
    core_backup.run_backup()


if __name__ == "__main__":
    main()
