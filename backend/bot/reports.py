"""Composição dos relatórios agendados (semanal + fechamento mensal).

Disparados por **systemd user timers** (oneshot) via ``backend/jobs/*``. Cada função
recebe um ``telegram.Bot``, lê o DB (somente leitura) e envia a mensagem ao chat do
dono. Antes viviam no ``bot/scheduler.py`` (APScheduler, aposentado).
"""
import json
import logging
from datetime import datetime, timedelta

from telegram import Bot

from core import database
from bot.utils import _fmt_brl as _fmt, _PT_MONTHS
from integrations import ollama
import config

_logger = logging.getLogger(__name__)


async def send_weekly_report(bot: Bot) -> None:
    """Compose and send the weekly financial summary to the configured chat.

    Covers the calendar week that ended last Sunday (the previous full Monday-to-
    Sunday period): total expenses, income, top category, total reserves, and credit
    card due-date information for both banks.

    Args:
        bot: The :class:`telegram.Bot` instance used to send the message.
    """
    today = datetime.now()
    last_monday = today - timedelta(days=today.weekday() + 7)

    summary = database.get_monthly_summary(last_monday.year, last_monday.month)
    investments = database.get_all_investments()
    reservas_total = sum(inv["current_balance"] for inv in investments)

    top = summary.get("top_category")
    top_str = f"{top['name']} — {_fmt(top['total'])}" if top else "—"

    nu_info    = database.get_credit_card_billing_info("nu-cc")
    inter_info = database.get_credit_card_billing_info("inter-cc")

    def _due_str(info: dict) -> str:
        d = info["days_until_due"]
        if d > 0:
            return f"vence em {d} dias"
        elif d == 0:
            return "vence hoje"
        else:
            return f"vencida há {abs(d)} dias"

    text = (
        f"*Resumo semanal — {last_monday.strftime('%d/%m')} a {(last_monday + timedelta(days=6)).strftime('%d/%m')}*\n\n"
        f"Gastos:        {_fmt(summary['expenses'])}\n"
        f"Receitas:      {_fmt(summary['income'])}\n"
        f"Top categoria: {top_str}\n"
        f"Reservas:      {_fmt(reservas_total)}\n\n"
        f"*Faturas abertas*\n"
        f"Nubank:  {_fmt(nu_info['total'])} — {_due_str(nu_info)}\n"
        f"Inter:   {_fmt(inter_info['total'])} — {_due_str(inter_info)}"
    )

    insight = await ollama.chat([{
        "role": "user",
        "content": (
            f"Gere uma análise em 2 frases do resumo financeiro semanal: "
            f"gastos={_fmt(summary['expenses'])}, receitas={_fmt(summary['income'])}, "
            f"top categoria={top_str}"
        ),
    }])
    if insight:
        text += f"\n\n💡 _{insight}_"

    await bot.send_message(chat_id=config.TELEGRAM_CHAT_ID, text=text, parse_mode="Markdown")


async def send_monthly_closing_report(bot: Bot) -> None:
    """Compose and send the monthly closing report for the previous month.

    Sent on the 1st of each month. Covers the entire previous calendar month: income,
    expenses, balance, category breakdown, investment movements, and total reserves.
    Anchors to ``today``'s previous month, so a late catch-up still reports the right
    period.

    Args:
        bot: The :class:`telegram.Bot` instance used to send the message.
    """
    today = datetime.now()
    if today.month == 1:
        year, month = today.year - 1, 12
    else:
        year, month = today.year, today.month - 1

    summary    = database.get_monthly_summary(year, month)
    categories = database.get_expenses_by_category(year, month)
    movements  = database.get_investment_movements_by_period(
        f"{year:04d}-{month:02d}-01",
        f"{year:04d}-{month:02d}-31",
    )
    investments = database.get_all_investments()
    reservas_total = sum(inv["current_balance"] for inv in investments)

    balance = summary["income"] - summary["expenses"]
    balance_sign = "+" if balance >= 0 else ""

    lines = [f"*Fechamento de {_PT_MONTHS[month]}/{year}*\n"]

    lines.append(
        f"Receitas:  {_fmt(summary['income'])}\n"
        f"Gastos:    {_fmt(summary['expenses'])}\n"
        f"Saldo:     {balance_sign}{_fmt(balance)}"
    )

    if categories:
        lines.append("\n*Gastos por categoria*")
        for cat in categories:
            lines.append(f"  {cat['name']}: {_fmt(cat['total'])}")

    if movements:
        lines.append("\n*Movimentações em investimentos*")
        for mv in movements:
            op = "Aporte" if mv["operation"] == "deposit" else "Resgate"
            lines.append(f"  {mv['name']} — {op}: {_fmt(mv['total'])}")

    lines.append(f"\n*Reservas acumuladas:* {_fmt(reservas_total)}")

    data_summary = json.dumps({
        "mes": f"{_PT_MONTHS[month]}/{year}",
        "receitas": summary["income"],
        "gastos": summary["expenses"],
        "saldo": balance,
        "reservas": reservas_total,
        "categorias": [{"nome": c["name"], "total": c["total"]} for c in categories],
    }, ensure_ascii=False)
    insight = await ollama.chat([{
        "role": "user",
        "content": f"Análise em 2 frases do fechamento financeiro mensal: {data_summary}",
    }])
    if insight:
        lines.append(f"\n💡 _{insight}_")

    await bot.send_message(
        chat_id=config.TELEGRAM_CHAT_ID,
        text="\n".join(lines),
        parse_mode="Markdown",
    )
