"""Inter credit card CSV parser.

Expected columns (exported from the Inter app):
    Data, Lançamento, Categoria, Tipo, Valor

Amount format examples::

    "R$ 230,80"      →  230.80  (expense — kept)
    "-R$ 766,75"     → -766.75  (payment/credit — skipped)

Installment handling: when "Tipo" is "Parcela N/M" and N > 1, the transaction
date is shifted forward by (N-1) months so each installment falls in its own
billing cycle and has a unique dedup key.

The file may include a UTF-8 BOM (``\\ufeff``), which is stripped before parsing.
Date formats accepted: ``%d/%m/%Y``, ``%Y-%m-%d``, ``%d/%m/%y``.
"""
import csv
import io
import re
from datetime import datetime, timedelta
from typing import Any

# These descriptions are revolving-credit charges posted by Inter on the day
# AFTER the billing cycle closes. They belong to the cycle that just closed,
# so backdate them by 1 day to keep them in the correct fatura range.
_PREV_CYCLE_CHARGES = frozenset({
    "IOF ADICIONAL DB PF",
    "IOF DIARIO DB PF",
    "ROTATIVO SALDO FINANCIADO",
    "ENCARGOS ROTATIVO",
})


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

            # Revolving-credit charges belong to the cycle that just closed —
            # backdate by 1 day so they stay outside the new cycle's range.
            if description in _PREV_CYCLE_CHARGES:
                dt = datetime.strptime(date, "%Y-%m-%d")
                date = (dt - timedelta(days=1)).strftime("%Y-%m-%d")

            # Shift date for installments N/M where N > 1 so each installment
            # falls in its own billing cycle with a unique dedup key.
            else:
                tipo = (row.get("Tipo") or "").strip()
                m = re.match(r"Parcela\s+(\d+)/\d+", tipo)
                if m:
                    n = int(m.group(1))
                    if n > 1:
                        dt = datetime.strptime(date, "%Y-%m-%d")
                        total_months = dt.month + (n - 1)
                        dt = dt.replace(
                            year=dt.year + (total_months - 1) // 12,
                            month=((total_months - 1) % 12) + 1,
                        )
                        date = dt.strftime("%Y-%m-%d")

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
