"""Entry point — on-demand launcher: bootstrap, start the dashboard, run the bot.

The 3 periodic jobs (backup, weekly report, monthly closing) are NOT started here
anymore — they run as **systemd user timers** (see ``backend/jobs/`` + ``deploy/``).
This process is the on-demand UI: it boots the dashboard + the Telegram bot and exits
when closed. ``bootstrap`` is imported first so ``.env`` loads before ``config`` is read.
"""
import asyncio
import logging

from bootstrap import bootstrap

from bot import build_application
from dashboard import start_dashboard


def main() -> None:
    # Python 3.12+ no longer creates a default event loop automatically.
    # PTB's run_polling calls asyncio.get_event_loop(), so we set one first.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    bootstrap()  # load_dotenv + config.validate + logging + database.init_db
    start_dashboard()
    app = build_application()
    logging.getLogger(__name__).info("BrokerShark is running...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
