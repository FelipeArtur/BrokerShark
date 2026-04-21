"""Investment deposit/withdrawal flow and ConversationHandler builder."""
import asyncio
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

import database
import sheets
from bot.constants import (
    INV_AMOUNT,
    INV_CONFIRMATION,
    INV_DATE,
    INV_DESCRIPTION,
    INV_DESTINATION,
    INV_OPERATION,
    INVESTMENT_META,
    OPERATION_LABELS,
)
from bot.handlers.commands import cancel
from bot.utils import _authorized, _fmt_brl, _parse_amount, _parse_purchase_date


async def investment_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Investir (aporte)", callback_data="inv_deposit"),
        InlineKeyboardButton("Resgatar",          callback_data="inv_withdrawal"),
    ]])
    await query.edit_message_text("O que você quer fazer?", reply_markup=keyboard)
    return INV_OPERATION


async def investment_destination(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    operation = query.data.replace("inv_", "")
    context.user_data["inv_operation"] = operation
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("Caixinha Nubank", callback_data="inv_dest_Caixinha Nubank"),
            InlineKeyboardButton("Tesouro Direto",  callback_data="inv_dest_Tesouro Direto"),
        ],
        [InlineKeyboardButton("Porquinho Inter", callback_data="inv_dest_Porquinho Inter")],
    ])
    await query.edit_message_text("Em qual investimento?", reply_markup=keyboard)
    return INV_DESTINATION


async def investment_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    dest = query.data.replace("inv_dest_", "")
    context.user_data["inv_destination"] = dest
    await query.edit_message_text("Qual o valor? (ex: 500,00)")
    return INV_AMOUNT


async def investment_description(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    amount = _parse_amount(update.message.text)
    if amount is None:
        await update.message.reply_text("Valor inválido. Tente novamente.")
        return INV_AMOUNT
    context.user_data["inv_amount"] = amount
    await update.message.reply_text('Alguma observação? (ex: "reserva emergência", "férias")')
    return INV_DESCRIPTION


async def investment_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    context.user_data["inv_note"] = update.message.text.strip()
    await update.message.reply_text(
        "Quando foi realizado?\n(ex: 19/04/2026 ou 19/04/2026 14:30)"
    )
    return INV_DATE


async def investment_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    parsed = _parse_purchase_date(update.message.text)
    if parsed is None:
        await update.message.reply_text(
            "Data inválida. Use o formato DD/MM/AAAA ou DD/MM/AAAA HH:MM"
        )
        return INV_DATE
    context.user_data["inv_date"], context.user_data["inv_date_display"] = parsed
    d = context.user_data
    op_label = OPERATION_LABELS.get(d["inv_operation"], d["inv_operation"])

    text = (
        f"Confirma o investimento?\n\n"
        f"Operação: {op_label}\n"
        f"Onde:     {d['inv_destination']}\n"
        f"Valor:    {_fmt_brl(d['inv_amount'])}\n"
        f"Obs:      {d['inv_note']}\n"
        f"Data:     {d['inv_date_display']}"
    )
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Confirmar", callback_data="inv_confirm"),
        InlineKeyboardButton("Cancelar",  callback_data="inv_cancel"),
    ]])
    await update.message.reply_text(text, reply_markup=keyboard)
    return INV_CONFIRMATION


async def investment_save(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "inv_cancel":
        context.user_data.clear()
        await query.edit_message_text("Registro cancelado.")
        return ConversationHandler.END

    d = context.user_data
    dest = d["inv_destination"]
    type_, bank = INVESTMENT_META.get(dest, ("savings", "nubank"))
    inv_id = database.upsert_investment(dest, type_, bank)

    mv_id = database.insert_investment_movement(
        date=d["inv_date"],
        investment_id=inv_id,
        operation=d["inv_operation"],
        amount=d["inv_amount"],
        description=d.get("inv_note") or None,
    )

    asyncio.get_event_loop().run_in_executor(
        None,
        sheets.append_investment,
        {
            "id": mv_id,
            "date": d["inv_date_display"],
            "investment_name": dest,
            "operation": d["inv_operation"],
            "amount": d["inv_amount"],
            "description": d.get("inv_note"),
            "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    op_label = OPERATION_LABELS.get(d["inv_operation"], d["inv_operation"])
    text = (
        f"Investimento registrado!\n\n"
        f"{op_label} — {_fmt_brl(d['inv_amount'])}\n"
        f"{dest}\n"
        f"{d['inv_date_display']}"
    )
    await query.edit_message_text(text)
    context.user_data.clear()
    return ConversationHandler.END


def build_investment_handler() -> ConversationHandler:
    """Build the ConversationHandler for the investment deposit/withdrawal flow."""
    return ConversationHandler(
        entry_points=[CallbackQueryHandler(investment_start, pattern="^menu_investment$")],
        states={
            INV_OPERATION: [
                CallbackQueryHandler(
                    investment_destination, pattern="^inv_(deposit|withdrawal)$"
                ),
            ],
            INV_DESTINATION: [
                CallbackQueryHandler(investment_amount, pattern="^inv_dest_.+$"),
            ],
            INV_AMOUNT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, investment_description),
            ],
            INV_DESCRIPTION: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, investment_date),
            ],
            INV_DATE: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, investment_confirmation),
            ],
            INV_CONFIRMATION: [
                CallbackQueryHandler(investment_save, pattern="^inv_(confirm|cancel)$"),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )
