"""Tests for safe transaction deletion: integrity-linked groups + reliable restore.

delete_transaction returns an opaque restore payload; restore_transactions replays
it. Deletion cascades to installment groups, auto-transfer pairs, and reverts
investment current_balance; fatura payments stay protected.
"""
import pytest


def _add(**kw):
    from core.db import crud
    defaults = dict(flow="expense", method="pix", account_id="nu-db", installments=1,
                    category_id=None, dest_account_id=None, counterpart=None, is_revenue=0)
    defaults.update(kw)
    return crud.insert_transaction(**defaults)


def _count(db):
    import sqlite3
    with sqlite3.connect(db) as raw:
        return raw.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]


# ── single row: delete → restore round trip ─────────────────────────────────

def test_delete_then_restore_recreates_row(db):
    from core.db import crud
    tid = _add(date="2026-05-01", amount=42.0, description="X", category_id=None)
    payload = crud.delete_transaction(tid)
    assert payload is not None
    assert crud.get_transaction(tid) is None
    assert len(payload["transactions"]) == 1

    restored = crud.restore_transactions(payload)
    assert restored == 1
    row = crud.get_transaction(tid)
    assert row is not None and row["amount"] == 42.0 and row["description"] == "X"


def test_delete_missing_returns_none(db):
    from core.db import crud
    assert crud.delete_transaction(999999) is None


def test_restore_empty_payload_noop(db):
    from core.db import crud
    assert crud.restore_transactions({}) == 0
    assert crud.restore_transactions({"transactions": []}) == 0


# ── fatura payment stays protected ──────────────────────────────────────────

def test_fatura_payment_not_deletable(db):
    from core.db import crud
    tid = _add(date="2026-05-01", flow="expense", method="transfer",
               account_id="nu-db", dest_account_id="nu-cc", amount=900.0,
               description="Pagamento fatura")
    with pytest.raises(ValueError):
        crud.delete_transaction(tid)
    assert crud.get_transaction(tid) is not None  # untouched


# ── installment group cascades ──────────────────────────────────────────────

def test_installment_group_deletes_and_restores_together(db):
    from core.db import crud
    first = crud.insert_expense(date="2026-01-10", method="credit", account_id="nu-cc",
                                amount=300.0, description="TV", installments=3, category_id=None)
    assert _count(db) == 3

    payload = crud.delete_transaction(first)
    assert len(payload["transactions"]) == 3      # all three parcelas
    assert _count(db) == 0

    assert crud.restore_transactions(payload) == 3
    assert _count(db) == 3


# ── auto-transfer pair cascades ─────────────────────────────────────────────

def test_self_transfer_pair_deletes_together(db):
    from core.db import crud
    out_id = _add(date="2026-05-01", flow="expense", method="transfer",
                  account_id="nu-db", amount=100.0, counterpart="SELF", description="-> inter")
    _add(date="2026-05-01", flow="income", method="ted", account_id="inter-db",
         amount=100.0, counterpart="SELF", is_revenue=0, description="<- nu")
    assert _count(db) == 2

    payload = crud.delete_transaction(out_id)
    assert len(payload["transactions"]) == 2      # both legs
    assert _count(db) == 0
    assert crud.restore_transactions(payload) == 2
    assert _count(db) == 2


# ── investment leg reverts + restores current_balance ───────────────────────

def test_investment_leg_delete_reverts_balance_and_restores(db):
    from core.db import crud, analytics
    inv_id = crud.upsert_investment("Tesouro IPCA+ 2029", "treasury", "nubank")
    crud.update_investment_balance(inv_id, 100.0)
    tx_id = crud.register_investment_transfer(inv_id, "nubank", "deposit", 250.0,
                                              "2026-05-10", "Tesouro IPCA+ 2029")
    assert analytics.get_investment_by_name("Tesouro IPCA+ 2029")["current_balance"] == 350.0

    payload = crud.delete_transaction(tx_id)
    # leg gone AND balance reverted to pre-deposit
    assert crud.get_transaction(tx_id) is None
    assert analytics.get_investment_by_name("Tesouro IPCA+ 2029")["current_balance"] == 100.0
    assert payload["investment_deltas"] == [{"id": inv_id, "applied_delta": 250.0}]

    crud.restore_transactions(payload)
    assert crud.get_transaction(tx_id) is not None
    assert analytics.get_investment_by_name("Tesouro IPCA+ 2029")["current_balance"] == 350.0


# ── endpoint round trip ─────────────────────────────────────────────────────

@pytest.fixture()
def client(db, monkeypatch):
    import importlib
    import dashboard.server as server
    importlib.reload(server)
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_endpoint_delete_and_restore(client, db):
    from core.db import crud
    tid = _add(date="2026-05-01", amount=15.0, description="Y", category_id=None)

    resp = client.delete(f"/api/transactions/{tid}")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] and body["deleted"] == 1 and "restore" in body
    assert crud.get_transaction(tid) is None

    r2 = client.post("/api/transactions/restore", json={"restore": body["restore"]})
    assert r2.status_code == 200 and r2.get_json()["restored"] == 1
    assert crud.get_transaction(tid) is not None


def test_endpoint_delete_fatura_409(client):
    tid = _add(date="2026-05-01", flow="expense", method="transfer",
               account_id="nu-db", dest_account_id="inter-cc", amount=500.0, description="fatura")
    assert client.delete(f"/api/transactions/{tid}").status_code == 409
