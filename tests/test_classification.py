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
