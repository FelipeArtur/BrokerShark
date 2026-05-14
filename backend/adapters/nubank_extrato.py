"""Adapter: Nubank checking account extrato.

Handles CSV files exported from the Nubank app for the conta corrente (nu-db).

Expected columns: ``Data``, ``Valor``, ``Identificador``, ``Descrição``
Date format: DD/MM/YYYY
Amount format: float with period decimal (e.g. ``4200.00``, ``-80.09``)
Dedup key: ``Identificador`` (UUID unique per transaction)

Classification rules
--------------------
- "pagamento de/da fatura"          → transfer to nu-cc
- "Aplicação RDB" / "dinheiro guardado" → Caixinha Nubank deposit
- "Resgate RDB"                     → Caixinha Nubank withdrawal
- valor > 0, "banco inter" + "felipe artur" → skip (already in inter-db)
- valor > 0, any                    → income (is_revenue=1)
- valor < 0, "banco inter" + "felipe artur" → transfer to inter-db
- valor < 0, any                    → expense

Note: transfers "felipe artur" without "banco inter" are salary from a previous
employer deposited at Bradesco/BB — treated as real income (is_revenue=1).
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import BankAdapter, ParsedRow

_FATURA_KEYWORDS = ("pagamento de fatura", "pagamento da fatura")
_CAIXINHA_DEPOSIT = ("aplicação rdb", "dinheiro guardado")
_CAIXINHA_WITHDRAWAL = ("resgate rdb",)


class NubankExtratoAdapter(BankAdapter):
    name = "nubank_extrato"
    account_id = "nu-db"

    def can_handle(self, path: Path) -> bool:
        return path.parent.name == "Extrato completo Nubank"

    def parse(self, content: str) -> list[ParsedRow]:
        content = content.lstrip("﻿")
        reader = csv.DictReader(io.StringIO(content))
        rows: list[ParsedRow] = []

        for row in reader:
            try:
                date = _normalize_date((row.get("Data") or "").strip())
                if not date:
                    continue

                raw = (row.get("Valor") or "").strip()
                if not raw:
                    continue
                valor = float(raw)

                description = (row.get("Descrição") or "").strip()
                if not description:
                    continue

                dedup_key = (row.get("Identificador") or "").strip() or None

                parsed = _classify(description, valor)
                parsed.date = date
                parsed.description = description
                parsed.dedup_key = dedup_key
                rows.append(parsed)

            except (ValueError, KeyError):
                continue

        return rows


def _classify(description: str, valor: float) -> ParsedRow:
    desc = description.lower()

    if any(kw in desc for kw in _FATURA_KEYWORDS):
        return ParsedRow(
            row_type="transfer",
            date="", description="", amount=abs(valor),
            account_id="nu-db",
            dest_account_id="nu-cc",
            method="transfer",
        )

    if description == "Aplicação RDB" or any(kw in desc for kw in _CAIXINHA_DEPOSIT):
        return ParsedRow(
            row_type="investment",
            date="", description="", amount=abs(valor),
            account_id="nu-db",
            investment_name="Caixinha Nubank",
            operation="deposit",
        )

    if description == "Resgate RDB" or any(kw in desc for kw in _CAIXINHA_WITHDRAWAL):
        return ParsedRow(
            row_type="investment",
            date="", description="", amount=abs(valor),
            account_id="nu-db",
            investment_name="Caixinha Nubank",
            operation="withdrawal",
        )

    if valor > 0:
        if "felipe artur macedo" in desc and "banco inter" in desc:
            return ParsedRow(
                row_type="skip",
                date="", description="", amount=valor,
                account_id="nu-db",
            )
        method = "pix_received" if "transferência recebida" in desc else "other"
        return ParsedRow(
            row_type="income",
            date="", description="", amount=valor,
            account_id="nu-db",
            is_revenue=1,
            method=method,
        )

    if valor < 0:
        if "felipe artur macedo" in desc and "banco inter" in desc:
            return ParsedRow(
                row_type="transfer",
                date="", description="", amount=abs(valor),
                account_id="nu-db",
                dest_account_id="inter-db",
                method="transfer",
            )
        if "transferência enviada pelo pix" in desc:
            method = "pix"
        elif "transferência enviada" in desc:
            method = "ted"
        else:
            method = "pix"
        return ParsedRow(
            row_type="expense",
            date="", description="", amount=abs(valor),
            account_id="nu-db",
            method=method,
        )

    return ParsedRow(row_type="skip", date="", description="", amount=0, account_id="nu-db")


def _normalize_date(raw: str) -> Optional[str]:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
