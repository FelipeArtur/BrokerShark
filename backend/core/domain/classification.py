"""Pure import-time transaction classification — no DB, no IO.

These functions label a raw statement line by inspecting its description (and the
owner's self-transfer allow-list from ``config``). They run during import to decide a
record's flow/method/counterpart before anything is written, and are kept free of
database and framework imports so they can be unit-tested in isolation.

Consumed by ``core/ingestion/adapters.py``. See CLAUDE.md for the financial meaning of
each label: investment leg (Caixinha/RDB/Porquinho…), self-transfer (counterpart=SELF),
and credit-card bill payment (surfaced under "Crédito").
"""
from __future__ import annotations

import config

# Checking rows that are investment movements, not real income/expense. Matched
# case-insensitively against the description. These become transfers with is_revenue=0
# so they keep the account balance correct without inflating receitas or polluting
# gastos por categoria. Reviewable per-row in the import preview.
#   "cdb porq" cobre "CDB PORQUINHO" e "CDB Porq Obj", incl. os estornos dessas reservas.
INVESTMENT_KEYWORDS = (
    "rdb", "nuinvest", "tesouro", "irrf", "cobrança de investimentos",
    "cobranca de investimentos", "aplicação", "aplicacao", "resgate",
    "caixinha", "porquinho", "cdb porq",
)


def is_investment(desc: str) -> bool:
    """True if the statement line is an investment leg (Caixinha/RDB/CDB/etc.)."""
    low = desc.lower()
    return any(k in low for k in INVESTMENT_KEYWORDS)


def is_self_transfer(desc: str) -> bool:
    """True if the counterparty is the account owner themselves (auto-Pix/TED).

    Matched against the owner's name/CPF (``config.OWNER_SELF_KEYWORDS``). Excludes
    investment estornos ("Estorno CDB…") which also carry the owner's name but are a
    different concept handled by the investment path.
    """
    low = desc.lower()
    if "estorno" in low or "cdb" in low:
        return False
    return any(k in low for k in config.OWNER_SELF_KEYWORDS)


def is_fatura_payment(desc: str) -> bool:
    """True if a checking-account outflow is a credit-card invoice payment.

    These are surfaced under "Crédito" (not TED) so the bill stands out. NOTE: this is a
    stand-in until itemized invoice handling lands — then the bill payment becomes a
    settlement (excluded from expense totals) and the line items become the real credit
    expenses, reconciled to the statement period (see CLAUDE.md).
    """
    return "fatura" in desc.lower()


def checking_expense_method(desc: str) -> str:
    """Infer the payment method of a checking-account outflow from its description."""
    low = desc.lower()
    if is_fatura_payment(desc):
        return "credit"
    if "pix" in low:
        return "pix"
    if "débito" in low or "debito" in low:
        return "debit"
    return "ted"
