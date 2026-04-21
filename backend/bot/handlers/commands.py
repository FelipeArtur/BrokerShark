"""Command handlers: /novo (start), /saldo, /resumo, /fatura, /reservas, /ajuda, /cancelar."""
from datetime import datetime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes, ConversationHandler

import database
from bot.utils import _authorized, _fmt_brl, _PT_MONTHS


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show the main menu with a monthly summary header."""
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
            InlineKeyboardButton("💸 Gasto",       callback_data="menu_expense"),
            InlineKeyboardButton("💰 Recebimento", callback_data="menu_income"),
        ],
        [InlineKeyboardButton("📈 Investimento", callback_data="menu_investment")],
    ])
    await update.message.reply_text(greeting, reply_markup=keyboard, parse_mode="Markdown")


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Abort the current conversation and clear collected state."""
    context.user_data.clear()
    if update.message:
        await update.message.reply_text("Operação cancelada.")
    return ConversationHandler.END


async def cmd_saldo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply with the current balance for every account."""
    if not _authorized(update):
        return
    accounts = database.get_all_accounts()
    lines = ["*Saldo por conta*\n"]
    for acc in accounts:
        balance = database.get_account_balance(acc["id"])
        lines.append(f"{acc['name']}: {_fmt_brl(balance)}")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def cmd_resumo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply with the current month income/expense summary."""
    if not _authorized(update):
        return
    now = datetime.now()
    summary = database.get_monthly_summary(now.year, now.month)
    top = summary.get("top_category")
    top_str = f"{top['name']} — {_fmt_brl(top['total'])}" if top else "—"
    text = (
        f"*Resumo de {_PT_MONTHS[now.month]}/{now.year}*\n\n"
        f"Gastos:         {_fmt_brl(summary['expenses'])}\n"
        f"Receitas:       {_fmt_brl(summary['income'])}\n"
        f"Top categoria:  {top_str}"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_fatura(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply with the current billing cycle totals for each credit card."""
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
    """Reply with current balances for all investments."""
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
    """Reply with the list of available commands."""
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
