"""Income registration flow and ConversationHandler builder."""
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
    INC_AMOUNT,
    INC_BANK,
    INC_CONFIRMATION,
    INC_DATE,
    INC_DESCRIPTION,
    INC_TYPE,
)
from bot.handlers.commands import cancel
from bot.utils import _authorized, _fmt_brl, _parse_amount, _parse_purchase_date

_METHOD_LABELS: dict[str, str] = {
    "salary":       "Salário",
    "freelance":    "Freela",
    "pix_received": "PIX recebido",
    "transfer":     "Transferência",
    "other":        "Outro",
}


async def income_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("Salário",      callback_data="inc_salary"),
            InlineKeyboardButton("Freela",        callback_data="inc_freelance"),
        ],
        [
            InlineKeyboardButton("PIX recebido", callback_data="inc_pix_received"),
            InlineKeyboardButton("Transferência", callback_data="inc_transfer"),
        ],
        [InlineKeyboardButton("Outro", callback_data="inc_other")],
    ])
    await query.edit_message_text("O que você recebeu?", reply_markup=keyboard)
    return INC_TYPE


async def income_bank(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    method = query.data.replace("inc_", "")
    context.user_data["inc_method"] = method
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Nubank", callback_data="inc_bank_nubank"),
        InlineKeyboardButton("Inter",  callback_data="inc_bank_inter"),
    ]])
    await query.edit_message_text("Em qual conta caiu?", reply_markup=keyboard)
    return INC_BANK


async def income_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    bank = query.data.replace("inc_bank_", "")
    context.user_data["inc_bank"] = bank
    context.user_data["inc_account_id"] = "nu-db" if bank == "nubank" else "inter-db"
    await query.edit_message_text("Qual o valor recebido? (ex: 3500,00)")
    return INC_AMOUNT


async def income_description(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    amount = _parse_amount(update.message.text)
    if amount is None:
        await update.message.reply_text("Valor inválido. Tente novamente.")
        return INC_AMOUNT
    context.user_data["inc_amount"] = amount
    await update.message.reply_text('De onde veio? (ex: "Empresa X", "João", "Projeto site")')
    return INC_DESCRIPTION


async def income_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    context.user_data["inc_description"] = update.message.text.strip()
    await update.message.reply_text(
        "Quando o valor foi recebido?\n(ex: 19/04/2026 ou 19/04/2026 14:30)"
    )
    return INC_DATE


async def income_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    parsed = _parse_purchase_date(update.message.text)
    if parsed is None:
        await update.message.reply_text(
            "Data inválida. Use o formato DD/MM/AAAA ou DD/MM/AAAA HH:MM"
        )
        return INC_DATE
    context.user_data["inc_date"], context.user_data["inc_date_display"] = parsed
    d = context.user_data

    method_label = _METHOD_LABELS.get(d["inc_method"], d["inc_method"])
    account_label = "Nubank Conta" if d["inc_bank"] == "nubank" else "Inter Conta"

    text = (
        f"Confirma o registro?\n\n"
        f"Tipo:  {method_label}\n"
        f"Valor: {_fmt_brl(d['inc_amount'])}\n"
        f"De:    {d['inc_description']}\n"
        f"Conta: {account_label}\n"
        f"Data:  {d['inc_date_display']}"
    )
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Confirmar", callback_data="inc_confirm"),
        InlineKeyboardButton("Cancelar",  callback_data="inc_cancel"),
    ]])
    await update.message.reply_text(text, reply_markup=keyboard)
    return INC_CONFIRMATION


async def income_save(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "inc_cancel":
        context.user_data.clear()
        await query.edit_message_text("Registro cancelado.")
        return ConversationHandler.END

    d = context.user_data
    tx_id = database.insert_transaction(
        date=d["inc_date"],
        flow="income",
        method=d["inc_method"],
        account_id=d["inc_account_id"],
        amount=d["inc_amount"],
        description=d["inc_description"],
    )

    asyncio.get_event_loop().run_in_executor(
        None,
        sheets.append_income,
        {
            "id": tx_id,
            "date": d["inc_date_display"],
            "method": d["inc_method"],
            "bank": d["inc_bank"],
            "account_id": d["inc_account_id"],
            "amount": d["inc_amount"],
            "description": d["inc_description"],
            "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    method_label = _METHOD_LABELS.get(d["inc_method"], d["inc_method"])
    account_label = "Nubank Conta" if d["inc_bank"] == "nubank" else "Inter Conta"

    text = (
        f"Recebimento registrado!\n\n"
        f"{method_label} — {_fmt_brl(d['inc_amount'])}\n"
        f"{d['inc_description']} · {account_label}\n"
        f"{d['inc_date_display']}"
    )
    await query.edit_message_text(text)
    context.user_data.clear()
    return ConversationHandler.END


def build_income_handler() -> ConversationHandler:
    """Build the ConversationHandler for the income registration flow."""
    return ConversationHandler(
        entry_points=[CallbackQueryHandler(income_start, pattern="^menu_income$")],
        states={
            INC_TYPE: [
                CallbackQueryHandler(
                    income_bank,
                    pattern="^inc_(salary|freelance|pix_received|transfer|other)$",
                ),
            ],
            INC_BANK: [
                CallbackQueryHandler(income_amount, pattern="^inc_bank_(nubank|inter)$"),
            ],
            INC_AMOUNT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, income_description),
            ],
            INC_DESCRIPTION: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, income_date),
            ],
            INC_DATE: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, income_confirmation),
            ],
            INC_CONFIRMATION: [
                CallbackQueryHandler(income_save, pattern="^inc_(confirm|cancel)$"),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )
