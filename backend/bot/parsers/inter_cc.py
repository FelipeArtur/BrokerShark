"""Inter credit card CSV parser.

Expected columns (exported from the Inter app):
    Data, Lançamento, Categoria, Tipo, Valor

Amount format examples::

    "R$ 230,80"      →  230.80  (expense — kept)
    "-R$ 766,75"     → -766.75  (payment/credit — skipped)

The file may include a UTF-8 BOM (``\\ufeff``), which is stripped before parsing.
Date formats accepted: ``%d/%m/%Y``, ``%Y-%m-%d``, ``%d/%m/%y``.
"""
import csv
import io
from datetime import datetime
from typing import Any


def parse(content: str) -> list[dict[str, Any]]:
    """Parse an Inter credit card CSV export into a list of transaction dicts.

    Args:
        content: Raw CSV text from the Inter app export (BOM-safe).

    Returns:
        List of transaction dicts ready for :func:`core.database.insert_transaction`.
        Each dict contains: ``date``, ``flow``, ``method``, ``account_id``,
        ``amount``, ``description``, ``installments``.
    """
    content = content.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(content))
    transactions = []

    for row in reader:
        try:
            raw_date = (
                row.get("Data") or row.get("Data Lançamento") or row.get("date") or ""
            ).strip()
            date = _normalize_date(raw_date)
            if date is None:
                continue

            raw_amount = (
                (row.get("Valor") or row.get("amount") or "")
                .strip()
                .replace("R$", "")
                .replace("\xa0", "")
                .strip()
                .replace(".", "")
                .replace(",", ".")
            )
            amount = float(raw_amount)
            if amount <= 0:
                continue

            description = (
                row.get("Lançamento")
                or row.get("Descrição")
                or row.get("Histórico")
                or row.get("description")
                or ""
            ).strip()
            if not description:
                continue

            transactions.append({
                "date":         date,
                "flow":         "expense",
                "method":       "credit",
                "account_id":   "inter-cc",
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
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
