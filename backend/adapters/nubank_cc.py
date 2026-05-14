"""Adapter: Nubank credit card fatura.

Handles CSV files exported from the Nubank app for the cartão de crédito (nu-cc).

Expected columns: ``date``, ``title``, ``amount``
Date format: YYYY-MM-DD
Amount format: float, positive = charge, negative = payment

Rows skipped
------------
- ``amount <= 0``       → payment received (already tracked as nu-db → nu-cc transfer)
- ``title == "Saldo em atraso"`` → unpaid balance rolled over from the previous
  fatura; already imported from that fatura's CSV (double-count prevention)

Everything else → expense in nu-cc.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import BankAdapter, ParsedRow


class NubankCCAdapter(BankAdapter):
    name = "nubank_cc"
    account_id = "nu-cc"

    def can_handle(self, path: Path) -> bool:
        return path.parent.name == "Fatura Nubank"

    def parse(self, content: str) -> list[ParsedRow]:
        reader = csv.DictReader(io.StringIO(content))
        rows: list[ParsedRow] = []

        for row in reader:
            try:
                date = _normalize_date((row.get("date") or "").strip())
                if not date:
                    continue

                raw = (row.get("amount") or "").strip().replace(",", ".")
                amount = float(raw)

                if amount <= 0:
                    rows.append(ParsedRow(
                        row_type="skip", date=date, description="(pagamento)", amount=abs(amount), account_id="nu-cc",
                    ))
                    continue

                description = (row.get("title") or "").strip()
                if not description:
                    continue

                if description == "Saldo em atraso":
                    rows.append(ParsedRow(
                        row_type="skip", date=date, description=description, amount=amount, account_id="nu-cc",
                    ))
                    continue

                rows.append(ParsedRow(
                    row_type="expense",
                    date=date,
                    description=description,
                    amount=amount,
                    account_id="nu-cc",
                    method="credit",
                ))

            except (ValueError, KeyError):
                continue

        return rows


def _normalize_date(raw: str) -> Optional[str]:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
