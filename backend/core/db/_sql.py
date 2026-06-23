"""Shared SQL fragments — single source of truth for the consumption-expense rule.

This lives in the db layer (not ``core/domain/``) because it knows persistence: it
emits a SQL ``WHERE`` fragment, parameterized by table alias. The canonical financial
invariant it encodes is documented in CLAUDE.md ("Consumption-expense rule").

WHY a function and not a constant: the ~33 consumption sites in ``analytics.py`` mix
table aliases — joined queries write ``t.dest_account_id``, single-table queries write
``dest_account_id``. A single constant string can't serve both; the alias parameter does.

SCOPE — consumption family ONLY. Do NOT use this for:
  • income            (``flow='income' AND is_revenue=1`` — different predicate)
  • investment legs   (``method='transfer'`` — see ``_APLIC``/``_RESG`` in analytics.py)
  • patrimônio        (``dest_account_id IS NULL`` only — must NOT filter by method)
Those are deliberately different clauses; centralizing them here would corrupt totals.
"""


def consumption_expense_clause(alias: str = "") -> str:
    """Return the canonical consumption-expense ``WHERE`` fragment.

    A consumption expense is ``flow='expense'`` that is NOT an investment/internal
    transfer (``method != 'transfer' AND dest_account_id IS NULL``) and NOT a
    third-party row (``COALESCE(is_third_party,0)=0``).

    ``alias`` is the table alias used in the query (e.g. ``"t"`` for joined queries);
    pass ``""`` for single-table queries.

        consumption_expense_clause()    -> "flow = 'expense' AND dest_account_id IS NULL ..."
        consumption_expense_clause("t") -> "t.flow = 'expense' AND t.dest_account_id IS NULL ..."
    """
    p = f"{alias}." if alias else ""
    return (
        f"{p}flow = 'expense' AND {p}dest_account_id IS NULL "
        f"AND {p}method != 'transfer' AND COALESCE({p}is_third_party, 0) = 0"
    )
