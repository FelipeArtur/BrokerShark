"""Application factory — monta todos os handlers e conecta os lifecycle hooks do scheduler."""
import warnings

from telegram import Update
from telegram.ext import (
    Application, ApplicationHandlerStop, CommandHandler, MessageHandler,
    TypeHandler, filters,
)

import config
from bot.handlers.commands import cancel, cmd_ajuda, cmd_fatura, cmd_reservas, cmd_resumo, cmd_saldo, start
from bot.handlers.ai_chat import ai_chat_handler
from bot.utils import _authorized


async def _auth_gate(update: Update, context: object) -> None:
    """Group -1 gate: drop every update that is not from the owner chat.

    Centralises authorization so no individual handler can forget it. Runs
    before all other handlers; raising ``ApplicationHandlerStop`` prevents any
    downstream handler (commands or the AI catch-all) from processing a
    non-owner update.
    """
    if not _authorized(update):
        raise ApplicationHandlerStop


async def _post_init(app: Application) -> None:
    from bot.scheduler import build_scheduler
    scheduler = build_scheduler(app.bot)
    scheduler.start()
    app.bot_data["scheduler"] = scheduler


async def _post_shutdown(app: Application) -> None:
    scheduler = app.bot_data.get("scheduler")
    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)


def build_application() -> Application:
    """Build and return the fully configured Telegram Application."""
    warnings.filterwarnings("ignore", message="If 'per_message=False'", category=UserWarning)

    app = (
        Application.builder()
        .token(config.TELEGRAM_TOKEN)
        .post_init(_post_init)
        .post_shutdown(_post_shutdown)
        .build()
    )

    # Owner-only gate runs first (group -1) so no handler can be reached by a
    # non-owner update, even if a future handler forgets its own check.
    app.add_handler(TypeHandler(Update, _auth_gate), group=-1)

    app.add_handler(CommandHandler("novo",     start))
    app.add_handler(CommandHandler("start",    start))
    app.add_handler(CommandHandler("saldo",    cmd_saldo))
    app.add_handler(CommandHandler("resumo",   cmd_resumo))
    app.add_handler(CommandHandler("fatura",   cmd_fatura))
    app.add_handler(CommandHandler("reservas", cmd_reservas))
    app.add_handler(CommandHandler("ajuda",    cmd_ajuda))
    app.add_handler(CommandHandler("cancelar", cancel))

    # AI catch-all — deve ser o último handler registrado
    app.add_handler(MessageHandler(
        filters.TEXT & ~filters.COMMAND & ~filters.UpdateType.EDITED_MESSAGE,
        ai_chat_handler,
    ))

    return app
