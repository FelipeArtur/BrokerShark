"""Entry point — initialises the database, starts the dashboard thread, then runs the bot."""
import asyncio
import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import config
from core import database
from integrations import sheets
from bot import build_application
from dashboard import start_dashboard

logging.basicConfig(level=logging.INFO, format=config.LOG_FORMAT)
Path(config.LOG_DIR).mkdir(exist_ok=True)


def main() -> None:
    # Python 3.12+ no longer creates a default event loop automatically.
    # PTB's run_polling calls asyncio.get_event_loop(), so we set one first.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    database.init_db()
    sheets.setup_headers()
    start_dashboard()
    app = build_application()
    logging.getLogger(__name__).info("BrokerShark is running...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
