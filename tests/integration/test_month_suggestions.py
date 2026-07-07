"""/api/month-transactions carries a history-learned category suggestion.

Uncategorized categorizable rows get ``suggested_category_id``/``suggested_category_name``
(same index as the import preview and the bulk panel) so the Histórico table can offer
a one-click apply. Suggest-only: nothing is written until the user clicks — the PATCH
that applies it is the existing per-transaction endpoint.
"""
import pytest


@pytest.fixture()
def client(db):
    import dashboard.server as server
    server.app.config["TESTING"] = True
    return server.app.test_client()


def _seed(cat_name="Padaria"):
    """Past categorized merchant + this-month uncategorized rows of every kind."""
    from core import database
    cat_id = database.create_category(cat_name, "expense")
    # History (another month) teaches the index.
    database.insert_transaction(
        date="2026-01-10", flow="expense", method="pix", account_id="nu-db",
        amount=12.0, description="Pix - Padaria do Bairro",
        category_id=cat_id, is_revenue=0,
    )
    # This month: same merchant, uncategorized → should carry the suggestion.
    database.insert_transaction(
        date="2026-06-10", flow="expense", method="pix", account_id="nu-db",
        amount=50.0, description="Pix - Padaria do Bairro", is_revenue=0,
    )
    # Unknown merchant → no suggestion.
    database.insert_transaction(
        date="2026-06-11", flow="expense", method="pix", account_id="nu-db",
        amount=30.0, description="Pix - Mercado Novo", is_revenue=0,
    )
    # Investment leg (transfer) → never categorizable, never suggested.
    database.insert_transaction(
        date="2026-06-12", flow="expense", method="transfer", account_id="nu-db",
        amount=300.0, description="Aplicação RDB", is_revenue=0,
    )
    return cat_id


def test_month_transactions_suggest_from_history(db):
    from core import database
    cat_id = _seed()
    rows = {t["description"]: t for t in database.get_month_transactions(6, 2026)}

    padaria = rows["Pix - Padaria do Bairro"]
    assert padaria["suggested_category_id"] == cat_id
    assert padaria["suggested_category_name"] == "Padaria"
    # suggest-only: the row itself stays uncategorized
    assert padaria["category_id"] is None

    assert rows["Pix - Mercado Novo"]["suggested_category_id"] is None
    # transfer leg: the keys are absent (front only reads them on uncategorized rows)
    assert rows["Aplicação RDB"].get("suggested_category_id") is None


def test_categorized_rows_carry_no_suggestion(db):
    from core import database
    cat_id = _seed()
    # Categorize the padaria row; re-read must not attach a suggestion to it.
    padaria_id = next(
        t["id"] for t in database.get_month_transactions(6, 2026)
        if t["description"] == "Pix - Padaria do Bairro"
    )
    database.update_transaction_category(padaria_id, cat_id)
    row = next(
        t for t in database.get_month_transactions(6, 2026) if t["id"] == padaria_id
    )
    assert row["category_id"] == cat_id
    assert row.get("suggested_category_id") is None


def test_api_serializes_suggestion(client):
    cat_id = _seed()
    resp = client.get("/api/month-transactions?month=6&year=2026")
    assert resp.status_code == 200
    rows = {t["description"]: t for t in resp.get_json()}
    assert rows["Pix - Padaria do Bairro"]["suggested_category_id"] == cat_id
    assert rows["Pix - Padaria do Bairro"]["suggested_category_name"] == "Padaria"
