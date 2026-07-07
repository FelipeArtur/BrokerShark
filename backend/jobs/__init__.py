"""Oneshot job entrypoints (run manually — no scheduler, by design).

Run from the repo root with the backend dir on the path:

    PYTHONPATH=backend python -m jobs.backup

Each entrypoint imports ``bootstrap`` first (loads .env before config is read),
calls ``bootstrap()``, then does its one thing and exits.
"""
