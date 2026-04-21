"""Google Sheets append-only mirror — never read back, never edited.

Design principles:
- Every INSERT in the database generates one append call here.
- Rows are never modified or deleted — Sheets is a write-only audit log.
- All public functions silently swallow exceptions so Sheets failures
  never propagate to the user or interrupt the bot flow.
- The gspread client is initialized once (module-level) and reused
  across all calls to avoid repeated OAuth handshakes.
"""
import logging
from pathlib import Path
from typing import Any

import gspread
from google.oauth2.service_account import Credentials

import config

CREDENTIALS_PATH = config.SHEETS_CREDENTIALS
SHEETS_ID = config.SHEETS_ID

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

_logger = logging.getLogger(__name__)
_client: gspread.Client | None = None


def _setup_error_log() -> None:
    Path("logs").mkdir(exist_ok=True)
    handler = logging.FileHandler("logs/sheets_errors.log")
    handler.setLevel(logging.ERROR)
    _logger.addHandler(handler)


_setup_error_log()


def _get_client() -> gspread.Client:
    """Return the cached gspread client, initializing it on first call.

    Returns:
        An authenticated :class:`gspread.Client` instance.
    """
    global _client
    if _client is None:
        creds = Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=SCOPES)
        _client = gspread.authorize(creds)
    return _client


def _get_worksheet(sheet_name: str) -> gspread.Worksheet:
    """Open a worksheet by name from the configured spreadsheet.

    Args:
        sheet_name: The worksheet tab name (e.g. ``"Gastos"``).

    Returns:
        The requested :class:`gspread.Worksheet`.
    """
    return _get_client().open_by_key(SHEETS_ID).worksheet(sheet_name)


def _clean(value: Any) -> Any:
    """Return empty string for ``None``, otherwise return the value unchanged."""
    return "" if value is None else value


def _fmt_amount(value: Any) -> str:
    """Format a numeric value as a Brazilian currency string (``"1234,56"``).

    Args:
        value: Numeric value or anything coercible to float.

    Returns:
        Formatted string with comma decimal separator, or empty string on error.
    """
    try:
        return f"{float(value):.2f}".replace(".", ",")
    except (TypeError, ValueError):
        return str(value) if value is not None else ""


def _expense_row(t: dict) -> list:
    return [
        _clean(t.get("id")),
        _clean(t.get("date")),
        _clean(t.get("method")),
        _clean(t.get("bank")),
        _clean(t.get("account_id")),
        _fmt_amount(t.get("amount")),
        _clean(t.get("installments", 1)),
        _clean(t.get("description")),
        _clean(t.get("category")),
        _clean(t.get("registered_at")),
    ]


def _income_row(t: dict) -> list:
    return [
        _clean(t.get("id")),
        _clean(t.get("date")),
        _clean(t.get("method")),
        _clean(t.get("bank")),
        _clean(t.get("account_id")),
        _fmt_amount(t.get("amount")),
        _clean(t.get("description")),
        _clean(t.get("registered_at")),
    ]


# ── Headers ───────────────────────────────────────────────────────────────────

_HEADERS = {
    "Gastos": ["id", "data", "meio", "banco", "conta_id", "valor", "parcelas", "descricao", "categoria", "data_registro"],
    "Recebimentos": ["id", "data", "meio", "banco", "conta_id", "valor", "descricao", "data_registro"],
    "Investimentos": ["id", "data", "reserva", "operacao", "valor", "descricao", "data_registro"],
}


def setup_headers() -> None:
    """Insert header rows at row 1 of each sheet if not already present.

    Safe to call on every startup — checks existing content before writing.
    Failures are logged and silently suppressed.
    """
    try:
        spreadsheet = gspread.authorize(
            Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=SCOPES)
        ).open_by_key(SHEETS_ID)
        for sheet_name, headers in _HEADERS.items():
            ws = spreadsheet.worksheet(sheet_name)
            first_row = ws.row_values(1)
            if first_row != headers:
                ws.insert_row(headers, index=1)
    except Exception:
        _logger.exception("Failed to setup headers in Sheets")


# ── Single-row (bot flow) ─────────────────────────────────────────────────────

def append_expense(transaction: dict) -> None:
    """Append one expense row to the *Gastos* sheet.

    Args:
        transaction: Dict with keys ``id``, ``date``, ``method``, ``bank``,
            ``account_id``, ``amount``, ``installments``, ``description``,
            ``category``, ``registered_at``.
    """
    try:
        ws = _get_worksheet("Gastos")
        ws.append_row(_expense_row(transaction), value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to append expense to Sheets")


def append_income(transaction: dict) -> None:
    """Append one income row to the *Recebimentos* sheet.

    Args:
        transaction: Dict with keys ``id``, ``date``, ``method``, ``bank``,
            ``account_id``, ``amount``, ``description``, ``registered_at``.
    """
    try:
        ws = _get_worksheet("Recebimentos")
        ws.append_row(_income_row(transaction), value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to append income to Sheets")


def append_investment(movement: dict) -> None:
    """Append one investment movement row to the *Investimentos* sheet.

    Args:
        movement: Dict with keys ``id``, ``date``, ``investment_name``,
            ``operation``, ``amount``, ``description``, ``registered_at``.
    """
    try:
        ws = _get_worksheet("Investimentos")
        row = [
            _clean(movement.get("id")),
            _clean(movement.get("date")),
            _clean(movement.get("investment_name")),
            _clean(movement.get("operation")),
            _fmt_amount(movement.get("amount")),
            _clean(movement.get("description")),
            _clean(movement.get("registered_at")),
        ]
        ws.append_row(row, value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to append investment to Sheets")


# ── Batch (CSV import) — single API call for all rows ─────────────────────────

def batch_append_expenses(transactions: list[dict]) -> None:
    """Send all expense rows in a single API call to avoid rate limiting.

    Args:
        transactions: List of expense dicts (same shape as :func:`append_expense`).
    """
    if not transactions:
        return
    try:
        ws = _get_worksheet("Gastos")
        rows = [_expense_row(t) for t in transactions]
        ws.append_rows(rows, value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to batch append expenses to Sheets")


def batch_append_incomes(transactions: list[dict]) -> None:
    """Send all income rows in a single API call.

    Args:
        transactions: List of income dicts (same shape as :func:`append_income`).
    """
    if not transactions:
        return
    try:
        ws = _get_worksheet("Recebimentos")
        rows = [_income_row(t) for t in transactions]
        ws.append_rows(rows, value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to batch append incomes to Sheets")
