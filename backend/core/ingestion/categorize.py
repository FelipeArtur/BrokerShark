"""Rule-based auto-categorization for consumption transactions.

Maps a transaction description to a category by keyword matching. Rules are
deliberately conservative and high-confidence — the goal is to pre-fill the
obvious recurring merchants on import and clear the bulk of the historical
backlog, leaving the genuinely ambiguous person-to-person PIX for the manual
"Categorizar pendentes" panel.

First matching rule wins, so order matters: more specific keywords go first.
Adding a merchant here is the supported way to teach the importer a new mapping.

The applier (:func:`auto_categorize`) only ever touches *consumption* rows that
are still uncategorized — it never overwrites a category already set by hand,
and never looks at transfers/investments/self-transfers (those carry no
category by design).
"""
from __future__ import annotations

import sqlite3
from typing import Optional

# (category_name, keywords) — keywords matched case-insensitively as substrings.
# category_name must exist in `categories` for the matching flow, or the rule is
# silently skipped (a renamed/removed category never raises).
#
# Keywords are deliberately specific. Broad substrings were dropped after review
# because they mis-categorize silently on every import: "mercado" caught Mercado
# Livre/Pago (e-commerce/payments), "cafe"/"café" matched merchant legal names,
# "uber" swallowed Uber Eats (food) into Lazer, "oferta" tagged any promo as a
# church donation. When unsure, leave it for the manual panel — a wrong auto
# category is worse than none.
_EXPENSE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Alimentação", (
        "vending machine", "svm comer", "svm vending", "comercial de alimentos",
        "garfodeouro", "garfo de ouro", "subway", "grill", "restaurante",
        "lanche", "pizza", "burger", "hamburg", "ifood",
        "supermercado", "padaria", "acai", "açaí", "doceria",
        "sorveteria", "espetinho", "churras",
    )),
    ("Carro", (
        "posto", "combustivel", "combustível", "ipva", "estacionamento",
        "auto escola", "autoescola", "formacao de condu", "formação de condu",
        "shell", "ipiranga", "petrobras", "detran", "pedagio", "pedágio",
    )),
    ("Atividade física", (
        "academia", "smartfit", "smart fit", "crossfit", "gympass",
        "totalpass", "musculacao", "musculação",
    )),
    ("Jogos", (
        "steam", "playstation", "psn", "xbox", "nintendo", "riot",
        "epic games", "blizzard", "garena", "playgames", "google play games",
    )),
    ("Lazer", (
        "cinema", "netflix", "spotify", "disney", "hbo", "prime video",
        "youtube premium", "ingresso", "99 tecnologia", "99app",
        "cabify", "max stream",
    )),
    ("Eletrônicos", (
        "kabum", "magazine luiza", "magalu", "americanas", "pichau",
        "terabyte", "aliexpress", "shopee", "eletro",
    )),
    ("Educação", (
        "udemy", "alura", "faculdade", "universidade", "curso ", "escola ",
        "rocketseat", "coursera", "hotmart",
    )),
    ("Igreja", (
        "instituicao exemplo", "instituicao exemplo", "igreja",
        "dizimo", "dízimo",
    )),
)

_INCOME_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Salário", (
        "exemplo de exemplo", "exemplo de exemplo",
        "exemplo industrial", "acme", "clube",
    )),
    ("PIX recebido", (
        "pix recebido", "transferência recebida pelo pix",
        "transferencia recebida pelo pix",
    )),
    ("Transferência", (
        "transferência recebida", "transferencia recebida", "ted recebid",
    )),
)


def _match(description: str, rules: tuple[tuple[str, tuple[str, ...]], ...]) -> Optional[str]:
    low = (description or "").lower()
    for category_name, keywords in rules:
        if any(k in low for k in keywords):
            return category_name
    return None


def suggest_category_name(description: str, flow: str) -> Optional[str]:
    """Return the category name a description maps to, or ``None`` if no rule hits."""
    rules = _EXPENSE_RULES if flow == "expense" else _INCOME_RULES
    return _match(description, rules)


def _category_name_to_id(conn: sqlite3.Connection) -> dict[tuple[str, str], int]:
    """Build a ``(flow, name) → id`` lookup for both flows."""
    return {
        (r["flow"], r["name"]): r["id"]
        for r in conn.execute("SELECT id, name, flow FROM categories").fetchall()
    }


def auto_categorize(conn: sqlite3.Connection) -> dict[str, int]:
    """Apply the rule set to every still-uncategorized *consumption* row.

    Operates on the caller's open connection so it can run inside the import
    confirm transaction or standalone. Only touches rows that are real
    consumption (expense non-transfer, or revenue income) with no category yet —
    transfers, investment legs and self-transfers are left alone.

    Returns ``{"matched": N, "scanned": M}``.
    """
    name_to_id = _category_name_to_id(conn)
    rows = conn.execute(
        """SELECT id, flow, is_revenue, COALESCE(display_name, description) AS text
             FROM transactions
            WHERE category_id IS NULL
              AND dest_account_id IS NULL
              AND (method IS NULL OR method != 'transfer')
              AND (counterpart IS NULL OR counterpart != 'SELF')
              AND COALESCE(is_third_party,0)=0
              AND ( (flow = 'expense')
                 OR (flow = 'income' AND is_revenue = 1) )"""
    ).fetchall()

    updates: list[tuple[int, int]] = []
    for r in rows:
        name = suggest_category_name(r["text"], r["flow"])
        if not name:
            continue
        cat_id = name_to_id.get((r["flow"], name))
        if cat_id is not None:
            updates.append((cat_id, r["id"]))

    if updates:
        conn.executemany(
            "UPDATE transactions SET category_id = ? WHERE id = ?", updates
        )
    return {"matched": len(updates), "scanned": len(rows)}
