"""Pure unit tests for core.domain.classification — no DB, no IO.

These functions were untested in isolation before the Phase 1b extraction (only
exercised end-to-end via the import pipeline). Now they have direct coverage.
"""
import pytest

import config
from core.domain import classification


@pytest.mark.parametrize("desc,expected", [
    ("Aplicação RDB", True),
    ("Resgate Caixinha", True),
    ("CDB PORQUINHO", True),
    ("CDB Porq Obj", True),
    ("NuInvest aporte", True),
    ("Tesouro Selic", True),
    ("IRRF sobre rendimentos", True),
    ("Mercado Livre", False),
    ("Pix para Joao", False),
])
def test_is_investment(desc, expected):
    assert classification.is_investment(desc) is expected


def test_is_self_transfer(monkeypatch):
    monkeypatch.setattr(config, "OWNER_SELF_KEYWORDS", ("joao da silva", "12345678900"))
    assert classification.is_self_transfer("Pix enviado Joao Da Silva") is True
    assert classification.is_self_transfer("Transferencia 12345678900") is True
    # estorno/cdb carry the owner's name but are NOT self-transfers — investment path
    assert classification.is_self_transfer("Estorno Joao Da Silva") is False
    assert classification.is_self_transfer("CDB Joao Da Silva") is False
    assert classification.is_self_transfer("Pix para Maria") is False


def test_is_fatura_payment():
    assert classification.is_fatura_payment("Pagamento de fatura") is True
    assert classification.is_fatura_payment("Pix mercado") is False


@pytest.mark.parametrize("desc,method", [
    ("Pagamento fatura cartao", "credit"),   # fatura wins even if other words present
    ("Pix enviado", "pix"),
    ("Compra no débito", "debit"),
    ("Debito automatico", "debit"),
    ("Transferencia TED", "ted"),            # fallback
])
def test_checking_expense_method(desc, method):
    assert classification.checking_expense_method(desc) == method


# ── merchant_key ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("desc,expected", [
    ("Compra no débito - PADARIA CENTRAL LTDA", "padaria central"),
    ("Pix - Padaria do Bairro", "padaria bairro"),
    ("Transferência Recebida - EMPRESA XYZ LTDA - 12.345.678/0001-90", "empresa xyz"),
    # the format prefix and a company suffix collapse the same merchant to one key
    ("Compra no débito - Mercado Tal", "mercado tal"),
    ("Mercado Tal", "mercado tal"),
    # pure routing / numeric lines reduce to nothing → "no match"
    ("12345", ""),
    ("Pix", ""),
    ("", ""),
])
def test_merchant_key(desc, expected):
    assert classification.merchant_key(desc) == expected


# ── is_categorizable ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("flow,method,counterpart,is_revenue,expected", [
    ("expense", "pix", None, 0, True),
    ("expense", "debit", None, 0, True),
    ("expense", "credit", None, 0, True),     # fatura payment proxy is categorizable
    ("expense", "transfer", None, 0, False),  # investment leg out
    ("expense", "transfer", "SELF", 0, False),
    ("income", "ted", None, 1, True),
    ("income", "ted", None, 0, False),        # investment redemption
    ("income", "pix", "SELF", 0, False),      # self-transfer income
])
def test_is_categorizable(flow, method, counterpart, is_revenue, expected):
    assert classification.is_categorizable(flow, method, counterpart, is_revenue) is expected


# ── build_category_index + suggest_from_index ──────────────────────────────────

def _hist(desc, flow, cid, name, date):
    return {"description": desc, "flow": flow, "category_id": cid,
            "category_name": name, "date": date}


def test_suggest_picks_most_frequent_category():
    history = [
        _hist("Mercado Tal", "expense", 1, "Alimentação", "2026-01-01"),
        _hist("Mercado Tal", "expense", 1, "Alimentação", "2026-01-02"),
        _hist("Mercado Tal", "expense", 2, "Outros", "2026-03-01"),
    ]
    index = classification.build_category_index(history)
    # a new row for the same merchant (different bank-format prefix) matches
    assert classification.suggest_from_index(
        "Compra no débito - Mercado Tal", "expense", index) == (1, "Alimentação")


def test_suggest_tie_break_most_recent():
    history = [
        _hist("Mercado Tal", "expense", 1, "A", "2026-01-01"),
        _hist("Mercado Tal", "expense", 2, "B", "2026-05-01"),
    ]
    index = classification.build_category_index(history)
    assert classification.suggest_from_index("Mercado Tal", "expense", index) == (2, "B")


def test_suggest_is_flow_scoped():
    history = [_hist("Mercado Tal", "expense", 1, "A", "2026-01-01")]
    index = classification.build_category_index(history)
    # same merchant key but different flow → no cross-flow suggestion
    assert classification.suggest_from_index("Mercado Tal", "income", index) is None


def test_suggest_no_match_and_empty_key():
    history = [_hist("Mercado Tal", "expense", 1, "A", "2026-01-01")]
    index = classification.build_category_index(history)
    assert classification.suggest_from_index("Pix - Outro Lugar", "expense", index) is None
    assert classification.suggest_from_index("12345", "expense", index) is None  # empty key
    assert classification.suggest_from_index("qualquer", "expense", {}) is None  # empty index
