"""Flask dashboard server — read-only analytics API on a daemon thread."""
import logging
import threading
from datetime import datetime

from flask import Flask, jsonify, send_from_directory

import config
import database

_logger = logging.getLogger(__name__)

DASHBOARD_PORT = config.DASHBOARD_PORT
FRONTEND_DIR = config.FRONTEND_DIR

app = Flask(__name__, static_folder=str(FRONTEND_DIR))


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/api/summary")
def api_summary():
    now = datetime.now()
    summary = database.get_monthly_summary(now.year, now.month)
    investments = database.get_all_investments()
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
    accounts = database.get_all_accounts()
    result = []
    for acc in accounts:
        result.append({
            "id": acc["id"],
            "name": acc["name"],
            "type": acc["type"],
            "bank": acc["bank"],
            "balance": database.get_account_balance(acc["id"]),
        })
    return jsonify(result)


@app.route("/api/investments")
def api_investments():
    investments = database.get_all_investments()
    return jsonify([
        {
            "name": inv["name"],
            "balance": inv["current_balance"],
            "type": inv["type"],
            "bank": inv["bank"],
        }
        for inv in investments
    ])


@app.route("/api/monthly")
def api_monthly():
    return jsonify(database.get_monthly_history(months=6))


@app.route("/api/categories")
def api_categories():
    now = datetime.now()
    categories = database.get_expenses_by_category(now.year, now.month)
    return jsonify(categories)


@app.route("/api/faturas")
def api_faturas():
    result = []
    for account_id, label in (("nu-cc", "Nubank Crédito"), ("inter-cc", "Inter Crédito")):
        info = database.get_credit_card_billing_info(account_id)
        result.append({"label": label, **info})
    return jsonify(result)


def start_dashboard() -> None:
    thread = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=DASHBOARD_PORT, debug=False, use_reloader=False),
        daemon=True,
        name="dashboard",
    )
    thread.start()
    _logger.info("Dashboard available at http://127.0.0.1:%d", DASHBOARD_PORT)
