#!/bin/sh
# Foreground dashboard — logs straight to this terminal (Ctrl-C to stop).
# No always-on service, by design (old systemd model lives in git log).
#
#   ./run.sh          serve only
#   ./run.sh --open   serve + open the browser once the port answers
cd "$(dirname "$0")"

if [ "$1" = "--open" ]; then
    (
        port="${DASHBOARD_PORT:-8080}"
        # Poll until the dashboard answers, then open it (max ~10s).
        for _ in $(seq 1 20); do
            if command -v curl >/dev/null 2>&1 \
               && curl -sf -o /dev/null "http://127.0.0.1:${port}/api/available"; then
                xdg-open "http://localhost:${port}" >/dev/null 2>&1
                exit 0
            fi
            sleep 0.5
        done
        xdg-open "http://localhost:${port}" >/dev/null 2>&1
    ) &
fi

exec env PYTHONPATH=backend .venv/bin/python backend/main.py
