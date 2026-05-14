"""Flask dashboard server — analytics API + quick-entry writes, served on a daemon thread.

Read endpoints query SQLite via :mod:`core.database` and return JSON.
Write endpoints (POST /api/transactions, POST /api/incomes, POST /api/investment-movements)
insert records using the same database functions as the Telegram bot, triggering
SSE notifications.

A real-time SSE endpoint (``/api/events``) notifies connected browsers whenever
the database is written to.

The server is started via :func:`start_dashboard`, which launches Waitress
(production WSGI) in a daemon thread on the configured port.
"""
import logging
import queue
import threading
from datetime import datetime

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from waitress import serve

import config
from core import database
from core import events as _events
from bot.parsers import nubank_cc, inter_cc, nubank_extrato, inter_extrato

_logger = logging.getLogger(__name__)

DASHBOARD_PORT = config.DASHBOARD_PORT
FRONTEND_DIR = config.FRONTEND_DIR

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="/static")


@app.route("/")
def index() -> Response:
    """Serve the dashboard HTML page."""
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/events")
def sse_stream() -> Response:
    """SSE endpoint that pushes ``update`` events on every DB write.

    The browser connects once and receives:
    - ``data: connected`` — immediately after connecting
    - ``data: update``    — whenever any transaction or investment is written
    - ``data: heartbeat`` — every 30 s to keep the connection alive

    Each connected client holds one thread from the Waitress pool, which is
    why the server is configured with 8 threads.

    Returns:
        A streaming :class:`flask.Response` with MIME type ``text/event-stream``.
    """
    def generate():
        q = _events.subscribe()
        try:
            yield "data: connected\n\n"
            while True:
                try:
                    q.get(timeout=30)
                    yield "data: update\n\n"
                except queue.Empty:
                    yield "data: heartbeat\n\n"
        finally:
            _events.unsubscribe(q)
    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/summary")
def api_summary() -> Response:
    """Return the current month (or all-time) financial summary.

    Query params:
        period:  ``"all"`` — returns all-time averages instead of monthly totals
        bank:    ``nubank`` | ``inter`` (optional, ignored when period=all)
        account: account id (optional, ignored when period=all)
        month:   int (optional, defaults to current month)
        year:    int (optional, defaults to current year)

    Returns:
        For period=all: JSON with ``period``, ``months_count``, ``avg_income``,
        ``avg_expenses``, ``avg_savings_rate``, ``reservas``, ``income_total``,
        ``expenses_total``.
        Otherwise: JSON with ``month``, ``year``, ``income``, ``expenses``,
        ``balance``, ``reservas``, ``top_category``.
    """
    period = request.args.get("period") or None
    if period == "all":
        return jsonify(database.get_all_time_summary())

    bank    = request.args.get("bank") or None
    account = request.args.get("account") or None
    now = datetime.now()
    month = request.args.get("month", type=int) or now.month
    year  = request.args.get("year",  type=int) or now.year
    if account:
        summary = database.get_account_monthly_summary(account, year, month)
        reservas_total = 0.0
    else:
        summary = database.get_monthly_summary(year, month, bank=bank)
        investments = database.get_all_investments()
        if bank:
            investments = [inv for inv in investments if inv["bank"] == bank]
        reservas_total = sum(inv["current_balance"] for inv in investments)
    return jsonify({
        "month":         month,
        "year":          year,
        "income":        summary["income"],
        "salary_income": summary.get("salary_income", 0.0),
        "other_income":  summary.get("other_income", 0.0),
        "expenses":      summary["expenses"],
        "balance":       summary["income"] - summary["expenses"],
        "reservas":      reservas_total,
        "top_category":  summary.get("top_category"),
    })


@app.route("/api/accounts")
def api_accounts() -> Response:
    """Return all accounts with their current balances.

    Query params:
        bank: ``nubank`` | ``inter`` (optional)

    Returns:
        JSON array of ``{id, name, type, bank, balance}`` objects.
    """
    bank = request.args.get("bank") or None
    accounts = database.get_all_accounts_with_balance()
    if bank:
        accounts = [a for a in accounts if a["bank"] == bank]
    return jsonify([
        {
            "id":                 a["id"],
            "name":               a["name"],
            "type":               a["type"],
            "bank":               a["bank"],
            "balance":            a["balance"],
            "gross_balance":      a["gross_balance"],
            "investment_balance": a["investment_balance"],
        }
        for a in accounts
    ])


@app.route("/api/investments")
def api_investments() -> Response:
    """Return all investments with their current balances.

    Query params:
        bank: ``nubank`` | ``inter`` (optional)

    Returns:
        JSON array of ``{name, balance, type, bank}`` objects.
    """
    bank = request.args.get("bank") or None
    investments = database.get_all_investments()
    if bank:
        investments = [inv for inv in investments if inv["bank"] == bank]
    return jsonify([
        {"id": inv["id"], "name": inv["name"], "balance": inv["current_balance"],
         "type": inv["type"], "bank": inv["bank"]}
        for inv in investments
    ])


@app.route("/api/investments/<int:inv_id>/balance", methods=["PATCH"])
def api_patch_investment_balance(inv_id: int) -> Response:
    """Update the current balance of an investment to its real-world value.

    Body JSON: ``{"balance": float}``
    """
    body = request.get_json(silent=True) or {}
    new_balance = body.get("balance")
    if new_balance is None or not isinstance(new_balance, (int, float)):
        return jsonify({"error": "Campo 'balance' obrigatório (número)."}), 400
    database.update_investment_balance(inv_id, float(new_balance))
    return jsonify({"ok": True, "id": inv_id, "balance": float(new_balance)})


@app.route("/api/monthly")
def api_monthly() -> Response:
    """Return the last 6 months of income vs expenses history.

    Query params:
        bank:    ``nubank`` | ``inter`` (optional)
        account: account id (optional — takes precedence over bank)

    Returns:
        JSON array of ``{label, income, expenses}`` objects, oldest first.
    """
    bank    = request.args.get("bank") or None
    account = request.args.get("account") or None
    months  = request.args.get("months", default=6, type=int)
    if account:
        return jsonify(database.get_monthly_history_by_account(account, months=months))
    return jsonify(database.get_monthly_history(months=months, bank=bank))


@app.route("/api/categories")
def api_categories() -> Response:
    """Return expenses grouped by category (current month or all-time).

    Query params:
        period:  ``"all"`` — returns totals across entire history
        bank:    ``nubank`` | ``inter`` (optional, ignored when period=all)
        account: account id (optional, ignored when period=all)
        month:   int (optional)
        year:    int (optional)

    Returns:
        JSON array of ``{name, total}`` objects, sorted by total descending.
    """
    period = request.args.get("period") or None
    if period == "all":
        return jsonify(database.get_all_time_categories())

    bank    = request.args.get("bank") or None
    account = request.args.get("account") or None
    now = datetime.now()
    month = request.args.get("month", type=int) or now.month
    year  = request.args.get("year",  type=int) or now.year
    if account:
        return jsonify(database.get_expenses_by_category_account(account, year, month))
    return jsonify(database.get_expenses_by_category(year, month, bank=bank))


@app.route("/api/expenses-by-method")
def api_expenses_by_method() -> Response:
    """Return current month expenses grouped by bank and payment method.

    Query params:
        bank: ``nubank`` | ``inter`` (optional)

    Returns:
        JSON array of ``{bank, method, total}`` objects.
    """
    bank = request.args.get("bank") or None
    now = datetime.now()
    return jsonify(database.get_expenses_by_method(now.year, now.month, bank=bank))


@app.route("/api/faturas")
def api_faturas() -> Response:
    """Return credit card billing info for the current billing cycle.

    Query params:
        bank: ``nubank`` | ``inter`` (optional — omit for both cards)

    Returns:
        JSON array of billing objects, each with ``label``, ``total``,
        ``due_date``, ``days_until_due``, ``cycle_start``, ``cycle_end``.
    """
    bank = request.args.get("bank") or None
    if bank == "nubank":
        cards = [("nu-cc", "Nubank Crédito")]
    elif bank == "inter":
        cards = [("inter-cc", "Inter Crédito")]
    else:
        cards = [("nu-cc", "Nubank Crédito"), ("inter-cc", "Inter Crédito")]
    result = []
    for account_id, label in cards:
        info = database.get_credit_card_billing_info(account_id)
        result.append({"accountId": account_id, "label": label, **info})
    return jsonify(result)


_VALID_ACCOUNTS = {"nu-cc", "nu-db", "inter-cc", "inter-db"}


@app.route("/api/account/<account_id>")
def api_account_detail(account_id: str) -> Response:
    """Return all details for a single account in one call.

    Args:
        account_id: One of ``nu-cc``, ``nu-db``, ``inter-cc``, ``inter-db``.

    Returns:
        JSON with ``id``, ``name``, ``type``, ``bank``, ``balance``,
        ``monthly_summary``, and (for credit accounts) ``billing_info``.
    """
    if account_id not in _VALID_ACCOUNTS:
        return jsonify({"error": "unknown account"}), 400
    accounts = database.get_all_accounts_with_balance()
    acc = next((a for a in accounts if a["id"] == account_id), None)
    if acc is None:
        return jsonify({"error": "account not found"}), 404
    now = datetime.now()
    summary = database.get_account_monthly_summary(account_id, now.year, now.month)
    result: dict = {
        "id":              acc["id"],
        "name":            acc["name"],
        "type":            acc["type"],
        "bank":            acc["bank"],
        "balance":         acc["balance"],
        "monthly_summary": summary,
    }
    if acc["type"] == "credit":
        result["billing_info"] = database.get_credit_card_billing_info(account_id)
    return jsonify(result)


@app.route("/api/account-history")
def api_account_history() -> Response:
    """Return the full month-by-month breakdown for a single account.

    Query params:
        account: account id (required)

    Returns:
        JSON array ordered newest first, each with
        ``year``, ``month``, ``label``, ``income``, ``expenses``, ``net``.
    """
    account_id = request.args.get("account") or None
    if not account_id or account_id not in _VALID_ACCOUNTS:
        return jsonify({"error": "valid ?account= required"}), 400
    return jsonify(database.get_full_monthly_history_by_account(account_id))


@app.route("/api/expense-categories")
def api_expense_categories() -> Response:
    """Return all expense categories for the inline category editor.

    Returns:
        JSON array of ``{id, name}`` objects ordered by id.
    """
    return jsonify(database.get_expense_categories())


@app.route("/api/transactions/<int:transaction_id>", methods=["PATCH"])
def api_patch_transaction(transaction_id: int) -> Response:
    """Update the category of a single transaction.

    Request body (JSON):
        category_id: integer — primary key of the target category.

    Returns:
        ``{"ok": true}`` on success, error JSON on failure.
    """
    data = request.get_json(silent=True) or {}
    category_id = data.get("category_id")
    if not isinstance(category_id, int):
        return jsonify({"error": "category_id must be an integer"}), 400
    database.update_transaction_category(transaction_id, category_id)
    return jsonify({"ok": True})


@app.route("/api/transactions")
def api_transactions() -> Response:
    """Return recent transactions for a given account.

    Query params:
        account: account id (required)
        limit:   max rows to return, capped at 50 (default 20)

    Returns:
        JSON array of ``{date, description, category, amount, flow}`` objects.
    """
    account_id = request.args.get("account") or None
    if not account_id or account_id not in _VALID_ACCOUNTS:
        return jsonify({"error": "valid ?account= required"}), 400
    try:
        limit = min(int(request.args.get("limit", 100)), 200)
    except ValueError:
        limit = 100
    try:
        month = int(request.args.get("month")) if request.args.get("month") else None
        year  = int(request.args.get("year"))  if request.args.get("year")  else None
    except ValueError:
        month, year = None, None
    return jsonify(database.get_recent_transactions(account_id, limit, month, year))


@app.route("/api/daily-spend")
def api_daily_spend() -> Response:
    """Return daily expense totals.

    Query params:
        month: int — if provided with year, returns all days of that month
        year:  int
    Returns:
        JSON array of ``{date, day, value}`` objects ordered oldest first.
    """
    month = request.args.get("month", type=int)
    year  = request.args.get("year",  type=int)
    return jsonify(database.get_daily_spend(year=year, month=month))


@app.route("/api/recent-activity")
def api_recent_activity() -> Response:
    """Return the most recent transactions across all accounts.

    Returns:
        JSON array of ``{id, date, description, category, amount, flow, account_id, bank}``.
    """
    return jsonify(database.get_recent_activity(20))


@app.route("/api/month-transactions")
def api_month_transactions() -> Response:
    """Return all non-transfer transactions for a given month across all accounts.

    Query params:
        month: int (1–12)
        year:  int

    Returns:
        JSON array of ``{id, date, description, amount, flow, account_id, bank, category, category_id}``.
    """
    month = request.args.get("month", type=int)
    year  = request.args.get("year",  type=int)
    if not month or not year:
        return jsonify({"error": "month and year required"}), 400
    return jsonify(database.get_month_transactions(month, year))


@app.route("/api/search")
def api_search() -> Response:
    """Full-text transaction search across the entire history.

    Query params:
        q: Search string (minimum 2 characters).

    Returns:
        JSON array of ``{id, date, description, amount, flow, account_id, bank, category}``.
    """
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    return jsonify(database.search_transactions(q, limit=30))


@app.route("/api/patrimonio-history")
def api_patrimonio_history() -> Response:
    """Return approximate monthly net worth for the last 12 months.

    Returns:
        JSON array of ``{label, value}`` objects ordered oldest first.
    """
    return jsonify(database.get_patrimonio_history(12))


@app.route("/api/budgets")
def api_budgets() -> Response:
    """Return all budget limits joined with category names.

    Returns:
        JSON array of ``{id, category_id, category_name, amount_limit}`` objects.
    """
    return jsonify(database.get_budgets())


@app.route("/api/budgets/<int:budget_id>", methods=["PATCH"])
def api_patch_budget(budget_id: int) -> Response:
    """Update the spending limit for a budget row.

    Request body (JSON):
        amount_limit: float — new monthly limit in BRL.
        category_id:  int   — category to update (optional, used if budget_id not found).

    Returns:
        ``{"ok": true}`` on success.
    """
    data = request.get_json(silent=True) or {}
    amount_limit = data.get("amount_limit")
    category_id = data.get("category_id")
    if not isinstance(amount_limit, (int, float)) or not isinstance(category_id, int):
        return jsonify({"error": "amount_limit (number) and category_id (int) required"}), 400
    database.upsert_budget(category_id, float(amount_limit))
    return jsonify({"ok": True})


@app.route("/api/transactions", methods=["POST"])
def api_post_transaction() -> Response:
    """Insert an expense transaction from the web quick-entry form.

    Request body (JSON):
        account_id:    str   — e.g. "nu-cc"
        method:        str   — "credit" | "pix" | "ted"
        amount:        float — positive value
        description:   str
        date:          str   — "YYYY-MM-DD"
        category_id:   int
        installments:  int   — default 1

    Returns:
        ``{"ok": true, "id": int}`` on success.
    """
    data = request.get_json(silent=True) or {}
    account_id  = data.get("account_id", "")
    method      = data.get("method", "")
    amount      = data.get("amount")
    description = data.get("description", "").strip()
    date_str    = data.get("date", "")
    category_id = data.get("category_id")
    installments = int(data.get("installments", 1))

    if account_id not in _VALID_ACCOUNTS:
        return jsonify({"error": "invalid account_id"}), 400
    if not isinstance(amount, (int, float)) or amount <= 0:
        return jsonify({"error": "amount must be a positive number"}), 400
    if not description:
        return jsonify({"error": "description required"}), 400
    if not date_str:
        return jsonify({"error": "date required"}), 400

    tx_id = database.insert_transaction(
        date=date_str,
        flow="expense",
        method=method,
        account_id=account_id,
        amount=float(amount),
        installments=installments,
        description=description,
        category_id=category_id,
    )
    return jsonify({"ok": True, "id": tx_id})


@app.route("/api/incomes", methods=["POST"])
def api_post_income() -> Response:
    """Insert an income or transfer transaction from the web quick-entry form.

    Request body (JSON) for income:
        type:        str   — "salary" | "freelance" | "pix" | "other"
        account_id:  str   — e.g. "nu-db"
        amount:      float
        description: str
        date:        str   — "YYYY-MM-DD"

    Request body (JSON) for transfer:
        type:        "transfer"
        from_account: str
        to_account:   str
        amount:       float
        date:         str

    Returns:
        ``{"ok": true, "id": int}`` on success.
    """
    data = request.get_json(silent=True) or {}
    tx_type  = data.get("type", "")
    amount   = data.get("amount")
    date_str = data.get("date", "")

    if not isinstance(amount, (int, float)) or amount <= 0:
        return jsonify({"error": "amount must be a positive number"}), 400
    if not date_str:
        return jsonify({"error": "date required"}), 400

    METHOD_MAP = {
        "salary": "salary", "freelance": "freelance",
        "pix": "pix_received", "other": "other",
    }

    if tx_type == "transfer":
        from_acc = data.get("from_account", "")
        to_acc   = data.get("to_account", "")
        if from_acc not in _VALID_ACCOUNTS or to_acc not in _VALID_ACCOUNTS:
            return jsonify({"error": "invalid account"}), 400
        description = f"Transferência {from_acc} → {to_acc}"
        tx_id = database.insert_transaction(
            date=date_str, flow="expense", method="transfer",
            account_id=from_acc, amount=float(amount), installments=1,
            description=description, category_id=None,
            dest_account_id=to_acc,
        )
        return jsonify({"ok": True, "id": tx_id})

    account_id  = data.get("account_id", "")
    description = data.get("description", "").strip() or tx_type
    method      = METHOD_MAP.get(tx_type, "other")
    is_revenue  = 1 if data.get("is_revenue") else 0

    if account_id not in _VALID_ACCOUNTS:
        return jsonify({"error": "invalid account_id"}), 400

    tx_id = database.insert_transaction(
        date=date_str, flow="income", method=method,
        account_id=account_id, amount=float(amount), installments=1,
        description=description, category_id=None,
        is_revenue=is_revenue,
    )
    return jsonify({"ok": True, "id": tx_id})


@app.route("/api/investment-movements", methods=["GET"])
def api_get_investment_movements() -> Response:
    """Return investment movements for a given month/year."""
    month = request.args.get("month", type=int)
    year  = request.args.get("year",  type=int)
    if not month or not year:
        return jsonify([])
    return jsonify(database.get_investment_movements_for_month(month, year))


@app.route("/api/investment-movements", methods=["POST"])
def api_post_investment_movement() -> Response:
    """Insert an investment deposit or withdrawal from the web quick-entry form.

    Request body (JSON):
        investment_name: str   — "Caixinha Nubank" | "Tesouro Direto" | "Porquinho Inter"
        operation:       str   — "deposit" | "withdrawal"
        amount:          float
        date:            str   — "YYYY-MM-DD"
        description:     str   — optional

    Returns:
        ``{"ok": true, "id": int}`` on success.
    """
    data = request.get_json(silent=True) or {}
    inv_name    = data.get("investment_name", "").strip()
    operation   = data.get("operation", "")
    amount      = data.get("amount")
    date_str    = data.get("date", "")
    description = data.get("description", "").strip() or None

    if not isinstance(amount, (int, float)) or amount <= 0:
        return jsonify({"error": "amount must be a positive number"}), 400
    if operation not in ("deposit", "withdrawal"):
        return jsonify({"error": "operation must be deposit or withdrawal"}), 400
    if not date_str:
        return jsonify({"error": "date required"}), 400

    investment = database.get_investment_by_name(inv_name)
    if investment is None:
        return jsonify({"error": f"investment '{inv_name}' not found"}), 400

    mv_id = database.insert_investment_movement(
        date=date_str,
        investment_id=investment["id"],
        operation=operation,
        amount=float(amount),
        description=description,
    )
    return jsonify({"ok": True, "id": mv_id})


@app.route("/api/expense-categories-full")
def api_expense_categories_full() -> Response:
    """Return all expense categories with their transaction count."""
    return jsonify(database.get_all_expense_categories())


@app.route("/api/categories", methods=["POST"])
def api_create_category() -> Response:
    """Create a new category.

    Body: ``{name: str, flow: "expense"|"income"}``
    """
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    flow = body.get("flow", "expense")
    if not name:
        return jsonify({"error": "name required"}), 400
    if flow not in ("expense", "income"):
        return jsonify({"error": "flow must be expense or income"}), 400
    try:
        new_id = database.create_category(name, flow)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    _events.notify()
    return jsonify({"id": new_id, "name": name, "flow": flow}), 201


@app.route("/api/categories/<int:category_id>", methods=["DELETE"])
def api_delete_category(category_id: int) -> Response:
    """Delete a category, reassigning its transactions to another.

    Body: ``{reassign_to_id: int}``
    """
    body = request.get_json(silent=True) or {}
    reassign_to_id = body.get("reassign_to_id")
    if reassign_to_id is None:
        return jsonify({"error": "reassign_to_id required"}), 400
    try:
        affected = database.delete_category(category_id, int(reassign_to_id))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    _events.notify()
    return jsonify({"ok": True, "transactions_reassigned": affected})


@app.route("/api/transactions/<int:transaction_id>", methods=["DELETE"])
def api_delete_transaction(transaction_id: int) -> Response:
    """Delete a transaction by ID.

    Returns:
        ``{"ok": true}`` on success, error JSON on failure (404 or 409).
    """
    try:
        deleted = database.delete_transaction(transaction_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    if not deleted:
        return jsonify({"error": "Transação não encontrada."}), 404
    _events.notify()
    return jsonify({"ok": True})


def _wrap_cc_rows(rows: list[dict]) -> list[dict]:
    """Add ``_type: 'transaction'`` to CC parser rows that lack it."""
    for row in rows:
        row.setdefault("_type", "transaction")
        row.setdefault("is_revenue", 0)
    return rows


_PARSER_MAP = {
    "nu-cc":    lambda content: _wrap_cc_rows(nubank_cc.parse(content)),
    "inter-cc": lambda content: _wrap_cc_rows(inter_cc.parse(content, adjust_installment_dates=False)),
    "nu-db":    lambda content: nubank_extrato.parse(content),
    "inter-db": lambda content: inter_extrato.parse(content),
}


@app.route("/api/import-csv/preview", methods=["POST"])
def api_import_csv_preview() -> Response:
    """Parse an uploaded CSV and return rows enriched with duplicate flags.

    Request (multipart/form-data):
        file:       The CSV file.
        account_id: ``nu-cc`` | ``inter-cc`` | ``nu-db`` | ``inter-db``

    Returns:
        JSON ``{rows: [...], error: null}`` on success, or ``{rows: null, error: str}``.
        Each row dict includes the parsed fields plus:
            - ``row_index``:           int
            - ``is_duplicate``:        bool
            - ``suggested_category_id``: int | null
            - ``include``:             bool (false for duplicates by default)
    """
    account_id = request.form.get("account_id", "")
    if account_id not in _VALID_ACCOUNTS:
        return jsonify({"rows": None, "error": "account_id inválido"}), 400

    f = request.files.get("file")
    if not f:
        return jsonify({"rows": None, "error": "arquivo não enviado"}), 400

    parser = _PARSER_MAP.get(account_id)
    if not parser:
        return jsonify({"rows": None, "error": "parser não disponível para esta conta"}), 400

    try:
        content = f.read().decode("utf-8", errors="replace")
        parsed_rows = parser(content)
    except Exception as exc:
        _logger.warning("CSV preview parse error account=%s: %s", account_id, exc)
        return jsonify({"rows": None, "error": f"Erro ao processar CSV: {exc}"}), 422

    result = []
    for idx, row in enumerate(parsed_rows):
        row_out = dict(row)
        row_out["row_index"] = idx

        # Duplicate detection (only for insertable rows)
        if row["_type"] in ("transaction", "transfer"):
            dup = database.transaction_exists(
                row["date"], row["amount"], row["description"],
                row.get("account_id", account_id),
            )
        elif row["_type"] == "investment_movement":
            dup = _investment_movement_exists_db(
                row["date"], row["investment_name"], row["operation"], row["amount"]
            )
        else:
            dup = False

        row_out["is_duplicate"] = dup
        row_out["include"] = not dup

        # Category suggestion for expense transactions
        if row["_type"] == "transaction" and row.get("flow") == "expense":
            row_out["suggested_category_id"] = database.suggest_category(row["description"])
            if row_out.get("category_id") is None:
                row_out["category_id"] = row_out["suggested_category_id"]
        else:
            row_out.setdefault("category_id", None)
            row_out["suggested_category_id"] = None

        result.append(row_out)

    return jsonify({"rows": result, "error": None})


def _investment_movement_exists_db(date: str, investment_name: str, operation: str, amount: float) -> bool:
    """Check if an identical investment movement already exists."""
    inv = database.get_investment_by_name(investment_name)
    if not inv:
        return False
    with database._connect() as conn:  # noqa: SLF001
        row = conn.execute(
            """SELECT 1 FROM investment_movements
               WHERE date=? AND investment_id=? AND operation=? AND amount=?""",
            (date, inv["id"], operation, amount),
        ).fetchone()
    return row is not None


@app.route("/api/import-csv/confirm", methods=["POST"])
def api_import_csv_confirm() -> Response:
    """Save the reviewed CSV rows to the database.

    Request body (JSON):
        rows: list of row objects from the preview response, each with:
            ``include`` (bool) and optionally ``category_id`` (int) overridden
            by the user.

    Returns:
        JSON ``{imported: int, skipped: int, errors: list[str]}``.
    """
    data = request.get_json(silent=True) or {}
    rows = data.get("rows", [])
    if not isinstance(rows, list):
        return jsonify({"error": "rows must be a list"}), 400

    imported = 0
    skipped = 0
    errors: list[str] = []

    for row in rows:
        if not row.get("include"):
            skipped += 1
            continue

        try:
            rtype = row.get("_type")

            if rtype == "investment_movement":
                inv = database.get_investment_by_name(row["investment_name"])
                if not inv:
                    inv_id = database.upsert_investment(row["investment_name"], "savings",
                                                        "nubank" if "Nubank" in row["investment_name"] else "inter")
                else:
                    inv_id = inv["id"]
                database.insert_investment_movement(
                    date=row["date"],
                    investment_id=inv_id,
                    operation=row["operation"],
                    amount=float(row["amount"]),
                    description=row.get("description"),
                )
                imported += 1
                continue

            # transaction or transfer
            flow            = row.get("flow", "expense")
            method          = row.get("method", "pix")
            account_id      = row.get("account_id")
            amount          = float(row["amount"])
            description     = row.get("description", "")
            dest_account_id = row.get("dest_account_id")
            counterpart     = row.get("counterpart")
            is_revenue      = int(row.get("is_revenue", 0))
            category_id     = row.get("category_id")

            # For expense transactions, ensure a category exists
            if flow == "expense" and dest_account_id is None and category_id is None:
                # Default to "Outro"
                cats = database.get_categories("expense")
                outro = next((c for c in cats if c["name"] == "Outro"), None)
                category_id = outro["id"] if outro else None

            database.insert_transaction(
                date=row["date"],
                flow=flow,
                method=method,
                account_id=account_id,
                amount=amount,
                description=description,
                installments=int(row.get("installments", 1)),
                category_id=category_id,
                dest_account_id=dest_account_id,
                counterpart=counterpart,
                is_revenue=is_revenue,
            )
            imported += 1

        except Exception as exc:
            _logger.warning("CSV confirm row error: %s — %s", row.get("description", "?"), exc)
            errors.append(f"{row.get('description', '?')}: {exc}")

    return jsonify({"imported": imported, "skipped": skipped, "errors": errors})


def start_dashboard() -> None:
    """Start the Waitress WSGI server in a daemon thread.

    The thread is named ``"dashboard"`` and runs until the process exits.
    Uses 32 threads: each open SSE connection holds one thread permanently,
    and a full page load fires ~10 API requests in parallel — 32 threads
    keeps the queue empty under normal single-user load.
    """
    thread = threading.Thread(
        target=lambda: serve(app, host="127.0.0.1", port=DASHBOARD_PORT, threads=32),
        daemon=True,
        name="dashboard",
    )
    thread.start()
    _logger.info("Dashboard available at http://127.0.0.1:%d", DASHBOARD_PORT)
