"""Pure utility helpers shared across all bot handlers.

Contains authorization check, BRL formatter, date helpers, and amount parser.
No side effects — safe to import from any module.
"""
import logging
from datetime import datetime
from typing import Optional

from telegram import Update

import config

_logger = logging.getLogger(__name__)

_PT_MONTHS: list[str] = [
    "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]


def _authorized(update: Update) -> bool:
    """Return True if the update comes from the authorised chat."""
    return update.effective_chat.id == config.TELEGRAM_CHAT_ID


def _fmt_brl(value: float) -> str:
    """Format a float as Brazilian Real, e.g. 1234.5 → 'R$ 1.234,50'."""
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_date(iso: str) -> str:
    """Convert YYYY-MM-DD to DD/MM/YYYY, returning the original string on failure."""
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return iso


def _parse_purchase_date(text: str) -> Optional[tuple[str, str]]:
    """Parse a user-supplied date (DD/MM/YYYY or DD/MM/YYYY HH:MM).

    Returns (db_date: YYYY-MM-DD, display: DD/MM/YYYY [HH:MM]), or None if invalid.
    """
    text = text.strip()
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%m/%Y %H:%M")
        except ValueError:
            continue
    try:
        dt = datetime.strptime(text, "%d/%m/%Y")
        return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%m/%Y")
    except ValueError:
        return None


def _parse_amount(text: str) -> Optional[float]:
    """Parse a BRL amount string, accepting comma or dot as decimal separator."""
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None
