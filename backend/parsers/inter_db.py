"""
Inter checking account CSV parser.

Expected columns (exported from Inter app):
    Data, Tipo, Descrição, Valor

Positive Valor = credit (income), negative = debit (expense).
Tipo examples: "Pix", "TED", "Débito", "Crédito em conta"

Example rows:
    15/03/2026,Pix,João Silva,500.00
    16/03/2026,Débito,Posto Shell,-120.00
"""
import csv
import io
from datetime import datetime
from typing import Any

_INCOME_TIPOS = {"crédito em conta", "pix recebido", "ted recebida", "transferência recebida"}
_METHOD_MAP = {
    "pix":        "pix",
    "ted":        "ted",
    "débito":     "debit",
    "transferência": "transfer",
}


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

            description = (
                row.get("Descrição") or row.get("Histórico") or row.get("description") or ""
            ).strip()
            if not description:
                continue

            tipo = (row.get("Tipo") or "").strip().lower()

            if amount > 0 or tipo in _INCOME_TIPOS:
                method = "pix_received" if "pix" in tipo else "transfer"
                transactions.append({
                    "date":        date,
                    "flow":        "income",
                    "method":      method,
                    "account_id":  "inter-db",
                    "amount":      abs(amount),
                    "description": description,
                    "installments": 1,
                })
            else:
                method = _METHOD_MAP.get(tipo, "debit")
                transactions.append({
                    "date":        date,
                    "flow":        "expense",
                    "method":      method,
                    "account_id":  "inter-db",
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
