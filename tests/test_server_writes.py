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


# ── P1b: editable import-staging route ────────────────────────────────────────

def _stage_one_pix(account="nu-db"):
    from core import ingestion
    extrato = (
        "Data,Valor,Identificador,Descrição\n"
        "10/01/2026,-50.00,uuid-pix,Pix - Padaria do Bairro\n"
    ).encode("utf-8")
    return ingestion.preview_import(account, extrato)


def test_import_staging_edit_amount_route(client):
    preview = _stage_one_pix()
    row = preview["rows"][0]
    resp = client.patch(
        f"/api/import/staging/{preview['batch_id']}/{row['id']}",
        json={"amount": 45.50, "display_name": "Padaria"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["row"]["amount"] == 45.50
    assert body["row"]["display_name"] == "Padaria"
    assert body["amount_divergence"] == -4.50  # 45.50 − 50.00


def test_import_staging_edit_rejects_bad_amount(client):
    preview = _stage_one_pix()
    row = preview["rows"][0]
    resp = client.patch(
        f"/api/import/staging/{preview['batch_id']}/{row['id']}",
        json={"amount": -5},
    )
    assert resp.status_code == 400


def test_import_staging_edit_unknown_row_404(client):
    preview = _stage_one_pix()
    resp = client.patch(
        f"/api/import/staging/{preview['batch_id']}/999999",
        json={"amount": 10.0},
    )
    assert resp.status_code == 404


def test_import_staging_edit_rejects_unknown_category(client):
    # a bad category_id must be rejected up front, not silently dropped by
    # confirm's INSERT OR IGNORE (FK violation)
    preview = _stage_one_pix()
    row = preview["rows"][0]
    resp = client.patch(
        f"/api/import/staging/{preview['batch_id']}/{row['id']}",
        json={"category_id": 999999},
    )
    assert resp.status_code == 400


# ── fatura_due membership via PATCH ────────────────────────────────────────────

def test_patch_fatura_due_on_card_purchase(client):
    """Tag/untag a card purchase into the open fatura (add the CLUBE use case)."""
    from core.db import crud, analytics

    tx = crud.insert_transaction(date="2026-06-02", flow="expense", method="credit",
                                 account_id="nu-cc", amount=90.0, description="CLUBE", category_id=1)
    resp = client.patch(f"/api/transactions/{tx}", json={"fatura_due": "2026-06-25"})
    assert resp.status_code == 200
    assert tx in [r["id"] for r in analytics.get_fatura_detail("nu-cc", "2026-06-25")["members"]]

    resp = client.patch(f"/api/transactions/{tx}", json={"fatura_due": None})
    assert resp.status_code == 200
    assert tx not in [r["id"] for r in analytics.get_fatura_detail("nu-cc", "2026-06-25")["members"]]


def test_patch_fatura_due_rejects_checking_row(client):
    """fatura_due is only valid on a credit-card purchase, never on a checking row."""
    from core.db import crud

    tx = crud.insert_transaction(date="2026-06-02", flow="expense", method="pix",
                                 account_id="nu-db", amount=20.0, description="x", category_id=1)
    resp = client.patch(f"/api/transactions/{tx}", json={"fatura_due": "2026-06-25"})
    assert resp.status_code == 400


def test_patch_fatura_due_rejects_payment_leg(client):
    """A leg with a dest account (fatura payment) can never carry fatura_due."""
    from core.db import crud

    tx = crud.insert_transaction(date="2026-06-05", flow="expense", method="transfer",
                                 account_id="nu-cc", amount=500.0, description="pay",
                                 dest_account_id="nu-cc", is_revenue=0)
    resp = client.patch(f"/api/transactions/{tx}", json={"fatura_due": "2026-06-25"})
    assert resp.status_code == 400


def test_patch_fatura_due_invalid_date(client):
    from core.db import crud

    tx = crud.insert_transaction(date="2026-06-02", flow="expense", method="credit",
                                 account_id="nu-cc", amount=90.0, description="x", category_id=1)
    resp = client.patch(f"/api/transactions/{tx}", json={"fatura_due": "10/06/2026"})
    assert resp.status_code == 400
