"""Insert, update, and delete operations for all tables."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional
from uuid import uuid4


from core.db.schema import _connect
from core import events


def insert_transaction(
    date: str,
    flow: str,
    method: str,
    account_id: str,
    amount: float,
    description: str,
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
        raise ValueError(f"Invalid date format: '{date}'. Expected YYYY-MM-DD.") from None
    # OR IGNORE only for the dedup path: an external_id collision is the one
    # constraint we want to swallow. Without an external_id, a constraint failure
    # is a real bug (bad method, broken FK) and must raise, not return -1.
    verb = "INSERT OR IGNORE" if external_id is not None else "INSERT"
    with _connect() as conn:
        cur = conn.execute(
            f"""{verb} INTO transactions
               (date, flow, method, account_id, amount,
                description, category_id, dest_account_id, counterpart, is_revenue,
                external_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (date, flow, method, account_id, amount,
             description, category_id, dest_account_id, counterpart, is_revenue,
             external_id),
        )
        last_id = cur.lastrowid if (cur.rowcount and cur.lastrowid is not None) else -1
    events.notify()
    return last_id


def get_transaction(transaction_id: int) -> Optional[sqlite3.Row]:
    """Fetch a single transaction by its id."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (transaction_id,)
        ).fetchone()


# Full transactions column set, in a fixed order, for round-trip delete→restore.
_TX_COLUMNS = (
    "id", "date", "flow", "method", "account_id", "amount",
    "description", "category_id", "dest_account_id", "counterpart", "is_revenue",
    "external_id", "display_name", "is_third_party", "original_amount",
    "import_batch_id",
)



def _self_transfer_partner(conn: sqlite3.Connection, row: sqlite3.Row) -> Optional[sqlite3.Row]:
    """Return the matching leg of an auto-transfer pair (counterpart='SELF'), if any."""
    if row["counterpart"] != "SELF":
        return None
    return conn.execute(
        """SELECT * FROM transactions
            WHERE counterpart = 'SELF' AND id != ? AND date = ?
              AND ROUND(amount,2) = ROUND(?,2) AND flow != ?
            LIMIT 1""",
        (row["id"], row["date"], row["amount"], row["flow"]),
    ).fetchone()


def _investment_balance_delta(conn: sqlite3.Connection, row: sqlite3.Row) -> Optional[dict]:
    """If ``row`` is a modal-created investment leg, return ``{id, applied_delta}``.

    ``register_investment_transfer`` writes legs described exactly as
    ``"Aplicação: <name>"`` (deposit, +amount to current_balance) or
    ``"Resgate: <name>"`` (withdrawal, -amount). We match that exact format against
    an existing investment name so imported Porquinho rows (different wording) never
    trigger a balance change. ``applied_delta`` is what was added on creation, so
    delete subtracts it and restore re-adds it.
    """
    desc = row["description"] or ""
    for prefix, sign in (("Aplicação: ", 1.0), ("Resgate: ", -1.0)):
        if desc.startswith(prefix):
            name = desc[len(prefix):]
            inv = conn.execute(
                "SELECT id FROM investments WHERE name = ?", (name,)
            ).fetchone()
            if inv is not None:
                return {"id": inv["id"], "applied_delta": sign * row["amount"]}
    return None


def _revert_investment_deltas(
    conn: sqlite3.Connection, rows: Iterable[sqlite3.Row]
) -> list[dict]:
    """Subtract each row's investment-leg delta from ``current_balance``.

    Shared by :func:`delete_transaction` and :func:`delete_batch`: for every modal-created
    investment leg in ``rows``, reverse the balance change it applied and collect
    ``{id, applied_delta}`` for the restore payload. Non-leg rows are skipped.
    """
    deltas: list[dict] = []
    for r in rows:
        delta = _investment_balance_delta(conn, r)
        if delta is not None:
            deltas.append(delta)
            conn.execute(
                "UPDATE investments SET current_balance = current_balance - ? WHERE id = ?",
                (delta["applied_delta"], delta["id"]),
            )
    return deltas


def delete_transaction(tx_id: int) -> Optional[dict]:
    """Delete a transaction (and its integrity-linked siblings) and return a restore payload.

    Safety guarantees:
      * **Auto-transfer pairs** (``counterpart='SELF'``) delete both legs together.
      * **Investment legs** created via the web modal also revert
        ``investments.current_balance`` so the position isn't left overstated.

    Everything happens in one transaction. The returned payload
    ``{"transactions": [full row dicts], "investment_deltas": [{"id", "applied_delta"}]}``
    is opaque to the caller and is what :func:`restore_transactions` replays for undo.

    Returns:
        The restore payload, or ``None`` if the id was not found.
    """
    with _connect() as conn:
        target = conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if target is None:
            return None
        # Build the set of rows that must go together (dedup by id).
        to_delete: dict[int, sqlite3.Row] = {target["id"]: target}
        partner = _self_transfer_partner(conn, target)
        if partner is not None:
            to_delete[partner["id"]] = partner

        # Reverse current_balance for any investment legs in the set.
        investment_deltas = _revert_investment_deltas(conn, to_delete.values())

        ids = list(to_delete.keys())
        placeholders = ",".join("?" for _ in ids)
        conn.execute(f"DELETE FROM transactions WHERE id IN ({placeholders})", ids)

    events.notify()
    return {
        "transactions": [{c: r[c] for c in _TX_COLUMNS} for r in to_delete.values()],
        "investment_deltas": investment_deltas,
    }


def restore_transactions(payload: dict) -> int:
    """Re-insert rows removed by :func:`delete_transaction` and re-apply balance deltas.

    Replays the opaque payload atomically: each transaction is re-inserted with its
    original id (so links stay intact), and every investment delta is re-added to
    ``current_balance``. Returns the number of transactions restored. A malformed
    or empty payload restores nothing (returns 0).
    """
    txs = (payload or {}).get("transactions") or []
    if not txs:
        return 0
    cols = ",".join(_TX_COLUMNS)
    qmarks = ",".join("?" for _ in _TX_COLUMNS)
    with _connect() as conn:
        for row in txs:
            conn.execute(
                f"INSERT INTO transactions ({cols}) VALUES ({qmarks})",
                tuple(row.get(c) for c in _TX_COLUMNS),
            )
        for d in (payload.get("investment_deltas") or []):
            conn.execute(
                "UPDATE investments SET current_balance = current_balance + ? WHERE id = ?",
                (d["applied_delta"], d["id"]),
            )
    events.notify()
    return len(txs)


def count_batch(import_batch_id: str) -> int:
    """Number of transactions tagged with ``import_batch_id``."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE import_batch_id = ?",
            (import_batch_id,),
        ).fetchone()
    return int(row[0] or 0)


def delete_batch(import_batch_id: str) -> dict:
    """Reverse a whole import in one transaction — every row that shares the tag.

    This is the deliberate counterpart to :func:`delete_transaction`'s per-row guard.
    delete_batch removes the entire tagged set.

    Any modal-style investment legs revert ``current_balance`` (imported rows use a
    different description format and normally have no delta — the check is defensive).

    Returns ``{"deleted": int, "transactions": [...], "investment_deltas": [...]}``;
    the last two form a restore payload :func:`restore_transactions` can replay.
    """
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions WHERE import_batch_id = ?",
            (import_batch_id,),
        ).fetchall()
        if not rows:
            return {"deleted": 0, "transactions": [], "investment_deltas": []}

        investment_deltas = _revert_investment_deltas(conn, rows)
        conn.execute(
            "DELETE FROM transactions WHERE import_batch_id = ?", (import_batch_id,)
        )
    events.notify()
    return {
        "deleted": len(rows),
        "transactions": [{c: r[c] for c in _TX_COLUMNS} for r in rows],
        "investment_deltas": investment_deltas,
    }


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


def prune_investments_except(names: list[str]) -> int:
    """Delete investment positions whose name is not in ``names`` (B3 full-sync).

    The B3 report is the source of truth for brokerage positions: a position that
    drops out of the latest report (matured/redeemed/transferred out) must vanish
    from the table, not linger with a stale balance. Caixinha/Porquinho live only
    in the ledger (never in this table), so they are never matched/removed here.
    Dependent ``investment_movements`` rows are deleted first to satisfy the FK.

    No-op (returns 0) when ``names`` is empty — an empty report is a parse failure
    upstream, never a signal to wipe every position.

    Returns:
        The number of positions removed.
    """
    if not names:
        return 0
    placeholders = ",".join("?" * len(names))
    with _connect() as conn:
        stale = [
            r["id"]
            for r in conn.execute(
                f"SELECT id FROM investments WHERE name NOT IN ({placeholders})", names
            ).fetchall()
        ]
        if stale:
            id_ph = ",".join("?" * len(stale))
            conn.execute(
                f"DELETE FROM investment_movements WHERE investment_id IN ({id_ph})", stale
            )
            conn.execute(f"DELETE FROM investments WHERE id IN ({id_ph})", stale)
    if stale:
        events.notify()
    return len(stale)


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
        last_id = cur.lastrowid if cur.lastrowid is not None else -1
        delta = amount if operation == "deposit" else -amount
        conn.execute(
            "UPDATE investments SET current_balance = current_balance + ? WHERE id = ?",
            (delta, investment_id),
        )
    events.notify()
    return last_id


# bank → checking account that funds/receives an investment movement.
_BANK_CHECKING = {"nubank": "nu-db", "inter": "inter-db"}


def register_investment_transfer(
    investment_id: int,
    bank: str,
    operation: str,
    amount: float,
    date: str,
    name: str,
) -> int:
    """Record an investment application/withdrawal as a checking-account transfer leg.

    This mirrors how imported investment flows are stored (a ``method='transfer'``
    transaction on the checking account), so the movement is visible and
    consistent across every screen: it reduces/raises the checking balance via
    the transactions ledger, lands in ``cashflow_statement.investment_net``, shows
    in the Histórico tagged "investimento", and bumps ``investments.current_balance``.
    Deliberately does NOT write ``investment_movements`` — that ledger is subtracted
    from checking balances in ``get_account_balance``/``get_all_accounts_with_balance``
    and would double-count against this transaction leg.

    aplicação (deposit) → flow='expense', method='transfer', is_revenue=0, current_balance += amount
    resgate (withdrawal) → flow='income', method='transfer', is_revenue=0, current_balance -= amount

    Both legs are atomic (single transaction). Returns the new transaction id.

    Raises:
        ValueError: if the bank has no mapped checking account.
    """
    checking = _BANK_CHECKING.get(bank)
    if checking is None:
        raise ValueError(f"Banco '{bank}' não tem conta corrente mapeada para investimentos.")
    if operation == "deposit":
        flow, desc, delta = "expense", f"Aplicação: {name}", amount
    else:
        flow, desc, delta = "income", f"Resgate: {name}", -amount
    with _connect() as conn:
        cur = conn.execute(
            """INSERT INTO transactions
               (date, flow, method, account_id, amount,
                description, category_id, dest_account_id, counterpart, is_revenue, external_id)
               VALUES (?,?,?,?,?,?,NULL,NULL,NULL,0,NULL)""",
            (date, flow, "transfer", checking, amount, desc),
        )
        tx_id = cur.lastrowid
        conn.execute(
            "UPDATE investments SET current_balance = current_balance + ? WHERE id = ?",
            (delta, investment_id),
        )
    events.notify()
    return tx_id  # type: ignore[return-value]


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
    # original_amount seeds to the parsed amount — the audit anchor if the user later
    # overrides the value in the editable preview.
    cols = (*STAGING_COLS, "original_amount")
    payload = [
        (batch_id, created, source, *(r.get(c) for c in STAGING_COLS), r.get("amount"))
        for r in rows
    ]
    placeholders = ", ".join(cols)
    qmarks = ", ".join("?" for _ in cols)
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


def _sget(row: sqlite3.Row, col: str) -> Any:
    """Read an optional staging column, tolerating pre-migration rows (→ None)."""
    return row[col] if col in row.keys() else None


_STAGING_EDITABLE = {"category_id", "display_name", "amount"}


def update_staging_row(batch_id: str, row_id: int, fields: dict[str, Any]) -> Optional[sqlite3.Row]:
    """Edit a staged row's category/name/amount before confirm (editable preview).

    Only ``category_id``, ``display_name`` and ``amount`` are editable — the parsed
    ``original_amount`` is left untouched so divergence stays auditable. Returns the
    updated row, or ``None`` if no editable field was given or the row wasn't found.
    """
    cols = {k: v for k, v in fields.items() if k in _STAGING_EDITABLE}
    if not cols:
        return None
    set_clause = ", ".join(f"{k} = ?" for k in cols)
    with _connect() as conn:
        cur = conn.execute(
            f"UPDATE import_staging SET {set_clause} WHERE batch_id = ? AND id = ?",
            (*cols.values(), batch_id, row_id),
        )
        if not cur.rowcount:
            return None
        return conn.execute(
            "SELECT * FROM import_staging WHERE id = ?", (row_id,)
        ).fetchone()


def staging_divergence(batch_id: str) -> float:
    """Sum(edited amount) − Sum(parsed original_amount) over a batch's 'new' rows.

    Non-zero means the user overrode one or more amounts, so the lote no longer
    matches the bank statement total — the import modal surfaces this as a warning.
    """
    with _connect() as conn:
        row = conn.execute(
            """SELECT COALESCE(SUM(amount), 0)
                      - COALESCE(SUM(COALESCE(original_amount, amount)), 0)
               FROM import_staging WHERE batch_id = ? AND status = 'new'""",
            (batch_id,),
        ).fetchone()
    return round(float(row[0] or 0.0), 2)


def confirm_staging_batch(
    batch_id: str,
    exclude_ids: Optional[set[int]] = None,
    import_batch_id: Optional[str] = None,
) -> dict:
    """Atomically promote a batch's 'new' rows to transactions and drop the batch.

    All inserts AND the batch delete run inside a single connection/transaction:
    on any error the context manager rolls back, so the staging batch survives
    intact and a retry is safe (no half-imported, no Inter duplicates). SSE is
    notified exactly once, after commit — not once per row.

    Args:
        batch_id: Token from :func:`insert_staging_rows`.
        exclude_ids: Staging-row ids the user unchecked in the preview.
        import_batch_id: Shared session token tagged onto every inserted row so the
            whole import (which may span several per-account staging batches) is
            reversible as one unit via :func:`delete_batch`. Generated when omitted.
            Only rows actually inserted carry it — ``INSERT OR IGNORE`` collisions and
            excluded rows are not tagged (so the tag = the exact undo set).

    Returns:
        ``{"inserted": int, "skipped": int, "import_batch_id": str}``, or
        ``{"missing": True, …}`` if the batch no longer exists.
    """
    excluded = exclude_ids or set()
    import_batch_id = import_batch_id or uuid4().hex
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM import_staging WHERE batch_id = ? ORDER BY date ASC, id ASC",
            (batch_id,),
        ).fetchall()
        if not rows:
            return {"inserted": 0, "skipped": 0, "missing": True}

        # import_batch_id tags the whole import so it's reversible as one unit.
        inserted = 0
        for r in rows:
            if r["status"] != "new" or r["id"] in excluded:
                continue
            orig = _sget(r, "original_amount")
            # store original_amount only when the user actually overrode the value,
            # so it stays a clean audit flag (NULL = untouched bank value)
            audit_amount = orig if (orig is not None and round(orig, 2) != round(r["amount"], 2)) else None
            cur = conn.execute(
                """INSERT OR IGNORE INTO transactions
                   (date, flow, method, account_id, amount,
                    description, category_id, dest_account_id, counterpart,
                    is_revenue, external_id, display_name, original_amount,
                    import_batch_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (r["date"], r["flow"], r["method"], r["account_id"], r["amount"],
                 r["description"], _sget(r, "category_id"), r["dest_account_id"],
                 _staging_counterpart(r), r["is_revenue"] or 0, r["external_id"],
                 _sget(r, "display_name"), audit_amount, import_batch_id),
            )
            if cur.rowcount:
                inserted += 1
        conn.execute("DELETE FROM import_staging WHERE batch_id = ?", (batch_id,))
    # Rows enter with category_id from the preview edit if set, else NULL — then
    # categorized by hand in the Histórico (filter "Sem categoria" + inline edit).
    events.notify()
    return {"inserted": inserted, "skipped": len(rows) - inserted,
            "import_batch_id": import_batch_id}


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
