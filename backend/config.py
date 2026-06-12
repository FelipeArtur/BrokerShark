"""Application configuration.

Single module responsible for reading environment variables. All other modules
import named constants from here — never call os.getenv() elsewhere.
"""
import logging
import os
from pathlib import Path

# ── Database ──────────────────────────────────────────────────────────────────
DB_PATH: str = os.getenv("DB_PATH", "data/brokershark.db")

# ── Backup — local (HDD) ──────────────────────────────────────────────────────
LOCAL_BACKUP_DIR: str = "/mnt/HDD_Arquivos/Backups/brokershark"
MAX_BACKUPS: int = 12  # TODO(E3): substituído por DAILY/MONTHLY_BACKUPS_KEPT no backup 2 camadas

# ── Dashboard ─────────────────────────────────────────────────────────────────
DASHBOARD_PORT: int = int(os.getenv("DASHBOARD_PORT", "8080"))
FRONTEND_DIR: Path = Path(__file__).parent.parent / "frontend"

# ── Ingestão ──────────────────────────────────────────────────────────────────
# Identificadores do próprio dono nos campos de contraparte dos extratos (nome
# e/ou fragmento de CPF, como aparecem na descrição). Usado para classificar
# auto-Pix/TED entre as contas do usuário como transferência (counterpart='SELF'),
# fora de despesas/receitas. Comma-separated; minúsculas; override por env.
OWNER_SELF_KEYWORDS: tuple[str, ...] = tuple(
    k.strip().lower()
    for k in os.getenv("OWNER_SELF_KEYWORDS", "joao da silva souza,000.000").split(",")
    if k.strip()
)

# ── Logging ───────────────────────────────────────────────────────────────────
# Logs vão para stdout (journald quando rodando como serviço systemd).
LOG_FORMAT: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


def validate() -> None:
    """Fail fast if the database location is unusable.

    Called at startup (``bootstrap``), never at import — so tests and tooling can
    import this module with an empty environment. Resolves ``DB_PATH`` to an
    absolute path and logs it, because a relative ``DB_PATH`` silently creates an
    empty database wherever the process happens to start (the most treacherous
    failure mode of this app). Raises ``SystemExit`` if the parent directory
    cannot be created.
    """
    resolved = Path(DB_PATH).resolve()
    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SystemExit(
            f"Config inválida: diretório do DB_PATH ({resolved.parent}) não pode ser criado: {exc}"
        ) from exc
    logging.getLogger(__name__).info("DB_PATH resolvido: %s", resolved)
