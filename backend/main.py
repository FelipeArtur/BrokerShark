"""Entry point — boots the web dashboard and serves it in the foreground.

Runs in the foreground via ``./run.sh`` (deploy strategy in rethink — see TODOS T-C):
the process blocks on the WSGI server, logs to stdout, and exits non-zero on a bad
environment. The periodic backup runs separately (``backend/jobs/backup.py``, fired
manually for now). ``bootstrap`` is imported first so ``.env`` loads before ``config``
is read.
"""
from bootstrap import bootstrap

from dashboard import run_dashboard


def main() -> None:
    """Bootstrap the process and serve the dashboard until terminated."""
    bootstrap()  # load_dotenv + config.validate + logging + database.init_db
    run_dashboard()


if __name__ == "__main__":
    main()
