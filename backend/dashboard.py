"""Flask dashboard server — read-only analytics API on a daemon thread."""
import logging
import queue
import threading
from datetime import datetime

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from waitress import serve

import config
import database
import events as _events

_logger = logging.getLogger(__name__)

DASHBOARD_PORT = config.DASHBOARD_PORT
FRONTEND_DIR = config.FRONTEND_DIR

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="/static")


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/events")
def sse_stream():
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
def api_summary():
    bank = request.args.get("bank") or None
    now = datetime.now()
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
def api_accounts():
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
def api_investments():
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
def api_monthly():
    bank = request.args.get("bank") or None
    return jsonify(database.get_monthly_history(months=6, bank=bank))


@app.route("/api/categories")
def api_categories():
    bank = request.args.get("bank") or None
    now = datetime.now()
    return jsonify(database.get_expenses_by_category(now.year, now.month, bank=bank))


@app.route("/api/faturas")
def api_faturas():
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


def start_dashboard() -> None:
    thread = threading.Thread(
        target=lambda: serve(app, host="127.0.0.1", port=DASHBOARD_PORT, threads=8),
        daemon=True,
        name="dashboard",
    )
    thread.start()
    _logger.info("Dashboard available at http://127.0.0.1:%d", DASHBOARD_PORT)
