"""Re-export shim — public API for database access.

All callers import this module as ``from core import database`` and access
functions via ``database.func()``.  The implementation lives in sub-modules
under ``core/db/`` to keep concerns separated:

  core/db/schema.py     — connection, schema creation, seeds, migrations
  core/db/crud.py       — insert / update / delete operations
  core/db/analytics.py  — read-only queries and summaries
  core/db/categories.py — category management
"""
from core.db.schema import init_db  # noqa: F401

from core.db.crud import (  # noqa: F401
    insert_transaction,
    get_transaction,
    delete_transaction,
    restore_transactions,
    delete_batch,
    get_transactions_by_period,
    update_transaction_category,
    update_transaction_fields,
    upsert_investment,
    set_investment_balance_by_name,
    register_investment_transfer,
    update_investment_balance,
    insert_staging_rows,
    get_staging_batch,
    delete_staging_batch,
    update_staging_row,
    staging_divergence,
    bulk_categorize,
)

from core.db.analytics import (  # noqa: F401
    get_account,
    get_all_accounts,
    get_all_accounts_with_balance,
    get_account_balance,
    get_all_investments,
    get_investment_by_name,
    get_ledger_savings_positions,
    get_monthly_summary,
    get_all_time_summary,
    get_all_time_categories,
    get_expenses_by_method,
    get_monthly_history,
    get_monthly_history_present,
    get_expenses_by_category,
    get_account_monthly_summary,
    get_monthly_history_by_account,
    get_full_monthly_history_by_account,
    get_expenses_by_category_account,
    get_recent_transactions,
    get_recent_activity,
    get_categorized_history,
    get_uncategorized_merchants,
    get_month_transactions,
    get_patrimonio_history,
    get_daily_spend,
    get_top_pix_descriptions,
    get_investment_evolution,
    search_transactions,
    get_cashflow_statement,
    get_available_to_spend,
    get_liquidity_history,
)

from core.db.categories import (  # noqa: F401
    get_categories,
    get_category,
    get_expense_categories,
    get_all_expense_categories,
    get_all_categories_full,
    create_category,
    delete_category,
)
