"""Bulk categorization by merchant — tag every occurrence at once.

Uncategorized, categorizable transactions are grouped by merchant key (so the
panel can tag all "Padaria do Bairro" rows in one pick), most-spent first, each
carrying a history-learned suggestion. Transfer legs, SELF and investment legs
are never offered (not categorizable).
"""
import pytest


@pytest.fixture()
def client(db):
    import dashboard.server as server
    server.app.config["TESTING"] = True
    return server.app.test_client()


def _seed(db):
    from core import database
    cat = database.create_category("Padaria", "expense")
    # three uncategorized expenses at the same merchant (different masks/dates)
    ids = [
        database.insert_transaction(date="2026-03-01", flow="expense", method="pix",
                                     account_id="nu-db", amount=10.0,
                                     description="Pix - Padaria do Bairro 12.345", is_revenue=0),
        database.insert_transaction(date="2026-03-08", flow="expense", method="pix",
                                     account_id="nu-db", amount=20.0,
                                     description="Compra no débito - PADARIA DO BAIRRO", is_revenue=0),
    ]
    # one categorized history row at the same merchant → drives the suggestion
    database.insert_transaction(date="2026-01-02", flow="expense", method="pix",
                                account_id="nu-db", amount=5.0,
                                description="Padaria do Bairro", category_id=cat, is_revenue=0)
    # a transfer leg (investment) — must NOT appear in the bulk panel
    database.insert_transaction(date="2026-03-10", flow="expense", method="transfer",
                                account_id="nu-db", amount=300.0,
                                description="Aplicação RDB", is_revenue=0)
    return cat, ids


def test_groups_merchant_with_suggestion(db):
    from core import database
    cat, ids = _seed(db)
    groups = database.get_uncategorized_merchants()
    # the two padaria rows collapse to one merchant group; the transfer is excluded
    assert len(groups) == 1
    g = groups[0]
    assert g["count"] == 2
    assert sorted(g["ids"]) == sorted(ids)
    assert g["total"] == pytest.approx(30.0)
    assert g["suggested_category_id"] == cat
    assert g["suggested_category_name"] == "Padaria"


def test_bulk_categorize_tags_all(client, db):
    from core import database
    cat, ids = _seed(db)
    resp = client.post("/api/transactions/categorize-bulk",
                       json={"ids": ids, "category_id": cat})
    assert resp.status_code == 200
    assert resp.get_json()["updated"] == 2
    # both rows now carry the category → no longer uncategorized
    assert database.get_uncategorized_merchants() == []


def test_bulk_rejects_unknown_category(client, db):
    _cat, ids = _seed(db)
    assert client.post("/api/transactions/categorize-bulk",
                       json={"ids": ids, "category_id": 99999}).status_code == 400
    assert client.post("/api/transactions/categorize-bulk",
                       json={"ids": ids}).status_code == 400


def test_get_endpoint(client, db):
    _cat, _ids = _seed(db)
    resp = client.get("/api/uncategorized-merchants")
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data) == 1 and data[0]["count"] == 2
