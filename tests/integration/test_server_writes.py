"""Tests for dashboard write endpoints — validation and is_revenue semantics."""
import pytest


@pytest.fixture()
def client(db, monkeypatch):
    """Flask test client bound to the isolated test DB from the `db` fixture."""
    import dashboard.server as server
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


def test_expense_post_creates_transaction(client):
    """Regression: POST /api/transactions must persist an expense. The
    checking-only pivot renamed crud.insert_expense → insert_transaction but left
    the call site calling the old name, so this endpoint 500'd with no test to catch it."""
    from core.db import analytics

    resp = client.post("/api/transactions", json={
        "account_id": "nu-db", "method": "pix",
        "amount": 50.0, "date": "2026-05-01", "description": "Padaria", "category_id": 1,
    })
    assert resp.status_code == 200
    assert resp.get_json()["id"] > 0
    assert analytics.get_monthly_summary(2026, 5)["expenses"] == 50.0


def test_expense_invalid_method_rejected(client):
    resp = client.post("/api/transactions", json={
        "account_id": "nu-db", "method": "bogus",
        "amount": 50.0, "date": "2026-05-01", "description": "x", "category_id": 1,
    })
    assert resp.status_code == 400


def test_expense_invalid_account_rejected(client):
    resp = client.post("/api/transactions", json={
        "account_id": "nu-cc", "method": "pix",
        "amount": 50.0, "date": "2026-05-01", "description": "x", "category_id": 1,
    })
    assert resp.status_code == 400


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


def test_import_detect_endpoint(client):
    """POST /api/import/detect sniffs each file's header → account_id or null."""
    import io
    nu = b"Data,Valor,Identificador,Descricao\n10/01/2026,-50.00,uuid-1,Padaria\n"
    resp = client.post("/api/import/detect",
                       data={"file": (io.BytesIO(nu), "nubank.csv")},
                       content_type="multipart/form-data")
    assert resp.status_code == 200
    assert resp.get_json()[0]["account_id"] == "nu-db"

    unknown = client.post("/api/import/detect",
                          data={"file": (io.BytesIO(b"a,b,c\n1,2,3\n"), "x.csv")},
                          content_type="multipart/form-data")
    assert unknown.get_json()[0]["account_id"] is None


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



def test_expense_rejects_malformed_date(client):
    # a malformed date is accepted by SQLite but silently drops out of every
    # strftime('%Y-%m') month grouping while still counting in balances
    for bad in ("01/05/2026", "2026-13-01", "2026-05-1", "yesterday", 20260501):
        resp = client.post("/api/transactions", json={
            "account_id": "nu-db", "method": "pix",
            "amount": 50.0, "date": bad, "description": "x", "category_id": 1,
        })
        assert resp.status_code == 400, f"date {bad!r} was accepted"


def test_expense_rejects_unknown_category(client):
    # mirrors the PATCH endpoint: unknown FK must be a 400, not an
    # unhandled IntegrityError 500 (foreign_keys=ON)
    resp = client.post("/api/transactions", json={
        "account_id": "nu-db", "method": "pix",
        "amount": 50.0, "date": "2026-05-01", "description": "x",
        "category_id": 999999,
    })
    assert resp.status_code == 400


def test_income_rejects_malformed_date(client):
    resp = client.post("/api/incomes", json={
        "type": "salary", "account_id": "nu-db",
        "amount": 100.0, "date": "05/2026",
    })
    assert resp.status_code == 400
