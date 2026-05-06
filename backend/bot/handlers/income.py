"""Income registration flow and ConversationHandler builder."""
import asyncio
from datetime import date, datetime, timedelta

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from core import database
from integrations import sheets
from bot.constants import (
    INC_AMOUNT,
    INC_BANK,
    INC_CONFIRMATION,
    INC_DATE,
    INC_DESCRIPTION,
    INC_TRANSFER_FROM,
    INC_TRANSFER_TO,
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

_ACCOUNT_LABELS: dict[str, str] = {
    "nu-db":    "Nubank Conta",
    "inter-db": "Inter Conta",
}

_DATE_KB = InlineKeyboardMarkup([[
    InlineKeyboardButton("Hoje",       callback_data="date_hoje"),
    InlineKeyboardButton("Ontem",      callback_data="date_ontem"),
    InlineKeyboardButton("Outra data", callback_data="date_outra"),
]])


async def income_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("Salário",       callback_data="inc_salary"),
            InlineKeyboardButton("Freela",         callback_data="inc_freelance"),
        ],
        [
            InlineKeyboardButton("PIX recebido",  callback_data="inc_pix_received"),
            InlineKeyboardButton("Transferência",  callback_data="inc_transfer"),
        ],
        [InlineKeyboardButton("Outro", callback_data="inc_other")],
    ])
    await query.edit_message_text("O que você recebeu?", reply_markup=keyboard)
    return INC_TYPE


# ── Transfer sub-flow ─────────────────────────────────────────────────────────

async def transfer_from_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """First step of internal transfer: ask for source account."""
    query = update.callback_query
    await query.answer()
    context.user_data["is_transfer"] = True
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Nubank Conta", callback_data="tr_from_nubank"),
        InlineKeyboardButton("Inter Conta",  callback_data="tr_from_inter"),
    ]])
    await query.edit_message_text("De qual conta?", reply_markup=keyboard)
    return INC_TRANSFER_FROM


async def transfer_to_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Second step of internal transfer: ask for destination account."""
    query = update.callback_query
    await query.answer()
    from_bank = query.data.replace("tr_from_", "")
    context.user_data["transfer_from_id"] = "nu-db" if from_bank == "nubank" else "inter-db"
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Nubank Conta", callback_data="tr_to_nubank"),
        InlineKeyboardButton("Inter Conta",  callback_data="tr_to_inter"),
    ]])
    await query.edit_message_text("Para qual conta?", reply_markup=keyboard)
    return INC_TRANSFER_TO


async def transfer_amount_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Third step of internal transfer: ask for amount."""
    query = update.callback_query
    await query.answer()
    to_bank = query.data.replace("tr_to_", "")
    context.user_data["transfer_to_id"] = "nu-db" if to_bank == "nubank" else "inter-db"
    await query.edit_message_text("Qual o valor? (ex: 1400,00)")
    return INC_AMOUNT


# ── Regular income flow ───────────────────────────────────────────────────────

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

    if context.user_data.get("is_transfer"):
        from_id = context.user_data["transfer_from_id"]
        to_id   = context.user_data["transfer_to_id"]
        context.user_data["inc_description"] = (
            f"Transferência {_ACCOUNT_LABELS[from_id]} → {_ACCOUNT_LABELS[to_id]}"
        )
        await update.message.reply_text("Quando foi a transferência?", reply_markup=_DATE_KB)
        return INC_DATE

    await update.message.reply_text('De onde veio? (ex: "Empresa X", "João", "Projeto site")')
    return INC_DESCRIPTION


async def income_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Save description and show date shortcut buttons."""
    if not _authorized(update):
        return ConversationHandler.END
    context.user_data["inc_description"] = update.message.text.strip()
    await update.message.reply_text("Quando o valor foi recebido?", reply_markup=_DATE_KB)
    return INC_DATE


async def income_date_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle Hoje/Ontem/Outra data buttons."""
    query = update.callback_query
    await query.answer()
    if query.data == "date_outra":
        await query.edit_message_text("Qual a data? (ex: 19/04/2026 ou 19/04/2026 14:30)")
        return INC_DATE
    today = date.today()
    d = today if query.data == "date_hoje" else today - timedelta(days=1)
    context.user_data["inc_date"] = d.strftime("%Y-%m-%d")
    context.user_data["inc_date_display"] = d.strftime("%d/%m/%Y")
    await _show_confirmation_edit(query, context)
    return INC_CONFIRMATION


async def income_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle typed date after 'Outra data', then show confirmation."""
    if not _authorized(update):
        return ConversationHandler.END
    parsed = _parse_purchase_date(update.message.text)
    if parsed is None:
        await update.message.reply_text(
            "Data inválida. Use o formato DD/MM/AAAA ou DD/MM/AAAA HH:MM"
        )
        return INC_DATE
    context.user_data["inc_date"], context.user_data["inc_date_display"] = parsed
    await _show_confirmation_reply(update, context)
    return INC_CONFIRMATION


# ── Confirmation helpers ──────────────────────────────────────────────────────

def _build_confirm_text(d: dict) -> str:
    if d.get("is_transfer"):
        return (
            f"Confirma a transferência?\n\n"
            f"De:    {_ACCOUNT_LABELS[d['transfer_from_id']]}\n"
            f"Para:  {_ACCOUNT_LABELS[d['transfer_to_id']]}\n"
            f"Valor: {_fmt_brl(d['inc_amount'])}\n"
            f"Data:  {d['inc_date_display']}"
        )
    method_label  = _METHOD_LABELS.get(d["inc_method"], d["inc_method"])
    account_label = "Nubank Conta" if d["inc_bank"] == "nubank" else "Inter Conta"
    return (
        f"Confirma o registro?\n\n"
        f"Tipo:  {method_label}\n"
        f"Valor: {_fmt_brl(d['inc_amount'])}\n"
        f"De:    {d['inc_description']}\n"
        f"Conta: {account_label}\n"
        f"Data:  {d['inc_date_display']}"
    )


async def _show_confirmation_edit(query, context: ContextTypes.DEFAULT_TYPE) -> None:
    await query.edit_message_text(
        _build_confirm_text(context.user_data),
        reply_markup=_build_confirm_kb(context.user_data)
    )

async def _show_confirmation_reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        _build_confirm_text(context.user_data),
        reply_markup=_build_confirm_kb(context.user_data)
    )

async def income_toggle_revenue(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data["inc_is_revenue"] = not context.user_data.get("inc_is_revenue", True)
    await _show_confirmation_edit(query, context)
    return INC_CONFIRMATION


# ── Save ──────────────────────────────────────────────────────────────────────

async def income_save(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Persist the income (or internal transfer) and notify the user."""
    query = update.callback_query
    await query.answer()

    if query.data == "inc_cancel":
        context.user_data.clear()
        await query.edit_message_text("Registro cancelado.")
        return ConversationHandler.END

    d = context.user_data

    if d.get("is_transfer"):
        # Internal transfer: single expense row on the source account with dest_account_id set.
        # Balance queries credit the destination via the inbound subquery automatically.
        # Summary queries exclude it via AND dest_account_id IS NULL — not counted as income or expense.
        database.insert_transaction(
            date=d["inc_date"],
            flow="expense",
            method="transfer",
            account_id=d["transfer_from_id"],
            amount=d["inc_amount"],
            description=d["inc_description"],
            dest_account_id=d["transfer_to_id"],
        )
        text = (
            f"Transferência registrada!\n\n"
            f"{_fmt_brl(d['inc_amount'])}\n"
            f"{_ACCOUNT_LABELS[d['transfer_from_id']]} → {_ACCOUNT_LABELS[d['transfer_to_id']]}\n"
            f"{d['inc_date_display']}"
        )
        await query.edit_message_text(text)
        context.user_data.clear()
        return ConversationHandler.END

    is_rev = 1 if d.get("inc_is_revenue", True) else 0

    tx_id = database.insert_transaction(
        date=d["inc_date"],
        flow="income",
        method=d["inc_method"],
        account_id=d["inc_account_id"],
        amount=d["inc_amount"],
        description=d["inc_description"],
        is_revenue=is_rev,
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
                    pattern="^inc_(salary|freelance|pix_received|other)$",
                ),
                CallbackQueryHandler(transfer_from_handler, pattern="^inc_transfer$"),
            ],
            INC_TRANSFER_FROM: [
                CallbackQueryHandler(transfer_to_handler, pattern="^tr_from_(nubank|inter)$"),
            ],
            INC_TRANSFER_TO: [
                CallbackQueryHandler(transfer_amount_handler, pattern="^tr_to_(nubank|inter)$"),
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
                CallbackQueryHandler(income_date_choice, pattern="^date_(hoje|ontem|outra)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, income_confirmation),
            ],
            INC_CONFIRMATION: [
                CallbackQueryHandler(income_save, pattern="^inc_(confirm|cancel)$"),
                CallbackQueryHandler(income_toggle_revenue, pattern="^inc_toggle_rev$"),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )
