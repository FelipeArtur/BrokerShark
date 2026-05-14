"""Adapter: Inter checking account extrato.

Handles CSV files exported from the Inter app for the conta corrente (inter-db).

Expected format:
  - Delimiter: ``;``
  - First few lines are metadata — parser skips until ``Data Lançamento`` header
  - Columns: ``Data Lançamento``, ``Descrição``, ``Valor``
  - Amount format: Brazilian (``"1.400,20"`` positive = income, negative = expense)

Classification rules
--------------------
- "pagamento efetuado" + "fatura"           → transfer to inter-cc
- "porquinho"/"cdb porq" (no "resgate")     → Porquinho Inter deposit
- "porquinho"/"cdb porq" + "resgate"/"estorno" → Porquinho Inter withdrawal
- valor > 0, "felipe artur macedo"          → skip (transfer from nu-db already in nu-db)
- valor > 0                                 → income (is_revenue=1)
- valor < 0, "felipe artur macedo"          → transfer to nu-db
- valor < 0                                 → expense
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import BankAdapter, ParsedRow

_FATURA_KEYWORDS = ("pagamento efetuado",)
_PORQUINHO_DEPOSIT = ("aplicacao", "cdb porq")
_PORQUINHO_WITHDRAWAL = ("resgate", "estorno")
_PORQUINHO_MARKER = "porquinho"
_SELF_NUBANK = "felipe artur macedo"


class InterExtratoAdapter(BankAdapter):
    name = "inter_extrato"
    account_id = "inter-db"

    def can_handle(self, path: Path) -> bool:
        return path.parent.name == "Extrato completo Inter"

    def parse(self, content: str) -> list[ParsedRow]:
        content = content.lstrip("﻿")
        lines = content.splitlines()

        # Skip Inter metadata header block
        data_start = 0
        for i, line in enumerate(lines):
            if line.startswith("Data Lançamento") or line.startswith("Data La"):
                data_start = i
                break

        data_text = "\n".join(lines[data_start:])
        reader = csv.DictReader(io.StringIO(data_text), delimiter=";")
        rows: list[ParsedRow] = []

        for row in reader:
            try:
                raw_date = (row.get("Data Lançamento") or row.get("Data La") or "").strip()
                date = _normalize_date(raw_date)
                if not date:
                    continue

                raw_val = (row.get("Valor") or "").strip()
                if not raw_val:
                    continue
                valor = _parse_br(raw_val)

                description = (row.get("Descrição") or "").strip()
                if not description:
                    continue

                parsed = _classify(description, valor)
                parsed.date = date
                parsed.description = description
                rows.append(parsed)

            except (ValueError, KeyError):
                continue

        return rows


def _classify(description: str, valor: float) -> ParsedRow:
    desc = description.lower()

    if any(kw in desc for kw in _FATURA_KEYWORDS) and "fatura" in desc:
        return ParsedRow(
            row_type="transfer",
            date="", description="", amount=abs(valor),
            account_id="inter-db",
            dest_account_id="inter-cc",
            method="transfer",
        )

    is_porquinho = _PORQUINHO_MARKER in desc or "cdb porq" in desc
    if is_porquinho:
        if any(kw in desc for kw in _PORQUINHO_WITHDRAWAL):
            return ParsedRow(
                row_type="investment",
                date="", description="", amount=abs(valor),
                account_id="inter-db",
                investment_name="Porquinho Inter",
                operation="withdrawal",
            )
        if any(kw in desc for kw in _PORQUINHO_DEPOSIT):
            return ParsedRow(
                row_type="investment",
                date="", description="", amount=abs(valor),
                account_id="inter-db",
                investment_name="Porquinho Inter",
                operation="deposit",
            )

    if valor > 0:
        if _SELF_NUBANK in desc:
            return ParsedRow(row_type="skip", date="", description="", amount=valor, account_id="inter-db")
        method = "pix_received" if "pix recebido" in desc else "other"
        return ParsedRow(
            row_type="income",
            date="", description="", amount=valor,
            account_id="inter-db",
            is_revenue=1,
            method=method,
        )

    if valor < 0:
        if _SELF_NUBANK in desc:
            return ParsedRow(
                row_type="transfer",
                date="", description="", amount=abs(valor),
                account_id="inter-db",
                dest_account_id="nu-db",
                method="transfer",
            )
        return ParsedRow(
            row_type="expense",
            date="", description="", amount=abs(valor),
            account_id="inter-db",
            method="pix",
        )

    return ParsedRow(row_type="skip", date="", description="", amount=0, account_id="inter-db")


def _parse_br(text: str) -> float:
    return float(
        text.strip()
        .replace("R$", "")
        .replace("\xa0", "")
        .strip()
        .replace(".", "")
        .replace(",", ".")
    )


def _normalize_date(raw: str) -> Optional[str]:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
