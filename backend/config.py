"""Application configuration.

Single module responsible for reading environment variables. All other modules
import named constants from here — never call os.getenv() elsewhere.
"""
import os
from pathlib import Path

# ── Telegram ──────────────────────────────────────────────────────────────────
TELEGRAM_TOKEN: str = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID: int = int(os.getenv("TELEGRAM_CHAT_ID", "0"))

# ── Database ──────────────────────────────────────────────────────────────────
DB_PATH: str = os.getenv("DB_PATH", "data/brokershark.db")
MAX_BACKUPS: int = 12

# ── Backup — local (HDD) + Google Drive ───────────────────────────────────────
LOCAL_BACKUP_DIR: str = "/mnt/HDD_Arquivos/brokershark/backups"
GOOGLE_CREDENTIALS: str = os.getenv(
    "GOOGLE_CREDENTIALS", "credentials/service_account.json"
)
DRIVE_BACKUP_FOLDER: str = os.getenv("DRIVE_BACKUP_FOLDER", "BrokerShark Backups")

# ── Dashboard ─────────────────────────────────────────────────────────────────
DASHBOARD_PORT: int = int(os.getenv("DASHBOARD_PORT", "8080"))
FRONTEND_DIR: Path = Path(__file__).parent.parent / "frontend"

# ── Ollama ────────────────────────────────────────────────────────────────────
OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_TIMEOUT: int = int(os.getenv("OLLAMA_TIMEOUT", "60"))

# ── Logging ───────────────────────────────────────────────────────────────────
# Anchored to the repo root so logs land in one place regardless of CWD
# (running `python backend/main.py` from root vs running tests from backend/).
LOG_DIR: str = str(Path(__file__).parent.parent / "logs")
LOG_FORMAT: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


def validate() -> None:
    """Fail fast if required secrets are missing.

    Called at startup (``main.py``), never at import — so tests and tooling can
    import this module with an empty environment. Without this, an empty ``.env``
    boots a bot whose owner gate compares against ``TELEGRAM_CHAT_ID == 0`` and a
    blank token, with no loud failure.
    """
    missing = [
        name for name, val in (("TELEGRAM_TOKEN", TELEGRAM_TOKEN),
                                ("TELEGRAM_CHAT_ID", TELEGRAM_CHAT_ID))
        if not val
    ]
    if missing:
        raise SystemExit(
            f"Config inválida: defina {', '.join(missing)} no .env antes de iniciar."
        )
