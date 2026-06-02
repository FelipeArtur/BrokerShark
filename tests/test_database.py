"""Tests for core database functions — insert, queries, and patrimônio logic."""
import pytest


def test_insert_transaction_basic(db):
    from core.db import crud, analytics

    tx_id = crud.insert_transaction(
        date="2026-05-01",
        flow="expense",
        method="pix",
        account_id="nu-db",
        amount=100.0,
        description="Supermercado",
        is_revenue=0,
    )
    assert isinstance(tx_id, int)
    row = analytics.get_recent_transactions("nu-db", limit=1)
    assert len(row) == 1
    assert row[0]["amount"] == 100.0
    assert row[0]["description"] == "Supermercado"


def test_insert_transaction_invalid_date(db):
    from core.db import crud

    with pytest.raises(ValueError, match="Invalid date format"):
        crud.insert_transaction(
            date="01-05-2026",
            flow="expense",
            method="pix",
            account_id="nu-db",
            amount=50.0,
            description="Bad date",
        )


def test_insert_transaction_installments(db):
    from core.db import crud, analytics

    tx_id = crud.insert_transaction(
        date="2026-05-15",
        flow="expense",
        method="credit",
        account_id="nu-cc",
        amount=300.0,
        description="Notebook",
        installments=3,
    )
    row = analytics.get_recent_transactions("nu-cc", limit=1)[0]
    assert row["amount"] == 300.0


def test_get_monthly_summary_excludes_transfers(db):
    from core.db import crud, analytics

    # Insert a real expense
    crud.insert_transaction(
        date="2026-05-10",
        flow="expense",
        method="pix",
        account_id="nu-db",
        amount=200.0,
        description="Aluguel",
        is_revenue=0,
    )
    # Insert a fatura payment (transfer — should be excluded from expenses)
    crud.insert_transaction(
        date="2026-05-10",
        flow="expense",
        method="transfer",
        account_id="nu-db",
        amount=500.0,
        description="Pagamento fatura Nubank",
        dest_account_id="nu-cc",
        is_revenue=0,
    )

    summary = analytics.get_monthly_summary(2026, 5)
    # Only the real expense should appear (transfers excluded by dest_account_id IS NULL)
    assert summary["expenses"] == 200.0


def test_get_monthly_summary_excludes_third_party(db):
    from core.db import crud, analytics

    # Insert a personal expense
    crud.insert_transaction(
        date="2026-05-05",
        flow="expense",
        method="pix",
        account_id="nu-db",
        amount=150.0,
        description="Restaurante",
        is_revenue=0,
    )
    # Insert a third-party expense (evento) — should be excluded
    tx_id = crud.insert_transaction(
        date="2026-05-05",
        flow="expense",
        method="pix",
        account_id="nu-db",
        amount=1000.0,
        description="Ingresso evento",
        is_revenue=0,
    )
    crud.update_transaction_fields(tx_id, is_third_party=1)

    summary = analytics.get_monthly_summary(2026, 5)
    assert summary["expenses"] == 150.0


def test_get_patrimonio_history_shape(db):
    from core.db import analytics

    history = analytics.get_patrimonio_history(months=3)
    assert len(history) == 3
    for entry in history:
        assert "label" in entry
        assert "value" in entry
        assert isinstance(entry["value"], float)


def test_patrimonio_cc_fatura_counted_as_expense(db):
    """CC fatura payment must reduce patrimônio (dest_account_id IN cc accounts)."""
    from core.db import crud, analytics

    # Income
    crud.insert_transaction(
        date="2026-05-01",
        flow="income",
        method="pix",
        account_id="nu-db",
        amount=5000.0,
        description="Salário",
        is_revenue=1,
    )
    # Regular expense
    crud.insert_transaction(
        date="2026-05-10",
        flow="expense",
        method="pix",
        account_id="nu-db",
        amount=500.0,
        description="Supermercado",
        is_revenue=0,
    )
    # CC fatura payment — must appear in patrimônio calc
    crud.insert_transaction(
        date="2026-05-25",
        flow="expense",
        method="transfer",
        account_id="nu-db",
        amount=800.0,
        description="Fatura Nubank",
        dest_account_id="nu-cc",
        is_revenue=0,
    )

    history = analytics.get_patrimonio_history(months=1)
    # Expected: initial_balance(0) + 5000 - 500 - 800 = 3700
    assert history[0]["value"] == pytest.approx(3700.0, abs=1.0)


def test_patrimonio_excludes_investment_movements(db):
    """Investment deposits/withdrawals must NOT appear in patrimônio history."""
    import sqlite3
    from core.db import crud, analytics, schema

    crud.insert_transaction(
        date="2026-05-01",
        flow="income",
        method="pix",
        account_id="nu-db",
        amount=4000.0,
        description="Salário",
        is_revenue=1,
    )
    # Create an investment and register a deposit — must not shift patrimônio
    with schema._connect() as conn:
        conn.execute(
            "INSERT INTO investments (name, type, bank, current_balance) VALUES (?,?,?,?)",
            ("Caixinha Teste", "savings", "nubank", 0.0),
        )
        inv_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO investment_movements (date, investment_id, operation, amount, description) VALUES (?,?,?,?,?)",
            ("2026-05-10", inv_id, "deposit", 1000.0, "Aporte"),
        )

    history = analytics.get_patrimonio_history(months=1)
    # Expected: initial_balance(0) + 4000 = 4000 (investment deposit does not affect total)
    assert history[0]["value"] == pytest.approx(4000.0, abs=1.0)


def test_available_to_spend(db):
    """available = Σ checking balances − Σ open fatura totals."""
    from datetime import date
    from core.db import crud, analytics

    today = date.today().isoformat()  # always inside the current billing cycle
    crud.insert_transaction(date=today, flow="income", method="pix",
                            account_id="nu-db", amount=5000.0, description="Salário", is_revenue=1)
    crud.insert_transaction(date=today, flow="expense", method="pix",
                            account_id="nu-db", amount=500.0, description="Mercado", is_revenue=0)
    # CC purchase dated today → lands in the open fatura
    crud.insert_transaction(date=today, flow="expense", method="credit",
                            account_id="nu-cc", amount=300.0, description="Compra cartão", is_revenue=0)

    res = analytics.get_available_to_spend()
    assert res["checking_total"] == pytest.approx(4500.0, abs=1.0)   # 5000 − 500
    assert res["faturas_total"]  == pytest.approx(300.0, abs=1.0)
    assert res["available"]      == pytest.approx(4200.0, abs=1.0)   # 4500 − 300


def test_liquidity_history_is_investment_adjusted(db):
    """Regression (eng-review Issue 1): the liquidity series must subtract investment
    movements so its latest point matches the hero 'Disponível' checking_total."""
    from datetime import date
    from core.db import crud, analytics, schema

    today = date.today().isoformat()
    crud.insert_transaction(date=today, flow="income", method="pix",
                            account_id="nu-db", amount=4000.0, description="Salário", is_revenue=1)
    # Investment deposit must reduce checking liquidity (same as the live balance)
    with schema._connect() as conn:
        conn.execute("INSERT INTO investments (name, type, bank, current_balance) VALUES (?,?,?,?)",
                     ("Caixinha Teste", "savings", "nubank", 0.0))
        inv_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO investment_movements (date, investment_id, operation, amount, description) VALUES (?,?,?,?,?)",
            (today, inv_id, "deposit", 1000.0, "Aporte"),
        )

    series = analytics.get_liquidity_history(months=1)
    assert len(series) == 1
    # 4000 income − 1000 invested − 0 card spend = 3000
    assert series[-1]["value"] == pytest.approx(3000.0, abs=1.0)
    # Consistency: latest liquidity point lines up with the hero checking_total
    avail = analytics.get_available_to_spend()
    assert avail["checking_total"] == pytest.approx(series[-1]["value"], abs=1.0)
