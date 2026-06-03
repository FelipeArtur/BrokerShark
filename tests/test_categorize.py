"""Tests for the categorization backlog tooling: auto-rules, grouping, bulk set.

Covers core/ingestion/categorize.py, analytics.get_uncategorized_grouped,
crud.bulk_set_category, and the dashboard endpoints that expose them.
"""
import pytest


def _cat_id(name: str, flow: str = "expense") -> int:
    from core.db import categories
    return {r["name"]: r["id"] for r in categories.get_categories(flow)}[name]


def _add(db_unused, **kw):
    """Insert a transaction with sensible consumption defaults."""
    from core.db import crud
    defaults = dict(method="pix", account_id="nu-db", installments=1,
                    category_id=None, dest_account_id=None, counterpart=None,
                    is_revenue=0)
    defaults.update(kw)
    return crud.insert_transaction(**defaults)


# ── auto-rule keyword matching ──────────────────────────────────────────────

def test_suggest_category_name_matches_known_merchants():
    from core.ingestion.categorize import suggest_category_name
    assert suggest_category_name("SUBWAY Salvador BRA", "expense") == "Alimentação"
    assert suggest_category_name("POSTO SHELL CENTRO", "expense") == "Carro"
    assert suggest_category_name("Transferência enviada pelo Pix - instituicao exemplo", "expense") == "Igreja"
    assert suggest_category_name("Pix recebido: fulano", "income") == "PIX recebido"
    assert suggest_category_name("EXEMPLO LTDA", "income") == "Salário"


def test_suggest_category_name_no_match_returns_none():
    from core.ingestion.categorize import suggest_category_name
    assert suggest_category_name("Transferência enviada pelo Pix - João da Silva", "expense") is None


def test_auto_categorize_fills_only_uncategorized_consumption(db):
    from core.ingestion.categorize import auto_categorize
    from core.db.schema import _connect

    food = _add(db, date="2026-05-01", flow="expense", amount=20.0, description="SUBWAY Salvador BRA")
    manual = _add(db, date="2026-05-02", flow="expense", amount=30.0, description="SUBWAY já categorizado",
                  category_id=_cat_id("Outro"))
    transfer = _add(db, date="2026-05-03", flow="expense", method="transfer", amount=50.0,
                    description="Aplicacao: CDB PORQUINHO")  # investment leg → never categorized
    ambiguous = _add(db, date="2026-05-04", flow="expense", amount=10.0, description="Pix - pessoa desconhecida")

    with _connect() as conn:
        res = auto_categorize(conn)

    from core.db import crud
    assert crud.get_transaction(food)["category_id"] == _cat_id("Alimentação")
    assert crud.get_transaction(manual)["category_id"] == _cat_id("Outro")       # untouched
    assert crud.get_transaction(transfer)["category_id"] is None                  # transfer skipped
    assert crud.get_transaction(ambiguous)["category_id"] is None                 # no rule
    assert res["matched"] == 1


# ── grouping ────────────────────────────────────────────────────────────────

def test_get_uncategorized_grouped_collapses_by_label(db):
    from core.db import analytics
    _add(db, date="2026-05-01", flow="expense", amount=10.0, description="PADARIA DO ZE")
    _add(db, date="2026-05-08", flow="expense", amount=15.0, description="PADARIA DO ZE")
    _add(db, date="2026-05-09", flow="expense", amount=99.0, description="LOJA RANDOM")

    groups = analytics.get_uncategorized_grouped("expense")
    by_label = {g["label"]: g for g in groups}
    assert by_label["PADARIA DO ZE"]["count"] == 2
    assert by_label["PADARIA DO ZE"]["total"] == pytest.approx(25.0)
    assert len(by_label["PADARIA DO ZE"]["ids"]) == 2


def test_get_uncategorized_grouped_excludes_transfers_and_categorized(db):
    from core.db import analytics
    _add(db, date="2026-05-01", flow="expense", method="transfer", amount=50.0,
         description="Aplicacao: investimento")
    _add(db, date="2026-05-02", flow="expense", amount=20.0, description="Mercado",
         category_id=_cat_id("Alimentação"))
    _add(db, date="2026-05-03", flow="income", method="transfer", amount=80.0,
         counterpart="SELF", description="auto-pix")

    assert analytics.get_uncategorized_grouped("expense") == []
    assert analytics.get_uncategorized_grouped("income") == []


# ── bulk set ────────────────────────────────────────────────────────────────

def test_bulk_set_category(db):
    from core.db import crud
    a = _add(db, date="2026-05-01", flow="expense", amount=10.0, description="X")
    b = _add(db, date="2026-05-02", flow="expense", amount=20.0, description="Y")
    n = crud.bulk_set_category([a, b], _cat_id("Lazer"))
    assert n == 2
    assert crud.get_transaction(a)["category_id"] == _cat_id("Lazer")
    assert crud.get_transaction(b)["category_id"] == _cat_id("Lazer")


def test_bulk_set_category_empty_is_noop(db):
    from core.db import crud
    assert crud.bulk_set_category([], _cat_id("Lazer")) == 0


# ── endpoints ───────────────────────────────────────────────────────────────

@pytest.fixture()
def client(db, monkeypatch):
    import importlib
    import dashboard.server as server
    importlib.reload(server)
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_endpoint_uncategorized_and_bulk_roundtrip(client, db):
    a = _add(db, date="2026-05-01", flow="expense", amount=12.0, description="FEIRA LIVRE")
    b = _add(db, date="2026-05-05", flow="expense", amount=8.0, description="FEIRA LIVRE")

    groups = client.get("/api/uncategorized?flow=expense").get_json()
    feira = next(g for g in groups if g["label"] == "FEIRA LIVRE")
    assert sorted(feira["ids"]) == sorted([a, b])

    resp = client.post("/api/transactions/bulk-category",
                       json={"ids": feira["ids"], "category_id": _cat_id("Alimentação")})
    assert resp.status_code == 200
    assert resp.get_json()["updated"] == 2
    assert client.get("/api/uncategorized?flow=expense").get_json() == []


def test_endpoint_bulk_validates_payload(client):
    assert client.post("/api/transactions/bulk-category", json={"ids": "nope", "category_id": 1}).status_code == 400
    assert client.post("/api/transactions/bulk-category", json={"ids": [], "category_id": 1}).status_code == 400
    assert client.post("/api/transactions/bulk-category", json={"ids": [1], "category_id": "x"}).status_code == 400


def test_endpoint_auto_categorize(client, db):
    _add(db, date="2026-05-01", flow="expense", amount=20.0, description="SUBWAY centro")
    resp = client.post("/api/auto-categorize", json={})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True and body["matched"] == 1


def test_endpoint_categories_list(client):
    income = client.get("/api/categories-list?flow=income").get_json()
    names = {c["name"] for c in income}
    assert "Salário" in names and "PIX recebido" in names
    assert client.get("/api/categories-list?flow=bogus").status_code == 400
