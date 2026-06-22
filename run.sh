#!/bin/sh
# Foreground dashboard — logs straight to this terminal (Ctrl-C to stop).
# Stands in for the systemd service while it's paused. Re-enable systemd later:
#   systemctl --user enable --now brokershark-dashboard.service brokershark-backup.timer
cd "$(dirname "$0")"
exec env PYTHONPATH=backend .venv/bin/python backend/main.py
