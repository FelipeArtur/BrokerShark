"""
Inter credit card CSV parser.

Expected columns (exported from Inter app):
    Data, Lançamento, Categoria, Tipo, Valor

Amount format: "R$ 1,49" or "-R$ 766,75"
Negative amounts are payments/credits — skipped.

Example row:
    15/03/2026,Supermercado Extra,SUPERMERCADO,Compra à vista,"R$ 230,80"
"""
import csv
import io
from datetime import datetime
from typing import Any


def parse(content: str) -> list[dict[str, Any]]:
    content = content.lstrip("\ufeff")
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
                row.get("Lançamento") or row.get("Descrição") or row.get("Histórico") or row.get("description") or ""
            ).strip()
            if not description:
                continue

            transactions.append({
                "date":        date,
                "flow":        "expense",
                "method":      "credit",
                "account_id":  "inter-cc",
                "amount":      amount,
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
