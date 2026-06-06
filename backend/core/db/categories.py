"""Category CRUD and one-time income auto-categorization migration."""
from __future__ import annotations

import sqlite3
from typing import Optional

from core.db.schema import _connect


def _auto_categorize_income(conn: sqlite3.Connection) -> None:
    """Assign income categories to uncategorized revenue transactions based on description.

    Called exactly once at first startup via the migration system.
    Receives an open connection so it participates in the caller's transaction.
    """
    ids = {r["name"]: r["id"] for r in conn.execute(
        "SELECT id, name FROM categories WHERE flow='income'"
    ).fetchall()}
    if not ids:
        return
    sal = ids.get("Salário")
    pix = ids.get("PIX recebido")
    fre = ids.get("Freela")
    out = ids.get("Outro")
    if sal:
        conn.execute(
            """UPDATE transactions SET category_id=?
               WHERE flow='income' AND is_revenue=1 AND category_id IS NULL
               AND (description LIKE '%EXEMPLO LTDA%'
                    OR description LIKE '%EXEMPLO%'
                    OR description LIKE '%JOAO DA SILVA SOUZA%')""",
            (sal,),
        )
    if pix:
        conn.execute(
            """UPDATE transactions SET category_id=?
               WHERE flow='income' AND is_revenue=1 AND category_id IS NULL
               AND (description LIKE '%Pix recebido%' OR description LIKE '%PIX%')""",
            (pix,),
        )
    if fre:
        conn.execute(
            """UPDATE transactions SET category_id=?
               WHERE flow='income' AND is_revenue=1 AND category_id IS NULL
               AND (description LIKE '%Ressarcimento%' OR description LIKE '%ressarcimento%'
                    OR description LIKE '%Reembolso%')""",
            (fre,),
        )
    if out:
        conn.execute(
            """UPDATE transactions SET category_id=?
               WHERE flow='income' AND is_revenue=1 AND category_id IS NULL""",
            (out,),
        )


def get_categories(flow: str) -> list[sqlite3.Row]:
    """Return all categories for the given flow, ordered by id."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM categories WHERE flow = ? ORDER BY id", (flow,)
        ).fetchall()


def get_category(category_id: int) -> Optional[sqlite3.Row]:
    """Fetch a single category by its id."""
    with _connect() as conn:
        return conn.execute(
            "SELECT * FROM categories WHERE id = ?", (category_id,)
        ).fetchone()


def get_expense_categories() -> list[dict]:
    """Return all expense categories ordered by id as {id, name} dicts."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name FROM categories WHERE flow = 'expense' ORDER BY id",
        ).fetchall()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


def get_all_expense_categories() -> list[dict]:
    """Return all expense categories with their transaction count."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT c.id, c.name, c.flow,
                      COUNT(t.id) AS transaction_count
               FROM categories c
               LEFT JOIN transactions t
                     ON t.category_id = c.id
                    AND t.dest_account_id IS NULL
               WHERE c.flow = 'expense'
               GROUP BY c.id
               ORDER BY c.name""",
        ).fetchall()
        return [dict(r) for r in rows]

def get_all_categories_full(flow: str) -> list[dict]:
    """Return all categories for a given flow with their transaction count."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT c.id, c.name, COUNT(t.id) AS transaction_count
                 FROM categories c
                 LEFT JOIN transactions t
                   ON t.category_id = c.id
                  AND t.dest_account_id IS NULL
                WHERE c.flow = ?
                GROUP BY c.id
                ORDER BY c.name""",
            (flow,)
        ).fetchall()
        return [dict(r) for r in rows]


def create_category(name: str, flow: str) -> int:
    """Insert a new category and return its generated id.

    Raises:
        ValueError: If a category with the same name+flow already exists.
    """
    with _connect() as conn:
        existing = conn.execute(
            "SELECT id FROM categories WHERE name=? AND flow=?", (name, flow)
        ).fetchone()
        if existing:
            raise ValueError(f"Categoria '{name}' já existe para o fluxo '{flow}'.")
        cur = conn.execute(
            "INSERT INTO categories (name, flow) VALUES (?,?)", (name, flow)
        )
        return cur.lastrowid  # type: ignore[return-value]


def delete_category(category_id: int, reassign_to_id: int) -> int:
    """Reassign all transactions from one category to another, then delete it.

    Returns:
        Number of transactions that were reassigned.

    Raises:
        ValueError: If either id is invalid or they are the same.
    """
    with _connect() as conn:
        if category_id == reassign_to_id:
            raise ValueError("Categoria de origem e destino não podem ser iguais.")
        
        if reassign_to_id > 0:
            target = conn.execute(
                "SELECT id FROM categories WHERE id=?", (reassign_to_id,)
            ).fetchone()
            if not target:
                raise ValueError(f"Categoria destino id={reassign_to_id} não encontrada.")
            cur = conn.execute(
                "UPDATE transactions SET category_id=? WHERE category_id=?",
                (reassign_to_id, category_id),
            )
            affected = cur.rowcount
        else:
            count = conn.execute("SELECT COUNT(*) FROM transactions WHERE category_id=?", (category_id,)).fetchone()[0]
            if count > 0:
                raise ValueError("Existem lançamentos, é obrigatório reatribuir para exclusão.")
            affected = 0

        conn.execute("DELETE FROM budgets WHERE category_id=?", (category_id,))
        conn.execute("DELETE FROM categories WHERE id=?", (category_id,))
        return affected
