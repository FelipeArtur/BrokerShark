"""Inter checking account extrato CSV parser.

Expected format:
- Delimiter: ``;``
- First few lines are metadata — parser skips until ``Data Lançamento`` header.
- Columns: ``Data Lançamento``, ``Descrição``, ``Valor``
- Amount format: Brazilian (``"1.400,20"`` → 1400.20; negative = expense)

Each parsed row contains a ``_type`` field:
- ``"transaction"``         — regular income or expense
- ``"transfer"``            — internal transfer between own accounts
- ``"investment_movement"`` — Porquinho Inter deposit or withdrawal

Rows that should be silently skipped (e.g. self-transfers from Nubank
already counted in nu-db) return ``None`` from :func:`_classify` and are
omitted from the output list.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Optional

_FATURA_KEYWORDS = ("pagamento efetuado",)

_PORQUINHO_DEPOSIT_KEYWORDS = ("aplicacao", "cdb porq")
_PORQUINHO_WITHDRAWAL_KEYWORDS = ("resgate", "estorno")
_PORQUINHO_MARKER = "porquinho"

# PIX received from own Nubank account — already in nu-db, skip here
_SELF_NUBANK_MARKER = "joao da silva"


def parse(content: str) -> list[dict[str, Any]]:
    """Parse an Inter extrato CSV into classified row dicts.

    Args:
        content: Raw CSV text (UTF-8/ISO-8859-1, BOM-safe).

    Returns:
        List of dicts.  Each dict contains at minimum ``_type``, ``date``,
        ``description``, and ``amount``.  Additional keys depend on ``_type``:

        ``"transaction"``:
            flow, method, account_id, is_revenue

        ``"transfer"``:
            flow, method, account_id, dest_account_id

        ``"investment_movement"``:
            investment_name, operation
    """
    content = content.lstrip("﻿")
    lines = content.splitlines()

    # Skip Inter metadata header block — find the line with column headers
    data_start = 0
    for i, line in enumerate(lines):
        if line.startswith("Data Lançamento") or line.startswith("Data La"):
            data_start = i
            break

    data_text = "\n".join(lines[data_start:])
    reader = csv.DictReader(io.StringIO(data_text), delimiter=";")

    rows: list[dict[str, Any]] = []
    for row in reader:
        try:
            raw_date = (
                row.get("Data Lançamento") or row.get("Data La") or ""
            ).strip()
            date = _normalize_date(raw_date)
            if not date:
                continue

            raw_valor = (row.get("Valor") or "").strip()
            if not raw_valor:
                continue
            valor = _parse_br_value(raw_valor)

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

    # Credit card fatura payment → transfer from inter-db to inter-cc
    if any(kw in desc_lower for kw in _FATURA_KEYWORDS) and "fatura" in desc_lower:
        return {
            "_type": "transfer",
            "flow": "expense",
            "method": "transfer",
            "account_id": "inter-db",
            "amount": abs(valor),
            "dest_account_id": "inter-cc",
        }

    # Porquinho Inter – detect deposits and withdrawals
    is_porquinho = _PORQUINHO_MARKER in desc_lower or "cdb porq" in desc_lower
    if is_porquinho:
        is_withdrawal = any(kw in desc_lower for kw in _PORQUINHO_WITHDRAWAL_KEYWORDS)
        if is_withdrawal:
            return {
                "_type": "investment_movement",
                "investment_name": "Porquinho Inter",
                "operation": "withdrawal",
                "amount": abs(valor),
            }
        if any(kw in desc_lower for kw in _PORQUINHO_DEPOSIT_KEYWORDS):
            return {
                "_type": "investment_movement",
                "investment_name": "Porquinho Inter",
                "operation": "deposit",
                "amount": abs(valor),
            }

    if valor > 0:
        # Self-transfer received from own Nubank account → skip (nu-db already has it)
        if _SELF_NUBANK_MARKER in desc_lower:
            return None

        method = "pix_received" if "pix recebido" in desc_lower else "transfer"
        category = "PIX recebido" if method == "pix_received" else "Transferência"
        return {
            "_type": "transaction",
            "flow": "income",
            "method": method,
            "account_id": "inter-db",
            "amount": valor,
            "is_revenue": 1,
            "counterpart": None,
        }

    if valor < 0:
        # Self-transfer sent to own Nubank account
        if _SELF_NUBANK_MARKER in desc_lower:
            return {
                "_type": "transfer",
                "flow": "expense",
                "method": "transfer",
                "account_id": "inter-db",
                "amount": abs(valor),
                "dest_account_id": "nu-db",
            }

        method = "pix" if "pix enviado" in desc_lower else "pix"
        return {
            "_type": "transaction",
            "flow": "expense",
            "method": method,
            "account_id": "inter-db",
            "amount": abs(valor),
            "is_revenue": 0,
            "counterpart": None,
        }

    return None  # valor == 0


def _parse_br_value(text: str) -> float:
    cleaned = (
        text.strip()
        .replace("R$", "")
        .replace("\xa0", "")
        .strip()
        .replace(".", "")
        .replace(",", ".")
    )
    return float(cleaned)


def _normalize_date(raw: str) -> Optional[str]:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
