"""Nubank checking account extrato CSV parser.

Expected CSV columns: Data, Valor, Descrição
Date formats accepted: %d/%m/%Y, %Y-%m-%d, %d/%m/%y
Positive valores = income, negative = expense.

Each parsed row contains a ``_type`` field:
- ``"transaction"``         — regular income or expense
- ``"transfer"``            — internal transfer between own accounts
- ``"investment_movement"`` — Caixinha Nubank deposit or withdrawal

Rows that should be silently skipped (e.g. self-transfers from Inter that are
already counted in inter-db) return ``None`` from :func:`_classify` and are
omitted from the output list.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Optional

_FATURA_KEYWORDS = ("pagamento de fatura", "pagamento da fatura")

_CAIXINHA_DEPOSIT = ("aplicação rdb", "dinheiro guardado")
_CAIXINHA_WITHDRAWAL = ("resgate rdb",)

# PIX received from own Inter account — already credited in inter-db, skip here
_SELF_INTER_MARKER = "banco inter"


def parse(content: str) -> list[dict[str, Any]]:
    """Parse a Nubank extrato CSV into classified row dicts.

    Args:
        content: Raw CSV text (UTF-8, BOM-safe).

    Returns:
        List of dicts.  Each dict contains at minimum ``_type``, ``date``,
        ``description``, and ``amount``.  Additional keys depend on ``_type``:

        ``"transaction"``:
            flow, method, account_id, is_revenue, counterpart (may be None)

        ``"transfer"``:
            flow, method, account_id, dest_account_id

        ``"investment_movement"``:
            investment_name, operation
    """
    content = content.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(content))
    rows: list[dict[str, Any]] = []
    for row in reader:
        try:
            date_raw = (row.get("Data") or "").strip()
            date = _normalize_date(date_raw)
            if not date:
                continue

            raw_valor = (row.get("Valor") or "").strip()
            if not raw_valor:
                continue
            valor = float(raw_valor)

            description = (row.get("Descrição") or "").strip()
            if not description:
                continue

            classified = _classify(description, valor)
            if classified is None:
                continue
            classified["date"] = date
            classified["description"] = description
            rows.append(classified)
        except (ValueError, KeyError):
            continue
    return rows


def _classify(description: str, valor: float) -> Optional[dict[str, Any]]:
    desc_lower = description.lower()

    # Credit card fatura payment → transfer from nu-db to nu-cc
    if any(kw in desc_lower for kw in _FATURA_KEYWORDS):
        return {
            "_type": "transfer",
            "flow": "expense",
            "method": "transfer",
            "account_id": "nu-db",
            "amount": abs(valor),
            "dest_account_id": "nu-cc",
        }

    # Caixinha Nubank – deposits
    if description == "Aplicação RDB" or any(kw in desc_lower for kw in _CAIXINHA_DEPOSIT):
        return {
            "_type": "investment_movement",
            "investment_name": "Caixinha Nubank",
            "operation": "deposit",
            "amount": abs(valor),
        }

    # Caixinha Nubank – withdrawals
    if description == "Resgate RDB" or any(kw in desc_lower for kw in _CAIXINHA_WITHDRAWAL):
        return {
            "_type": "investment_movement",
            "investment_name": "Caixinha Nubank",
            "operation": "withdrawal",
            "amount": abs(valor),
        }

    if valor > 0:
        # Self-transfer from own Inter account → skip (inter-db already credited)
        if "felipe artur macedo" in desc_lower and _SELF_INTER_MARKER in desc_lower:
            return None

        # Self-transfer from another own account → income but is_revenue=0
        if "felipe artur macedo" in desc_lower:
            method = "pix_received" if "transferência recebida" in desc_lower else "other"
            return {
                "_type": "transaction",
                "flow": "income",
                "method": method,
                "account_id": "nu-db",
                "amount": valor,
                "is_revenue": 0,
                "counterpart": "SELF",
            }

        # Regular income
        method = "pix_received" if "transferência recebida" in desc_lower else "other"
        return {
            "_type": "transaction",
            "flow": "income",
            "method": method,
            "account_id": "nu-db",
            "amount": valor,
            "is_revenue": 1,
            "counterpart": None,
        }

    if valor < 0:
        # Self-transfer to own Inter account
        if "felipe artur macedo" in desc_lower and _SELF_INTER_MARKER in desc_lower:
            return {
                "_type": "transfer",
                "flow": "expense",
                "method": "transfer",
                "account_id": "nu-db",
                "amount": abs(valor),
                "dest_account_id": "inter-db",
            }

        if "transferência enviada pelo pix" in desc_lower:
            method = "pix"
        elif "transferência enviada" in desc_lower:
            method = "ted"
        else:
            method = "pix"
        return {
            "_type": "transaction",
            "flow": "expense",
            "method": method,
            "account_id": "nu-db",
            "amount": abs(valor),
            "is_revenue": 0,
            "counterpart": None,
        }

    return None  # valor == 0, nothing to record


def _normalize_date(raw: str) -> Optional[str]:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
