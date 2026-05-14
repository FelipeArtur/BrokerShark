"""Adapter: Inter credit card fatura.

Handles CSV files exported from the Inter app for the cartão de crédito (inter-cc).

Expected columns: ``Data``, ``Lançamento``, ``Categoria``, ``Tipo``, ``Valor``
Format: comma-separated, all values quoted, UTF-8 BOM
Date format: DD/MM/YYYY
Amount format: Brazilian (``"R$ 1.400,20"``) — always positive in the export

Rows skipped
------------
Inter exports CC bill payments as positive "Compra à vista" rows.  They are NOT
purchases — skipping them prevents double-counting with the inter-db transfer
(``dest_account_id='inter-cc'``) that already covers the fatura payment.

Skipped descriptions:
- ``"PAGAMENTO ON LINE"``       → online fatura payment
- ``"DEB AUT PARCIAL"``         → automatic partial debit
- ``"EST DEB AUTOM PARCIAL MAN"`` → reversal of automatic partial debit

Everything else → expense in inter-cc.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from . import BankAdapter, ParsedRow

_PAYMENT_DESCRIPTIONS = frozenset({
    "PAGAMENTO ON LINE",
    "DEB AUT PARCIAL",
    "EST DEB AUTOM PARCIAL MAN",
})

# Revolving-credit charges posted by Inter on the day AFTER the billing cycle
# closes — backdate by 1 day to keep them in the correct fatura date range.
_PREV_CYCLE_CHARGES = frozenset({
    "IOF ADICIONAL DB PF",
    "IOF DIARIO DB PF",
    "ROTATIVO SALDO FINANCIADO",
    "ENCARGOS ROTATIVO",
})


class InterCCAdapter(BankAdapter):
    name = "inter_cc"
    account_id = "inter-cc"

    def can_handle(self, path: Path) -> bool:
        return path.parent.name == "Fatura banco Inter"

    def parse(self, content: str) -> list[ParsedRow]:
        content = content.lstrip("﻿")
        reader = csv.DictReader(io.StringIO(content))
        rows: list[ParsedRow] = []

        for row in reader:
            try:
                raw_date = (row.get("Data") or "").strip()
                date = _normalize_date(raw_date)
                if not date:
                    continue

                raw_val = (
                    (row.get("Valor") or "")
                    .strip()
                    .replace("R$", "")
                    .replace("\xa0", "")
                    .strip()
                    .replace(".", "")
                    .replace(",", ".")
                )
                amount = float(raw_val)

                if amount <= 0:
                    rows.append(ParsedRow(
                        row_type="skip", date=date, description="(crédito)", amount=abs(amount), account_id="inter-cc",
                    ))
                    continue

                description = (row.get("Lançamento") or "").strip()
                if not description:
                    continue

                if description in _PAYMENT_DESCRIPTIONS:
                    rows.append(ParsedRow(
                        row_type="skip", date=date, description=description, amount=amount, account_id="inter-cc",
                    ))
                    continue

                if description in _PREV_CYCLE_CHARGES:
                    dt = datetime.strptime(date, "%Y-%m-%d")
                    date = (dt - timedelta(days=1)).strftime("%Y-%m-%d")

                rows.append(ParsedRow(
                    row_type="expense",
                    date=date,
                    description=description,
                    amount=amount,
                    account_id="inter-cc",
                    method="credit",
                ))

            except (ValueError, KeyError):
                continue

        return rows


def _normalize_date(raw: str) -> Optional[str]:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
