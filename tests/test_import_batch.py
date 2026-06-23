"""Tests for reversible imports: import_batch_id tagging + delete_batch.

confirm_staging_batch tags every inserted row with a shared import_batch_id so a
whole import (possibly several per-account staging batches) is reversible in one
shot via delete_batch.
"""
import sqlite3

import pytest

NUBANK = (
    "Data,Valor,Identificador,Descrição\n"
    "10/01/2026,-50.00,uuid-a,Pix - Padaria\n"
    "11/01/2026,-30.00,uuid-b,Pix - Mercado\n"
).encode("utf-8")

INTER = (
    "Extrato Conta Corrente \n"
    "Conta ;1\n"
    "Período ;01/01/2026 a 31/01/2026\n"
    "Saldo: ;0,00\n"
    "\n"
    "Data Lançamento;Descrição;Valor;Saldo\n"
    "10/01/2026;Pix enviado: Fulano;-20,00;0,00\n"
).encode("utf-8")


def _insert_tagged(db, import_batch_id, **kw):
    """Raw-insert a tagged transaction (insert_transaction doesn't take the tag)."""
    cols = dict(
        date="2026-05-01", flow="expense", method="pix", account_id="nu-db",
        amount=10.0, description="x", category_id=None,
        dest_account_id=None, counterpart=None, is_revenue=0, external_id=None,
        import_batch_id=import_batch_id,
    )
    cols.update(kw)
    with sqlite3.connect(db) as raw:
        keys = ",".join(cols)
        q = ",".join("?" for _ in cols)
        cur = raw.execute(f"INSERT INTO transactions ({keys}) VALUES ({q})", tuple(cols.values()))
        return cur.lastrowid


# ── confirm tags inserted rows ───────────────────────────────────────────────

def test_confirm_tags_inserted_rows_with_one_shared_id(db):
    from core import ingestion

    preview = ingestion.preview_import("nu-db", NUBANK)
    res = ingestion.confirm_import(preview["batch_id"])
    bid = res["import_batch_id"]
    assert bid  # generated server-side when caller omits it

    with sqlite3.connect(db) as raw:
        # DISTINCT — not just count: every inserted row shares exactly one tag
        distinct = raw.execute(
            "SELECT DISTINCT import_batch_id FROM transactions WHERE import_batch_id IS NOT NULL"
        ).fetchall()
        assert distinct == [(bid,)]
        assert raw.execute(
            "SELECT COUNT(*) FROM transactions WHERE import_batch_id = ?", (bid,)
        ).fetchone()[0] == 2


def test_shared_session_id_spans_multiple_batches(db):
    """A multi-account drop = several confirms sharing one client-supplied id."""
    from core import ingestion
    from core.db import crud

    sid = "session-xyz"
    r1 = ingestion.confirm_import(ingestion.preview_import("nu-db", NUBANK)["batch_id"], import_batch_id=sid)
    r2 = ingestion.confirm_import(ingestion.preview_import("inter-db", INTER)["batch_id"], import_batch_id=sid)
    assert r1["import_batch_id"] == sid and r2["import_batch_id"] == sid
    assert crud.count_batch(sid) == 3  # 2 Nubank + 1 Inter, one reversible unit


def test_dedup_intact_with_new_column(db):
    """INSERT OR IGNORE external_id dedup still fires after adding import_batch_id."""
    from core import ingestion

    ingestion.confirm_import(ingestion.preview_import("nu-db", NUBANK)["batch_id"])
    preview2 = ingestion.preview_import("nu-db", NUBANK)
    assert preview2["counts"]["new"] == 0
    assert preview2["counts"]["duplicate"] == 2
    res2 = ingestion.confirm_import(preview2["batch_id"])
    assert res2["inserted"] == 0  # re-import skips dupes, tags nothing new

    with sqlite3.connect(db) as raw:
        assert raw.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 2


# ── delete_batch ─────────────────────────────────────────────────────────────

def test_delete_batch_unknown_id_is_noop(db):
    from core.db import crud
    res = crud.delete_batch("does-not-exist")
    assert res == {"deleted": 0, "transactions": [], "investment_deltas": []}


def test_delete_batch_reverts_investment_balance(db):
    """A tagged modal-format investment leg reverts current_balance on batch undo."""
    from core.db import crud, analytics

    inv_id = crud.upsert_investment("Tesouro X", "treasury", "nubank")
    crud.update_investment_balance(inv_id, 100.0)
    sid = "imp-3"
    _insert_tagged(db, sid, description="Aplicação: Tesouro X", method="transfer", amount=250.0)
    crud.update_investment_balance(inv_id, 350.0)  # simulate the leg's effect

    res = crud.delete_batch(sid)
    assert res["investment_deltas"] == [{"id": inv_id, "applied_delta": 250.0}]
    assert analytics.get_investment_by_name("Tesouro X")["current_balance"] == 100.0


# ── migration idempotency ────────────────────────────────────────────────────

def test_import_batch_id_column_and_partial_index_present_and_idempotent(db):
    import core.db.schema as schema

    with sqlite3.connect(db) as raw:
        cols = [r[1] for r in raw.execute("PRAGMA table_info(transactions)")]
        assert "import_batch_id" in cols
        idx = raw.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tx_import_batch'"
        ).fetchone()
        assert idx is not None

    # re-running init_db (the try/except-SELECT migration) is a safe no-op
    schema.init_db()
    schema.init_db()
    with sqlite3.connect(db) as raw:
        cols = [r[1] for r in raw.execute("PRAGMA table_info(transactions)")]
        assert cols.count("import_batch_id") == 1


# ── endpoints ────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(db, monkeypatch):
    import dashboard.server as server
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_endpoint_confirm_returns_id_then_delete(client, db):
    from core import ingestion
    from core.db import crud

    preview = ingestion.preview_import("nu-db", NUBANK)
    r = client.post("/api/import/confirm", json={"batch_id": preview["batch_id"]})
    assert r.status_code == 200
    bid = r.get_json()["import_batch_id"]
    assert bid
    assert crud.count_batch(bid) == 2

    d = client.delete(f"/api/import/batch/{bid}")
    assert d.status_code == 200
    body = d.get_json()
    assert body["ok"] and body["deleted"] == 2 and "restore" in body

    assert crud.count_batch(bid) == 0
    assert client.delete("/api/import/batch/nonexistent").status_code == 404
