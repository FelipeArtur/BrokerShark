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
LOCAL_BACKUP_DIR: str = os.getenv("LOCAL_BACKUP_DIR", "backups")
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
LOG_DIR: str = "logs"
LOG_FORMAT: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
