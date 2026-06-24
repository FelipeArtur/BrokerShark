"""Import preview/staging now carries counterpart + a history-learned category suggestion.

The preview UI uses these to (a) tag each row correctly (counterpart was previously
not serialized, so SELF transfers showed as 'investimento') and (b) pre-select a
category learned from how the user categorized the same merchant before. Suggestion
is suggest-only: the staging row's category_id is never auto-written.
"""
import pytest

# Nubank export covering the three relevant cases: a real consumption expense
# (categorizable), an investment leg (transfer, not categorizable), and income.
NUBANK = (
    "Data,Valor,Identificador,Descrição\n"
    "10/06/2026,-50.00,sug-uuid-pix,Pix - Padaria do Bairro\n"
    "11/06/2026,-300.00,sug-uuid-rdb,Aplicação RDB\n"
    "12/06/2026,4200.00,sug-uuid-sal,Transferência Recebida - ACME\n"
).encode("utf-8")


@pytest.fixture()
def client(db, monkeypatch):
    """Flask test client bound to the isolated test DB."""
    import dashboard.server as server
    server.app.config["TESTING"] = True
    return server.app.test_client()


def _seed_history(category_name="Padaria"):
    """Create a category + a past categorized expense at 'Padaria do Bairro'."""
    from core import database
    cat_id = database.create_category(category_name, "expense")
    database.insert_transaction(
        date="2026-01-10", flow="expense", method="pix", account_id="nu-db",
        amount=12.0, description="Pix - Padaria do Bairro",
        category_id=cat_id, is_revenue=0,
    )
    return cat_id


def test_preview_suggests_category_from_history(db):
    from core.ingestion import service
    cat_id = _seed_history()

    rows = {r["description"]: r for r in service.preview_import("nu-db", NUBANK)["rows"]}

    pix = rows["Pix - Padaria do Bairro"]            # same merchant as the seeded txn
    assert pix["suggested_category_id"] == cat_id
    assert pix["suggested_category_name"] == "Padaria"
    assert pix["counterpart"] is None                # field serialized

    rdb = rows["Aplicação RDB"]                       # transfer leg → not categorizable
    assert rdb["suggested_category_id"] is None
    assert rdb["suggested_category_name"] is None
    assert "counterpart" in rdb                       # present even when null

    salary = rows["Transferência Recebida - ACME"]  # income, but no income history
    assert salary["suggested_category_id"] is None


def test_no_history_means_no_suggestion(db):
    from core.ingestion import service
    for r in service.preview_import("nu-db", NUBANK)["rows"]:
        assert r["suggested_category_id"] is None
        assert r["suggested_category_name"] is None
        assert "counterpart" in r


def test_self_transfer_serializes_counterpart(db, monkeypatch):
    import config
    monkeypatch.setattr(config, "OWNER_SELF_KEYWORDS", ("joao da silva",))
    from core.ingestion import service

    csv = (
        "Data,Valor,Identificador,Descrição\n"
        "13/06/2026,-500.00,sug-uuid-self,"
        "Transferência enviada pelo Pix - Joao Da Silva\n"
    ).encode("utf-8")
    row = service.preview_import("nu-db", csv)["rows"][0]
    assert row["counterpart"] == "SELF"
    assert row["suggested_category_id"] is None       # SELF is never categorizable


def test_staging_get_and_patch_echo_carry_fields(client):
    from core import database
    from core.ingestion import service
    cat_id = _seed_history()
    batch = service.preview_import("nu-db", NUBANK)["batch_id"]

    # GET re-read includes the new fields
    resp = client.get(f"/api/import/staging/{batch}")
    assert resp.status_code == 200
    rows = {r["description"]: r for r in resp.get_json()}
    assert rows["Pix - Padaria do Bairro"]["suggested_category_id"] == cat_id
    assert "counterpart" in rows["Aplicação RDB"]

    # PATCH echo keeps the suggestion (editing the alias must not drop it)
    pix_id = rows["Pix - Padaria do Bairro"]["id"]
    patch = client.patch(
        f"/api/import/staging/{batch}/{pix_id}", json={"display_name": "Pão"})
    assert patch.status_code == 200
    echoed = patch.get_json()["row"]
    assert echoed["suggested_category_id"] == cat_id
    assert echoed["display_name"] == "Pão"
    assert echoed["counterpart"] is None
    # suggest-only: the staging row's own category_id was never auto-written
    assert echoed["category_id"] is None
    _ = database  # facade import touched for parity with other integration tests
