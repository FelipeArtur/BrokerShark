"""Oneshot job entrypoints fired by systemd user timers.

Run from the repo root with the backend dir on the path:

    PYTHONPATH=backend python -m jobs.backup
    PYTHONPATH=backend python -m jobs.weekly_report
    PYTHONPATH=backend python -m jobs.monthly_closing

Each entrypoint imports ``bootstrap`` first (loads .env before config is read),
calls ``bootstrap()``, then does its one thing and exits. See ``deploy/`` for the
.service/.timer units (``Persistent=true`` → catch-up on boot).
"""
