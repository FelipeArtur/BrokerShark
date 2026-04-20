"""
Nubank credit card CSV parser.

Expected columns (exported from Nubank app):
    date, category, title, amount

Example row:
    2026-03-15,Restaurantes,iFood,85.50
"""
import csv
import io
from datetime import datetime
from typing import Any


def parse(content: str) -> list[dict[str, Any]]:
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
                "date":        date,
                "flow":        "expense",
                "method":      "credit",
                "account_id":  "nu-cc",
                "amount":      amount,
                "description": description,
                "installments": 1,
            })
        except (ValueError, KeyError):
            continue

    return transactions


def _normalize_date(raw: str) -> str | None:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
