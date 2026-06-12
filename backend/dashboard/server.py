"""Flask dashboard server — analytics API + quick-entry writes.

Read endpoints query SQLite via :mod:`core.database` and return JSON.
Write endpoints (POST /api/transactions, POST /api/incomes, POST /api/investment-movements)
insert records via :mod:`core.database`, triggering SSE notifications.

A real-time SSE endpoint (``/api/events``) notifies connected browsers whenever
the database is written to.

The server is started via :func:`run_dashboard`, which blocks on Waitress
(production WSGI) in the foreground — the process is meant to live under a
systemd user service (``Restart=on-failure``).
"""
import logging
import queue
from datetime import date, datetime

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from waitress import serve

import config
from core import backup
from core import database
from core import ingestion
from core.ingestion import b3
from core import events as _events
from core.ingestion.adapters import SourceMismatch
_logger = logging.getLogger(__name__)

DASHBOARD_PORT = config.DASHBOARD_PORT
FRONTEND_DIR = config.FRONTEND_DIR

# Largest upload accepted for file imports. Bank/broker exports are a few KB;
# 8 MB is generous headroom while bounding memory and rejecting abuse.
_MAX_UPLOAD_BYTES = 8 * 1024 * 1024

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = _MAX_UPLOAD_BYTES


# Hosts this unauthenticated API will answer to. The API exposes the user's full
# financial history with no auth (single-user localhost design), so we defend the
# two browser-reachable vectors: DNS-rebinding (reject foreign Host headers) and
# cross-site writes (reject foreign Origin on state-changing methods).
_ALLOWED_HOSTS = {
    "127.0.0.1", "localhost",
    f"127.0.0.1:{DASHBOARD_PORT}", f"localhost:{DASHBOARD_PORT}",
}


@app.before_request
def _guard_host_origin():
    """Reject DNS-rebinding (foreign Host) and cross-site writes (foreign Origin).

    The API has no auth — this guard plus the 127.0.0.1 bind IS the security
    boundary for browser-reachable attacks. Returns None to let the request pass.
    """
    from urllib.parse import urlparse
    if request.host not in _ALLOWED_HOSTS:
        return jsonify({"error": "invalid host"}), 403
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("Origin")
        if origin and urlparse(origin).netloc not in _ALLOWED_HOSTS:
            return jsonify({"error": "cross-origin request blocked"}), 403
    return None


@app.errorhandler(413)
def _too_large(_exc) -> Response:
    """Return JSON (not HTML) when an upload exceeds MAX_CONTENT_LENGTH."""
    return jsonify({"error": "Arquivo grande demais (máx. 8 MB)."}), 413


@app.after_request
def _add_security_headers(response: Response) -> Response:
    """Attach CSP/no-sniff/no-frame headers; ``/api/*`` responses are never cached."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    # Financial data must not linger in the browser disk cache. Static assets
    # (JS/CSS/fonts) stay cacheable.
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    return response


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
    why the server is configured with 32 threads.

    Returns:
        A streaming :class:`flask.Response` with MIME type ``text/event-stream``.
    """
    def generate():
        """Yield SSE frames forever; unsubscribe from the event bus on disconnect."""
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

@app.route("/api/investment-evolution")
def api_investment_evolution() -> Response:
    """Return historical investment deposits vs withdrawals for the last 12 months.

    Returns:
        JSON array of ``{label, month, year, deposit, withdrawal}`` objects ordered oldest first.
    """
    return jsonify(database.get_investment_evolution(12))


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
        present: ``1`` to return only months that have transactions (real data
                 range, no zero-filled window). Used by the Histórico month strip.

    Returns:
        JSON array of ``{label, month, year, income, expenses}`` objects, oldest first.
    """
    bank    = request.args.get("bank") or None
    account = request.args.get("account") or None
    months  = request.args.get("months", default=6, type=int)
    present = request.args.get("present")
    if present and not account:
        return jsonify(database.get_monthly_history_present(bank=bank))
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


_VALID_CARDS = {"nu-cc", "inter-cc"}


@app.route("/api/account-faturas")
def api_account_faturas() -> Response:
    """Return the list of faturas (one per vencimento) for a credit card, newest first.

    Query params:
        account: a credit-card id (``nu-cc`` | ``inter-cc``).

    Powers the Histórico "modo-fatura" picker (browse by vencimento, not calendar month).
    """
    account = request.args.get("account") or ""
    if account not in _VALID_CARDS:
        return jsonify({"error": "account must be a credit card"}), 400
    return jsonify(database.get_account_faturas(account))


@app.route("/api/fatura")
def api_fatura() -> Response:
    """Return the editable view of one fatura: its purchases plus addable candidates.

    Query params:
        account: a credit-card id (``nu-cc`` | ``inter-cc``).
        due:     the fatura vencimento, ``YYYY-MM-DD``.

    Returns ``{account, due, total, count, members, candidates}``. ``members`` are the
    purchases tagged with this ``fatura_due``; ``candidates`` are untagged card purchases
    in a window around the bill that the user may add (toggling writes ``fatura_due`` via
    ``PATCH /api/transactions/<id>``).
    """
    account = request.args.get("account") or ""
    due = request.args.get("due") or ""
    if account not in _VALID_CARDS:
        return jsonify({"error": "account must be a credit card"}), 400
    try:
        datetime.strptime(due, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "due must be YYYY-MM-DD"}), 400
    return jsonify(database.get_fatura_detail(account, due))


_VALID_ACCOUNTS = {"nu-cc", "nu-db", "inter-cc", "inter-db"}
# Payment methods accepted by the expense quick-entry form.
_VALID_EXPENSE_METHODS = {"credit", "pix", "ted", "debit"}
# Income subtypes accepted by the income quick-entry form (mapped to a stored method).
_VALID_INCOME_TYPES = {"salary", "freelance", "pix", "other"}


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
    """Update editable fields on a single transaction.

    Request body (JSON) — any combination of:
        category_id:    int    — primary key of the target category.
        display_name:   str|null — friendly display name (null clears it).
        is_third_party: 0|1   — exclude from personal finance summaries.
        fatura_due:     str ``YYYY-MM-DD`` | null — credit-card fatura membership.
                        Only valid on a card purchase leg (``*-cc`` account,
                        ``dest_account_id IS NULL``, ``flow='expense'``); null removes
                        the purchase from its fatura. Never tag a fatura-total/payment
                        row — that would double-count.

    Returns:
        ``{"ok": true}`` on success, error JSON on failure.
    """
    data = request.get_json(silent=True) or {}
    fields: dict = {}
    if "category_id" in data:
        if not isinstance(data["category_id"], int) or isinstance(data["category_id"], bool):
            return jsonify({"error": "category_id must be an integer"}), 400
        # Validate FK up front: with foreign_keys=ON an unknown id would raise an
        # unhandled IntegrityError (500). Mirrors the staging-edit endpoint.
        if database.get_category(data["category_id"]) is None:
            return jsonify({"error": "category_id not found"}), 400
        fields["category_id"] = data["category_id"]
    if "display_name" in data:
        v = data["display_name"]
        if v is not None and not isinstance(v, str):
            return jsonify({"error": "display_name must be a string or null"}), 400
        fields["display_name"] = v.strip() if isinstance(v, str) else None
    if "is_third_party" in data:
        if data["is_third_party"] not in (0, 1, True, False):
            return jsonify({"error": "is_third_party must be 0 or 1"}), 400
        fields["is_third_party"] = int(bool(data["is_third_party"]))
    if "fatura_due" in data:
        v = data["fatura_due"]
        if v is not None:
            if not isinstance(v, str):
                return jsonify({"error": "fatura_due must be YYYY-MM-DD or null"}), 400
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                return jsonify({"error": "fatura_due must be YYYY-MM-DD or null"}), 400
        # Guard the invariant: fatura_due lives only on a card *purchase* leg. A
        # checking row, a fatura-total/payment row (dest set), or a non-expense can
        # never carry it — otherwise the bill total would double-count.
        tx = database.get_transaction(transaction_id)
        if tx is None:
            return jsonify({"error": "transaction not found"}), 404
        if not (str(tx["account_id"]).endswith("-cc")
                and tx["dest_account_id"] is None
                and tx["flow"] == "expense"):
            return jsonify({"error": "fatura_due only valid on a credit-card purchase"}), 400
        fields["fatura_due"] = v
    if not fields:
        return jsonify({"error": "no valid fields provided"}), 400
    database.update_transaction_fields(transaction_id, **fields)
    _events.notify()
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
    m, y = request.args.get("month"), request.args.get("year")
    try:
        month = int(m) if m else None
        year  = int(y) if y else None
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


@app.route("/api/pix-top")
def api_pix_top() -> Response:
    """Return top PIX expense destinations for a given month, grouped by display_name/description.

    Query params:
        month: int (1–12, defaults to current month)
        year:  int (defaults to current year)

    Returns:
        JSON array of ``{label, count, total}`` ordered by total descending.
    """
    now = date.today()
    month = max(1, min(12, request.args.get("month", type=int) or now.month))
    year  = max(2000, request.args.get("year",  type=int) or now.year)
    return jsonify(database.get_top_pix_descriptions(month, year))


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


@app.route("/api/cashflow-statement")
def api_cashflow_statement() -> Response:
    """Return the monthly cash flow statement: income, expenses, investments, free balance.

    Query params:
        month: int (1–12, defaults to current month)
        year:  int (defaults to current year)

    Returns:
        JSON with ``month``, ``year``, ``label``, ``income_total``, ``expense_total``,
        ``expense_by_source``, ``investment_net``, ``free_balance``, ``cc_by_category``.
        Always returns 200 — zeros when no data exist for the requested period.
    """
    now   = datetime.now()
    month = max(1, min(12, request.args.get("month", type=int) or now.month))
    year  = max(2000, request.args.get("year",  type=int) or now.year)
    return jsonify(database.get_cashflow_statement(month, year))


@app.route("/api/available")
def api_available() -> Response:
    """Return real liquidity: checking cash minus open card bills ("disponível pra gastar").

    Returns:
        JSON with ``checking_total``, ``faturas_total``, ``available``.
        available = checking_total − faturas_total.
    """
    return jsonify(database.get_available_to_spend())


@app.route("/api/patrimonio-history")
def api_patrimonio_history() -> Response:
    """Return approximate monthly net worth for the last 12 months.

    Returns:
        JSON array of ``{label, value}`` objects ordered oldest first.
    """
    return jsonify(database.get_patrimonio_history(12))


@app.route("/api/liquidity-history")
def api_liquidity_history() -> Response:
    """Return approximate monthly liquidity (checking − card spend) for the last 12 months.

    Returns:
        JSON array of ``{label, value}`` objects ordered oldest first. Powers the
        hero "Disponível pra gastar" trend sparkline.
    """
    return jsonify(database.get_liquidity_history(12))


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
    if method not in _VALID_EXPENSE_METHODS:
        return jsonify({"error": "invalid method"}), 400
    if not isinstance(amount, (int, float)) or amount <= 0:
        return jsonify({"error": "amount must be a positive number"}), 400
    if not description:
        return jsonify({"error": "description required"}), 400
    if not date_str:
        return jsonify({"error": "date required"}), 400
    if installments < 1 or installments > 99:
        return jsonify({"error": "installments must be between 1 and 99"}), 400

    tx_id = database.insert_expense(
        date=date_str,
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
    if tx_type not in _VALID_INCOME_TYPES:
        return jsonify({"error": "invalid type"}), 400
    description = data.get("description", "").strip() or tx_type
    method      = METHOD_MAP.get(tx_type, "other")
    # A real income is revenue by default — it must count in income summaries
    # (which filter is_revenue=1). Self-transfers go through the transfer branch
    # above, not here. Only an explicit is_revenue=0 opts a row out.
    is_revenue  = 0 if data.get("is_revenue") in (0, False) else 1

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
    """Return investment movements for a given month/year or specific investment."""
    month = request.args.get("month", type=int)
    year  = request.args.get("year",  type=int)
    inv_id = request.args.get("investment_id", type=str)
    
    if inv_id:
        return jsonify(database.get_investment_movements_by_id(inv_id))
        
    if not month or not year:
        return jsonify(database.get_recent_investment_movements(limit=100))
    return jsonify(database.get_investment_movements_for_month(month, year))


@app.route("/api/investment-movements", methods=["POST"])
def api_post_investment_movement() -> Response:
    """Register an investment application/withdrawal from the web quick-entry form.

    Recorded as a checking-account transfer leg (NOT an investment_movements row),
    so it stays consistent across every screen — see
    ``crud.register_investment_transfer``.

    Request body (JSON):
        investment_name: str   — e.g. "Tesouro IPCA+ 2029" | "Caixinha Nubank"
        operation:       str   — "deposit" | "withdrawal"
        amount:          float
        date:            str   — "YYYY-MM-DD"

    Returns:
        ``{"ok": true, "id": int}`` (id = the created transaction) on success.
    """
    data = request.get_json(silent=True) or {}
    inv_name    = data.get("investment_name", "").strip()
    operation   = data.get("operation", "")
    amount      = data.get("amount")
    date_str    = data.get("date", "")

    if not isinstance(amount, (int, float)) or amount <= 0:
        return jsonify({"error": "amount must be a positive number"}), 400
    if operation not in ("deposit", "withdrawal"):
        return jsonify({"error": "operation must be deposit or withdrawal"}), 400
    if not date_str:
        return jsonify({"error": "date required"}), 400

    investment = database.get_investment_by_name(inv_name)
    if investment is None:
        return jsonify({"error": f"investment '{inv_name}' not found"}), 400

    try:
        tx_id = database.register_investment_transfer(
            investment_id=investment["id"],
            bank=investment["bank"],
            operation=operation,
            amount=float(amount),
            date=date_str,
            name=investment["name"],
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "id": tx_id})


@app.route("/api/import/b3/preview", methods=["POST"])
def api_import_b3_preview() -> Response:
    """Parse a B3 XLSX report WITHOUT writing — for review before confirm.

    Multipart form: ``file`` (the .xlsx). Returns ``{positions, created, updated,
    total}`` where each position is tagged ``status`` (``"new"`` if its name is not
    yet an investment, else ``"update"``). Nothing is persisted.
    """
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"error": "Nenhum arquivo enviado."}), 400
    if not (upload.filename or "").lower().endswith(".xlsx"):
        return jsonify({"error": "Relatório B3 deve ser um arquivo .xlsx"}), 400

    data = upload.read()
    try:
        positions = b3.parse_b3(data)
    except b3.B3ParseError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        _logger.exception("Erro inesperado lendo B3 (preview)")
        return jsonify({"error": "Falha ao processar o relatório B3."}), 500

    existing = {inv["name"] for inv in database.get_all_investments()}
    rows = [
        {"name": p.name, "type": p.type, "bank": p.bank, "balance": p.balance,
         "status": "update" if p.name in existing else "new"}
        for p in positions
    ]
    created = sum(1 for r in rows if r["status"] == "new")
    return jsonify({
        "positions": rows,
        "created": created,
        "updated": len(rows) - created,
        "total": len(rows),
    })


@app.route("/api/import/b3", methods=["POST"])
def api_import_b3() -> Response:
    """Parse a B3 XLSX report and upsert investment positions.

    Multipart form: ``file`` (the .xlsx). Returns the upsert summary
    (``{created, updated, total, positions}``). A malformed/non-xlsx file is a
    client error (400); only truly unexpected failures return 500.
    """
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"error": "Nenhum arquivo enviado."}), 400
    if not (upload.filename or "").lower().endswith(".xlsx"):
        return jsonify({"error": "Relatório B3 deve ser um arquivo .xlsx"}), 400

    data = upload.read()
    try:
        summary = b3.load_b3_positions(data)
    except b3.B3ParseError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        _logger.exception("Erro inesperado importando B3")
        return jsonify({"error": "Falha ao processar o relatório B3."}), 500
    _events.notify()
    return jsonify(summary)


@app.route("/api/import/preview", methods=["POST"])
def api_import_preview() -> Response:
    """Parse an uploaded export file, classify rows, and stage them for review.

    Multipart form:
        file:       one or more uploaded CSVs (repeat the field for a multi-file batch).
        account_id: target account (``nu-db`` | ``inter-db`` | ``inter-cc``).

    Returns:
        ``{batch_id, source, account_id, counts:{…}, amount_divergence, rows:[…]}``.
        400 if the account is invalid or any file does not match the account.
    """
    account_id = (request.form.get("account_id") or "").strip()
    if account_id not in _VALID_ACCOUNTS:
        return jsonify({"error": "invalid account_id"}), 400
    uploads = request.files.getlist("file")  # one or many → a single staged batch
    files = [b for b in (u.read() for u in uploads) if b]
    if not files:
        return jsonify({"error": "file required"}), 400

    try:
        result = ingestion.preview_import_multi(account_id, files)
    except SourceMismatch as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


@app.route("/api/import/staging/<batch_id>")
def api_import_staging(batch_id: str) -> Response:
    """Return the staged rows for a batch (re-read by the preview modal).

    Each row now carries ``category_id``/``display_name``/``original_amount`` for the
    editable preview; the divergence can be derived from ``amount`` vs ``original_amount``.
    """
    from core.ingestion.service import _row_view  # local import: internal helper
    rows = database.get_staging_batch(batch_id)
    return jsonify([_row_view(r) for r in rows])


@app.route("/api/import/staging/<batch_id>/<int:row_id>", methods=["PATCH"])
def api_import_staging_edit(batch_id: str, row_id: int) -> Response:
    """Edit a staged row's category/name/value before confirm (editable preview).

    Body (JSON, any subset): ``{category_id?: int|null, display_name?: str|null,
    amount?: number>0}``. The parsed ``original_amount`` is preserved, so overriding
    the value is auditable and surfaces as ``amount_divergence``.

    Returns ``{ok, row, amount_divergence}``; 404 if the row isn't in the batch.
    """
    body = request.get_json(silent=True) or {}
    fields: dict = {}
    if "category_id" in body:
        cid = body["category_id"]
        if cid is not None and not isinstance(cid, int):
            return jsonify({"error": "category_id must be int or null"}), 400
        # reject unknown categories up front — confirm's INSERT OR IGNORE would
        # otherwise drop the row silently on a FK violation
        if cid is not None and database.get_category(cid) is None:
            return jsonify({"error": "category_id not found"}), 400
        fields["category_id"] = cid
    if "display_name" in body:
        dn = body["display_name"]
        if dn is not None and not isinstance(dn, str):
            return jsonify({"error": "display_name must be string or null"}), 400
        fields["display_name"] = dn or None
    if "amount" in body:
        amt = body["amount"]
        if isinstance(amt, bool) or not isinstance(amt, (int, float)) or amt <= 0:
            return jsonify({"error": "amount must be a positive number"}), 400
        fields["amount"] = float(amt)
    if not fields:
        return jsonify({"error": "no editable field provided"}), 400

    row = database.update_staging_row(batch_id, row_id, fields)
    if row is None:
        return jsonify({"error": "staging row not found"}), 404
    from core.ingestion.service import _row_view
    return jsonify({
        "ok": True,
        "row": _row_view(row),
        "amount_divergence": database.staging_divergence(batch_id),
    })


@app.route("/api/import/confirm", methods=["POST"])
def api_import_confirm() -> Response:
    """Promote a staged batch's 'new' rows to transactions.

    Request body (JSON):
        batch_id:        str        — token from the preview step.
        exclude_ids:     list[int]  — staging-row ids the user unchecked (optional).
        import_batch_id: str        — shared session token so a multi-account drop
                                       (several confirms) reverses as one unit. The
                                       client generates it once per drop and sends it
                                       with every confirm; generated server-side if
                                       omitted. Echoed back in the response.

    Returns:
        ``{"ok": true, "inserted": int, "skipped": int, "import_batch_id": str}``.
        404 if the batch is gone (expired or already confirmed).
    """
    body = request.get_json(silent=True) or {}
    batch_id = (body.get("batch_id") or "").strip()
    if not batch_id:
        return jsonify({"error": "batch_id required"}), 400
    exclude_ids = body.get("exclude_ids") or []
    if not isinstance(exclude_ids, list):
        return jsonify({"error": "exclude_ids must be a list"}), 400
    import_batch_id = (body.get("import_batch_id") or "").strip() or None

    # fatura_due (ISO yyyy-mm-dd): the bill's vencimento for a credit-card fatura
    # import. Tags the purchases so the open fatura uses the bank's grouping.
    fatura_due = (body.get("fatura_due") or "").strip() or None
    if fatura_due:
        try:
            datetime.strptime(fatura_due, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "fatura_due must be YYYY-MM-DD"}), 400

    result = ingestion.confirm_import(batch_id, exclude_ids, import_batch_id, fatura_due)
    if result.get("missing"):
        return jsonify({"error": "Importação expirada, refaça o upload."}), 404
    # Refresh today's daily snapshot in the background (single-flight) — the day's
    # import + categorization work lands on the HDD without the response waiting.
    backup.request_post_import_snapshot()
    return jsonify({"ok": True, **result})


@app.route("/api/expense-categories-full")
def api_expense_categories_full() -> Response:
    """Return all expense categories with their transaction count."""
    return jsonify(database.get_all_expense_categories())

@app.route("/api/categories-full")
def api_categories_full() -> Response:
    """Return all categories for a flow with their transaction count."""
    flow = request.args.get("flow", "expense")
    if flow not in ("expense", "income"):
        return jsonify({"error": "flow must be expense or income"}), 400
    return jsonify(database.get_all_categories_full(flow))


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
    """Delete a transaction (and integrity-linked siblings) by ID.

    Installment groups, auto-transfer pairs and investment-balance reverts are
    handled in :func:`database.delete_transaction`. The response carries an opaque
    ``restore`` payload the client posts back to ``/api/transactions/restore`` for undo.

    Returns:
        ``{"ok": true, "deleted": N, "restore": {...}}`` on success;
        404 if not found; 409 for a protected fatura payment.
    """
    try:
        restore = database.delete_transaction(transaction_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    if restore is None:
        return jsonify({"error": "Transação não encontrada."}), 404
    return jsonify({"ok": True, "deleted": len(restore["transactions"]), "restore": restore})


@app.route("/api/transactions/restore", methods=["POST"])
def api_restore_transactions() -> Response:
    """Undo a delete: re-insert the rows from a ``restore`` payload.

    Body: ``{restore: <payload from DELETE>}``.
    Returns ``{"ok": true, "restored": N}``.
    """
    body = request.get_json(silent=True) or {}
    payload = body.get("restore")
    if not isinstance(payload, dict):
        return jsonify({"error": "restore payload required"}), 400
    try:
        restored = database.restore_transactions(payload)
    except Exception:
        _logger.exception("Erro ao restaurar transações")
        return jsonify({"error": "Falha ao restaurar."}), 500
    return jsonify({"ok": True, "restored": restored})


@app.route("/api/import/batch/<import_batch_id>", methods=["DELETE"])
def api_delete_import_batch(import_batch_id: str) -> Response:
    """Reverse a whole import: delete every transaction sharing ``import_batch_id``.

    Unlike per-row delete, this deliberately removes fatura-total rows too (the
    per-row 409 guard is for accidental single deletes, not a whole-import undo).
    The response carries a ``restore`` payload the client can post back to
    ``/api/transactions/restore``.

    Returns ``{"ok": true, "deleted": N, "restore": {...}}``; 404 if nothing matched.
    """
    result = database.delete_batch(import_batch_id)
    if not result["deleted"]:
        return jsonify({"error": "Importação não encontrada."}), 404
    backup.request_post_import_snapshot()
    return jsonify({
        "ok": True,
        "deleted": result["deleted"],
        "restore": {
            "transactions": result["transactions"],
            "investment_deltas": result["investment_deltas"],
        },
    })



def run_dashboard() -> None:
    """Serve the dashboard with Waitress in the foreground (blocks until killed).

    Uses 32 threads: each open SSE connection holds one thread permanently,
    and a full page load fires ~10 API requests in parallel — 32 threads
    keeps the queue empty under normal single-user load. SIGTERM (systemd
    stop) terminates the process with the default handler, which systemd
    treats as a clean exit.
    """
    _logger.info("Dashboard available at http://127.0.0.1:%d", DASHBOARD_PORT)
    serve(app, host="127.0.0.1", port=DASHBOARD_PORT, threads=32)
