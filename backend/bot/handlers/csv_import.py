"""CSV import flow with AI-assisted categorization."""
from __future__ import annotations

import asyncio
import json
import tempfile
from datetime import datetime
from typing import Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatAction
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
from integrations import ollama
from bot.constants import (
    ACCOUNT_LABELS,
    CSV_ACCOUNT,
    CSV_AI_CATEGORIZING,
    CSV_CONFIRMATION,
    PARSER_MAP,
)
from bot.handlers.commands import cancel
from bot.utils import _authorized, _fmt_brl, _fmt_date


# ── Helpers ───────────────────────────────────────────────────────────────────

def _preview_text(transactions: list[dict], suggestions: dict[str, str], account_id: str) -> str:
    """Build the preview message text with AI category suggestions shown."""
    dates = [t["date"] for t in transactions]
    total = sum(t["amount"] for t in transactions if t["flow"] == "expense")
    account_label = ACCOUNT_LABELS[account_id]

    has_ai = bool(suggestions)
    ai_badge = " ✨ IA" if has_ai else ""

    lines = [
        f"*Preview — {account_label}{ai_badge}*\n",
        f"Transações: {len(transactions)}",
        f"Período: {_fmt_date(min(dates))} → {_fmt_date(max(dates))}",
        f"Valor total: {_fmt_brl(total)}\n",
    ]

    if has_ai:
        lines.append("*Categorias sugeridas:*")
        cat_counts: dict[str, int] = {}
        for t in transactions:
            if t["flow"] == "expense":
                cat = suggestions.get(t["description"], "Outro")
                cat_counts[cat] = cat_counts.get(cat, 0) + 1
        for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1]):
            lines.append(f"  {cat}: {count} transações")
        lines.append("")

    lines.append("Confirma a importação?")
    return "\n".join(lines)


def _confirmation_keyboard(has_ai: bool) -> InlineKeyboardMarkup:
    row = [InlineKeyboardButton("Confirmar", callback_data="csv_confirm")]
    if has_ai:
        row.append(InlineKeyboardButton("Ajustar ✨", callback_data="csv_adjust"))
    row.append(InlineKeyboardButton("Cancelar", callback_data="csv_cancel"))
    return InlineKeyboardMarkup([row])


# ── Handlers ──────────────────────────────────────────────────────────────────

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

    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Nubank Crédito", callback_data="csv_nu-cc"),
        InlineKeyboardButton("Inter Crédito",  callback_data="csv_inter-cc"),
    ]])
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

    # ── AI categorization (best-effort, 20 s timeout) ─────────────────────────
    suggestions: dict[str, str] = {}
    expense_txs = [t for t in transactions if t["flow"] == "expense"]
    if expense_txs and await ollama.is_available():
        await context.bot.send_chat_action(
            chat_id=update.effective_chat.id, action=ChatAction.TYPING
        )
        expense_cats = database.get_categories("expense")
        valid_cats = [c["name"] for c in expense_cats]
        patterns = database.get_categorization_patterns(100)
        tx_for_ai = [{"description": t["description"], "amount": t["amount"]} for t in expense_txs]
        suggestions = await ollama.suggest_categories(tx_for_ai, patterns, valid_cats)

    context.user_data["csv_suggestions"] = suggestions

    text = _preview_text(transactions, suggestions, account_id)
    await query.edit_message_text(
        text,
        reply_markup=_confirmation_keyboard(bool(suggestions)),
        parse_mode="Markdown",
    )
    return CSV_CONFIRMATION


async def csv_start_adjust(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """User tapped 'Ajustar ✨' — prompt for free-text adjustments."""
    query = update.callback_query
    await query.answer()

    transactions = context.user_data.get("csv_transactions", [])
    suggestions = context.user_data.get("csv_suggestions", {})

    # Show current assignments so the user knows what to adjust
    lines = ["*Categorias atuais:*"]
    seen: set[str] = set()
    for t in transactions:
        if t["flow"] == "expense" and t["description"] not in seen:
            seen.add(t["description"])
            cat = suggestions.get(t["description"], "Outro")
            lines.append(f"  {t['description'][:35]} → {cat}")

    lines.append("\nDigite o ajuste em linguagem natural, ex:")
    lines.append('_"iFood é Alimentação, PS Store é Jogos"_')

    await query.edit_message_text("\n".join(lines), parse_mode="Markdown")
    return CSV_AI_CATEGORIZING


async def csv_apply_adjustment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """User typed an adjustment — let Ollama interpret and update suggestions."""
    if not _authorized(update) or not update.message or not update.message.text:
        return CSV_AI_CATEGORIZING

    adjustment_text = update.message.text.strip()
    account_id = context.user_data["csv_account_id"]
    transactions = context.user_data.get("csv_transactions", [])
    suggestions: dict[str, str] = context.user_data.get("csv_suggestions", {})

    await context.bot.send_chat_action(
        chat_id=update.effective_chat.id, action=ChatAction.TYPING
    )

    expense_cats = database.get_categories("expense")
    valid_cats = [c["name"] for c in expense_cats]
    cats_str = ", ".join(valid_cats)

    current_json = json.dumps(suggestions, ensure_ascii=False)
    prompt = (
        f"O usuário quer ajustar categorias de transações financeiras.\n"
        f"Categorias válidas: {cats_str}\n\n"
        f"Atribuições atuais (JSON):\n{current_json}\n\n"
        f"Ajuste solicitado: \"{adjustment_text}\"\n\n"
        f"Retorne APENAS o JSON atualizado com as mesmas chaves, "
        f"aplicando as mudanças pedidas. Não inclua explicações."
    )

    msg = await ollama.chat([{"role": "user", "content": prompt}])
    if msg:
        try:
            start = msg.find("{")
            end = msg.rfind("}") + 1
            if start != -1 and end > 0:
                raw: dict[str, str] = json.loads(msg[start:end])
                valid_set = set(valid_cats)
                suggestions = {k: v for k, v in raw.items() if v in valid_set}
                context.user_data["csv_suggestions"] = suggestions
        except (json.JSONDecodeError, ValueError):
            pass

    text = _preview_text(transactions, suggestions, account_id)
    keyboard = _confirmation_keyboard(True)
    await update.message.reply_text(text, reply_markup=keyboard, parse_mode="Markdown")
    return CSV_CONFIRMATION


async def csv_import(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "csv_cancel":
        context.user_data.clear()
        await query.edit_message_text("Importação cancelada.")
        return ConversationHandler.END

    transactions = context.user_data.get("csv_transactions", [])
    suggestions: dict[str, str] = context.user_data.get("csv_suggestions", {})
    account_id = context.user_data["csv_account_id"]
    bank = account_id.split("-")[0]

    # Build category name → id lookup
    expense_cats = database.get_categories("expense")
    cat_id_by_name: dict[str, int] = {c["name"]: c["id"] for c in expense_cats}
    outro_id: Optional[int] = cat_id_by_name.get("Outro")

    imported = 0
    skipped = 0
    sheets_expenses: list[dict] = []
    sheets_incomes: list[dict] = []
    registered_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for t in transactions:
        if database.transaction_exists(t["date"], t["amount"], t["description"], t["account_id"]):
            skipped += 1
            continue

        suggested_cat_name = suggestions.get(t["description"])
        category_id = (
            cat_id_by_name.get(suggested_cat_name, outro_id)
            if t["flow"] == "expense" and suggested_cat_name
            else (outro_id if t["flow"] == "expense" else None)
        )

        tx_id = database.insert_transaction(
            date=t["date"],
            flow=t["flow"],
            method=t["method"],
            account_id=t["account_id"],
            amount=t["amount"],
            description=t["description"],
            installments=t.get("installments", 1),
            category_id=category_id,
        )

        cat_name = (
            cat_id_by_name.get(category_id, "Outro")  # type: ignore[arg-type]
            if t["flow"] == "expense" and category_id
            else None
        )
        # Resolve name from id for Sheets row
        id_to_name = {v: k for k, v in cat_id_by_name.items()}
        cat_label = id_to_name.get(category_id, "Outro") if category_id else None

        row = {
            "id": tx_id,
            "date": t["date"],
            "method": t["method"],
            "bank": bank,
            "account_id": t["account_id"],
            "amount": t["amount"],
            "installments": t.get("installments", 1),
            "description": t["description"],
            "category": cat_label,
            "registered_at": registered_at,
        }
        if t["flow"] == "expense":
            sheets_expenses.append(row)
        else:
            sheets_incomes.append(row)
        imported += 1

    asyncio.get_event_loop().run_in_executor(None, sheets.batch_append_expenses, sheets_expenses)
    asyncio.get_event_loop().run_in_executor(None, sheets.batch_append_incomes, sheets_incomes)

    ai_note = " (com sugestões IA ✨)" if suggestions else ""
    await query.edit_message_text(
        f"Importação concluída{ai_note}!\n\n"
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
                CallbackQueryHandler(csv_import,        pattern="^csv_(confirm|cancel)$"),
                CallbackQueryHandler(csv_start_adjust,  pattern="^csv_adjust$"),
            ],
            CSV_AI_CATEGORIZING: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, csv_apply_adjustment),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )
