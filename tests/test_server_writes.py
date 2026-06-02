"""Tests for dashboard write endpoints — validation and is_revenue semantics."""
import pytest


@pytest.fixture()
def client(db, monkeypatch):
    """Flask test client bound to the isolated test DB from the `db` fixture."""
    import importlib
    import dashboard.server as server
    importlib.reload(server)  # rebind module-level refs after _connect is patched
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_income_defaults_to_revenue(client):
    """Regression (#3): a salary posted without an explicit is_revenue must still
    count as revenue (is_revenue=1), or it vanishes from every income summary."""
    from core.db import analytics

    resp = client.post("/api/incomes", json={
        "type": "salary", "account_id": "nu-db",
        "amount": 5000.0, "date": "2026-05-01", "description": "Salário",
    })
    assert resp.status_code == 200
    assert resp.get_json()["id"] > 0
    assert analytics.get_monthly_summary(2026, 5)["income"] == 5000.0


def test_income_explicit_non_revenue_opt_out(client):
    from core.db import analytics

    resp = client.post("/api/incomes", json={
        "type": "other", "account_id": "nu-db", "is_revenue": 0,
        "amount": 200.0, "date": "2026-05-01", "description": "Reembolso",
    })
    assert resp.status_code == 200
    assert analytics.get_monthly_summary(2026, 5)["income"] == 0.0


def test_income_invalid_type_rejected(client):
    resp = client.post("/api/incomes", json={
        "type": "bogus", "account_id": "nu-db",
        "amount": 100.0, "date": "2026-05-01",
    })
    assert resp.status_code == 400


def test_expense_invalid_method_rejected(client):
    resp = client.post("/api/transactions", json={
        "account_id": "nu-cc", "method": "bogus",
        "amount": 50.0, "date": "2026-05-01", "description": "x", "category_id": 1,
    })
    assert resp.status_code == 400


def test_expense_installments_expanded_via_endpoint(client):
    from core.db import analytics

    resp = client.post("/api/transactions", json={
        "account_id": "nu-cc", "method": "credit", "installments": 3,
        "amount": 300.0, "date": "2026-01-10", "description": "TV", "category_id": 1,
    })
    assert resp.status_code == 200
    rows = analytics.get_recent_transactions("nu-cc", limit=10)
    assert len(rows) == 3
    assert sum(r["amount"] for r in rows) == pytest.approx(300.0, abs=0.001)
