"""CSV import flow and ConversationHandler builder."""
import asyncio
import tempfile
from datetime import datetime
from typing import Optional

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
from bot.constants import ACCOUNT_LABELS, CSV_ACCOUNT, CSV_CONFIRMATION, PARSER_MAP
from bot.handlers.commands import cancel
from bot.utils import _authorized, _fmt_brl, _fmt_date


async def csv_received(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    doc = update.message.document
    if not doc.file_name.lower().endswith(".csv"):
        return ConversationHandler.END

    file = await doc.get_file()
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        await file.download_to_drive(tmp.name)
        context.user_data["csv_path"] = tmp.name

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("Nubank Crédito", callback_data="csv_nu-cc"),
            InlineKeyboardButton("Inter Crédito",  callback_data="csv_inter-cc"),
        ],
    ])
    await update.message.reply_text(
        f"Arquivo recebido: *{doc.file_name}*\n\nDe qual conta é esse extrato?",
        reply_markup=keyboard,
        parse_mode="Markdown",
    )
    return CSV_ACCOUNT


async def csv_preview(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    account_id = query.data.replace("csv_", "")
    context.user_data["csv_account_id"] = account_id

    csv_path = context.user_data["csv_path"]
    try:
        with open(csv_path, encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception:
        await query.edit_message_text("Erro ao ler o arquivo. Tente novamente.")
        return ConversationHandler.END

    parser = PARSER_MAP[account_id]
    transactions = parser.parse(content)
    context.user_data["csv_transactions"] = transactions

    if not transactions:
        await query.edit_message_text("Nenhuma transação encontrada no arquivo.")
        return ConversationHandler.END

    dates = [t["date"] for t in transactions]
    total = sum(t["amount"] for t in transactions)
    account_label = ACCOUNT_LABELS[account_id]

    text = (
        f"*Preview — {account_label}*\n\n"
        f"Transações: {len(transactions)}\n"
        f"Período: {_fmt_date(min(dates))} → {_fmt_date(max(dates))}\n"
        f"Valor total: {_fmt_brl(total)}\n\n"
        f"Confirma a importação?"
    )
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Confirmar", callback_data="csv_confirm"),
        InlineKeyboardButton("Cancelar",  callback_data="csv_cancel"),
    ]])
    await query.edit_message_text(text, reply_markup=keyboard, parse_mode="Markdown")
    return CSV_CONFIRMATION


async def csv_import(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "csv_cancel":
        context.user_data.clear()
        await query.edit_message_text("Importação cancelada.")
        return ConversationHandler.END

    transactions = context.user_data.get("csv_transactions", [])
    account_id = context.user_data["csv_account_id"]
    bank = account_id.split("-")[0]
    imported = 0
    skipped = 0

    outro_id: Optional[int] = None
    expense_cats = database.get_categories("expense")
    outro_id = next((c["id"] for c in expense_cats if c["name"] == "Outro"), None)

    sheets_expenses: list[dict] = []
    sheets_incomes: list[dict] = []
    registered_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for t in transactions:
        if database.transaction_exists(t["date"], t["amount"], t["description"], t["account_id"]):
            skipped += 1
            continue

        tx_id = database.insert_transaction(
            date=t["date"],
            flow=t["flow"],
            method=t["method"],
            account_id=t["account_id"],
            amount=t["amount"],
            description=t["description"],
            installments=t.get("installments", 1),
            category_id=outro_id if t["flow"] == "expense" else None,
        )

        row = {
            "id": tx_id,
            "date": t["date"],
            "method": t["method"],
            "bank": bank,
            "account_id": t["account_id"],
            "amount": t["amount"],
            "installments": t.get("installments", 1),
            "description": t["description"],
            "category": "Outro" if t["flow"] == "expense" else None,
            "registered_at": registered_at,
        }
        if t["flow"] == "expense":
            sheets_expenses.append(row)
        else:
            sheets_incomes.append(row)
        imported += 1

    asyncio.get_event_loop().run_in_executor(None, sheets.batch_append_expenses, sheets_expenses)
    asyncio.get_event_loop().run_in_executor(None, sheets.batch_append_incomes, sheets_incomes)

    await query.edit_message_text(
        f"Importação concluída!\n\n"
        f"Registradas: {imported}\n"
        f"Duplicatas ignoradas: {skipped}"
    )
    context.user_data.clear()
    return ConversationHandler.END


def build_csv_handler() -> ConversationHandler:
    """Build the ConversationHandler for the CSV import flow."""
    return ConversationHandler(
        entry_points=[
            MessageHandler(filters.Document.ALL, csv_received),
        ],
        states={
            CSV_ACCOUNT: [
                CallbackQueryHandler(csv_preview, pattern="^csv_(nu-cc|inter-cc)$"),
            ],
            CSV_CONFIRMATION: [
                CallbackQueryHandler(csv_import, pattern="^csv_(confirm|cancel)$"),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )
