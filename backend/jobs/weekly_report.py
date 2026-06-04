"""Entrypoint: weekly report (systemd timer: Mon 08:00, Persistent).

    PYTHONPATH=backend python -m jobs.weekly_report

Builds a short-lived ``telegram.Bot`` and sends the message — no long-poll needed,
so scheduled notifications fire even when the on-demand launcher is closed.
"""
import asyncio

from bootstrap import bootstrap

import config
from telegram import Bot
from bot.reports import send_weekly_report


def main() -> None:
    bootstrap()
    bot = Bot(config.TELEGRAM_TOKEN)
    asyncio.run(send_weekly_report(bot))


if __name__ == "__main__":
    main()
