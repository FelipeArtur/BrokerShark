"""Tests for investment movement registration as a checking transfer leg.

``register_investment_transfer`` records an application/withdrawal the same way
imported investment flows are stored (a method='transfer' transaction on the
checking account) + bumps ``investments.current_balance`` — and deliberately does
NOT write ``investment_movements`` (that ledger is subtracted from checking
balances and would double-count). This keeps the movement consistent across the
hero "Disponível", the cashflow statement, and the Histórico.
"""
import pytest


def _make_investment(name="Tesouro IPCA+ 2029", type_="treasury", bank="nubank", balance=100.0):
    from core.db import crud
    inv_id = crud.upsert_investment(name, type_, bank)
    crud.update_investment_balance(inv_id, balance)
    return inv_id


def test_register_investment_transfer_deposit(db):
    from core.db import crud, analytics
    inv_id = _make_investment(balance=100.0)
    bal_before = analytics.get_account_balance("nu-db")

    crud.register_investment_transfer(inv_id, "nubank", "deposit", 250.0, "2026-05-10", "Tesouro IPCA+ 2029")

    # checking dropped by the applied amount, via a transfer-leg transaction
    assert round(analytics.get_account_balance("nu-db") - bal_before, 2) == -250.0
    # investment position rose
    inv = analytics.get_investment_by_name("Tesouro IPCA+ 2029")
    assert round(inv["current_balance"], 2) == 350.0
    # NOT counted as consumption expense (method='transfer')
    assert analytics.get_monthly_summary(2026, 5)["expenses"] == 0.0
    # investment_movements ledger stays empty (no double-count path)
    import sqlite3
    with sqlite3.connect(db) as raw:
        assert raw.execute("SELECT COUNT(*) FROM investment_movements").fetchone()[0] == 0


def test_register_investment_transfer_withdrawal(db):
    from core.db import crud, analytics
    inv_id = _make_investment(balance=500.0)
    bal_before = analytics.get_account_balance("nu-db")

    crud.register_investment_transfer(inv_id, "nubank", "withdrawal", 200.0, "2026-05-12", "Tesouro IPCA+ 2029")

    assert round(analytics.get_account_balance("nu-db") - bal_before, 2) == 200.0  # cash back in
    inv = analytics.get_investment_by_name("Tesouro IPCA+ 2029")
    assert round(inv["current_balance"], 2) == 300.0
    # resgate is income but not revenue, so it doesn't inflate the income headline
    assert analytics.get_monthly_summary(2026, 5)["income"] == 0.0


def test_register_investment_transfer_unmapped_bank_raises(db):
    from core.db import crud
    inv_id = _make_investment(name="Cripto X", type_="other", bank="binance", balance=10.0)
    with pytest.raises(ValueError):
        crud.register_investment_transfer(inv_id, "binance", "deposit", 10.0, "2026-05-10", "Cripto X")
