"""Statement coverage powers the missing-month safety net.

A month is only a gap when it has no transactions AND no coverage. Coverage is
recorded on import (one entry per month each statement file covered — so an empty
month still counts) and when the user dismisses a gap as a no-activity month.
Account-agnostic, idempotent (UNIQUE(year, month)).
"""
import pytest


@pytest.fixture()
def client(db):
    """Flask test client bound to the isolated test DB."""
    import dashboard.server as server
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_record_and_get_coverage(db):
    from core import database
    added = database.record_coverage([(2021, 8), (2021, 8), (2025, 1)], origin="import")
    assert added == 2  # the duplicate (2021, 8) is ignored
    rows = {(r["year"], r["month"]): r["origin"] for r in database.get_coverage()}
    assert rows == {(2021, 8): "import", (2025, 1): "import"}


def test_import_origin_not_downgraded_by_manual(db):
    from core import database
    database.record_coverage([(2021, 8)], origin="import")
    added = database.record_coverage([(2021, 8)], origin="manual")
    assert added == 0  # already covered — no-op, origin stays 'import'
    rows = {(r["year"], r["month"]): r["origin"] for r in database.get_coverage()}
    assert rows[(2021, 8)] == "import"


def test_record_coverage_rejects_bad_input(db):
    from core import database
    with pytest.raises(ValueError):
        database.record_coverage([(2021, 13)])      # month out of range
    with pytest.raises(ValueError):
        database.record_coverage([(2021, 8)], origin="bogus")


def test_api_get_empty(client):
    resp = client.get("/api/statement-coverage")
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_api_post_manual_then_get(client):
    post = client.post("/api/statement-coverage",
                       json={"periods": [{"year": 2021, "month": 8}], "origin": "manual"})
    assert post.status_code == 200
    assert post.get_json()["added"] == 1
    rows = client.get("/api/statement-coverage").get_json()
    assert rows == [{"year": 2021, "month": 8, "origin": "manual"}]


def test_api_post_import_many(client):
    periods = [{"year": 2021, "month": m} for m in range(1, 13)]
    post = client.post("/api/statement-coverage",
                       json={"periods": periods, "origin": "import"})
    assert post.status_code == 200
    assert post.get_json()["added"] == 12
    assert len(client.get("/api/statement-coverage").get_json()) == 12


def test_api_post_rejects_bad(client):
    assert client.post("/api/statement-coverage",
                       json={"periods": [{"year": 2021, "month": 0}]}).status_code == 400
    assert client.post("/api/statement-coverage",
                       json={"periods": [{"year": 2021}]}).status_code == 400
    assert client.post("/api/statement-coverage",
                       json={"periods": [], "origin": "bogus"}).status_code == 400
