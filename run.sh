#!/bin/sh
# Foreground dashboard — logs straight to this terminal (Ctrl-C to stop).
# No always-on service, by design (old systemd model lives in git log).
cd "$(dirname "$0")"
exec env PYTHONPATH=backend .venv/bin/python backend/main.py
