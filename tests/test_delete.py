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

def test_delete_missing_returns_none(db):
    from core.db import crud
    assert crud.delete_transaction(999999) is None


def test_restore_empty_payload_noop(db):
    from core.db import crud
    assert crud.restore_transactions({}) == 0
    assert crud.restore_transactions({"transactions": []}) == 0


# ── fatura payment stays protected ──────────────────────────────────────────

# ── installment group cascades ──────────────────────────────────────────────

# ── auto-transfer pair cascades ─────────────────────────────────────────────

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


