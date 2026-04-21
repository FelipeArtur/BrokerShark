"""Expense registration flow and ConversationHandler builder."""
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
    ACCOUNT_MAP,
    EXP_AMOUNT,
    EXP_BANK,
    EXP_CATEGORY,
    EXP_CONFIRMATION,
    EXP_DATE,
    EXP_DESCRIPTION,
    EXP_INSTALLMENTS,
    EXP_NUM_INSTALLMENTS,
    EXP_PAYMENT_TYPE,
    METHOD_LABELS,
)
from bot.handlers.commands import cancel
from bot.utils import _authorized, _fmt_brl, _parse_amount, _parse_purchase_date, _PT_MONTHS


async def expense_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("PIX",     callback_data="exp_pix"),
            InlineKeyboardButton("Crédito", callback_data="exp_credit"),
            InlineKeyboardButton("TED",     callback_data="exp_ted"),
        ],
    ])
    await query.edit_message_text("Como foi o pagamento?", reply_markup=keyboard)
    return EXP_PAYMENT_TYPE


async def expense_bank(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    method = query.data.replace("exp_", "")
    context.user_data["exp_method"] = method
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Nubank", callback_data="bank_nubank"),
        InlineKeyboardButton("Inter",  callback_data="bank_inter"),
    ]])
    await query.edit_message_text("Qual banco?", reply_markup=keyboard)
    return EXP_BANK


async def expense_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    bank = query.data.replace("bank_", "")
    context.user_data["exp_bank"] = bank
    context.user_data["exp_account_id"] = ACCOUNT_MAP[(context.user_data["exp_method"], bank)]
    await query.edit_message_text("Qual o valor? (ex: 45,90)")
    return EXP_AMOUNT


async def expense_installments(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    amount = _parse_amount(update.message.text)
    if amount is None:
        await update.message.reply_text("Valor inválido. Tente novamente (ex: 45,90)")
        return EXP_AMOUNT
    context.user_data["exp_amount"] = amount

    if context.user_data["exp_method"] != "credit":
        context.user_data["exp_installments"] = 1
        return await _ask_description(update, context)

    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Sim", callback_data="inst_yes"),
        InlineKeyboardButton("Não", callback_data="inst_no"),
    ]])
    await update.message.reply_text("Foi parcelado?", reply_markup=keyboard)
    return EXP_INSTALLMENTS


async def expense_num_installments(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if query.data == "inst_no":
        context.user_data["exp_installments"] = 1
        await query.edit_message_text("Como você quer chamar esse gasto?")
        return EXP_DESCRIPTION
    await query.edit_message_text("Em quantas vezes?")
    return EXP_NUM_INSTALLMENTS


async def expense_description_from_installments(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    try:
        n = int(update.message.text.strip())
        if n < 2:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Digite um número válido (mínimo 2).")
        return EXP_NUM_INSTALLMENTS
    context.user_data["exp_installments"] = n
    await update.message.reply_text("Como você quer chamar esse gasto?")
    return EXP_DESCRIPTION


async def _ask_description(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text("Como você quer chamar esse gasto?")
    return EXP_DESCRIPTION


async def expense_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not _authorized(update):
        return ConversationHandler.END
    context.user_data["exp_description"] = update.message.text.strip()
    await update.message.reply_text(
        "Quando foi a compra?\n(ex: 19/04/2026 ou 19/04/2026 14:30)"
    )
    return EXP_DATE


async def expense_category(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
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
    keyboard = InlineKeyboardMarkup(rows)
    await update.message.reply_text("Qual a categoria?", reply_markup=keyboard)
    return EXP_CATEGORY


async def expense_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
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
    """Send a warning message if monthly expenses have reached or exceeded income."""
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
            EXP_PAYMENT_TYPE: [
                CallbackQueryHandler(expense_bank, pattern="^exp_(pix|credit|ted)$"),
            ],
            EXP_BANK: [
                CallbackQueryHandler(expense_amount, pattern="^bank_(nubank|inter)$"),
            ],
            EXP_AMOUNT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_installments),
            ],
            EXP_INSTALLMENTS: [
                CallbackQueryHandler(expense_num_installments, pattern="^inst_(yes|no)$"),
            ],
            EXP_NUM_INSTALLMENTS: [
                MessageHandler(
                    filters.TEXT & ~filters.COMMAND, expense_description_from_installments
                ),
            ],
            EXP_DESCRIPTION: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_date),
            ],
            EXP_DATE: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_category),
            ],
            EXP_CATEGORY: [
                CallbackQueryHandler(expense_confirmation, pattern="^cat_\\d+$"),
            ],
            EXP_CONFIRMATION: [
                CallbackQueryHandler(expense_save, pattern="^exp_(confirm|cancel)$"),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )
