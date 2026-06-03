"""Insert, update, and delete operations for all tables."""
from __future__ import annotations

import calendar
import sqlite3
from datetime import datetime, timedelta
from typing import Any, Optional

from core.db.schema import _connect
from core import events


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
    is_revenue: int = 0,
    external_id: Optional[str] = None,
) -> int:
    """Insert a new transaction and notify the dashboard via SSE.

    Args:
        date: ISO date string (``"YYYY-MM-DD"``).
        flow: ``"expense"`` or ``"income"``.
        method: ``"pix"``, ``"credit"``, ``"ted"``, ``"transfer"``, or income subtypes.
        account_id: FK to ``accounts.id``.
        amount: Positive monetary value in BRL.
        description: Human-readable label entered by the user.
        installments: Number of installments (default 1).
        category_id: FK to ``categories.id`` (required for expenses).
        dest_account_id: FK for internal transfers (usually ``None``).
        counterpart: Sender/recipient name for external PIX.
        is_revenue: 1 for real income, 0 for self-transfers.
        external_id: Stable source id (e.g. Nubank's ``Identificador`` UUID) used
            for import dedup. ``INSERT OR IGNORE`` skips rows that collide with the
            partial UNIQUE index on ``external_id``.

    Returns:
        The auto-incremented ``id`` of the newly inserted row, or ``-1`` when an
        ``external_id`` collision caused the insert to be ignored.

    Raises:
        sqlite3.IntegrityError: When a manual insert (no ``external_id``) violates a
            constraint (bad ``method``/``flow`` CHECK, missing FK, NULL column). Only
            the dedup path (``external_id`` present) swallows collisions via
            ``INSERT OR IGNORE`` — manual writes must fail loudly instead of
            silently vanishing.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except (ValueError, TypeError):
        raise ValueError(f"Invalid date format: '{date}'. Expected YYYY-MM-DD.")
    # OR IGNORE only for the dedup path: an external_id collision is the one
    # constraint we want to swallow. Without an external_id, a constraint failure
    # is a real bug (bad method, broken FK) and must raise, not return -1.
    verb = "INSERT OR IGNORE" if external_id is not None else "INSERT"
    with _connect() as conn:
        cur = conn.execute(
            f"""{verb} INTO transactions
               (date, flow, method, account_id, amount, installments,
                description, category_id, dest_account_id, counterpart, is_revenue,
                external_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (date, flow, method, account_id, amount, installments,
             description, category_id, dest_account_id, counterpart, is_revenue,
             external_id),
        )
        last_id = cur.lastrowid if cur.rowcount else -1
    events.notify()
    return last_id


def _add_months(iso_date: str, months: int) -> str:
    """Return ``iso_date`` shifted forward by ``months``, clamping the day.

    A purchase made on the 31st whose next installment lands in a 30-day month
    is clamped to the 30th (never rolls into the following month).
    """
    d = datetime.strptime(iso_date, "%Y-%m-%d").date()
    total = (d.month - 1) + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return f"{year:04d}-{month:02d}-{day:02d}"


def insert_expense(
    date: str,
    method: str,
    account_id: str,
    amount: float,
    description: str,
    installments: int = 1,
    category_id: Optional[int] = None,
    dest_account_id: Optional[str] = None,
) -> int:
    """Insert an expense, expanding a multi-installment purchase into one row per month.

    A single ``credit`` purchase split into N installments is stored as N separate
    transactions — one per monthly billing cycle, each carrying ``amount / N`` — so
    each fatura and each monthly summary reflect only the installment due that month
    (matching how imported card statements already arrive). The cents remainder is
    placed on the final installment so the parts sum back to ``amount`` exactly.

    Single-installment purchases (``installments <= 1``) insert one row, unchanged.

    Returns:
        The ``id`` of the first inserted row.
    """
    if installments <= 1:
        return insert_transaction(
            date=date, flow="expense", method=method, account_id=account_id,
            amount=amount, description=description, installments=installments,
            category_id=category_id, dest_account_id=dest_account_id,
        )
    per = round(amount / installments, 2)
    parts = [per] * (installments - 1)
    parts.append(round(amount - per * (installments - 1), 2))  # remainder on the last
    first_id = -1
    for k, part in enumerate(parts):
        label = f"{description} ({k + 1}/{installments})"
        tx_id = insert_transaction(
            date=_add_months(date, k), flow="expense", method=method,
            account_id=account_id, amount=part, description=label,
            installments=installments, category_id=category_id,
            dest_account_id=dest_account_id,
        )
        if k == 0:
            first_id = tx_id
    return first_id


def get_transaction(transaction_id: int) -> Optional[sqlite3.Row]:
    """Fetch a single transaction by its id."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (transaction_id,)
        ).fetchone()


def delete_transaction(tx_id: int) -> bool:
    """Delete a transaction by ID.

    Raises:
        ValueError: If the transaction is a protected fatura payment.

    Returns:
        ``True`` if deleted, ``False`` if not found.
    """
    with _connect() as conn:
        row = conn.execute(
            "SELECT method, dest_account_id FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if row is None:
            return False
        if row["method"] == "transfer" and row["dest_account_id"] in ("nu-cc", "inter-cc"):
            raise ValueError(
                "Pagamentos de fatura não podem ser excluídos. "
                "Este lançamento representa o total da fatura paga e é usado no cálculo do patrimônio."
            )
        conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
        return True


def get_transactions_by_period(
    start_date: str, end_date: str, flow: Optional[str] = None
) -> list[sqlite3.Row]:
    """Return transactions within a date range, optionally filtered by flow."""
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


def update_transaction_category(transaction_id: int, category_id: int) -> None:
    """Update the category of a single transaction."""
    with _connect() as conn:
        conn.execute(
            "UPDATE transactions SET category_id = ? WHERE id = ?",
            (category_id, transaction_id),
        )


def update_transaction_fields(tx_id: int, **fields: Any) -> None:
    """Update one or more editable fields on a transaction.

    Accepts keyword arguments: ``display_name`` (str | None),
    ``category_id`` (int), ``is_third_party`` (int 0/1).
    """
    allowed = {"display_name", "category_id", "is_third_party"}
    cols = {k: v for k, v in fields.items() if k in allowed}
    if not cols:
        return
    set_clause = ", ".join(f"{k} = ?" for k in cols)
    with _connect() as conn:
        conn.execute(
            f"UPDATE transactions SET {set_clause} WHERE id = ?",
            (*cols.values(), tx_id),
        )


def upsert_investment(name: str, type_: str, bank: str) -> int:
    """Insert an investment if it does not exist, then return its id."""
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO investments (name, type, bank) VALUES (?,?,?)",
            (name, type_, bank),
        )
        row = conn.execute(
            "SELECT id FROM investments WHERE name = ?", (name,)
        ).fetchone()
        return row["id"]


def set_investment_balance_by_name(
    name: str, type_: str, bank: str, balance: float
) -> tuple[int, bool]:
    """Idempotent upsert of a position snapshot keyed by ``name``.

    Creates the investment with ``balance`` if it does not exist; otherwise updates
    its ``current_balance`` (and refreshes type/bank). Used by the B3 import, where
    each report is a point-in-time snapshot and re-running must not duplicate rows.

    Returns:
        ``(investment_id, created)`` — ``created`` is ``True`` on insert.
    """
    with _connect() as conn:
        row = conn.execute(
            "SELECT id FROM investments WHERE name = ?", (name,)
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE investments SET current_balance=?, type=?, bank=? WHERE id=?",
                (balance, type_, bank, row["id"]),
            )
            inv_id, created = row["id"], False
        else:
            cur = conn.execute(
                "INSERT INTO investments (name, type, bank, current_balance) VALUES (?,?,?,?)",
                (name, type_, bank, balance),
            )
            inv_id, created = cur.lastrowid, True
    events.notify()
    return inv_id, created


def insert_investment_movement(
    date: str,
    investment_id: int,
    operation: str,
    amount: float,
    description: Optional[str] = None,
) -> int:
    """Record a deposit or withdrawal and update the investment balance.

    Atomically inserts the movement row and updates ``investments.current_balance``
    within a single transaction. Notifies the dashboard via SSE after commit.

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


def update_investment_balance(investment_id: int, new_balance: float) -> None:
    """Overwrite the current_balance of an investment to reflect real-world value."""
    with _connect() as conn:
        conn.execute(
            "UPDATE investments SET current_balance=? WHERE id=?",
            (new_balance, investment_id),
        )
    events.notify()


def get_investment_movement(movement_id: int) -> Optional[sqlite3.Row]:
    """Fetch a single investment movement by its id."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM investment_movements WHERE id = ?", (movement_id,)
        ).fetchone()


def upsert_budget(category_id: int, amount_limit: float) -> None:
    """Insert or replace the spending limit for a category."""
    with _connect() as conn:
        conn.execute(
            """INSERT INTO budgets (category_id, amount_limit) VALUES (?,?)
               ON CONFLICT(category_id) DO UPDATE SET amount_limit=excluded.amount_limit""",
            (category_id, amount_limit),
        )


def log_unrecognized(message: str) -> None:
    """Persist an unrecognised Telegram message to the audit log."""
    with _connect() as conn:
        conn.execute(
            "INSERT INTO unrecognized_log (date, message) VALUES (?,?)",
            (datetime.now().isoformat(), message),
        )


# ── Import staging ──────────────────────────────────────────────────────────
# Rows parsed from an uploaded file land in import_staging with a classification
# status ('new' | 'duplicate' | 'skipped'). The preview modal reads them; on
# confirm, only 'new' rows are promoted to transactions and the batch is deleted.

# Single source of truth for the staging column order. ``service.py`` imports
# this so the parsed-record dict and the INSERT can never drift apart.
STAGING_COLS = (
    "date", "flow", "method", "account_id", "amount", "description",
    "dest_account_id", "external_id", "is_revenue", "counterpart", "status", "note",
)


def insert_staging_rows(batch_id: str, source: str, rows: list[dict[str, Any]]) -> None:
    """Persist a batch of classified, parsed rows into ``import_staging``.

    Args:
        batch_id: Opaque token identifying this upload (UUID hex).
        source: Adapter key, e.g. ``"nubank_extrato"``.
        rows: Dicts with keys from :data:`STAGING_COLS` (missing keys → NULL).
    """
    created = datetime.now().isoformat()
    payload = [
        (batch_id, created, source, *(r.get(c) for c in STAGING_COLS))
        for r in rows
    ]
    placeholders = ", ".join(STAGING_COLS)
    qmarks = ", ".join("?" for _ in STAGING_COLS)
    with _connect() as conn:
        conn.executemany(
            f"INSERT INTO import_staging (batch_id, created_at, source, {placeholders}) "
            f"VALUES (?,?,?,{qmarks})",
            payload,
        )


def get_staging_batch(batch_id: str) -> list[sqlite3.Row]:
    """Return all staged rows for a batch, ordered by date ascending."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM import_staging WHERE batch_id = ? ORDER BY date ASC, id ASC",
            (batch_id,),
        ).fetchall()


def delete_staging_batch(batch_id: str) -> int:
    """Delete every staged row for a batch. Returns the number of rows removed."""
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM import_staging WHERE batch_id = ?", (batch_id,)
        )
        return cur.rowcount


def _staging_counterpart(row: sqlite3.Row) -> Optional[str]:
    """Read ``counterpart`` from a staging row, tolerating pre-migration rows."""
    return row["counterpart"] if "counterpart" in row.keys() else None


def confirm_staging_batch(batch_id: str, exclude_ids: Optional[set[int]] = None) -> dict:
    """Atomically promote a batch's 'new' rows to transactions and drop the batch.

    All inserts AND the batch delete run inside a single connection/transaction:
    on any error the context manager rolls back, so the staging batch survives
    intact and a retry is safe (no half-imported, no Inter duplicates). SSE is
    notified exactly once, after commit — not once per row.

    Args:
        batch_id: Token from :func:`insert_staging_rows`.
        exclude_ids: Staging-row ids the user unchecked in the preview.

    Returns:
        ``{"inserted": int, "skipped": int}``, or ``{"missing": True, …}`` if the
        batch no longer exists (expired or already confirmed).
    """
    excluded = exclude_ids or set()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM import_staging WHERE batch_id = ? ORDER BY date ASC, id ASC",
            (batch_id,),
        ).fetchall()
        if not rows:
            return {"inserted": 0, "skipped": 0, "missing": True}
        inserted = 0
        for r in rows:
            if r["status"] != "new" or r["id"] in excluded:
                continue
            cur = conn.execute(
                """INSERT OR IGNORE INTO transactions
                   (date, flow, method, account_id, amount, installments,
                    description, category_id, dest_account_id, counterpart,
                    is_revenue, external_id)
                   VALUES (?,?,?,?,?,1,?,NULL,?,?,?,?)""",
                (r["date"], r["flow"], r["method"], r["account_id"], r["amount"],
                 r["description"], r["dest_account_id"], _staging_counterpart(r),
                 r["is_revenue"] or 0, r["external_id"]),
            )
            if cur.rowcount:
                inserted += 1
        conn.execute("DELETE FROM import_staging WHERE batch_id = ?", (batch_id,))
    events.notify()
    return {"inserted": inserted, "skipped": len(rows) - inserted}


def prune_staging(older_than_hours: int = 24) -> int:
    """Delete abandoned staging rows older than ``older_than_hours``.

    Previews the user never confirmed would otherwise accumulate forever.
    Returns the number of rows removed.
    """
    cutoff = (datetime.now() - timedelta(hours=older_than_hours)).isoformat()
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM import_staging WHERE created_at < ?", (cutoff,)
        )
        return cur.rowcount
