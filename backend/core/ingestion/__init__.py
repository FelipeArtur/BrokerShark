"""File ingestion pipeline — parse bank/broker exports, dedup, stage, confirm.

Layered so the parsing and dedup logic stay pure (no DB) and therefore trivially
testable; all database access goes through :mod:`core.db.crud` and
:mod:`core.db.analytics`, which the test fixture already patches.

    adapters.py  — parse raw file bytes → list[Record]  (pure)
    dedup.py     — classify records as new/duplicate     (pure)
    service.py   — orchestration: preview → staging, confirm → transactions
    b3.py        — parse B3 .xlsx investment positions → investments (snapshot upsert)
"""
from core.ingestion.service import confirm_import, preview_import  # noqa: F401

__all__ = ["preview_import", "confirm_import"]
