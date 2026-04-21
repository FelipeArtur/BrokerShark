"""Application factory — assembles all handlers and wires up scheduler lifecycle hooks."""
import warnings

from telegram.ext import Application, CommandHandler

import config
from bot.handlers import (
    build_csv_handler,
    build_expense_handler,
    build_income_handler,
    build_investment_handler,
)
from bot.handlers.commands import (
    cancel,
    cmd_ajuda,
    cmd_fatura,
    cmd_reservas,
    cmd_resumo,
    cmd_saldo,
    start,
)


async def _post_init(app: Application) -> None:
    from scheduler import build_scheduler
    scheduler = build_scheduler(app.bot)
    scheduler.start()
    app.bot_data["scheduler"] = scheduler


async def _post_shutdown(app: Application) -> None:
    scheduler = app.bot_data.get("scheduler")
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)


def build_application() -> Application:
    """Build and return the fully configured Telegram Application."""
    warnings.filterwarnings(
        "ignore",
        message="If 'per_message=False'",
        category=UserWarning,
    )

    app = (
        Application.builder()
        .token(config.TELEGRAM_TOKEN)
        .post_init(_post_init)
        .post_shutdown(_post_shutdown)
        .build()
    )

    app.add_handler(CommandHandler("novo",     start))
    app.add_handler(CommandHandler("start",    start))
    app.add_handler(CommandHandler("saldo",    cmd_saldo))
    app.add_handler(CommandHandler("resumo",   cmd_resumo))
    app.add_handler(CommandHandler("fatura",   cmd_fatura))
    app.add_handler(CommandHandler("reservas", cmd_reservas))
    app.add_handler(CommandHandler("ajuda",    cmd_ajuda))

    app.add_handler(build_expense_handler())
    app.add_handler(build_income_handler())
    app.add_handler(build_investment_handler())
    app.add_handler(build_csv_handler())

    return app
