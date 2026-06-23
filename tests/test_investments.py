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


def test_investment_evolution_derives_from_transactions(db):
    # Regression: ISSUE-001 — the "Evolução do Patrimônio (Aportes)" chart read the
    # empty investment_movements table, so it rendered a flat R$0 line despite real
    # invested money. It must derive from the transactions ledger (investment legs),
    # the same source as get_cashflow_statement.investment_net.
    # Found by /qa on 2026-06-04.
    import sqlite3
    from datetime import date
    from core.db import crud, analytics

    inv_id = _make_investment(balance=0.0)
    today = date.today().isoformat()
    crud.register_investment_transfer(inv_id, "nubank", "deposit", 1000.0, today, "Tesouro IPCA+ 2029")
    crud.register_investment_transfer(inv_id, "nubank", "withdrawal", 300.0, today, "Tesouro IPCA+ 2029")

    ev = analytics.get_investment_evolution(12)
    current = ev[-1]  # window ends on the current month
    assert round(current["deposit"], 2) == 1000.0
    assert round(current["withdrawal"], 2) == 300.0
    # cumulative reflects net invested from transactions — NOT zero (the bug)
    assert round(current["cumulative"], 2) == 700.0

    # proves the chart no longer reads investment_movements (which stays empty)
    with sqlite3.connect(db) as raw:
        assert raw.execute("SELECT COUNT(*) FROM investment_movements").fetchone()[0] == 0


def test_ledger_savings_positions_derived(db):
    """Caixinha is derived from RDB legs (never reaches the investments table).

    NuInvest/brokerage legs are excluded (they become B3 positions → double-count)
    and SELF legs are excluded.
    """
    from core.db import crud, analytics
    crud.insert_transaction(date="2026-01-05", flow="expense", method="transfer",
                            account_id="nu-db", amount=1000.0, description="Aplicação RDB", is_revenue=0)
    crud.insert_transaction(date="2026-02-05", flow="expense", method="transfer",
                            account_id="nu-db", amount=500.0,
                            description="Dinheiro guardado com resgate planejado", is_revenue=0)
    crud.insert_transaction(date="2026-03-05", flow="income", method="transfer",
                            account_id="nu-db", amount=200.0, description="Resgate RDB", is_revenue=0)
    # brokerage transfer → NOT Caixinha (would double-count against B3)
    crud.insert_transaction(date="2026-01-10", flow="expense", method="transfer",
                            account_id="nu-db", amount=900.0,
                            description="Transferência de saldo NuInvest", is_revenue=0)
    # SELF transfer → excluded
    crud.insert_transaction(date="2026-01-12", flow="expense", method="transfer",
                            account_id="nu-db", amount=50.0, description="Aplicação RDB",
                            counterpart="SELF", is_revenue=0)
    # Inter Porquinho leg → NOT derived: a Porquinho is a B3-custodied CDB, so it
    # comes from the B3 truth table, not here (deriving it would double-count).
    crud.insert_transaction(date="2026-01-15", flow="expense", method="transfer",
                            account_id="inter-db", amount=300.0,
                            description='Aplicacao: CDB Porquinho BANCO INTER SA', is_revenue=0)

    pos = {p["name"]: p for p in analytics.get_ledger_savings_positions()}
    assert "Caixinha Nubank" in pos
    assert pos["Caixinha Nubank"]["balance"] == 1300.0  # 1000 + 500 − 200
    assert pos["Caixinha Nubank"]["id"] is None
    assert pos["Caixinha Nubank"]["derived"] is True
    assert "Porquinho Inter" not in pos  # B3-tracked CDB, never derived
