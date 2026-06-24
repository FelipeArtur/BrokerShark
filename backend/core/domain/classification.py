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

import re
import unicodedata
from collections import defaultdict
from typing import Optional

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


# ── Category suggestion (learned from history, suggest-only) ───────────────────
# Pure helpers that power the import preview's "sugestão" column. The DB layer
# fetches the categorized history; everything here is text + tallying so it stays
# unit-testable. Nothing auto-applies — the UI shows the suggestion pre-selected
# and the user confirms (keeps the CLAUDE.md "manual categorization" control).

# Structural tokens of the bank export format (and accent-stripped). Dropping them
# leaves the merchant name as the matching key, so "Compra no débito - PADARIA X"
# and a past "PADARIA X" collapse to the same key. Accents are stripped first, so
# these are all unaccented.
_MERCHANT_STOP = frozenset({
    "compra", "no", "na", "debito", "credito", "pix", "ted", "doc",
    "transferencia", "enviada", "recebida", "recebido", "pelo", "pela",
    "pagamento", "pagto", "de", "da", "do", "dos", "das", "e", "em", "para",
    "conta", "agencia", "fatura", "boleto", "ltda", "sa", "me", "mei", "epp",
    "eireli", "instituicao", "cp",
})


def _strip_accents(text: str) -> str:
    """Drop combining marks so 'débito' → 'debito' (stable, ascii merchant keys)."""
    return "".join(
        c for c in unicodedata.normalize("NFD", text)
        if unicodedata.category(c) != "Mn"
    )


def merchant_key(description: str) -> str:
    """Reduce a raw statement description to a stable merchant key.

    Lowercases, strips accents, drops digits/punctuation (CPF/CNPJ masks, agency
    and account tails), removes the bank format's structural tokens, and keeps the
    meaningful merchant words. Empty when nothing meaningful remains (e.g. a pure
    routing line) — callers treat an empty key as "no match".
    """
    if not description:
        return ""
    s = _strip_accents(str(description).lower())
    s = re.sub(r"[^a-z\s]", " ", s)  # digits + punctuation → space
    tokens = [t for t in s.split() if len(t) > 1 and t not in _MERCHANT_STOP]
    return " ".join(tokens)


def is_categorizable(
    flow: str, method: str, counterpart: Optional[str], is_revenue: int,
) -> bool:
    """True if a staged row should carry a category (mirrors the consumption/revenue rule).

    Real consumption expense (any method except the transfer leg) or real income
    (``is_revenue=1``). Transfer legs, SELF, and investment legs (income with
    ``is_revenue=0``) are never categorizable.
    """
    if counterpart == "SELF":
        return False
    if flow == "expense":
        return method != "transfer"
    if flow == "income":
        return is_revenue == 1
    return False


def build_category_index(
    history: list[dict],
) -> dict[tuple[str, str], tuple[int, str]]:
    """Index categorized history into ``(flow, merchant_key) → (category_id, name)``.

    ``history`` rows are dicts with ``description``, ``flow``, ``category_id``,
    ``category_name``, ``date``. Picks the most frequent category per key,
    tie-broken by the most recent date. Built once per preview; lookups are O(1).
    """
    freq: dict[tuple[str, str], dict[int, int]] = defaultdict(lambda: defaultdict(int))
    names: dict[int, str] = {}
    latest: dict[tuple[str, str, int], str] = {}
    for h in history:
        cid = h.get("category_id")
        if cid is None:
            continue
        key = merchant_key(h.get("description") or "")
        if not key:
            continue
        flow = h.get("flow") or ""
        gk = (flow, key)
        freq[gk][cid] += 1
        names[cid] = h.get("category_name") or ""
        d = h.get("date") or ""
        lk = (flow, key, cid)
        if d > latest.get(lk, ""):
            latest[lk] = d
    out: dict[tuple[str, str], tuple[int, str]] = {}
    for gk, counts in freq.items():
        best = max(counts, key=lambda cid: (counts[cid], latest.get((*gk, cid), "")))
        out[gk] = (best, names[best])
    return out


def suggest_from_index(
    description: str, flow: str, index: dict[tuple[str, str], tuple[int, str]],
) -> Optional[tuple[int, str]]:
    """Look up the suggested ``(category_id, name)`` for a row, or None if no match."""
    key = merchant_key(description)
    if not key:
        return None
    return index.get((flow, key))
