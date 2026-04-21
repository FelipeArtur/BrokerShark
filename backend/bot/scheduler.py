"""APScheduler jobs — daily backup, weekly report, and monthly closing report.

Jobs registered:
- ``daily_backup``   — 03:00 every day via :func:`core.backup.run_backup`
- ``weekly_report``  — Monday 08:00 with income/expense summary and fatura info
- ``monthly_closing``— 1st of each month 08:00 with full previous-month breakdown
"""
import asyncio
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from telegram import Bot

from core import backup, database
from bot.utils import _fmt_brl as _fmt, _PT_MONTHS
import config

TELEGRAM_CHAT_ID = config.TELEGRAM_CHAT_ID

_logger = logging.getLogger(__name__)


async def _send_weekly_report(bot: Bot) -> None:
    """Compose and send the weekly financial summary to the configured chat.

    Covers the calendar week that ended last Sunday (i.e., the previous full
    Monday-to-Sunday period).  Includes total expenses, income, top category,
    total reserves, and credit card due-date information for both banks.

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

    await bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=text, parse_mode="Markdown")


async def _send_monthly_closing_report(bot: Bot) -> None:
    """Compose and send the monthly closing report for the previous month.

    Sent on the 1st of each month at 08:00. Covers the entire previous calendar
    month: income, expenses, balance, category breakdown, investment movements,
    and total accumulated reserves.

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

    await bot.send_message(
        chat_id=TELEGRAM_CHAT_ID,
        text="\n".join(lines),
        parse_mode="Markdown",
    )


async def _run_backup_async() -> None:
    """Run the synchronous backup in a thread pool to avoid blocking the event loop."""
    await asyncio.to_thread(backup.run_backup)


def build_scheduler(bot: Bot) -> AsyncIOScheduler:
    """Create and configure the APScheduler with all recurring jobs.

    Args:
        bot: The :class:`telegram.Bot` instance passed to report jobs.

    Returns:
        A configured :class:`~apscheduler.schedulers.asyncio.AsyncIOScheduler`
        (not yet started — the caller must call ``.start()``).
    """
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        _run_backup_async,
        trigger="cron",
        hour=3,
        minute=0,
        id="daily_backup",
    )

    scheduler.add_job(
        _send_weekly_report,
        trigger="cron",
        day_of_week="mon",
        hour=8,
        minute=0,
        id="weekly_report",
        kwargs={"bot": bot},
    )

    scheduler.add_job(
        _send_monthly_closing_report,
        trigger="cron",
        day=1,
        hour=8,
        minute=0,
        id="monthly_closing",
        kwargs={"bot": bot},
    )

    return scheduler
