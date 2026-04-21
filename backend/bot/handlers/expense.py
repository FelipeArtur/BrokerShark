"""Expense registration flow and ConversationHandler builder."""
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
    ACCOUNT_CHOICES,
    EXP_ACCOUNT,
    EXP_AMOUNT,
    EXP_INSTALLMENTS,
    EXP_DESCRIPTION,
    EXP_DATE,
    EXP_CATEGORY,
    EXP_CONFIRMATION,
    METHOD_LABELS,
)
from bot.handlers.commands import cancel
from bot.utils import _authorized, _fmt_brl, _parse_amount, _parse_purchase_date, _PT_MONTHS

_DATE_KB = InlineKeyboardMarkup([[
    InlineKeyboardButton("Hoje",       callback_data="date_hoje"),
    InlineKeyboardButton("Ontem",      callback_data="date_ontem"),
    InlineKeyboardButton("Outra data", callback_data="date_outra"),
]])


async def expense_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Entry point: show combined payment-method + bank selection."""
    query = update.callback_query
    await query.answer()
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("Nubank Crédito", callback_data="acc_nu-cc_credit"),
            InlineKeyboardButton("Inter Crédito",  callback_data="acc_inter-cc_credit"),
        ],
        [
            InlineKeyboardButton("Nubank PIX", callback_data="acc_nu-db_pix"),
            InlineKeyboardButton("Inter PIX",  callback_data="acc_inter-db_pix"),
        ],
        [
            InlineKeyboardButton("Nubank TED", callback_data="acc_nu-db_ted"),
            InlineKeyboardButton("Inter TED",  callback_data="acc_inter-db_ted"),
        ],
    ])
    await query.edit_message_text("Como foi o pagamento?", reply_markup=keyboard)
    return EXP_ACCOUNT


async def expense_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Store account+method from selection, ask for amount."""
    query = update.callback_query
    await query.answer()
    key = query.data.replace("acc_", "")
    account_id, method = ACCOUNT_CHOICES[key]
    context.user_data["exp_account_id"] = account_id
    context.user_data["exp_method"] = method
    context.user_data["exp_bank"] = "nubank" if account_id.startswith("nu") else "inter"
    await query.edit_message_text("Qual o valor? (ex: 45,90)")
    return EXP_AMOUNT


async def expense_installments(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Parse amount; show installment buttons for credit, skip to description for PIX/TED."""
    if not _authorized(update):
        return ConversationHandler.END
    amount = _parse_amount(update.message.text)
    if amount is None:
        await update.message.reply_text("Valor inválido. Tente novamente (ex: 45,90)")
        return EXP_AMOUNT
    context.user_data["exp_amount"] = amount

    if context.user_data["exp_method"] != "credit":
        context.user_data["exp_installments"] = 1
        await update.message.reply_text("Como você quer chamar esse gasto?")
        return EXP_DESCRIPTION

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("À vista", callback_data="inst_1"),
            InlineKeyboardButton("2x",      callback_data="inst_2"),
            InlineKeyboardButton("3x",      callback_data="inst_3"),
        ],
        [
            InlineKeyboardButton("4x",      callback_data="inst_4"),
            InlineKeyboardButton("6x",      callback_data="inst_6"),
            InlineKeyboardButton("12x",     callback_data="inst_12"),
        ],
        [InlineKeyboardButton("Outro número", callback_data="inst_other")],
    ])
    await update.message.reply_text("Em quantas vezes?", reply_markup=keyboard)
    return EXP_INSTALLMENTS


async def expense_installments_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle installment button: store count and proceed, or ask for custom number."""
    query = update.callback_query
    await query.answer()
    if query.data == "inst_other":
        await query.edit_message_text("Em quantas vezes? (mínimo 2)")
        return EXP_INSTALLMENTS
    context.user_data["exp_installments"] = int(query.data.replace("inst_", ""))
    await query.edit_message_text("Como você quer chamar esse gasto?")
    return EXP_DESCRIPTION


async def expense_installments_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle typed installment count after 'Outro número'."""
    if not _authorized(update):
        return ConversationHandler.END
    try:
        n = int(update.message.text.strip())
        if n < 2:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Digite um número válido (mínimo 2).")
        return EXP_INSTALLMENTS
    context.user_data["exp_installments"] = n
    await update.message.reply_text("Como você quer chamar esse gasto?")
    return EXP_DESCRIPTION


async def expense_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Save description and show date shortcut buttons."""
    if not _authorized(update):
        return ConversationHandler.END
    context.user_data["exp_description"] = update.message.text.strip()
    await update.message.reply_text("Quando foi a compra?", reply_markup=_DATE_KB)
    return EXP_DATE


async def expense_date_choice(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle Hoje/Ontem/Outra data buttons."""
    query = update.callback_query
    await query.answer()
    if query.data == "date_outra":
        await query.edit_message_text("Qual a data? (ex: 19/04/2026 ou 19/04/2026 14:30)")
        return EXP_DATE
    today = date.today()
    d = today if query.data == "date_hoje" else today - timedelta(days=1)
    context.user_data["exp_date"] = d.strftime("%Y-%m-%d")
    context.user_data["exp_date_display"] = d.strftime("%d/%m/%Y")
    return await _ask_category_edit(query, context)


async def expense_date_typed(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle typed date after 'Outra data' selection."""
    if not _authorized(update):
        return ConversationHandler.END
    parsed = _parse_purchase_date(update.message.text)
    if parsed is None:
        await update.message.reply_text(
            "Data inválida. Use o formato DD/MM/AAAA ou DD/MM/AAAA HH:MM"
        )
        return EXP_DATE
    context.user_data["exp_date"], context.user_data["exp_date_display"] = parsed
    categories = database.get_categories("expense")
    buttons = [
        InlineKeyboardButton(cat["name"], callback_data=f"cat_{cat['id']}")
        for cat in categories
    ]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    await update.message.reply_text("Qual a categoria?", reply_markup=InlineKeyboardMarkup(rows))
    return EXP_CATEGORY


async def _ask_category_edit(query, context: ContextTypes.DEFAULT_TYPE) -> int:
    categories = database.get_categories("expense")
    buttons = [
        InlineKeyboardButton(cat["name"], callback_data=f"cat_{cat['id']}")
        for cat in categories
    ]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    await query.edit_message_text("Qual a categoria?", reply_markup=InlineKeyboardMarkup(rows))
    return EXP_CATEGORY


async def expense_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show confirmation summary after category selection."""
    query = update.callback_query
    await query.answer()
    cat_id = int(query.data.replace("cat_", ""))
    cat = database.get_category(cat_id)
    context.user_data["exp_category_id"] = cat_id
    context.user_data["exp_category_name"] = cat["name"]

    d = context.user_data
    method_label = METHOD_LABELS.get(d["exp_method"], d["exp_method"])
    bank_label = d["exp_bank"].capitalize()
    amount = d["exp_amount"]
    installments = d.get("exp_installments", 1)

    if installments > 1:
        valor_str = f"{_fmt_brl(amount)} ({installments}x de {_fmt_brl(amount / installments)})"
    else:
        valor_str = _fmt_brl(amount)

    text = (
        f"Confirma o registro?\n\n"
        f"Tipo:      {method_label} — {bank_label}\n"
        f"Valor:     {valor_str}\n"
        f"Gasto:     {d['exp_description']}\n"
        f"Categoria: {d['exp_category_name']}\n"
        f"Data:      {d['exp_date_display']}"
    )
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Confirmar", callback_data="exp_confirm"),
        InlineKeyboardButton("Cancelar",  callback_data="exp_cancel"),
    ]])
    await query.edit_message_text(text, reply_markup=keyboard)
    return EXP_CONFIRMATION


async def expense_save(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Persist the expense and notify the user."""
    query = update.callback_query
    await query.answer()

    if query.data == "exp_cancel":
        context.user_data.clear()
        await query.edit_message_text("Registro cancelado.")
        return ConversationHandler.END

    d = context.user_data
    tx_id = database.insert_transaction(
        date=d["exp_date"],
        flow="expense",
        method=d["exp_method"],
        account_id=d["exp_account_id"],
        amount=d["exp_amount"],
        description=d["exp_description"],
        installments=d.get("exp_installments", 1),
        category_id=d["exp_category_id"],
    )

    asyncio.get_event_loop().run_in_executor(
        None,
        sheets.append_expense,
        {
            "id": tx_id,
            "date": d["exp_date_display"],
            "method": d["exp_method"],
            "bank": d["exp_bank"],
            "account_id": d["exp_account_id"],
            "amount": d["exp_amount"],
            "installments": d.get("exp_installments", 1),
            "description": d["exp_description"],
            "category": d["exp_category_name"],
            "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    method_label = METHOD_LABELS.get(d["exp_method"], d["exp_method"])
    bank_label = d["exp_bank"].capitalize()
    text = (
        f"Gasto registrado!\n\n"
        f"{d['exp_description']} — {_fmt_brl(d['exp_amount'])}\n"
        f"{bank_label} {method_label} · {d['exp_category_name']}\n"
        f"{d['exp_date_display']}"
    )
    await query.edit_message_text(text)
    context.user_data.clear()

    await _check_spending_alert(query.message.chat_id, context)
    return ConversationHandler.END


async def _check_spending_alert(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a warning if monthly expenses have reached or exceeded income."""
    now = datetime.now()
    summary = database.get_monthly_summary(now.year, now.month)
    if summary["income"] > 0 and summary["expenses"] >= summary["income"]:
        pct = int(summary["expenses"] / summary["income"] * 100)
        await context.bot.send_message(
            chat_id=chat_id,
            text=(
                f"⚠️ *Atenção!* Seus gastos em {_PT_MONTHS[now.month]} já representam "
                f"*{pct}%* das suas receitas.\n\n"
                f"Gastos:   {_fmt_brl(summary['expenses'])}\n"
                f"Receitas: {_fmt_brl(summary['income'])}"
            ),
            parse_mode="Markdown",
        )


def build_expense_handler() -> ConversationHandler:
    """Build the ConversationHandler for the expense registration flow."""
    return ConversationHandler(
        entry_points=[CallbackQueryHandler(expense_start, pattern="^menu_expense$")],
        states={
            EXP_ACCOUNT: [
                CallbackQueryHandler(expense_amount, pattern="^acc_.+$"),
            ],
            EXP_AMOUNT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_installments),
            ],
            EXP_INSTALLMENTS: [
                CallbackQueryHandler(expense_installments_choice, pattern=r"^inst_(\d+|other)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_installments_text),
            ],
            EXP_DESCRIPTION: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_date),
            ],
            EXP_DATE: [
                CallbackQueryHandler(expense_date_choice, pattern="^date_(hoje|ontem|outra)$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_date_typed),
            ],
            EXP_CATEGORY: [
                CallbackQueryHandler(expense_confirmation, pattern=r"^cat_\d+$"),
            ],
            EXP_CONFIRMATION: [
                CallbackQueryHandler(expense_save, pattern="^exp_(confirm|cancel)$"),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )
