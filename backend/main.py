import asyncio
import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import database
import sheets
from bot import build_application

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
Path("logs").mkdir(exist_ok=True)


def main() -> None:
    # Python 3.12+ no longer creates a default event loop automatically.
    # PTB's run_polling calls asyncio.get_event_loop(), so we set one first.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    database.init_db()
    sheets.setup_headers()
    app = build_application()
    logging.getLogger(__name__).info("BrokerShark is running...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
