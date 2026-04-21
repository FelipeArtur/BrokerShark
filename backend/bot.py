import asyncio
import logging
import os
import tempfile
from datetime import datetime
from typing import Optional

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Update,
)
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

import database
import sheets
from parsers import nubank_cc, inter_cc

TELEGRAM_CHAT_ID = int(os.getenv("TELEGRAM_CHAT_ID", "0"))
_logger = logging.getLogger(__name__)

# ── State constants ───────────────────────────────────────────────────────────

# Expense flow
(
    EXP_PAYMENT_TYPE,
    EXP_BANK,
    EXP_AMOUNT,
    EXP_INSTALLMENTS,
    EXP_NUM_INSTALLMENTS,
    EXP_DESCRIPTION,
    EXP_DATE,
    EXP_CATEGORY,
    EXP_CONFIRMATION,
) = range(9)

# Income flow
(
    INC_TYPE,
    INC_BANK,
    INC_AMOUNT,
    INC_DESCRIPTION,
    INC_DATE,
    INC_CONFIRMATION,
) = range(10, 16)

# Investment flow
(
    INV_OPERATION,
    INV_DESTINATION,
    INV_AMOUNT,
    INV_DESCRIPTION,
    INV_DATE,
    INV_CONFIRMATION,
) = range(20, 26)

# CSV import flow
(
    CSV_ACCOUNT,
    CSV_CONFIRMATION,
) = range(30, 32)

ACCOUNT_MAP = {
    ("pix",    "nubank"): "nu-db",
    ("ted",    "nubank"): "nu-db",
    ("credit", "nubank"): "nu-cc",
    ("pix",    "inter"):  "inter-db",
    ("ted",    "inter"):  "inter-db",
    ("credit", "inter"):  "inter-cc",
}

INVESTMENT_META = {
    "Caixinha Nubank":   ("savings",  "nubank"),
    "Tesouro Direto":    ("treasury", "nubank"),
    "Porquinho Inter":   ("savings",  "inter"),
}

PARSER_MAP = {
    "nu-cc":    nubank_cc,
    "inter-cc": inter_cc,
}

ACCOUNT_LABELS = {
    "nu-cc":    "Nubank Crédito",
    "nu-db":    "Nubank Conta",
    "inter-cc": "Inter Crédito",
    "inter-db": "Inter Conta",
}

METHOD_LABELS = {
    "pix":    "PIX",
    "credit": "Crédito",
    "ted":    "TED",
}

OPERATION_LABELS = {
    "deposit":    "Aporte",
    "withdrawal": "Resgate",
}


# ── Guards ────────────────────────────────────────────────────────────────────

def _authorized(update: Update) -> bool:
    return update.effective_chat.id == TELEGRAM_CHAT_ID


_PT_MONTHS = [
    "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]


def _fmt_brl(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_date(iso: str) -> str:
    """Convert YYYY-MM-DD to DD/MM/YYYY."""
    try:
        d = datetime.strptime(iso, "%Y-%m-%d")
        return d.strftime("%d/%m/%Y")
    except ValueError:
        return iso


def _parse_purchase_date(text: str) -> Optional[tuple[str, str]]:
    """Parse purchase date (and optional time) from user input.
    Returns (db_date: YYYY-MM-DD, display: DD/MM/YYYY HH:MM or DD/MM/YYYY)."""
    text = text.strip()
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%m/%Y %H:%M")
        except ValueError:
            continue
    try:
        dt = datetime.strptime(text, "%d/%m/%Y")
        return dt.strftime("%Y-%m-%d"), dt.strftime("%d/%m/%Y")
    except ValueError:
        return None


def _parse_amount(text: str) -> Optional[float]:
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


# ── Main menu ─────────────────────────────────────────────────────────────────

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return

    now = datetime.now()
    summary = database.get_monthly_summary(now.year, now.month)
    investments = database.get_all_investments()
    reservas_total = sum(inv["current_balance"] for inv in investments)

    top = summary.get("top_category")
    top_str = f"{top['name']} — {_fmt_brl(top['total'])}" if top else "—"

    greeting = (
        f"*BrokerShark* — {now.strftime('%d/%m/%Y')}\n\n"
        f"*{_PT_MONTHS[now.month]} {now.year}*\n"
        f"Gastos:        {_fmt_brl(summary['expenses'])}\n"
        f"Receitas:      {_fmt_brl(summary['income'])}\n"
        f"Top categoria: {top_str}\n"
        f"Reservas:      {_fmt_brl(reservas_total)}\n\n"
        "O que você quer fazer?"
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("💸 Gasto",        callback_data="menu_expense"),
            InlineKeyboardButton("💰 Recebimento",  callback_data="menu_income"),
        ],
        [InlineKeyboardButton("📈 Investimento", callback_data="menu_investment")],
    ])
    await update.message.reply_text(greeting, reply_markup=keyboard, parse_mode="Markdown")


# ═══════════════════════════════════════════════════════════════════════════════
# EXPENSE FLOW
# ═══════════════════════════════════════════════════════════════════════════════

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


async def expense_description_from_installments(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
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
    rows = [buttons[i:i+2] for i in range(0, len(buttons), 2)]
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


# ═══════════════════════════════════════════════════════════════════════════════
# INCOME FLOW
# ═══════════════════════════════════════════════════════════════════════════════

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
    context.user_data["inc_account_id"] = f"{bank[:2]}-db" if bank == "nubank" else "inter-db"
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

    method_labels = {
        "salary": "Salário", "freelance": "Freela",
        "pix_received": "PIX recebido", "transfer": "Transferência", "other": "Outro",
    }
    method_label = method_labels.get(d["inc_method"], d["inc_method"])
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

    method_labels = {
        "salary": "Salário", "freelance": "Freela",
        "pix_received": "PIX recebido", "transfer": "Transferência", "other": "Outro",
    }
    method_label = method_labels.get(d["inc_method"], d["inc_method"])
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


# ═══════════════════════════════════════════════════════════════════════════════
# INVESTMENT FLOW
# ═══════════════════════════════════════════════════════════════════════════════

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
            InlineKeyboardButton("Caixinha Nubank",  callback_data="inv_dest_Caixinha Nubank"),
            InlineKeyboardButton("Tesouro Direto",   callback_data="inv_dest_Tesouro Direto"),
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


# ═══════════════════════════════════════════════════════════════════════════════
# COMMAND HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def cmd_saldo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    accounts = database.get_all_accounts()
    lines = ["*Saldo por conta*\n"]
    for acc in accounts:
        balance = database.get_account_balance(acc["id"])
        lines.append(f"{acc['name']}: {_fmt_brl(balance)}")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_resumo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    now = datetime.now()
    summary = database.get_monthly_summary(now.year, now.month)
    top = summary.get("top_category")
    top_str = (
        f"{top['name']} — {_fmt_brl(top['total'])}" if top else "—"
    )
    text = (
        f"*Resumo de {_PT_MONTHS[now.month]}/{now.year}*\n\n"
        f"Gastos:         {_fmt_brl(summary['expenses'])}\n"
        f"Receitas:       {_fmt_brl(summary['income'])}\n"
        f"Top categoria:  {top_str}"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_fatura(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return

    lines = ["*Fatura dos cartões*\n"]
    for account_id, label in (("nu-cc", "Nubank Crédito"), ("inter-cc", "Inter Crédito")):
        info = database.get_credit_card_billing_info(account_id)
        due_str = (
            f"vence em {info['days_until_due']} dias ({info['due_date']})"
            if info["days_until_due"] >= 0
            else f"vencida há {abs(info['days_until_due'])} dias"
        )
        lines.append(
            f"*{label}*\n"
            f"  {_fmt_brl(info['total'])} — {due_str}\n"
            f"  Período: {info['cycle_start']} a {info['cycle_end']}"
        )

    await update.message.reply_text("\n\n".join(lines), parse_mode="Markdown")


async def cmd_reservas(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    investments = database.get_all_investments()
    if not investments:
        await update.message.reply_text("Nenhum investimento registrado ainda.")
        return
    lines = ["*Reservas*\n"]
    total = 0.0
    for inv in investments:
        lines.append(f"{inv['name']}: {_fmt_brl(inv['current_balance'])}")
        total += inv["current_balance"]
    lines.append(f"\nTotal: {_fmt_brl(total)}")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_ajuda(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _authorized(update):
        return
    text = (
        "*Comandos disponíveis*\n\n"
        "/novo — registrar gasto, recebimento ou investimento\n"
        "/saldo — saldo por conta\n"
        "/resumo — resumo do mês atual por categoria\n"
        "/fatura — fatura atual dos cartões de crédito\n"
        "/reservas — saldo dos investimentos\n"
        "/ajuda — esta mensagem\n\n"
        "Envie um arquivo .csv para importar extratos bancários."
    )
    await update.message.reply_text(text, parse_mode="Markdown")


# ═══════════════════════════════════════════════════════════════════════════════
# CSV IMPORT FLOW
# ═══════════════════════════════════════════════════════════════════════════════

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
    return ConversationHandler(
        entry_points=[
            MessageHandler(filters.Document.ALL, csv_received),
        ],
        states={
            CSV_ACCOUNT: [
                CallbackQueryHandler(
                    csv_preview, pattern="^csv_(nu-cc|inter-cc)$"
                ),
            ],
            CSV_CONFIRMATION: [
                CallbackQueryHandler(csv_import, pattern="^csv_(confirm|cancel)$"),
            ],
        },
        fallbacks=[CommandHandler("cancelar", cancel)],
        allow_reentry=True,
    )


# ── Cancellation ──────────────────────────────────────────────────────────────

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    if update.message:
        await update.message.reply_text("Operação cancelada.")
    return ConversationHandler.END


# ── ConversationHandlers ──────────────────────────────────────────────────────

def build_expense_handler() -> ConversationHandler:
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
                MessageHandler(filters.TEXT & ~filters.COMMAND, expense_description_from_installments),
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


def build_income_handler() -> ConversationHandler:
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


def build_investment_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[CallbackQueryHandler(investment_start, pattern="^menu_investment$")],
        states={
            INV_OPERATION: [
                CallbackQueryHandler(
                    investment_destination, pattern="^inv_(deposit|withdrawal)$"
                ),
            ],
            INV_DESTINATION: [
                CallbackQueryHandler(
                    investment_amount, pattern="^inv_dest_.+$"
                ),
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
    import warnings
    warnings.filterwarnings(
        "ignore",
        message="If 'per_message=False'",
        category=UserWarning,
    )

    token = os.getenv("TELEGRAM_TOKEN", "")
    app = (
        Application.builder()
        .token(token)
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
