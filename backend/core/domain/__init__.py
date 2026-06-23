"""Pure domain logic — no database, no framework, no IO.

Modules here encode the project's business rules as plain functions over plain data,
so they can be unit-tested in isolation without a DB or HTTP layer. Adapters
(core/ingestion, core/db, dashboard) import from here; nothing here imports them.
"""
