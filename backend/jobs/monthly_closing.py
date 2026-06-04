"""Entrypoint: monthly closing report (systemd timer: 1st 08:00, Persistent).

    PYTHONPATH=backend python -m jobs.monthly_closing

Reports the PREVIOUS calendar month (anchored to today), so a late ``Persistent``
catch-up still reports the correct period.
"""
import asyncio

from bootstrap import bootstrap

import config
from telegram import Bot
from bot.reports import send_monthly_closing_report


def main() -> None:
    bootstrap()
    bot = Bot(config.TELEGRAM_TOKEN)
    asyncio.run(send_monthly_closing_report(bot))


if __name__ == "__main__":
    main()
