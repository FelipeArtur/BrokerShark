"""
Nubank checking account CSV parser.

Expected columns (exported from Nubank app):
    Data, Descrição, Valor

Positive Valor = credit (income), negative = debit (expense).

Example rows:
    15/03/2026,Transferência recebida,1500.00
    16/03/2026,iFood,-45.00
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
            raw_date = (row.get("Data") or row.get("date") or "").strip()
            date = _normalize_date(raw_date)
            if date is None:
                continue

            raw_amount = (
                (row.get("Valor") or row.get("amount") or "")
                .strip()
                .replace(".", "")
                .replace(",", ".")
            )
            amount = float(raw_amount)
            if amount == 0:
                continue

            description = (row.get("Descrição") or row.get("description") or "").strip()
            if not description:
                continue

            if amount > 0:
                transactions.append({
                    "date":        date,
                    "flow":        "income",
                    "method":      "pix_received",
                    "account_id":  "nu-db",
                    "amount":      amount,
                    "description": description,
                    "installments": 1,
                })
            else:
                transactions.append({
                    "date":        date,
                    "flow":        "expense",
                    "method":      "debit",
                    "account_id":  "nu-db",
                    "amount":      abs(amount),
                    "description": description,
                    "installments": 1,
                })
        except (ValueError, KeyError):
            continue

    return transactions


def _normalize_date(raw: str) -> str | None:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
