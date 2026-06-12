"""Schema creation, seed data, and migration management.

This is the only module that calls ``sqlite3.connect()`` directly.
All other sub-modules import ``_connect`` from here.

Migrations are tracked in the ``migration_log`` table. One-time data
mutations run exactly once and are never repeated on subsequent startups.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime

import config

DB_PATH = config.DB_PATH


def _connect() -> sqlite3.Connection:
    """Open and configure a SQLite connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-8000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create all tables (if absent), insert seed data, and run pending migrations.

    Safe to call on every startup — uses ``CREATE TABLE IF NOT EXISTS`` and
    ``INSERT OR IGNORE`` to avoid duplicates.
    """
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS migration_log (
                name    TEXT PRIMARY KEY,
                ran_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id               TEXT PRIMARY KEY,
                bank             TEXT NOT NULL,
                type             TEXT NOT NULL,
                name             TEXT NOT NULL,
                billing_day      INTEGER,
                due_day          INTEGER,
                initial_balance  REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS categories (
                id    INTEGER PRIMARY KEY AUTOINCREMENT,
                name  TEXT NOT NULL,
                flow  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                date            TEXT NOT NULL,
                flow            TEXT NOT NULL
                    CHECK (flow IN ('expense', 'income')),
                method          TEXT NOT NULL
                    CHECK (method IN ('pix', 'credit', 'ted', 'transfer', 'debit',
                                      'salary', 'freelance', 'pix_received', 'other')),
                account_id      TEXT NOT NULL,
                amount          REAL NOT NULL,
                installments    INTEGER DEFAULT 1,
                description     TEXT NOT NULL,
                category_id     INTEGER,
                dest_account_id TEXT,
                counterpart     TEXT,
                is_revenue      INTEGER DEFAULT 0,
                external_id     TEXT,
                display_name    TEXT,
                is_third_party  INTEGER NOT NULL DEFAULT 0,
                original_amount REAL,
                import_batch_id TEXT,
                fatura_due      TEXT,
                FOREIGN KEY (account_id)      REFERENCES accounts(id),
                FOREIGN KEY (dest_account_id) REFERENCES accounts(id),
                FOREIGN KEY (category_id)     REFERENCES categories(id)
            );

            CREATE TABLE IF NOT EXISTS investments (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL,
                type            TEXT NOT NULL,
                bank            TEXT NOT NULL,
                current_balance REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS investment_movements (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                date          TEXT NOT NULL,
                investment_id INTEGER NOT NULL,
                operation     TEXT NOT NULL
                    CHECK (operation IN ('deposit', 'withdrawal')),
                amount        REAL NOT NULL,
                description   TEXT,
                FOREIGN KEY (investment_id) REFERENCES investments(id)
            );

            CREATE TABLE IF NOT EXISTS budgets (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id  INTEGER NOT NULL UNIQUE,
                amount_limit REAL NOT NULL,
                FOREIGN KEY (category_id) REFERENCES categories(id)
            );

            -- Staging area for file imports (web ingestion).
            -- Parsed rows land here with a classification status; the user
            -- reviews them in the preview modal, then 'new' rows are promoted
            -- to transactions on confirm and the whole batch is deleted.
            CREATE TABLE IF NOT EXISTS import_staging (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id        TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                source          TEXT NOT NULL,
                status          TEXT NOT NULL
                    CHECK (status IN ('new', 'duplicate', 'skipped')),
                date            TEXT,
                flow            TEXT,
                method          TEXT,
                account_id      TEXT,
                amount          REAL,
                description     TEXT,
                dest_account_id TEXT,
                external_id     TEXT,
                is_revenue      INTEGER DEFAULT 0,
                counterpart     TEXT,
                category_id     INTEGER,
                display_name    TEXT,
                original_amount REAL,
                note            TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_staging_batch
                ON import_staging(batch_id);

            -- Indices for common query patterns
            CREATE INDEX IF NOT EXISTS idx_tx_date
                ON transactions(date);
            CREATE INDEX IF NOT EXISTS idx_tx_account_date
                ON transactions(account_id, date);
            CREATE INDEX IF NOT EXISTS idx_tx_flow_date
                ON transactions(flow, date);
        """)

        _seed_accounts(conn)
        _seed_categories(conn)
        _seed_budgets(conn)

        # Backward-compat migrations for existing databases
        # (no-ops on fresh databases where columns are already in the base schema)
        _apply_column_migrations(conn)

        _run_pending_migrations(conn)


def _apply_column_migrations(conn: sqlite3.Connection) -> None:
    """Add columns introduced after the initial schema via ALTER TABLE.

    Each block is a no-op if the column already exists (fresh db or already migrated).
    """
    try:
        conn.execute("SELECT is_revenue FROM transactions LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE transactions ADD COLUMN is_revenue INTEGER DEFAULT 0")
        conn.execute(
            "UPDATE transactions SET is_revenue = 1 "
            "WHERE flow = 'income' AND dest_account_id IS NULL "
            "AND (counterpart IS NULL OR counterpart != 'SELF')"
        )
        conn.commit()

    try:
        conn.execute("SELECT external_id FROM transactions LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE transactions ADD COLUMN external_id TEXT")
        conn.commit()

    try:
        conn.execute("SELECT display_name FROM transactions LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE transactions ADD COLUMN display_name TEXT")
        conn.execute(
            "ALTER TABLE transactions ADD COLUMN is_third_party INTEGER NOT NULL DEFAULT 0"
        )
        conn.execute(
            "INSERT OR IGNORE INTO categories (name, flow) VALUES ('Eventos / Terceiros', 'expense')"
        )
        conn.commit()

    # import_staging.counterpart carries the auto-transfer marker ('SELF') from the
    # adapter through to confirm; older staging tables predate it.
    try:
        conn.execute("SELECT counterpart FROM import_staging LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE import_staging ADD COLUMN counterpart TEXT")
        conn.commit()

    # Editable import preview (P1b): transactions get original_amount (the bank's
    # parsed value, set only when the user overrides the amount — the audit anchor);
    # staging rows carry original_amount + user edits to category/name before confirm.
    try:
        conn.execute("SELECT original_amount FROM transactions LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE transactions ADD COLUMN original_amount REAL")
        conn.commit()
    try:
        conn.execute("SELECT original_amount FROM import_staging LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE import_staging ADD COLUMN original_amount REAL")
        conn.execute("ALTER TABLE import_staging ADD COLUMN category_id INTEGER")
        conn.execute("ALTER TABLE import_staging ADD COLUMN display_name TEXT")
        conn.commit()

    # Reversible imports: every transaction promoted from a single import (the whole
    # multi-file/multi-account drop shares one id) carries import_batch_id, so the
    # batch is filterable in the Histórico and reversible in one shot via
    # crud.delete_batch. Most rows (manual entries, pre-existing data) stay NULL by
    # design → a PARTIAL index keeps it lean.
    try:
        conn.execute("SELECT import_batch_id FROM transactions LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE transactions ADD COLUMN import_batch_id TEXT")
        conn.commit()
    try:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tx_import_batch "
            "ON transactions(import_batch_id) WHERE import_batch_id IS NOT NULL"
        )
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # Fatura membership from import: a CC purchase carries fatura_due (the bill's
    # vencimento, captured at import) so the OPEN fatura = sum of the next due's
    # tagged purchases — the bank's own grouping, not a fragile date-window cutoff
    # (which can't split same-date purchases across bills, e.g. a recurring charge).
    try:
        conn.execute("SELECT fatura_due FROM transactions LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE transactions ADD COLUMN fatura_due TEXT")
        conn.commit()
    try:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tx_fatura_due "
            "ON transactions(account_id, fatura_due) WHERE fatura_due IS NOT NULL"
        )
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # Partial UNIQUE index on external_id: enforces dedup for sources that
    # carry a stable id (Nubank's Identificador), while allowing the many NULLs
    # from manual entries and Inter rows (which dedup by content hash instead).
    # Wrapped defensively: a pre-existing DB with duplicate external_ids would
    # fail here, and import dedup must never block startup.
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_external_id "
            "ON transactions(external_id) WHERE external_id IS NOT NULL"
        )
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # Investments are keyed by name (B3 positions upsert by name; the seeded
    # savings are unique too). The UNIQUE index makes upsert_investment's
    # INSERT OR IGNORE actually dedup. Wrapped defensively: a pre-existing DB
    # with duplicate investment names would fail, and that must not block startup.
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_investments_name ON investments(name)"
        )
        conn.commit()
    except sqlite3.OperationalError:
        pass


def _run_pending_migrations(conn: sqlite3.Connection) -> None:
    """Execute one-time data migrations that have not yet been applied."""
    # Deferred import to avoid circular dependency:
    # categories.py imports _connect from this module; importing it at module
    # level here would create a circular import at load time.
    from core.db.categories import _auto_categorize_income  # noqa: PLC0415

    done = {r[0] for r in conn.execute("SELECT name FROM migration_log").fetchall()}

    if "auto_categorize_income_v1" not in done:
        _auto_categorize_income(conn)
        conn.execute(
            "INSERT INTO migration_log (name, ran_at) VALUES (?,?)",
            ("auto_categorize_income_v1", datetime.now().isoformat()),
        )
        conn.commit()


def _seed_accounts(conn: sqlite3.Connection) -> None:
    accounts = [
        ("nu-cc",    "nubank", "credit",   "Nubank Crédito", 18, 25),
        ("nu-db",    "nubank", "checking", "Nubank Conta",   None, None),
        ("inter-cc", "inter",  "credit",   "Inter Crédito",  18, 25),
        ("inter-db", "inter",  "checking", "Inter Conta",    None, None),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO accounts (id, bank, type, name, billing_day, due_day) VALUES (?,?,?,?,?,?)",
        accounts,
    )


def _seed_categories(conn: sqlite3.Connection) -> None:
    expense_categories = [
        "Alimentação", "Carro", "Jogos", "Lazer", "Atividade física",
        "Eletrônicos", "Educação", "Igreja", "Dízimo", "Outro",
    ]
    income_categories = [
        "Salário", "Freela", "PIX recebido", "Transferência", "Outro",
    ]
    existing = {row["name"] for row in conn.execute("SELECT name FROM categories")}
    rows = (
        [(name, "expense") for name in expense_categories if name not in existing]
        + [(name, "income") for name in income_categories if name not in existing]
    )
    if rows:
        conn.executemany("INSERT INTO categories (name, flow) VALUES (?,?)", rows)


def _seed_budgets(conn: sqlite3.Connection) -> None:
    defaults = {
        "Alimentação": 1500.0, "Carro": 500.0, "Jogos": 200.0,
        "Lazer": 400.0, "Atividade física": 300.0, "Eletrônicos": 300.0,
        "Educação": 500.0, "Igreja": 200.0, "Dízimo": 0.0, "Outro": 300.0,
    }
    for name, limit in defaults.items():
        cat = conn.execute(
            "SELECT id FROM categories WHERE name=? AND flow='expense'", (name,)
        ).fetchone()
        if cat:
            conn.execute(
                "INSERT OR IGNORE INTO budgets (category_id, amount_limit) VALUES (?,?)",
                (cat["id"], limit),
            )
