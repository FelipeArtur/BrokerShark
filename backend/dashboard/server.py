"""Flask dashboard server — read-only analytics API served on a daemon thread.

All endpoints are read-only: they query SQLite via :mod:`core.database` and
return JSON.  A real-time SSE endpoint (``/api/events``) notifies connected
browsers whenever the database is written to, replacing the old 60-second poll.

The server is started via :func:`start_dashboard`, which launches Waitress
(production WSGI) in a daemon thread on the configured port.

Endpoints:
    ``GET /``                — serves ``frontend/index.html``
    ``GET /api/events``      — SSE stream: ``connected`` | ``update`` | ``heartbeat``
    ``GET /api/summary``     — current month income, expenses, balance, reservas
    ``GET /api/accounts``    — all accounts with current balance
    ``GET /api/investments`` — all investments with current balance
    ``GET /api/monthly``     — last 6 months of income vs expenses
    ``GET /api/categories``  — current month expenses by category
    ``GET /api/faturas``     — credit card billing info

All data endpoints accept an optional ``?bank=nubank|inter`` query parameter
to filter results to a single bank.
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
    """Return the current month financial summary.

    Query params:
        bank:    ``nubank`` | ``inter`` (optional)
        account: ``nu-cc`` | ``nu-db`` | ``inter-cc`` | ``inter-db`` (optional)

    Returns:
        JSON with keys ``month``, ``year``, ``income``, ``expenses``,
        ``balance``, ``reservas``, ``top_category``.
    """
    bank    = request.args.get("bank") or None
    account = request.args.get("account") or None
    now = datetime.now()
    if account:
        summary = database.get_account_monthly_summary(account, now.year, now.month)
        reservas_total = 0.0
    else:
        summary = database.get_monthly_summary(now.year, now.month, bank=bank)
        investments = database.get_all_investments()
        if bank:
            investments = [inv for inv in investments if inv["bank"] == bank]
        reservas_total = sum(inv["current_balance"] for inv in investments)
    return jsonify({
        "month": now.month,
        "year": now.year,
        "income": summary["income"],
        "expenses": summary["expenses"],
        "balance": summary["income"] - summary["expenses"],
        "reservas": reservas_total,
        "top_category": summary.get("top_category"),
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
        {"id": a["id"], "name": a["name"], "type": a["type"],
         "bank": a["bank"], "balance": a["balance"]}
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
        {"name": inv["name"], "balance": inv["current_balance"],
         "type": inv["type"], "bank": inv["bank"]}
        for inv in investments
    ])


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
    if account:
        return jsonify(database.get_monthly_history_by_account(account, months=6))
    return jsonify(database.get_monthly_history(months=6, bank=bank))


@app.route("/api/categories")
def api_categories() -> Response:
    """Return current month expenses grouped by category.

    Query params:
        bank:    ``nubank`` | ``inter`` (optional)
        account: account id (optional — takes precedence over bank)

    Returns:
        JSON array of ``{name, total}`` objects, sorted by total descending.
    """
    bank    = request.args.get("bank") or None
    account = request.args.get("account") or None
    now = datetime.now()
    if account:
        return jsonify(database.get_expenses_by_category_account(account, now.year, now.month))
    return jsonify(database.get_expenses_by_category(now.year, now.month, bank=bank))


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
        result.append({"label": label, **info})
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
        limit = min(int(request.args.get("limit", 20)), 50)
    except ValueError:
        limit = 20
    return jsonify(database.get_recent_transactions(account_id, limit))


def start_dashboard() -> None:
    """Start the Waitress WSGI server in a daemon thread.

    The thread is named ``"dashboard"`` and runs until the process exits.
    Uses 8 threads so that SSE clients (each blocking one thread) don't
    starve regular API requests.
    """
    thread = threading.Thread(
        target=lambda: serve(app, host="127.0.0.1", port=DASHBOARD_PORT, threads=8),
        daemon=True,
        name="dashboard",
    )
    thread.start()
    _logger.info("Dashboard available at http://127.0.0.1:%d", DASHBOARD_PORT)
