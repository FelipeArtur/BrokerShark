"""Read-only query functions — summaries, history, and reporting."""
from __future__ import annotations

import calendar
import sqlite3
from datetime import date, timedelta
from typing import Optional

from core.db.schema import _connect

_PT_SHORT = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
             "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
_PT_MONTHS_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
                    "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
_CF_PT_SHORT = _PT_SHORT  # same list, kept as alias for legacy callers


# ── Accounts ──────────────────────────────────────────────────────────────────

def get_account(account_id: str) -> Optional[sqlite3.Row]:
    """Fetch a single account by its primary key."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM accounts WHERE id = ?", (account_id,)
        ).fetchone()


def get_all_accounts() -> list[sqlite3.Row]:
    """Return all accounts ordered by insertion (primary-key) order."""
    with _connect() as conn:
        return conn.execute("SELECT * FROM accounts").fetchall()


def get_all_accounts_with_balance() -> list[sqlite3.Row]:
    """Return all accounts with computed balance, gross_balance, and investment_balance columns."""
    with _connect() as conn:
        return conn.execute(
            """SELECT
                   a.*,
                   a.initial_balance
                       + COALESCE(SUM(CASE WHEN t.flow='income'  AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN t.flow='expense' AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0)
                       + COALESCE(inb.total, 0)
                       - CASE WHEN a.type='checking' THEN COALESCE(inv_net.net, 0) ELSE 0 END
                   AS balance,
                   a.initial_balance
                       + COALESCE(SUM(CASE WHEN t.flow='income'  AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN t.flow='expense' AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0)
                       + COALESCE(inb.total, 0)
                   AS gross_balance,
                   CASE WHEN a.type='checking' THEN COALESCE(inv_cur.current, 0) ELSE 0 END
                   AS investment_balance
               FROM accounts a
               LEFT JOIN transactions t ON t.account_id = a.id
               LEFT JOIN (
                   SELECT dest_account_id, SUM(amount) AS total
                   FROM transactions WHERE dest_account_id IS NOT NULL
                   GROUP BY dest_account_id
               ) inb ON inb.dest_account_id = a.id
               LEFT JOIN (
                   SELECT i.bank,
                          COALESCE(SUM(CASE WHEN im.operation='deposit' THEN im.amount ELSE -im.amount END), 0) AS net
                   FROM investment_movements im
                   JOIN investments i ON i.id = im.investment_id
                   GROUP BY i.bank
               ) inv_net ON inv_net.bank = a.bank
               LEFT JOIN (
                   SELECT bank, SUM(current_balance) AS current
                   FROM investments GROUP BY bank
               ) inv_cur ON inv_cur.bank = a.bank
               GROUP BY a.id"""
        ).fetchall()


def get_account_balance(account_id: str) -> float:
    """Compute the running balance for a single account."""
    with _connect() as conn:
        acc = conn.execute(
            "SELECT initial_balance, type, bank FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        if not acc:
            return 0.0
        initial = acc["initial_balance"]
        income = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='income' AND COALESCE(is_third_party,0)=0",
            (account_id,),
        ).fetchone()[0]
        expense = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='expense' AND COALESCE(is_third_party,0)=0",
            (account_id,),
        ).fetchone()[0]
        inbound = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE dest_account_id=?",
            (account_id,),
        ).fetchone()[0]
        balance = initial + income - expense + inbound
        if acc["type"] == "checking":
            inv_net = conn.execute(
                """SELECT COALESCE(SUM(CASE WHEN im.operation='deposit' THEN im.amount ELSE -im.amount END), 0)
                   FROM investment_movements im
                   JOIN investments i ON i.id = im.investment_id
                   WHERE i.bank = ?""",
                (acc["bank"],),
            ).fetchone()[0]
            balance -= inv_net
        return balance


# ── Investments ───────────────────────────────────────────────────────────────

def get_all_investments() -> list[sqlite3.Row]:
    """Return all investment records with their current balances."""
    with _connect() as conn:
        return conn.execute("SELECT * FROM investments").fetchall()


def get_investment_by_name(name: str) -> Optional[sqlite3.Row]:
    """Fetch an investment record by its display name."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM investments WHERE name = ?", (name,)
        ).fetchone()


# ── Summary queries ───────────────────────────────────────────────────────────

def get_monthly_summary(year: int, month: int, bank: Optional[str] = None) -> dict:
    """Return total income, expenses, salary breakdown, and top expense category for a month."""
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    j = "JOIN accounts a ON a.id = t.account_id" if bank else ""
    b = "AND a.bank = ?" if bank else ""
    p = (bank,) if bank else ()
    with _connect() as conn:
        expenses = conn.execute(
            f"SELECT COALESCE(SUM(t.amount),0) FROM transactions t {j} WHERE t.flow='expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 AND t.date BETWEEN ? AND ? {b}",
            (start, end, *p),
        ).fetchone()[0]
        income = conn.execute(
            f"SELECT COALESCE(SUM(t.amount),0) FROM transactions t {j} WHERE t.flow='income' AND t.is_revenue=1 AND COALESCE(t.is_third_party,0)=0 AND t.date BETWEEN ? AND ? {b}",
            (start, end, *p),
        ).fetchone()[0]
        sal_row = conn.execute("SELECT id FROM categories WHERE name='Salário' AND flow='income'").fetchone()
        sal_id = sal_row[0] if sal_row else None
        salary_income = conn.execute(
            f"SELECT COALESCE(SUM(t.amount),0) FROM transactions t {j} WHERE t.flow='income' AND t.is_revenue=1 AND COALESCE(t.is_third_party,0)=0 AND t.category_id=? AND t.date BETWEEN ? AND ? {b}",
            (sal_id, start, end, *p),
        ).fetchone()[0] if sal_id else 0.0
        top_category = conn.execute(
            f"""SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               {j}
               WHERE t.flow='expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 AND t.date BETWEEN ? AND ? {b}
               GROUP BY c.id ORDER BY total DESC LIMIT 1""",
            (start, end, *p),
        ).fetchone()
    return {
        "expenses":      expenses,
        "income":        income,
        "salary_income": salary_income,
        "other_income":  round(income - salary_income, 2),
        "top_category":  dict(top_category) if top_category else None,
    }


def get_all_time_summary() -> dict:
    """Return aggregate financial metrics across the entire transaction history."""
    with _connect() as conn:
        expenses_total = conn.execute(
            """SELECT COALESCE(SUM(amount), 0) FROM transactions
               WHERE flow = 'expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0""",
        ).fetchone()[0]
        income_total = conn.execute(
            """SELECT COALESCE(SUM(amount), 0) FROM transactions
               WHERE flow = 'income' AND dest_account_id IS NULL AND is_revenue = 1 AND COALESCE(is_third_party,0)=0""",
        ).fetchone()[0]
        months_count = conn.execute(
            """SELECT COUNT(DISTINCT strftime('%Y-%m', date)) FROM transactions
               WHERE dest_account_id IS NULL""",
        ).fetchone()[0] or 1
        reservas = conn.execute(
            "SELECT COALESCE(SUM(current_balance), 0) FROM investments",
        ).fetchone()[0]
    avg_income   = income_total   / months_count
    avg_expenses = expenses_total / months_count
    avg_savings  = (avg_income - avg_expenses) / avg_income if avg_income > 0 else 0.0
    return {
        "period":           "all",
        "months_count":     months_count,
        "income_total":     income_total,
        "expenses_total":   expenses_total,
        "avg_income":       avg_income,
        "avg_expenses":     avg_expenses,
        "avg_savings_rate": avg_savings,
        "reservas":         reservas,
    }


def get_all_time_categories() -> list[dict]:
    """Return all-time expenses grouped by category, sorted by total descending."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT c.name, COALESCE(SUM(t.amount), 0) AS total
               FROM categories c
               JOIN transactions t ON t.category_id = c.id
               WHERE t.flow = 'expense' AND t.dest_account_id IS NULL AND t.method != 'transfer'
               GROUP BY c.id
               ORDER BY total DESC""",
        ).fetchall()
        return [{"name": r["name"], "total": r["total"]} for r in rows]


def get_expenses_by_method(year: int, month: int, bank: Optional[str] = None) -> list[dict]:
    """Return current month expenses grouped by bank and payment method."""
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    b = "AND a.bank = ?" if bank else ""
    p = (bank,) if bank else ()
    with _connect() as conn:
        rows = conn.execute(
            f"""SELECT a.bank, t.method, COALESCE(SUM(t.amount), 0) AS total
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               WHERE t.flow = 'expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 AND t.date BETWEEN ? AND ? {b}
               GROUP BY a.bank, t.method
               HAVING total > 0
               ORDER BY a.bank, t.method""",
            (start, end, *p),
        ).fetchall()
    return [{"bank": r[0], "method": r[1], "total": r[2]} for r in rows]


def get_credit_card_statement(account_id: str, start_date: str, end_date: str) -> float:
    """Sum all expenses on a credit card account within a date range.

    Deliberately *not* filtered by ``is_third_party``: a third-party purchase made
    on the card is still owed to the bank, so it belongs in the fatura total (and
    therefore reduces "disponível pra gastar"). This is the one place that diverges
    from the personal-spend summaries, on purpose.
    """
    with _connect() as conn:
        row = conn.execute(
            """SELECT COALESCE(SUM(amount),0) FROM transactions
               WHERE account_id=? AND flow='expense' AND date BETWEEN ? AND ?""",
            (account_id, start_date, end_date),
        ).fetchone()
        return row[0]


def get_credit_card_billing_info(account_id: str) -> dict:
    """Return billing cycle details and days until due for a credit card."""
    with _connect() as conn:
        acc = conn.execute(
            "SELECT billing_day, due_day FROM accounts WHERE id=?", (account_id,)
        ).fetchone()

    billing_day: int = acc["billing_day"] or 1
    due_day: int     = acc["due_day"] or (billing_day + 7)
    today            = date.today()

    if today.day >= billing_day:
        prev_billing = today.replace(day=billing_day)
    else:
        first_of_month  = today.replace(day=1)
        prev_month_last = first_of_month - timedelta(days=1)
        prev_billing    = prev_month_last.replace(day=min(billing_day, prev_month_last.day))

    cycle_start = prev_billing + timedelta(days=1)

    if prev_billing.month == 12:
        next_billing = prev_billing.replace(year=prev_billing.year + 1, month=1, day=billing_day)
    else:
        next_billing = prev_billing.replace(month=prev_billing.month + 1, day=billing_day)
    cycle_end = next_billing

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
    prev_cycle_end = prev_billing
    if prev_billing.month == 1:
        prev_prev_billing = prev_billing.replace(year=prev_billing.year - 1, month=12, day=billing_day)
    else:
        prev_prev_billing = prev_billing.replace(month=prev_billing.month - 1, day=min(billing_day, 28))
    prev_cycle_start = prev_prev_billing + timedelta(days=1)
    last_total = get_credit_card_statement(
        account_id,
        prev_cycle_start.strftime("%Y-%m-%d"),
        prev_cycle_end.strftime("%Y-%m-%d"),
    )
    return {
        "total": total,
        "last_total": last_total,
        "cycle_start": cycle_start.strftime("%d/%m/%Y"),
        "cycle_end":   cycle_end.strftime("%d/%m/%Y"),
        "due_date":    due_date.strftime("%d/%m/%Y"),
        "days_until_due": days_until_due,
    }


def get_monthly_history(months: int = 6, bank: Optional[str] = None) -> list[dict]:
    """Return income and expense totals for the last N months, zero-filled."""
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
        sal_row = conn.execute("SELECT id FROM categories WHERE name='Salário' AND flow='income'").fetchone()
        sal_id = sal_row[0] if sal_row else -1
        rows = conn.execute(
            f"""SELECT
                   strftime('%Y-%m', t.date) AS ym,
                   COALESCE(SUM(CASE WHEN t.flow='expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0) AS expenses,
                   COALESCE(SUM(CASE WHEN t.flow='income' AND t.is_revenue=1 AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN t.flow='income' AND t.is_revenue=1 AND COALESCE(t.is_third_party,0)=0 AND t.category_id=? THEN t.amount ELSE 0 END), 0) AS salary_income
               FROM transactions t
               {j}
               WHERE t.date BETWEEN ? AND ? {b}
               GROUP BY ym""",
            (sal_id, start, end, *p),
        ).fetchall()

    by_month = {
        r["ym"]: {"expenses": r["expenses"], "income": r["income"], "salary_income": r["salary_income"]}
        for r in rows
    }
    return [
        {
            "label":        f"{_PT_SHORT[m]}/{str(y)[-2:]}",
            "month":        m,
            "year":         y,
            **by_month.get(f"{y:04d}-{m:02d}", {"expenses": 0.0, "income": 0.0, "salary_income": 0.0}),
        }
        for y, m in periods
    ]


def get_monthly_history_present(bank: Optional[str] = None) -> list[dict]:
    """Return income/expense totals for **only the months that have transactions**.

    Unlike get_monthly_history (fixed N-month window from today, zero-filled), this
    follows the real data: one entry per month present in the DB, ascending. Powers
    the Histórico month strip so the timeline maps to the periods that actually exist.
    """
    j = "JOIN accounts a ON a.id = t.account_id" if bank else ""
    b = "WHERE a.bank = ?" if bank else ""
    p = (bank,) if bank else ()
    with _connect() as conn:
        sal_row = conn.execute("SELECT id FROM categories WHERE name='Salário' AND flow='income'").fetchone()
        sal_id = sal_row[0] if sal_row else -1
        rows = conn.execute(
            f"""SELECT
                   strftime('%Y-%m', t.date) AS ym,
                   COALESCE(SUM(CASE WHEN t.flow='expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0) AS expenses,
                   COALESCE(SUM(CASE WHEN t.flow='income' AND t.is_revenue=1 AND COALESCE(t.is_third_party,0)=0 THEN t.amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN t.flow='income' AND t.is_revenue=1 AND COALESCE(t.is_third_party,0)=0 AND t.category_id=? THEN t.amount ELSE 0 END), 0) AS salary_income
               FROM transactions t
               {j}
               {b}
               GROUP BY ym
               ORDER BY ym""",
            (sal_id, *p),
        ).fetchall()
    result: list[dict] = []
    for r in rows:
        y, m = int(r["ym"][:4]), int(r["ym"][5:7])
        result.append({
            "label":         f"{_PT_SHORT[m]}/{str(y)[-2:]}",
            "month":         m,
            "year":          y,
            "expenses":      r["expenses"],
            "income":        r["income"],
            "salary_income": r["salary_income"],
        })
    return result


def get_expenses_by_category(year: int, month: int, bank: Optional[str] = None) -> list[dict]:
    """Return expense totals grouped by category for a given month."""
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
               WHERE t.flow='expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 AND t.date BETWEEN ? AND ? {b}
               GROUP BY c.id ORDER BY total DESC""",
            (start, end, *p),
        ).fetchall()
    return [{"name": r["name"], "total": r["total"]} for r in rows]


def get_account_monthly_summary(account_id: str, year: int, month: int) -> dict:
    """Return total income, expenses, and top expense category for one account in a month."""
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    with _connect() as conn:
        expenses = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0 AND date BETWEEN ? AND ?",
            (account_id, start, end),
        ).fetchone()[0]
        income = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE account_id=? AND flow='income' AND is_revenue=1 AND COALESCE(is_third_party,0)=0 AND date BETWEEN ? AND ?",
            (account_id, start, end),
        ).fetchone()[0]
        top_category = conn.execute(
            """SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE t.account_id=? AND t.flow='expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 AND t.date BETWEEN ? AND ?
               GROUP BY c.id ORDER BY total DESC LIMIT 1""",
            (account_id, start, end),
        ).fetchone()
    return {
        "expenses": expenses,
        "income": income,
        "top_category": dict(top_category) if top_category else None,
    }


def get_monthly_history_by_account(account_id: str, months: int = 6) -> list[dict]:
    """Return income and expense totals for the last N months filtered by account."""
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
                   COALESCE(SUM(CASE WHEN flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0 THEN amount ELSE 0 END), 0) AS expenses,
                   COALESCE(SUM(CASE WHEN flow='income' AND is_revenue=1 AND COALESCE(is_third_party,0)=0 THEN amount ELSE 0 END), 0) AS income
               FROM transactions
               WHERE account_id=? AND date BETWEEN ? AND ?
               GROUP BY ym""",
            (account_id, start, end),
        ).fetchall()

    by_month = {r["ym"]: {"expenses": r["expenses"], "income": r["income"]} for r in rows}
    return [
        {
            "label": f"{_PT_SHORT[m]}/{str(y)[-2:]}",
            "month": m,
            "year":  y,
            **by_month.get(f"{y:04d}-{m:02d}", {"expenses": 0.0, "income": 0.0}),
        }
        for y, m in periods
    ]


def get_full_monthly_history_by_account(account_id: str) -> list[dict]:
    """Return income, expenses, and net for every month that has transactions, newest first."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT
                   strftime('%Y-%m', date) AS ym,
                   COALESCE(SUM(CASE WHEN flow='income' AND is_revenue=1 AND COALESCE(is_third_party,0)=0 THEN amount ELSE 0 END), 0) AS income,
                   COALESCE(SUM(CASE WHEN flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0 THEN amount ELSE 0 END), 0) AS expenses
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
    """Return expense totals grouped by category for one account in a given month."""
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    with _connect() as conn:
        rows = conn.execute(
            """SELECT c.name, SUM(t.amount) AS total
               FROM transactions t
               JOIN categories c ON c.id = t.category_id
               WHERE t.account_id=? AND t.flow='expense' AND t.dest_account_id IS NULL AND t.method != 'transfer' AND COALESCE(t.is_third_party,0)=0 AND t.date BETWEEN ? AND ?
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
    """Return transactions for a given account with optional month/year filter."""
    limit = min(limit, 200)
    query = """
        SELECT t.id, t.date, t.description, t.display_name, t.amount, t.flow,
               t.method, t.category_id, c.name AS category,
               t.dest_account_id, t.account_id,
               COALESCE(t.is_third_party, 0) AS is_third_party
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
            "id":              r["id"],
            "date":            r["date"],
            "description":     r["description"],
            "display_name":    r["display_name"],
            "amount":          r["amount"],
            "flow":            r["flow"],
            "method":          r["method"],
            "category_id":     r["category_id"],
            "category":        r["category"],
            "dest_account_id": r["dest_account_id"],
            "account_id":      r["account_id"],
            "is_third_party":  r["is_third_party"],
        }
        for r in rows
    ]


def get_recent_activity(limit: int = 20) -> list[dict]:
    """Return the most recent transactions across all accounts."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT t.id, t.date, t.description, t.display_name, t.amount, t.flow,
                      t.method, t.account_id, a.bank,
                      COALESCE(c.name, '') AS category,
                      COALESCE(t.is_third_party, 0) AS is_third_party
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               LEFT JOIN categories c ON c.id = t.category_id
               WHERE t.dest_account_id IS NULL
               ORDER BY t.date DESC, t.id DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_month_transactions(month: int, year: int) -> list[dict]:
    """Return all non-(internal-transfer) transactions for a calendar month across all accounts.

    ``is_revenue`` is exposed so the client can apply the SAME consumption/income rule
    as every analytics function: a despesa is ``flow=expense AND method!='transfer'`` and
    a receita is ``flow=income AND is_revenue=1``. Investment cash legs (Aplicação/Resgate,
    stored as ``method='transfer'`` / ``is_revenue=0`` with no dest account) stay in the
    list so they remain visible, but the client must exclude them from despesa/receita
    totals — otherwise the Histórico headline numbers diverge from the rest of the app.
    """
    with _connect() as conn:
        rows = conn.execute(
            """SELECT t.id, t.date, t.description, t.display_name, t.amount, t.flow,
                      t.method, t.account_id, a.bank,
                      COALESCE(c.name, '') AS category, t.category_id,
                      COALESCE(t.is_revenue, 0) AS is_revenue,
                      COALESCE(t.counterpart, '') AS counterpart,
                      COALESCE(t.installments, 1) AS installments,
                      COALESCE(t.is_third_party, 0) AS is_third_party
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               LEFT JOIN categories c ON c.id = t.category_id
               WHERE t.dest_account_id IS NULL
                 AND strftime('%Y-%m', t.date) = ?
               ORDER BY t.date ASC, t.id ASC""",
            (f"{year:04d}-{month:02d}",),
        ).fetchall()
    return [dict(r) for r in rows]


def get_patrimonio_history(months: int = 12) -> list[dict]:
    """Return approximate monthly net worth for the last N months, oldest first.

    Note: this computes a *different* point-in-time checking series than
    ``_checking_balance_at`` (used by the liquidity sparkline). Here CC fatura
    payments are counted as cash outflow (``dest IN ('nu-cc','inter-cc')``) and
    third-party rows are excluded, because this is the net-worth view. The
    liquidity series instead mirrors the live ``get_all_accounts_with_balance``
    formula. The two are intentionally distinct; do not unify them.
    """
    today_dt = date.today()
    result = []
    with _connect() as conn:
        checking_accounts = conn.execute(
            "SELECT id, initial_balance FROM accounts WHERE type='checking'"
        ).fetchall()

        for i in range(months - 1, -1, -1):
            if today_dt.month - i <= 0:
                y = today_dt.year - 1
                m = today_dt.month - i + 12
            else:
                y = today_dt.year
                m = today_dt.month - i
            if m > 12:
                y += 1
                m -= 12

            last_day = calendar.monthrange(y, m)[1]
            cutoff = f"{y:04d}-{m:02d}-{last_day:02d}"

            checking_bal = 0.0
            for acc in checking_accounts:
                row = conn.execute(
                    """SELECT
                         COALESCE(SUM(CASE WHEN flow='income' AND dest_account_id IS NULL AND COALESCE(is_third_party,0)=0 THEN amount ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN flow='expense'
                                          AND COALESCE(is_third_party,0)=0
                                          AND (dest_account_id IS NULL
                                               OR dest_account_id IN ('nu-cc','inter-cc'))
                                     THEN amount ELSE 0 END), 0)
                       AS net
                       FROM transactions WHERE account_id=? AND date <= ?""",
                    (acc["id"], cutoff),
                ).fetchone()
                checking_bal += acc["initial_balance"] + (row["net"] or 0.0)

            label = f"{_PT_SHORT[m]}/{str(y)[-2:]}"
            result.append({"label": label, "value": round(checking_bal, 2)})

    return result


def _checking_balance_at(conn: sqlite3.Connection, account_id: str, bank: str,
                          initial_balance: float, cutoff: str) -> float:
    """Checking-account balance as of ``cutoff`` (YYYY-MM-DD).

    Mirrors ``get_all_accounts_with_balance`` (the source of the hero "Disponível" number)
    so any point-in-time series stays consistent with the live balance:
    initial + income − expense + inbound transfers − investment net (by bank).
    """
    net = conn.execute(
        """SELECT COALESCE(SUM(CASE WHEN flow='income'  THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN flow='expense' THEN amount ELSE 0 END), 0)
           FROM transactions WHERE account_id=? AND date<=?""",
        (account_id, cutoff),
    ).fetchone()[0]
    inbound = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE dest_account_id=? AND date<=?",
        (account_id, cutoff),
    ).fetchone()[0]
    inv_net = conn.execute(
        """SELECT COALESCE(SUM(CASE WHEN im.operation='deposit' THEN im.amount ELSE -im.amount END), 0)
           FROM investment_movements im JOIN investments i ON i.id = im.investment_id
           WHERE i.bank=? AND im.date<=?""",
        (bank, cutoff),
    ).fetchone()[0]
    return float(initial_balance) + float(net or 0) + float(inbound or 0) - float(inv_net or 0)


def get_liquidity_history(months: int = 12) -> list[dict]:
    """Return approximate monthly liquidity ("disponível pra gastar") for the last N months.

    liquidity[m] = checking balance at end of month (investment-adjusted, via
    ``_checking_balance_at``, so the latest point lines up with the hero "Disponível"
    number) − card spend during that month. The card-spend term is a per-month proxy
    for the open fatura (exact per-cycle fatura history is not stored), so historical
    points are approximate; the trend is what the sparkline conveys.
    """
    today_dt = date.today()
    result: list[dict] = []
    with _connect() as conn:
        checking_accounts = conn.execute(
            "SELECT id, bank, initial_balance FROM accounts WHERE type='checking'"
        ).fetchall()

        for i in range(months - 1, -1, -1):
            if today_dt.month - i <= 0:
                y = today_dt.year - 1
                m = today_dt.month - i + 12
            else:
                y = today_dt.year
                m = today_dt.month - i
            if m > 12:
                y += 1
                m -= 12

            last_day = calendar.monthrange(y, m)[1]
            cutoff = f"{y:04d}-{m:02d}-{last_day:02d}"
            start  = f"{y:04d}-{m:02d}-01"

            checking_bal = sum(
                _checking_balance_at(conn, acc["id"], acc["bank"], acc["initial_balance"], cutoff)
                for acc in checking_accounts
            )

            card_spend = conn.execute(
                """SELECT COALESCE(SUM(amount), 0) AS spent
                   FROM transactions
                   WHERE account_id IN ('nu-cc','inter-cc')
                     AND flow='expense' AND dest_account_id IS NULL
                     AND method != 'transfer' AND COALESCE(is_third_party,0)=0
                     AND date BETWEEN ? AND ?""",
                (start, cutoff),
            ).fetchone()["spent"] or 0.0

            label = f"{_PT_SHORT[m]}/{str(y)[-2:]}"
            result.append({"label": label, "value": round(checking_bal - card_spend, 2)})

    return result


def get_daily_spend(year: Optional[int] = None, month: Optional[int] = None) -> list[dict]:
    """Return daily expense totals for a calendar month, zero-filled for every day."""
    today = date.today()
    year  = year  or today.year
    month = month or today.month
    last_day = calendar.monthrange(year, month)[1]
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-{last_day:02d}"
    with _connect() as conn:
        rows = conn.execute(
            """SELECT date, SUM(amount) AS value
               FROM transactions
               WHERE flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0 AND date BETWEEN ? AND ?
               GROUP BY date ORDER BY date""",
            (start, end),
        ).fetchall()
    by_date = {r["date"]: r["value"] for r in rows}
    return [
        {"date": f"{year:04d}-{month:02d}-{d:02d}", "day": d, "value": by_date.get(f"{year:04d}-{month:02d}-{d:02d}", 0.0)}
        for d in range(1, last_day + 1)
    ]


def get_top_pix_descriptions(month: int, year: int, limit: int = 10) -> list[dict]:
    """Return top PIX expense destinations grouped by display_name/description."""
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    with _connect() as conn:
        rows = conn.execute(
            """SELECT
                 COALESCE(display_name, description) AS label,
                 COUNT(*) AS count,
                 SUM(amount) AS total
               FROM transactions
               WHERE method = 'pix'
                 AND flow = 'expense'
                 AND dest_account_id IS NULL
                 AND COALESCE(is_third_party, 0) = 0
                 AND date BETWEEN ? AND ?
               GROUP BY COALESCE(display_name, description)
               ORDER BY total DESC
               LIMIT ?""",
            (start, end, limit),
        ).fetchall()
    return [{"label": r["label"], "count": r["count"], "total": float(r["total"])} for r in rows]


def get_investment_movements_by_period(start_date: str, end_date: str) -> list[dict]:
    """Return investment movements grouped by investment and operation type."""
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


def get_investment_movements_for_month(month: int, year: int) -> list[dict]:
    """Return individual investment movements for a given calendar month."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT im.id, im.date, im.investment_id, im.operation, im.amount,
                      COALESCE(im.description, '') AS description,
                      i.name AS investment_name, i.bank
               FROM investment_movements im
               JOIN investments i ON i.id = im.investment_id
               WHERE strftime('%Y', im.date) = ? AND strftime('%m', im.date) = ?
               ORDER BY im.date DESC""",
            (f"{year:04d}", f"{month:02d}"),
        ).fetchall()
    return [dict(r) for r in rows]

def get_recent_investment_movements(limit: int = 100) -> list[dict]:
    """Return recent investment movements."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT im.id, im.date, im.investment_id, im.operation, im.amount,
                      COALESCE(im.description, '') AS description,
                      i.name AS investment_name, i.bank
               FROM investment_movements im
               JOIN investments i ON i.id = im.investment_id
               ORDER BY im.date DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_budgets() -> list[dict]:
    """Return all budgets joined with category names."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT b.id, b.category_id, c.name AS category_name, b.amount_limit
               FROM budgets b JOIN categories c ON c.id = b.category_id
               ORDER BY c.id""",
        ).fetchall()
    return [dict(r) for r in rows]


def search_transactions(query: str, limit: int = 30) -> list[dict]:
    """Full-text search across all transactions by description and category."""
    safe = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    q = f"%{safe}%"
    with _connect() as conn:
        rows = conn.execute(
            """SELECT t.id, t.date, t.description, t.display_name, t.amount, t.flow,
                      t.account_id, a.bank, c.name AS category,
                      COALESCE(t.is_third_party, 0) AS is_third_party
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               LEFT JOIN categories c ON c.id = t.category_id
               WHERE t.dest_account_id IS NULL
                 AND (t.description LIKE ? ESCAPE '\\' OR t.display_name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')
               ORDER BY t.date DESC
               LIMIT ?""",
            (q, q, q, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_cashflow_statement(month: int, year: int) -> dict:
    """Return the monthly cash flow statement: income, expenses, investments, free balance."""
    first_day = f"{year:04d}-{month:02d}-01"
    last_day  = f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"
    label = f"{_CF_PT_SHORT[month]}/{str(year)[-2:]}"

    with _connect() as conn:
        row = conn.execute(
            """SELECT
                 SUM(CASE WHEN flow='income' AND is_revenue=1 AND COALESCE(is_third_party,0)=0                                  THEN amount ELSE 0 END) AS income_total,
                 SUM(CASE WHEN flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0
                          AND account_id IN ('nu-cc','inter-cc')                                                                 THEN amount ELSE 0 END) AS cc_expenses,
                 SUM(CASE WHEN flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0
                          AND account_id IN ('nu-db','inter-db')                                                                 THEN amount ELSE 0 END) AS direct_expenses
               FROM transactions
               WHERE date BETWEEN ? AND ?""",
            (first_day, last_day),
        ).fetchone()
        income_total    = float(row["income_total"] or 0)
        cc_expenses     = float(row["cc_expenses"] or 0)
        direct_expenses = float(row["direct_expenses"] or 0)

        # Investment cash flow lives in the transactions ledger, not investment_movements:
        # "Aplicação RDB"/Caixinha/Porquinho apply legs are imported as flow='expense',
        # method='transfer', dest_account_id NULL; redemptions as flow='income',
        # is_revenue=0. (investment_movements is a separate, currently-unused ledger.)
        # Deriving from transactions keeps "Saldo livre" honest — money moved into
        # investments leaves the checking accounts and must reduce free cash.
        # counterpart='SELF' marca transferências entre as contas do próprio usuário
        # (auto-Pix/TED) — não são investimento nem consumo, ficam fora deste cálculo.
        inv_row = conn.execute(
            """SELECT
                 COALESCE(SUM(CASE WHEN flow='expense' AND method='transfer' AND dest_account_id IS NULL
                                   AND COALESCE(counterpart,'') != 'SELF'
                                   AND COALESCE(is_third_party,0)=0 THEN amount ELSE 0 END), 0) AS invested,
                 COALESCE(SUM(CASE WHEN flow='income' AND is_revenue=0 AND dest_account_id IS NULL
                                   AND COALESCE(counterpart,'') != 'SELF'
                                   AND COALESCE(is_third_party,0)=0 THEN amount ELSE 0 END), 0) AS redeemed
               FROM transactions
               WHERE date BETWEEN ? AND ?""",
            (first_day, last_day),
        ).fetchone()
        investment_deposits    = float(inv_row["invested"] or 0)
        investment_withdrawals = float(inv_row["redeemed"] or 0)
        investment_net         = investment_deposits - investment_withdrawals

        cat_rows = conn.execute(
            """SELECT COALESCE(c.name, 'Sem categoria') AS category, SUM(t.amount) AS total
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               WHERE t.flow = 'expense'
                 AND t.dest_account_id IS NULL
                 AND COALESCE(t.is_third_party,0)=0
                 AND t.account_id IN ('nu-cc', 'inter-cc')
                 AND t.date BETWEEN ? AND ?
               GROUP BY c.id
               ORDER BY total DESC""",
            (first_day, last_day),
        ).fetchall()

    expense_total = cc_expenses + direct_expenses

    cc_rows = [{"category": r["category"], "amount": float(r["total"])} for r in cat_rows]
    cc_by_category: list[dict] = []
    if cc_rows and cc_expenses > 0:
        for r in cc_rows[:3]:
            cc_by_category.append({
                "category": r["category"],
                "amount":   r["amount"],
                "pct":      round(r["amount"] / cc_expenses * 100, 1),
            })
        outros = sum(r["amount"] for r in cc_rows[3:])
        if outros > 0:
            cc_by_category.append({
                "category": "Outros",
                "amount":   outros,
                "pct":      round(outros / cc_expenses * 100, 1),
            })

    return {
        "month":             month,
        "year":              year,
        "label":             label,
        "income_total":      income_total,
        "expense_total":     expense_total,
        "expense_by_source": {"cc": cc_expenses, "direct": direct_expenses},
        "investment_net":    investment_net,
        "free_balance":      income_total - expense_total - investment_net,
        "cc_by_category":    cc_by_category,
    }


def get_available_to_spend() -> dict:
    """Return the real liquidity ("disponível pra gastar"): checking cash minus open card bills.

    available = Σ checking balances (nu-db, inter-db) − Σ open fatura totals (nu-cc, inter-cc).
    This is the balance-sheet truth — "if I paid every open bill right now, this is what's left."
    Reuses get_all_accounts_with_balance() and get_credit_card_billing_info() so there is a
    single source of truth shared with /api/accounts and /api/faturas.
    """
    checking_total = 0.0
    faturas_total  = 0.0
    for acc in get_all_accounts_with_balance():
        if acc["type"] == "checking":
            checking_total += float(acc["balance"] or 0)
        elif acc["type"] == "credit":
            faturas_total += float(get_credit_card_billing_info(acc["id"])["total"] or 0)
    return {
        "checking_total": checking_total,
        "faturas_total":  faturas_total,
        "available":      checking_total - faturas_total,
    }


# ── Import dedup lookups ──────────────────────────────────────────────────────
# Two strategies, mirroring the two kinds of source files:
#   • Nubank carries a stable UUID (Identificador) → match on external_id.
#   • Inter has no id → match on the content key (account, date, amount, desc)
#     with occurrence counting, so a re-uploaded cumulative file only adds its
#     new tail and a legitimate same-day/same-amount duplicate is preserved.

def get_existing_external_ids(ids: list[str]) -> set[str]:
    """Return the subset of ``ids`` already present in ``transactions``."""
    if not ids:
        return set()
    found: set[str] = set()
    with _connect() as conn:
        # Chunk to stay well under SQLite's variable limit.
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            qmarks = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"SELECT external_id FROM transactions WHERE external_id IN ({qmarks})",
                chunk,
            ).fetchall()
            found.update(r["external_id"] for r in rows)
    return found


def get_key_counts(account_id: str, date_lo: str, date_hi: str) -> dict[tuple, int]:
    """Count existing transactions per content key for one account / date range.

    Returns a dict keyed by ``(date, round(amount, 2), description)`` → count.
    Used to dedup id-less sources (Inter) by occurrence.
    """
    counts: dict[tuple, int] = {}
    with _connect() as conn:
        rows = conn.execute(
            """SELECT date, ROUND(amount, 2) AS amt, description, COUNT(*) AS n
               FROM transactions
               WHERE account_id = ? AND date BETWEEN ? AND ?
               GROUP BY date, amt, description""",
            (account_id, date_lo, date_hi),
        ).fetchall()
    for r in rows:
        counts[(r["date"], r["amt"], r["description"])] = r["n"]
    return counts

def get_investment_evolution(months: int = 12) -> list[dict]:
    """Return cumulative invested (deposits − withdrawals) for the last N months.

    Derived from the **transactions** ledger (investment legs), not the empty
    ``investment_movements`` table — same canonical source as
    ``get_cashflow_statement.investment_net``: aplicação = ``flow='expense' AND
    method='transfer' AND dest_account_id IS NULL``; resgate = ``flow='income' AND
    is_revenue=0 AND dest_account_id IS NULL``; both exclude ``counterpart='SELF'``
    and ``is_third_party``. Zero-filled across the window.
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

    # Investment legs in the transactions ledger (same predicate as
    # get_cashflow_statement.investment_net). aplicação = +amount, resgate = −amount.
    _APLIC = ("flow='expense' AND method='transfer' AND dest_account_id IS NULL "
              "AND COALESCE(counterpart,'') != 'SELF' AND COALESCE(is_third_party,0)=0")
    _RESG  = ("flow='income' AND is_revenue=0 AND dest_account_id IS NULL "
              "AND COALESCE(counterpart,'') != 'SELF' AND COALESCE(is_third_party,0)=0")

    with _connect() as conn:
        # 1. Linha de base: aportes − resgates ANTES do período de start.
        baseline_cur = conn.execute(
            f"""SELECT COALESCE(SUM(
                   CASE WHEN {_APLIC} THEN amount
                        WHEN {_RESG}  THEN -amount
                        ELSE 0 END), 0)
               FROM transactions
               WHERE date < ?""",
            (start,)
        ).fetchone()
        baseline = float(baseline_cur[0])

        # 2. Aplicações/resgates dentro da janela de N meses, por mês.
        rows = conn.execute(
            f"""SELECT
                   strftime('%Y-%m', date) AS ym,
                   COALESCE(SUM(CASE WHEN {_APLIC} THEN amount ELSE 0 END), 0) AS deposit,
                   COALESCE(SUM(CASE WHEN {_RESG}  THEN amount ELSE 0 END), 0) AS withdrawal
               FROM transactions
               WHERE date BETWEEN ? AND ?
               GROUP BY ym""",
            (start, end),
        ).fetchall()
        
        lookup = {r["ym"]: {"deposit": float(r["deposit"]), "withdrawal": float(r["withdrawal"])} for r in rows}

        out = []
        running_total = baseline

        for y, m in periods:
            ym = f"{y:04d}-{m:02d}"
            label = f"{_CF_PT_SHORT[m]}/{str(y)[-2:]}"
            d = lookup.get(ym, {"deposit": 0.0, "withdrawal": 0.0})
            deposit = d["deposit"]
            withdrawal = d["withdrawal"]
            running_total += (deposit - withdrawal)

            out.append({
                "label": label,
                "month": m,
                "year": y,
                "deposit": deposit,
                "withdrawal": withdrawal,
                "cumulative": running_total
            })
        return out
