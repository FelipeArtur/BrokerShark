"""Security hardening regression gates.

These lock in the defense-in-depth added in the VibeSec pass: at-rest DB file
permissions, the Sec-Fetch-Site / header layer, and bounds on the bulk endpoint.
"""
import os
import stat

import pytest


@pytest.fixture()
def client(db):
    import dashboard.server as server
    server.app.config["TESTING"] = True
    return server.app.test_client()


def test_db_file_is_owner_only(db):
    """init_db() locks the ledger to 0600 — no group/other read of financial data."""
    mode = stat.S_IMODE(os.stat(db).st_mode)
    assert mode == 0o600, oct(mode)


def test_security_headers_present(client):
    r = client.get("/api/accounts")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "geolocation=()" in r.headers["Permissions-Policy"]
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"  # /api/ is never cached


def test_sec_fetch_site_cross_site_blocked(client):
    """A cross-site write is rejected even though the Origin header is absent."""
    r = client.post("/api/transactions/categorize-bulk",
                    json={"ids": [], "category_id": 1},
                    headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403
    # same-origin (the real app) still works
    ok = client.post("/api/transactions/categorize-bulk",
                     json={"ids": [], "category_id": 1},
                     headers={"Sec-Fetch-Site": "same-origin"})
    assert ok.status_code == 200


def test_foreign_host_blocked(client):
    """DNS-rebinding: a foreign Host header is rejected."""
    r = client.get("/api/accounts", headers={"Host": "evil.example.com"})
    assert r.status_code == 403


def test_bulk_categorize_caps_id_count(client):
    """An oversized id list is a 400, not a SQLite "too many variables" 500."""
    r = client.post("/api/transactions/categorize-bulk",
                    json={"ids": list(range(10001)), "category_id": 1})
    assert r.status_code == 400


def test_bulk_categorize_chunks_over_sqlite_limit(db):
    """>999 ids update fine (chunked under SQLite's variable limit), de-duped."""
    from core import database
    cat = database.create_category("Mercado", "expense")
    ids = [
        database.insert_transaction(date="2026-03-01", flow="expense", method="pix",
                                    account_id="nu-db", amount=1.0,
                                    description=f"Compra {i}", is_revenue=0)
        for i in range(1100)
    ]
    # duplicates in the request must not inflate the count
    updated = database.bulk_categorize(ids + ids[:50], cat)
    assert updated == 1100
