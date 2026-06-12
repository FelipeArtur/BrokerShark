#!/usr/bin/env bash
# BrokerShark — restaura o banco a partir de um snapshot do HDD.
#
#   deploy/restore.sh /mnt/HDD_Arquivos/Backups/brokershark/brokershark_2026-06-11.db
#
# O restore NUNCA pode rodar com o dashboard escrevendo (always-on): este script
# para o serviço antes, restaura (com verificação de integridade + sidecar
# .pre-restore, ver core/backup.restore_backup) e religa o serviço ao final —
# inclusive quando o restore falha, porque nesse caso o banco fica intocado.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP="${1:?uso: deploy/restore.sh /caminho/para/brokershark_YYYY-MM-DD.db}"

RESTART=0
if systemctl --user is-active --quiet brokershark-dashboard.service; then
    echo "Parando o dashboard (restore exige o app parado)..."
    systemctl --user stop brokershark-dashboard.service
    RESTART=1
fi

set +e
PYTHONPATH=backend .venv/bin/python - "$BACKUP" <<'EOF'
import sys

import bootstrap  # noqa: F401  — só pelo load_dotenv no import (não chama bootstrap())
from core import backup

sys.exit(0 if backup.restore_backup(sys.argv[1]) else 1)
EOF
RC=$?
set -e

if [ "$RESTART" = 1 ]; then
    echo "Religando o dashboard..."
    systemctl --user start brokershark-dashboard.service
fi

if [ "$RC" = 0 ]; then
    echo "Restore concluído. Sidecar .pre-restore guardado ao lado do DB."
else
    echo "Restore FALHOU — banco original intocado. Veja o log acima." >&2
fi
exit "$RC"
