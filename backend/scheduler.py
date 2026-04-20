import logging
import os
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from telegram import Bot

import backup
import database

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID = int(os.getenv("TELEGRAM_CHAT_ID", "0"))

_logger = logging.getLogger(__name__)


async def _send_weekly_report(bot: Bot) -> None:
    today = datetime.now()
    last_monday = today - timedelta(days=today.weekday() + 7)
    last_sunday = last_monday + timedelta(days=6)

    start = last_monday.strftime("%Y-%m-%d")
    end   = last_sunday.strftime("%Y-%m-%d")

    summary = database.get_monthly_summary(last_monday.year, last_monday.month)
    investments = database.get_all_investments()

    reservas_total = sum(inv["current_balance"] for inv in investments)
    top = summary.get("top_category")
    top_str = f"{top['name']} — R$ {top['total']:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") if top else "—"

    def fmt(value: float) -> str:
        return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    text = (
        f"*Resumo da semana passada*\n\n"
        f"Gastos: {fmt(summary['expenses'])}\n"
        f"Receitas: {fmt(summary['income'])}\n"
        f"Top categoria: {top_str}\n"
        f"Reservas: {fmt(reservas_total)}"
    )

    await bot.send_message(
        chat_id=TELEGRAM_CHAT_ID,
        text=text,
        parse_mode="Markdown",
    )


def build_scheduler(bot: Bot) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        backup.run_backup,
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

    return scheduler
