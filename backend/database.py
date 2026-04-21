import sqlite3
import os
from datetime import datetime, date, timedelta
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "data/brokershark.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
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
        ("nu-cc",    "nubank", "credit",   "Nubank Crédito",  None, None),
        ("nu-db",    "nubank", "checking", "Nubank Conta",     None, None),
        ("inter-cc", "inter",  "credit",   "Inter Crédito",   None, None),
        ("inter-db", "inter",  "checking", "Inter Conta",      None, None),
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
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()


def get_all_accounts() -> list[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute("SELECT * FROM accounts").fetchall()


def get_account_balance(account_id: str) -> float:
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
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM categories WHERE flow = ? ORDER BY id", (flow,)
        ).fetchall()


def get_category(category_id: int) -> Optional[sqlite3.Row]:
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
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO transactions
               (date, flow, method, account_id, amount, installments,
                description, category_id, dest_account_id, counterpart)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (date, flow, method, account_id, amount, installments,
             description, category_id, dest_account_id, counterpart),
        )
        return cur.lastrowid


def get_transaction(transaction_id: int) -> Optional[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (transaction_id,)
        ).fetchone()


def get_transactions_by_period(
    start_date: str, end_date: str, flow: Optional[str] = None
) -> list[sqlite3.Row]:
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


def transaction_exists(
    date: str, amount: float, description: str, account_id: str
) -> bool:
    with _connect() as conn:
        row = conn.execute(
            """SELECT 1 FROM transactions
               WHERE date=? AND amount=? AND description=? AND account_id=?""",
            (date, amount, description, account_id),
        ).fetchone()
        return row is not None


# ── Investments ───────────────────────────────────────────────────────────────

def get_all_investments() -> list[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute("SELECT * FROM investments").fetchall()


def get_investment_by_name(name: str) -> Optional[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM investments WHERE name = ?", (name,)
        ).fetchone()


def upsert_investment(name: str, type_: str, bank: str) -> int:
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
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO investment_movements
               (date, investment_id, operation, amount, description)
               VALUES (?,?,?,?,?)""",
            (date, investment_id, operation, amount, description),
        )
        delta = amount if operation == "deposit" else -amount
        conn.execute(
            "UPDATE investments SET current_balance = current_balance + ? WHERE id = ?",
            (delta, investment_id),
        )
        return cur.lastrowid


def get_investment_movement(movement_id: int) -> Optional[sqlite3.Row]:
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM investment_movements WHERE id = ?", (movement_id,)
        ).fetchone()


# ── Summary queries ───────────────────────────────────────────────────────────

def get_monthly_summary(year: int, month: int) -> dict:
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    with _connect() as conn:
        expenses = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE flow='expense' AND date BETWEEN ? AND ?",
            (start, end),
        ).fetchone()[0]
        income = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE flow='income' AND date BETWEEN ? AND ?",
            (start, end),
        ).fetchone()[0]
        top_category = conn.execute(
            """SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE t.flow='expense' AND t.date BETWEEN ? AND ?
               GROUP BY c.id ORDER BY total DESC LIMIT 1""",
            (start, end),
        ).fetchone()
    return {
        "expenses": expenses,
        "income": income,
        "top_category": dict(top_category) if top_category else None,
    }


def get_credit_card_statement(account_id: str, start_date: str, end_date: str) -> float:
    with _connect() as conn:
        row = conn.execute(
            """SELECT COALESCE(SUM(amount),0) FROM transactions
               WHERE account_id=? AND flow='expense' AND date BETWEEN ? AND ?""",
            (account_id, start_date, end_date),
        ).fetchone()
        return row[0]


def get_credit_card_billing_info(account_id: str) -> dict:
    """Return current billing period total and days until due for a credit card."""
    with _connect() as conn:
        acc = conn.execute(
            "SELECT billing_day, due_day FROM accounts WHERE id=?", (account_id,)
        ).fetchone()

    billing_day: int = acc["billing_day"] or 1
    due_day: int = acc["due_day"] or (billing_day + 7)

    today = date.today()

    # Compute current cycle start
    if today.day >= billing_day:
        cycle_start = today.replace(day=billing_day)
    else:
        first_of_month = today.replace(day=1)
        prev_month_last = first_of_month - timedelta(days=1)
        cycle_start = prev_month_last.replace(day=min(billing_day, prev_month_last.day))

    # Cycle end = day before billing_day next month
    if cycle_start.month == 12:
        next_billing = cycle_start.replace(year=cycle_start.year + 1, month=1, day=billing_day)
    else:
        next_billing = cycle_start.replace(month=cycle_start.month + 1, day=billing_day)
    cycle_end = next_billing - timedelta(days=1)

    # Due date for the current cycle
    if next_billing.month == 12:
        due_date = next_billing.replace(year=next_billing.year + 1, month=1, day=min(due_day, 28))
    else:
        due_date = next_billing.replace(month=next_billing.month + 1, day=min(due_day, 28))
    # Clamp due date to same month as next_billing if due_day < billing_day
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
        "cycle_end": cycle_end.strftime("%d/%m/%Y"),
        "due_date": due_date.strftime("%d/%m/%Y"),
        "days_until_due": days_until_due,
    }


def get_monthly_history(months: int = 6) -> list[dict]:
    today = date.today()
    result = []
    for i in range(months - 1, -1, -1):
        month = today.month - i
        year = today.year
        while month <= 0:
            month += 12
            year -= 1
        summary = get_monthly_summary(year, month)
        result.append({
            "label": f"{month:02d}/{year}",
            "expenses": summary["expenses"],
            "income": summary["income"],
        })
    return result


def get_expenses_by_category(year: int, month: int) -> list[dict]:
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    with _connect() as conn:
        rows = conn.execute(
            """SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE t.flow='expense' AND t.date BETWEEN ? AND ?
               GROUP BY c.id ORDER BY total DESC""",
            (start, end),
        ).fetchall()
    return [{"name": r["name"], "total": r["total"]} for r in rows]


def get_investment_movements_by_period(start_date: str, end_date: str) -> list[dict]:
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
    with _connect() as conn:
        conn.execute(
            "INSERT INTO unrecognized_log (date, message) VALUES (?,?)",
            (datetime.now().isoformat(), message),
        )
