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

    crud.insert_transaction(
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


def test_expenses_by_method_debit_is_its_own_bucket(db):
    # P2 débito defensivo: a stray `debit` expense must land in its own method
    # bucket and not inflate pix/credito; the breakdown must still sum to total
    # consumption (credit-card purchases bucket under 'credit' — the fatura).
    from core.db import crud, analytics

    crud.insert_transaction(date="2026-05-02", flow="expense", method="pix",
                            account_id="nu-db", amount=100.0, description="PIX mercado")
    crud.insert_transaction(date="2026-05-03", flow="expense", method="credit",
                            account_id="nu-cc", amount=200.0, description="Compra cartão")
    crud.insert_transaction(date="2026-05-04", flow="expense", method="ted",
                            account_id="nu-db", amount=50.0, description="TED aluguel")
    crud.insert_transaction(date="2026-05-05", flow="expense", method="debit",
                            account_id="nu-db", amount=30.0, description="Débito padaria")
    # a transfer (fatura payment) must NOT show up in the method breakdown
    crud.insert_transaction(date="2026-05-06", flow="expense", method="transfer",
                            account_id="nu-db", amount=999.0, description="Pagamento fatura",
                            dest_account_id="nu-cc")

    rows = analytics.get_expenses_by_method(2026, 5)
    by_method: dict[str, float] = {}
    for r in rows:
        by_method[r["method"]] = by_method.get(r["method"], 0.0) + r["total"]

    assert by_method["debit"] == 30.0          # débito in its own bucket
    assert by_method["pix"] == 100.0           # not inflated by débito
    assert by_method["credit"] == 200.0        # CC purchase = fatura bucket
    assert by_method["ted"] == 50.0
    assert "transfer" not in by_method         # fatura payment excluded
    assert round(sum(by_method.values()), 2) == 380.0  # == total consumption


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


def test_monthly_history_present_only_months_with_data(db):
    """The Histórico strip must follow the DB: only months that have transactions,
    ascending, skipping empty months (no fixed window, no zero-fill)."""
    from core.db import crud, analytics

    # Two non-adjacent months; March is intentionally left empty.
    crud.insert_transaction(date="2026-01-10", flow="expense", method="pix",
                            account_id="nu-db", amount=100.0, description="Jan", is_revenue=0)
    crud.insert_transaction(date="2026-01-20", flow="income", method="pix",
                            account_id="nu-db", amount=3000.0, description="Salário jan", is_revenue=1)
    crud.insert_transaction(date="2026-04-05", flow="expense", method="pix",
                            account_id="nu-db", amount=250.0, description="Abr", is_revenue=0)

    hist = analytics.get_monthly_history_present()
    labels = [h["label"] for h in hist]
    assert labels == ["Jan/26", "Abr/26"]            # only months with data, ascending, gap skipped
    assert hist[0]["expenses"] == pytest.approx(100.0)
    assert hist[0]["income"] == pytest.approx(3000.0)
    assert hist[1]["expenses"] == pytest.approx(250.0)


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


def test_income_method_check_allows_subtypes(db):
    """Regression (#1): income methods (salary/freelance/pix_received/other) must
    satisfy the transactions.method CHECK on a fresh DB. Before the fix, INSERT OR
    IGNORE silently dropped these rows."""
    from core.db import crud, analytics

    tx_id = crud.insert_transaction(
        date="2026-05-01", flow="income", method="salary",
        account_id="nu-db", amount=5000.0, description="Salário", is_revenue=1,
    )
    assert tx_id > 0  # actually inserted, not silently ignored (-1)
    summary = analytics.get_monthly_summary(2026, 5)
    assert summary["income"] == 5000.0


def test_manual_insert_raises_on_bad_method(db):
    """Regression (#4): a manual insert (no external_id) with a constraint-violating
    method must raise, not silently return -1."""
    import sqlite3
    import pytest
    from core.db import crud

    with pytest.raises(sqlite3.IntegrityError):
        crud.insert_transaction(
            date="2026-05-01", flow="expense", method="bogus",
            account_id="nu-db", amount=10.0, description="x",
        )


def test_external_id_collision_still_silently_ignored(db):
    """The dedup path (external_id present) keeps swallowing collisions via
    INSERT OR IGNORE — re-inserting the same id returns -1, not an error."""
    from core.db import crud

    first = crud.insert_transaction(
        date="2026-05-01", flow="expense", method="pix",
        account_id="nu-db", amount=10.0, description="x", external_id="uuid-1",
    )
    second = crud.insert_transaction(
        date="2026-05-01", flow="expense", method="pix",
        account_id="nu-db", amount=10.0, description="x", external_id="uuid-1",
    )
    assert first > 0
    assert second == -1


def test_insert_expense_expands_installments(db):
    """Regression (#5): a 3x credit purchase becomes 3 monthly rows that sum to the
    total — one per fatura cycle — instead of the full amount on a single cycle."""
    from core.db import crud, analytics

    crud.insert_expense(
        date="2026-01-15", method="credit", account_id="nu-cc",
        amount=300.0, description="Notebook", installments=3,
    )
    rows = analytics.get_recent_transactions("nu-cc", limit=10)
    assert len(rows) == 3
    assert sum(r["amount"] for r in rows) == pytest.approx(300.0, abs=0.001)
    dates = sorted(r["date"] for r in rows)
    assert dates == ["2026-01-15", "2026-02-15", "2026-03-15"]
    # Each month's fatura sees only its installment, not the full 300.
    jan = analytics.get_credit_card_statement("nu-cc", "2026-01-01", "2026-01-31")
    assert jan == pytest.approx(100.0, abs=0.001)


def test_insert_expense_installment_cents_remainder(db):
    """The cents remainder lands on the final installment so parts sum exactly."""
    from core.db import crud, analytics

    crud.insert_expense(
        date="2026-01-31", method="credit", account_id="nu-cc",
        amount=100.0, description="Curso", installments=3,
    )
    rows = analytics.get_recent_transactions("nu-cc", limit=10)
    amounts = sorted(r["amount"] for r in rows)
    assert amounts == [33.33, 33.33, 33.34]
    # Day clamps when the target month is shorter (Jan 31 → Feb 28).
    dates = sorted(r["date"] for r in rows)
    assert dates == ["2026-01-31", "2026-02-28", "2026-03-31"]


def test_third_party_excluded_from_account_balance(db):
    """Regression (#2): is_third_party rows must be excluded from the account balance
    used by the hero 'Disponível' number, matching get_account_balance."""
    from core.db import crud, analytics

    crud.insert_transaction(date="2026-05-01", flow="income", method="salary",
                            account_id="nu-db", amount=1000.0, description="Salário", is_revenue=1)
    tx_id = crud.insert_transaction(date="2026-05-02", flow="income", method="pix",
                                    account_id="nu-db", amount=500.0, description="Evento", is_revenue=1)
    crud.update_transaction_fields(tx_id, is_third_party=1)

    accounts = {a["id"]: a for a in analytics.get_all_accounts_with_balance()}
    nu_db = accounts["nu-db"]
    # Third-party 500 excluded → balance is 1000, consistent with both functions.
    assert nu_db["balance"] == pytest.approx(1000.0, abs=0.001)
    assert analytics.get_account_balance("nu-db") == pytest.approx(nu_db["balance"], abs=0.001)
