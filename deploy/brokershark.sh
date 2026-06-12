#!/usr/bin/env bash
# BrokerShark — atalho de abertura: garante o serviço no ar e abre o browser.
# O dashboard roda como serviço systemd de usuário (sempre ativo); este script
# existe só para o duplo-clique/atalho de desktop.
set -euo pipefail
systemctl --user is-active --quiet brokershark-dashboard.service \
    || systemctl --user start brokershark-dashboard.service
exec xdg-open "http://localhost:${DASHBOARD_PORT:-8080}"
