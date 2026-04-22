"""SQLite data layer — schema creation, seeds, and all query functions.

This module is the **single source of truth** for all persistence operations.
No other module executes SQL directly; every read and write goes through the
functions defined here.

Connection settings applied on every open:
- ``PRAGMA journal_mode=WAL``   — allows concurrent readers alongside writers.
- ``PRAGMA foreign_keys=ON``    — enforces referential integrity.
- ``PRAGMA synchronous=NORMAL`` — safe with WAL, faster than FULL.
- ``PRAGMA cache_size=-8000``   — 8 MB shared page cache.
- ``PRAGMA temp_store=MEMORY``  — temporary tables kept in RAM.

After every write (:func:`insert_transaction`, :func:`insert_investment_movement`)
the module calls :func:`core.events.notify` so that connected SSE clients
refresh the dashboard immediately.
"""
import sqlite3
from datetime import datetime, date, timedelta
from typing import Optional

import config
from core import events

DB_PATH = config.DB_PATH


# ── Connection ────────────────────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    """Open and configure a SQLite connection.

    Returns:
        A ``sqlite3.Connection`` with WAL mode, foreign keys, and performance
        pragmas applied.  ``row_factory`` is set to ``sqlite3.Row`` so columns
        are accessible by name.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-8000")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.row_factory = sqlite3.Row
    return conn


# ── Initialisation ────────────────────────────────────────────────────────────

def init_db() -> None:
    """Create all tables (if absent) and insert seed data.

    Safe to call on every startup — uses ``CREATE TABLE IF NOT EXISTS`` and
    ``INSERT OR IGNORE`` to avoid duplicates.
    """
    with _connect() as conn:
        conn.executescript("""
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
                flow            TEXT NOT NULL,
                method          TEXT NOT NULL,
                account_id      TEXT NOT NULL,
                amount          REAL NOT NULL,
                installments    INTEGER DEFAULT 1,
                description     TEXT NOT NULL,
                category_id     INTEGER,
                dest_account_id TEXT,
                counterpart     TEXT,
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
                operation     TEXT NOT NULL,
                amount        REAL NOT NULL,
                description   TEXT,
                FOREIGN KEY (investment_id) REFERENCES investments(id)
            );

            CREATE TABLE IF NOT EXISTS unrecognized_log (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                date    TEXT NOT NULL,
                message TEXT NOT NULL
            );
        """)
        _seed_accounts(conn)
        _seed_categories(conn)


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


# ── Accounts ──────────────────────────────────────────────────────────────────

def get_account(account_id: str) -> Optional[sqlite3.Row]:
    """Fetch a single account by its primary key.

    Args:
        account_id: One of ``"nu-cc"``, ``"nu-db"``, ``"inter-cc"``, ``"inter-db"``.

    Returns:
        A ``sqlite3.Row`` with all account columns, or ``None`` if not found.
    """
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()


def get_all_accounts() -> list[sqlite3.Row]:
    """Return all accounts ordered by insertion (primary-key) order.

    Returns:
        List of ``sqlite3.Row`` objects.
    """
    with _connect() as conn:
        return conn.execute("SELECT * FROM accounts").fetchall()


def get_all_accounts_with_balance() -> list[sqlite3.Row]:
    """Return all accounts with a computed ``balance`` column.

    Uses a single JOIN query instead of N+1 calls to :func:`get_account_balance`.
    Balance = ``initial_balance`` + sum of income transactions − sum of expense
    transactions for that account.

    Returns:
        List of ``sqlite3.Row`` objects, each containing all account columns
        plus a ``balance`` (float) column.
    """
    with _connect() as conn:
        return conn.execute(
            """SELECT
                   a.*,
                   a.initial_balance
                       + COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount ELSE 0 END), 0)
                   AS balance
               FROM accounts a
               LEFT JOIN transactions t ON t.account_id = a.id
               GROUP BY a.id"""
        ).fetchall()


def get_account_balance(account_id: str) -> float:
    """Compute the running balance for a single account.

    Args:
        account_id: Account primary key.

    Returns:
        ``initial_balance + income_total − expense_total`` as a float.
    """
    with _connect() as conn:
        acc = conn.execute(
            "SELECT initial_balance FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()
        initial = acc["initial_balance"] if acc else 0.0
        income = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='income'",
            (account_id,),
        ).fetchone()[0]
        expense = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='expense'",
            (account_id,),
        ).fetchone()[0]
        return initial + income - expense


# ── Categories ────────────────────────────────────────────────────────────────

def get_categories(flow: str) -> list[sqlite3.Row]:
    """Return all categories for the given flow, ordered by id.

    Args:
        flow: ``"expense"`` or ``"income"``.

    Returns:
        List of ``sqlite3.Row`` objects with ``id`` and ``name`` columns.
    """
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM categories WHERE flow = ? ORDER BY id", (flow,)
        ).fetchall()


def get_category(category_id: int) -> Optional[sqlite3.Row]:
    """Fetch a single category by its id.

    Args:
        category_id: Auto-incremented primary key.

    Returns:
        ``sqlite3.Row`` or ``None``.
    """
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM categories WHERE id = ?", (category_id,)
        ).fetchone()


# ── Transactions ──────────────────────────────────────────────────────────────

def insert_transaction(
    date: str,
    flow: str,
    method: str,
    account_id: str,
    amount: float,
    description: str,
    installments: int = 1,
    category_id: Optional[int] = None,
    dest_account_id: Optional[str] = None,
    counterpart: Optional[str] = None,
) -> int:
    """Insert a new transaction and notify the dashboard via SSE.

    Args:
        date: ISO date string (``"YYYY-MM-DD"``).
        flow: ``"expense"`` or ``"income"``.
        method: ``"pix"``, ``"credit"``, ``"ted"``, or income subtypes.
        account_id: FK to ``accounts.id``.
        amount: Positive monetary value in BRL.
        description: Human-readable label entered by the user.
        installments: Number of installments (default 1).
        category_id: FK to ``categories.id`` (required for expenses).
        dest_account_id: FK for internal transfers (usually ``None``).
        counterpart: Sender/recipient name for external PIX.

    Returns:
        The auto-incremented ``id`` of the newly inserted row.
    """
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO transactions
               (date, flow, method, account_id, amount, installments,
                description, category_id, dest_account_id, counterpart)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (date, flow, method, account_id, amount, installments,
             description, category_id, dest_account_id, counterpart),
        )
        last_id = cur.lastrowid
    events.notify()
    return last_id


def get_transaction(transaction_id: int) -> Optional[sqlite3.Row]:
    """Fetch a single transaction by its id.

    Args:
        transaction_id: Auto-incremented primary key.

    Returns:
        ``sqlite3.Row`` or ``None``.
    """
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (transaction_id,)
        ).fetchone()


def get_transactions_by_period(
    start_date: str, end_date: str, flow: Optional[str] = None
) -> list[sqlite3.Row]:
    """Return transactions within a date range, optionally filtered by flow.

    Args:
        start_date: Inclusive lower bound (``"YYYY-MM-DD"``).
        end_date:   Inclusive upper bound (``"YYYY-MM-DD"``).
        flow:       ``"expense"``, ``"income"``, or ``None`` for all.

    Returns:
        List of ``sqlite3.Row`` objects ordered by date descending.
    """
    with _connect() as conn:
        if flow:
            return conn.execute(
                "SELECT * FROM transactions WHERE date BETWEEN ? AND ? AND flow = ? ORDER BY date DESC",
                (start_date, end_date, flow),
            ).fetchall()
        return conn.execute(
            "SELECT * FROM transactions WHERE date BETWEEN ? AND ? ORDER BY date DESC",
            (start_date, end_date),
        ).fetchall()


def transaction_exists(date: str, amount: float, description: str, account_id: str) -> bool:
    """Check if an identical transaction already exists (duplicate detection).

    Used by the CSV import flow to skip rows already present in the database.

    Args:
        date:        ISO date string.
        amount:      Transaction amount.
        description: Transaction description.
        account_id:  Account FK.

    Returns:
        ``True`` if a matching row exists, ``False`` otherwise.
    """
    with _connect() as conn:
        row = conn.execute(
            """SELECT 1 FROM transactions
               WHERE date=? AND amount=? AND description=? AND account_id=?""",
            (date, amount, description, account_id),
        ).fetchone()
        return row is not None


# ── Investments ───────────────────────────────────────────────────────────────

def get_all_investments() -> list[sqlite3.Row]:
    """Return all investment records with their current balances.

    Returns:
        List of ``sqlite3.Row`` objects (id, name, type, bank, current_balance).
    """
    with _connect() as conn:
        return conn.execute("SELECT * FROM investments").fetchall()


def get_investment_by_name(name: str) -> Optional[sqlite3.Row]:
    """Fetch an investment record by its display name.

    Args:
        name: E.g. ``"Caixinha Nubank"``, ``"Tesouro Direto"``, ``"Porquinho Inter"``.

    Returns:
        ``sqlite3.Row`` or ``None``.
    """
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM investments WHERE name = ?", (name,)
        ).fetchone()


def upsert_investment(name: str, type_: str, bank: str) -> int:
    """Insert an investment if it does not exist, then return its id.

    Args:
        name:  Display name (unique).
        type_: ``"savings"`` or ``"treasury"``.
        bank:  ``"nubank"`` or ``"inter"``.

    Returns:
        The ``id`` of the existing or newly created investment row.
    """
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO investments (name, type, bank) VALUES (?,?,?)",
            (name, type_, bank),
        )
        row = conn.execute(
            "SELECT id FROM investments WHERE name = ?", (name,)
        ).fetchone()
        return row["id"]


def insert_investment_movement(
    date: str,
    investment_id: int,
    operation: str,
    amount: float,
    description: Optional[str] = None,
) -> int:
    """Record a deposit or withdrawal and update the investment balance.

    Atomically inserts the movement row and updates ``investments.current_balance``
    within a single transaction.  Notifies the dashboard via SSE after commit.

    Args:
        date:          ISO date string.
        investment_id: FK to ``investments.id``.
        operation:     ``"deposit"`` or ``"withdrawal"``.
        amount:        Positive monetary amount.
        description:   Optional free-text note.

    Returns:
        The auto-incremented ``id`` of the new ``investment_movements`` row.
    """
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO investment_movements
               (date, investment_id, operation, amount, description)
               VALUES (?,?,?,?,?)""",
            (date, investment_id, operation, amount, description),
        )
        last_id = cur.lastrowid
        delta = amount if operation == "deposit" else -amount
        conn.execute(
            "UPDATE investments SET current_balance = current_balance + ? WHERE id = ?",
            (delta, investment_id),
        )
    events.notify()
    return last_id


def get_investment_movement(movement_id: int) -> Optional[sqlite3.Row]:
    """Fetch a single investment movement by its id.

    Args:
        movement_id: Auto-incremented primary key.

    Returns:
        ``sqlite3.Row`` or ``None``.
    """
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM investment_movements WHERE id = ?", (movement_id,)
        ).fetchone()


# ── Summary queries ───────────────────────────────────────────────────────────

def get_monthly_summary(year: int, month: int, bank: Optional[str] = None) -> dict:
    """Return total income, expenses, and the top expense category for a month.

    Args:
        year:  Four-digit year.
        month: Month number (1–12).
        bank:  Optional filter — ``"nubank"`` or ``"inter"``.  ``None`` = all banks.

    Returns:
        dict with keys:
            - ``expenses`` (float): Total expenses.
            - ``income`` (float): Total income.
            - ``top_category`` (dict | None): ``{"name": str, "total": float}``
              for the highest-spend category, or ``None`` if no expenses.
    """
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    j = "JOIN accounts a ON a.id = t.account_id" if bank else ""
    b = "AND a.bank = ?" if bank else ""
    p = (bank,) if bank else ()
    with _connect() as conn:
        expenses = conn.execute(
            f"SELECT COALESCE(SUM(t.amount),0) FROM transactions t {j} WHERE t.flow='expense' AND t.date BETWEEN ? AND ? {b}",
            (start, end, *p),
        ).fetchone()[0]
        income = conn.execute(
            f"SELECT COALESCE(SUM(t.amount),0) FROM transactions t {j} WHERE t.flow='income' AND t.date BETWEEN ? AND ? {b}",
            (start, end, *p),
        ).fetchone()[0]
        top_category = conn.execute(
            f"""SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               {j}
               WHERE t.flow='expense' AND t.date BETWEEN ? AND ? {b}
               GROUP BY c.id ORDER BY total DESC LIMIT 1""",
            (start, end, *p),
        ).fetchone()
    return {
        "expenses": expenses,
        "income": income,
        "top_category": dict(top_category) if top_category else None,
    }


def get_expenses_by_method(year: int, month: int, bank: Optional[str] = None) -> list[dict]:
    """Return current month expenses grouped by bank and payment method.

    Args:
        year:  Four-digit year.
        month: Month number (1–12).
        bank:  Optional filter — ``"nubank"`` or ``"inter"``.  ``None`` = all banks.

    Returns:
        List of dicts with keys ``bank``, ``method``, ``total``, sorted by bank
        then method.  Only includes rows where ``total > 0``.
    """
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    b = "AND a.bank = ?" if bank else ""
    p = (bank,) if bank else ()
    with _connect() as conn:
        rows = conn.execute(
            f"""SELECT a.bank, t.method, COALESCE(SUM(t.amount), 0) AS total
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               WHERE t.flow = 'expense' AND t.date BETWEEN ? AND ? {b}
               GROUP BY a.bank, t.method
               HAVING total > 0
               ORDER BY a.bank, t.method""",
            (start, end, *p),
        ).fetchall()
    return [{"bank": r[0], "method": r[1], "total": r[2]} for r in rows]


def get_credit_card_statement(account_id: str, start_date: str, end_date: str) -> float:
    """Sum all expenses on a credit card account within a date range.

    Args:
        account_id:  Credit card account id (``"nu-cc"`` or ``"inter-cc"``).
        start_date:  Inclusive lower bound (``"YYYY-MM-DD"``).
        end_date:    Inclusive upper bound (``"YYYY-MM-DD"``).

    Returns:
        Total expense amount as a float (0.0 if no transactions).
    """
    with _connect() as conn:
        row = conn.execute(
            """SELECT COALESCE(SUM(amount),0) FROM transactions
               WHERE account_id=? AND flow='expense' AND date BETWEEN ? AND ?""",
            (account_id, start_date, end_date),
        ).fetchone()
        return row[0]


def get_credit_card_billing_info(account_id: str) -> dict:
    """Return billing cycle details and days until due for a credit card.

    Computes the current billing cycle from ``billing_day`` and ``due_day``
    stored on the account.  Falls back to day 1 / day 8 when not configured.

    Args:
        account_id: Credit card account id (``"nu-cc"`` or ``"inter-cc"``).

    Returns:
        dict with keys:
            - ``total`` (float): Statement total for the current cycle.
            - ``cycle_start`` (str): ``"DD/MM/YYYY"``.
            - ``cycle_end`` (str): ``"DD/MM/YYYY"``.
            - ``due_date`` (str): ``"DD/MM/YYYY"``.
            - ``days_until_due`` (int): Negative means already past due.
    """
    with _connect() as conn:
        acc = conn.execute(
            "SELECT billing_day, due_day FROM accounts WHERE id=?", (account_id,)
        ).fetchone()

    billing_day: int = acc["billing_day"] or 1
    due_day: int     = acc["due_day"] or (billing_day + 7)
    today            = date.today()

    if today.day >= billing_day:
        cycle_start = today.replace(day=billing_day)
    else:
        first_of_month  = today.replace(day=1)
        prev_month_last = first_of_month - timedelta(days=1)
        cycle_start     = prev_month_last.replace(day=min(billing_day, prev_month_last.day))

    if cycle_start.month == 12:
        next_billing = cycle_start.replace(year=cycle_start.year + 1, month=1, day=billing_day)
    else:
        next_billing = cycle_start.replace(month=cycle_start.month + 1, day=billing_day)
    cycle_end = next_billing - timedelta(days=1)

    if next_billing.month == 12:
        due_date = next_billing.replace(year=next_billing.year + 1, month=1, day=min(due_day, 28))
    else:
        due_date = next_billing.replace(month=next_billing.month + 1, day=min(due_day, 28))
    if due_day < billing_day:
        due_date = next_billing.replace(day=min(due_day, 28))

    days_until_due = (due_date - today).days
    total = get_credit_card_statement(
        account_id,
        cycle_start.strftime("%Y-%m-%d"),
        cycle_end.strftime("%Y-%m-%d"),
    )
    return {
        "total": total,
        "cycle_start": cycle_start.strftime("%d/%m/%Y"),
        "cycle_end":   cycle_end.strftime("%d/%m/%Y"),
        "due_date":    due_date.strftime("%d/%m/%Y"),
        "days_until_due": days_until_due,
    }


def get_monthly_history(months: int = 6, bank: Optional[str] = None) -> list[dict]:
    """Return income and expense totals for the last N months.

    Uses a single SQL query with ``GROUP BY strftime('%Y-%m', date)`` instead
    of N separate calls to :func:`get_monthly_summary`.  Months with no
    transactions are filled with zeros.

    Args:
        months: Number of months to return (default 6).
        bank:   Optional filter — ``"nubank"`` or ``"inter"``.

    Returns:
        List of dicts ordered from oldest to newest, each containing:
            - ``label`` (str): ``"MM/YYYY"`` display string.
            - ``expenses`` (float)
            - ``income`` (float)
    """
    today   = date.today()
    periods: list[tuple[int, int]] = []
    for i in range(months - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        periods.append((y, m))

    start_y, start_m = periods[0]
    end_y,   end_m   = periods[-1]
    start = f"{start_y:04d}-{start_m:02d}-01"
    end   = f"{end_y:04d}-{end_m:02d}-31"

    j = "JOIN accounts a ON a.id = t.account_id" if bank else ""
    b = "AND a.bank = ?" if bank else ""
    p = (bank,) if bank else ()

    with _connect() as conn:
        rows = conn.execute(
            f"""SELECT
                   strftime('%Y-%m', t.date) AS ym,
                   COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount ELSE 0 END), 0) AS expenses,
                   COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount ELSE 0 END), 0) AS income
               FROM transactions t
               {j}
               WHERE t.date BETWEEN ? AND ? {b}
               GROUP BY ym""",
            (start, end, *p),
        ).fetchall()

    by_month = {r["ym"]: {"expenses": r["expenses"], "income": r["income"]} for r in rows}
    return [
        {
            "label": f"{m:02d}/{y}",
            **by_month.get(f"{y:04d}-{m:02d}", {"expenses": 0.0, "income": 0.0}),
        }
        for y, m in periods
    ]


def get_expenses_by_category(year: int, month: int, bank: Optional[str] = None) -> list[dict]:
    """Return expense totals grouped by category for a given month.

    Args:
        year:  Four-digit year.
        month: Month number (1–12).
        bank:  Optional filter — ``"nubank"`` or ``"inter"``.

    Returns:
        List of ``{"name": str, "total": float}`` dicts ordered by total descending.
    """
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    j = "JOIN accounts a ON a.id = t.account_id" if bank else ""
    b = "AND a.bank = ?" if bank else ""
    p = (bank,) if bank else ()
    with _connect() as conn:
        rows = conn.execute(
            f"""SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               {j}
               WHERE t.flow='expense' AND t.date BETWEEN ? AND ? {b}
               GROUP BY c.id ORDER BY total DESC""",
            (start, end, *p),
        ).fetchall()
    return [{"name": r["name"], "total": r["total"]} for r in rows]


def get_account_monthly_summary(account_id: str, year: int, month: int) -> dict:
    """Return total income, expenses, and top expense category for one account in a month.

    Args:
        account_id: Account primary key (e.g. ``"nu-cc"``).
        year:  Four-digit year.
        month: Month number (1–12).

    Returns:
        dict with keys ``expenses``, ``income``, ``top_category``.
    """
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    with _connect() as conn:
        expenses = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='expense' AND date BETWEEN ? AND ?",
            (account_id, start, end),
        ).fetchone()[0]
        income = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='income' AND date BETWEEN ? AND ?",
            (account_id, start, end),
        ).fetchone()[0]
        top_category = conn.execute(
            """SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE t.account_id=? AND t.flow='expense' AND t.date BETWEEN ? AND ?
               GROUP BY c.id ORDER BY total DESC LIMIT 1""",
            (account_id, start, end),
        ).fetchone()
    return {
        "expenses": expenses,
        "income": income,
        "top_category": dict(top_category) if top_category else None,
    }


def get_monthly_history_by_account(account_id: str, months: int = 6) -> list[dict]:
    """Return income and expense totals for the last N months filtered by account.

    Args:
        account_id: Account primary key.
        months: Number of months to return (default 6).

    Returns:
        List of dicts ordered oldest to newest, each containing
        ``label``, ``expenses``, ``income``.
    """
    today   = date.today()
    periods: list[tuple[int, int]] = []
    for i in range(months - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        periods.append((y, m))

    start_y, start_m = periods[0]
    end_y,   end_m   = periods[-1]
    start = f"{start_y:04d}-{start_m:02d}-01"
    end   = f"{end_y:04d}-{end_m:02d}-31"

    with _connect() as conn:
        rows = conn.execute(
            """SELECT
                   strftime('%Y-%m', date) AS ym,
                   COALESCE(SUM(CASE WHEN flow='expense' THEN amount ELSE 0 END), 0) AS expenses,
                   COALESCE(SUM(CASE WHEN flow='income'  THEN amount ELSE 0 END), 0) AS income
               FROM transactions
               WHERE account_id=? AND date BETWEEN ? AND ?
               GROUP BY ym""",
            (account_id, start, end),
        ).fetchall()

    by_month = {r["ym"]: {"expenses": r["expenses"], "income": r["income"]} for r in rows}
    return [
        {
            "label": f"{m:02d}/{y}",
            **by_month.get(f"{y:04d}-{m:02d}", {"expenses": 0.0, "income": 0.0}),
        }
        for y, m in periods
    ]


_PT_MONTHS_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]


def get_full_monthly_history_by_account(account_id: str) -> list[dict]:
    """Return income, expenses, and net for every month that has transactions.

    Args:
        account_id: Account primary key.

    Returns:
        List of dicts ordered newest first, each with
        ``year``, ``month``, ``label``, ``income``, ``expenses``, ``net``.
    """
    with _connect() as conn:
        rows = conn.execute(
            """SELECT
                   strftime('%Y-%m', date) AS ym,
                   COALESCE(SUM(CASE WHEN flow='income'  THEN amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN flow='expense' THEN amount ELSE 0 END), 0) AS expenses
               FROM transactions
               WHERE account_id = ?
               GROUP BY ym
               ORDER BY ym DESC""",
            (account_id,),
        ).fetchall()
    result = []
    for r in rows:
        y, m = int(r["ym"][:4]), int(r["ym"][5:])
        result.append({
            "year":     y,
            "month":    m,
            "label":    f"{_PT_MONTHS_SHORT[m - 1]} {y}",
            "income":   r["income"],
            "expenses": r["expenses"],
            "net":      r["income"] - r["expenses"],
        })
    return result


def get_expenses_by_category_account(account_id: str, year: int, month: int) -> list[dict]:
    """Return expense totals grouped by category for one account in a given month.

    Args:
        account_id: Account primary key.
        year:  Four-digit year.
        month: Month number (1–12).

    Returns:
        List of ``{"name": str, "total": float}`` dicts ordered by total descending.
    """
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    with _connect() as conn:
        rows = conn.execute(
            """SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE t.account_id=? AND t.flow='expense' AND t.date BETWEEN ? AND ?
               GROUP BY c.id ORDER BY total DESC""",
            (account_id, start, end),
        ).fetchall()
    return [{"name": r["name"], "total": r["total"]} for r in rows]


def get_recent_transactions(
    account_id: str,
    limit: int = 100,
    month: int | None = None,
    year: int | None = None,
) -> list[dict]:
    """Return transactions for a given account with optional month/year filter.

    Args:
        account_id: Account primary key.
        limit: Maximum number of rows to return (default 100, cap at 200).
        month: Calendar month (1–12) to filter by. Requires year.
        year: Calendar year to filter by.

    Returns:
        List of dicts ordered newest first, each containing
        ``date``, ``description``, ``category``, ``amount``, ``flow``.
    """
    limit = min(limit, 200)
    query = """
        SELECT t.date, t.description, t.amount, t.flow, c.name AS category
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.account_id = ?
    """
    params: list = [account_id]
    if month and year:
        query += " AND strftime('%Y-%m', t.date) = ?"
        params.append(f"{year:04d}-{month:02d}")
    elif year:
        query += " AND strftime('%Y', t.date) = ?"
        params.append(f"{year:04d}")
    query += " ORDER BY t.date DESC, t.id DESC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [
        {
            "date": r["date"],
            "description": r["description"],
            "amount": r["amount"],
            "flow": r["flow"],
            "category": r["category"],
        }
        for r in rows
    ]


def get_investment_movements_by_period(start_date: str, end_date: str) -> list[dict]:
    """Return investment movements grouped by investment and operation type.

    Used by the monthly closing report to summarise deposits and withdrawals.

    Args:
        start_date: Inclusive lower bound (``"YYYY-MM-DD"``).
        end_date:   Inclusive upper bound (``"YYYY-MM-DD"``).

    Returns:
        List of ``{"name": str, "operation": str, "total": float}`` dicts.
    """
    with _connect() as conn:
        rows = conn.execute(
            """SELECT i.name, im.operation, SUM(im.amount) AS total
               FROM investment_movements im
               JOIN investments i ON i.id = im.investment_id
               WHERE im.date BETWEEN ? AND ?
               GROUP BY i.id, im.operation ORDER BY i.name""",
            (start_date, end_date),
        ).fetchall()
    return [{"name": r["name"], "operation": r["operation"], "total": r["total"]} for r in rows]


# ── Logging ───────────────────────────────────────────────────────────────────

def log_unrecognized(message: str) -> None:
    """Persist an unrecognised Telegram message to the audit log.

    Args:
        message: Raw text of the message that could not be handled.
    """
    with _connect() as conn:
        conn.execute(
            "INSERT INTO unrecognized_log (date, message) VALUES (?,?)",
            (datetime.now().isoformat(), message),
        )
