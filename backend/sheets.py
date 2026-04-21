"""Google Sheets append-only mirror — never read back, never edited."""
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


def _setup_error_log() -> None:
    Path("logs").mkdir(exist_ok=True)
    handler = logging.FileHandler("logs/sheets_errors.log")
    handler.setLevel(logging.ERROR)
    _logger.addHandler(handler)


_setup_error_log()


def _get_worksheet(sheet_name: str) -> gspread.Worksheet:
    creds = Credentials.from_service_account_file(CREDENTIALS_PATH, scopes=SCOPES)
    client = gspread.authorize(creds)
    return client.open_by_key(SHEETS_ID).worksheet(sheet_name)


def _clean(value: Any) -> Any:
    return "" if value is None else value


def _fmt_amount(value: Any) -> str:
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
    """Insert header row at row 1 of each sheet if not already present."""
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
    try:
        ws = _get_worksheet("Gastos")
        ws.append_row(_expense_row(transaction), value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to append expense to Sheets")


def append_income(transaction: dict) -> None:
    try:
        ws = _get_worksheet("Recebimentos")
        ws.append_row(_income_row(transaction), value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to append income to Sheets")


def append_investment(movement: dict) -> None:
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
    """Send all expense rows in a single API call — avoids rate limiting on bulk imports."""
    if not transactions:
        return
    try:
        ws = _get_worksheet("Gastos")
        rows = [_expense_row(t) for t in transactions]
        ws.append_rows(rows, value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to batch append expenses to Sheets")


def batch_append_incomes(transactions: list[dict]) -> None:
    """Send all income rows in a single API call."""
    if not transactions:
        return
    try:
        ws = _get_worksheet("Recebimentos")
        rows = [_income_row(t) for t in transactions]
        ws.append_rows(rows, value_input_option="USER_ENTERED", table_range="A1")
    except Exception:
        _logger.exception("Failed to batch append incomes to Sheets")
