"""Golden characterization test — the regression gate for the Phase 1 consumption-rule
swap (eng-plan 2026-06-23 hexagonal-lite, finding T1).

The consumption-expense clause is hand-copied across ~33 SQL sites in analytics.py,
and those sites are NOT homogeneous (consumption vs investment-leg vs patrimônio vs
income — see CLAUDE.md "consumption-expense rule"). Centralizing them via a helper is
safe ONLY if every aggregate keeps producing the same number. This test pins TODAY's
output of every invariant aggregate against a fixed seed, so a wrong swap turns it red.

    seed (deterministic, 3 months × 2 accounts, every clause family)
      ↓
    invariant aggregates  ──assert──>  golden snapshot (captured pre-swap)

IRON RULE: this file is committed BEFORE the swap and stays untouched DURING it. The
only assertion expected to change is `all_time_categories` — :262 currently OMITS the
is_third_party filter (finding T1b), so it over-counts by the third-party expense; when
Phase 1b fixes :262, update that one literal (750.0) and note it in the commit.
"""
import pytest


def _seed() -> None:
    """Deterministic spread covering every clause family the swap touches.

    consumption (pix/ted) · income (salary) · self-transfer (counterpart=SELF, both legs)
    · investment legs (aplicação expense/transfer, resgate income/is_revenue=0) ·
    internal transfer (dest set) · third-party (is_third_party=1, WITH category → exercises :262).
    """
    from core.db import crud, categories

    cat = categories.create_category("Mercado", "expense")
    T = crud.insert_transaction
    # 2026-03
    T(date="2026-03-05", flow="income", method="salary", account_id="nu-db",
      amount=5000.0, description="Salario", is_revenue=1)
    T(date="2026-03-10", flow="expense", method="pix", account_id="nu-db",
      amount=200.0, description="Mercado", category_id=cat, is_revenue=0)
    T(date="2026-03-12", flow="expense", method="ted", account_id="inter-db",
      amount=100.0, description="Conta luz", is_revenue=0)
    # 2026-04
    T(date="2026-04-05", flow="income", method="salary", account_id="nu-db",
      amount=5000.0, description="Salario", is_revenue=1)
    T(date="2026-04-08", flow="expense", method="pix", account_id="nu-db",
      amount=300.0, description="Restaurante", category_id=cat, is_revenue=0)
    tp = T(date="2026-04-09", flow="expense", method="pix", account_id="nu-db",
           amount=1000.0, description="Ingresso evento", category_id=cat, is_revenue=0)
    crud.update_transaction_fields(tp, is_third_party=1)
    T(date="2026-04-15", flow="expense", method="transfer", account_id="nu-db",
      amount=500.0, description="Transf propria", counterpart="SELF", is_revenue=0)
    T(date="2026-04-15", flow="income", method="transfer", account_id="inter-db",
      amount=500.0, description="Transf propria", counterpart="SELF", is_revenue=0)
    T(date="2026-04-20", flow="expense", method="transfer", account_id="nu-db",
      amount=400.0, description="Aplicacao RDB", is_revenue=0)
    # 2026-05
    T(date="2026-05-05", flow="income", method="salary", account_id="nu-db",
      amount=5000.0, description="Salario", is_revenue=1)
    T(date="2026-05-08", flow="expense", method="pix", account_id="nu-db",
      amount=250.0, description="Farmacia", category_id=cat, is_revenue=0)
    T(date="2026-05-10", flow="income", method="transfer", account_id="nu-db",
      amount=150.0, description="Resgate RDB", is_revenue=0)
    T(date="2026-05-12", flow="expense", method="transfer", account_id="nu-db",
      amount=200.0, description="Interna", dest_account_id="inter-db", is_revenue=0)


@pytest.fixture()
def seeded(db):
    _seed()
    return db


def test_golden_monthly_summary(seeded):
    """Abr/26: only the 300 pix expense counts (third-party 1000, self-transfer 500,
    aplicação 400 all excluded). Income = 5000 salary."""
    from core.db import analytics

    s = analytics.get_monthly_summary(2026, 4)
    assert s["expenses"] == pytest.approx(300.0)
    assert s["income"] == pytest.approx(5000.0)
    assert s["other_income"] == pytest.approx(5000.0)
    assert s["top_category"]["total"] == pytest.approx(300.0)


def test_golden_cashflow(seeded):
    """investment_net = 400 aplicação − 0 (resgate is May) = 400; free = 5000−300−400."""
    from core.db import analytics

    c = analytics.get_cashflow_statement(4, 2026)
    assert c["income_total"] == pytest.approx(5000.0)
    assert c["expense_total"] == pytest.approx(300.0)
    assert c["investment_net"] == pytest.approx(400.0)
    assert c["free_balance"] == pytest.approx(4300.0)


def test_golden_expenses_by_category(seeded):
    """Excludes the third-party 1000 (is_third_party=1) → Mercado = 300 for Abr."""
    from core.db import analytics

    rows = analytics.get_expenses_by_category(2026, 4)
    assert rows == [{"name": "Mercado", "total": pytest.approx(300.0)}]


def test_golden_account_monthly(seeded):
    from core.db import analytics

    a = analytics.get_account_monthly_summary("nu-db", 2026, 4)
    assert a["expenses"] == pytest.approx(300.0)
    assert a["income"] == pytest.approx(5000.0)


def test_golden_monthly_history_present(seeded):
    """Three months with data, ascending; each expenses figure is consumption-only."""
    from core.db import analytics

    h = analytics.get_monthly_history_present()
    assert [x["label"] for x in h] == ["Mar/26", "Abr/26", "Mai/26"]
    assert [x["expenses"] for x in h] == [pytest.approx(300.0), pytest.approx(300.0), pytest.approx(250.0)]
    assert [x["income"] for x in h] == [pytest.approx(5000.0)] * 3


def test_golden_all_time_summary(seeded):
    """Canonical clause: expenses_total excludes third-party → 200+100+300+250 = 850."""
    from core.db import analytics

    s = analytics.get_all_time_summary()
    assert s["months_count"] == 3
    assert s["income_total"] == pytest.approx(15000.0)
    assert s["expenses_total"] == pytest.approx(850.0)


def test_golden_all_time_categories_PINS_262_divergence(seeded):
    """analytics.py:262 (get_all_time_categories) currently OMITS COALESCE(is_third_party,0)=0,
    so Mercado over-counts by the 1000 third-party expense → 200+300+250+1000 = 1750.

    This is the T1b divergence. When Phase 1b aligns :262 to the canonical clause, this
    literal becomes 750.0 (third-party excluded) — update it then, with a commit note.
    Until then, pinning 1750 proves the swap itself didn't move the number.
    """
    from core.db import analytics

    rows = analytics.get_all_time_categories()
    assert rows == [{"name": "Mercado", "total": pytest.approx(1750.0)}]
