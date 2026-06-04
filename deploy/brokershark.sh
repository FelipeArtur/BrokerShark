#!/usr/bin/env bash
# BrokerShark — on-demand launcher.
# Starts the dashboard + Telegram bot in the foreground and opens the browser.
# Stop it (Ctrl-C / close) when you're done — nothing stays running in the background
# except the systemd timers (backup / weekly / monthly closing).
set -euo pipefail
cd "$(dirname "$0")/.."
( sleep 2; xdg-open http://localhost:8080 >/dev/null 2>&1 || true ) &
exec .venv/bin/python backend/main.py
