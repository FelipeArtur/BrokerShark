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
BACKUP_DIR: str = os.getenv("BACKUP_DIR", "backups")
MAX_BACKUPS: int = 30

# ── Google Sheets ─────────────────────────────────────────────────────────────
SHEETS_CREDENTIALS: str = os.getenv(
    "SHEETS_CREDENTIALS", "credentials/service_account.json"
)
SHEETS_ID: str = os.getenv("SHEETS_ID", "")

# ── Dashboard ─────────────────────────────────────────────────────────────────
DASHBOARD_PORT: int = int(os.getenv("DASHBOARD_PORT", "8080"))
FRONTEND_DIR: Path = Path(__file__).parent.parent / "frontend"

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_DIR: str = "logs"
LOG_FORMAT: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
