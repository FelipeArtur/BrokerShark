"""Entry point — boots the web dashboard and serves it in the foreground.

Designed to run as a systemd **user** service (``deploy/systemd/
brokershark-dashboard.service``): the process blocks on the WSGI server, logs to
stdout (journald), and exits non-zero on a bad environment so ``Restart=on-failure``
can act. The periodic backup runs separately as a systemd user timer
(``backend/jobs/backup.py``). ``bootstrap`` is imported first so ``.env`` loads
before ``config`` is read.
"""
from bootstrap import bootstrap

from dashboard import run_dashboard


def main() -> None:
    """Bootstrap the process and serve the dashboard until terminated."""
    bootstrap()  # load_dotenv + config.validate + logging + database.init_db
    run_dashboard()


if __name__ == "__main__":
    main()
