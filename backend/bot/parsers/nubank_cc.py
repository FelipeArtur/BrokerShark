"""Nubank credit card CSV parser.

Expected columns (exported from the Nubank app):
    date, category, title, amount

Example row::

    2026-03-15,Restaurantes,iFood,85.50

Rows where ``amount <= 0`` (refunds/payments) or ``title`` is empty are skipped.
Date formats accepted: ``%Y-%m-%d``, ``%d/%m/%Y``, ``%d/%m/%y``.
"""
import csv
import io
from datetime import datetime
from typing import Any


def parse(content: str) -> list[dict[str, Any]]:
    """Parse a Nubank credit card CSV export into a list of transaction dicts.

    Args:
        content: Raw CSV text from the Nubank app export.

    Returns:
        List of transaction dicts ready for :func:`core.database.insert_transaction`.
        Each dict contains: ``date``, ``flow``, ``method``, ``account_id``,
        ``amount``, ``description``, ``installments``.
    """
    reader = csv.DictReader(io.StringIO(content))
    transactions = []

    for row in reader:
        try:
            raw_date = row.get("date", "").strip()
            date = _normalize_date(raw_date)
            if date is None:
                continue

            raw_amount = row.get("amount", "").strip().replace(",", ".")
            amount = float(raw_amount)
            if amount <= 0:
                continue

            description = row.get("title", "").strip()
            if not description:
                continue

            transactions.append({
                "date":         date,
                "flow":         "expense",
                "method":       "credit",
                "account_id":   "nu-cc",
                "amount":       amount,
                "description":  description,
                "installments": 1,
            })
        except (ValueError, KeyError):
            continue

    return transactions


def _normalize_date(raw: str) -> str | None:
    """Convert a date string to ``"YYYY-MM-DD"`` format.

    Args:
        raw: Date string in any of the accepted formats.

    Returns:
        ISO-formatted date string, or ``None`` if parsing fails.
    """
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
