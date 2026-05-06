"""Command handlers: /start, /saldo, /resumo, /fatura, /reservas, /ajuda, /cancelar."""
from datetime import datetime

from telegram import Update
from telegram.ext import ContextTypes

from core import database
from bot.utils import _authorized, _fmt_brl, _PT_MONTHS


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Show the monthly snapshot and invite the user to chat."""
    if not _authorized(update):
        return

    now = datetime.now()
    summary = database.get_monthly_summary(now.year, now.month)
    investments = database.get_all_investments()
    reservas_total = sum(inv["current_balance"] for inv in investments)

    top = summary.get("top_category")
    top_str = f"{top['name']} — {_fmt_brl(top['total'])}" if top else "—"

    # Sinaliza para o ai_chat_handler limpar histórico na próxima mensagem
    context.bot_data[f"clear_history_{update.effective_chat.id}"] = True

    text = (
        f"*BrokerShark* — {now.strftime('%d/%m/%Y')}\n\n"
        f"*{_PT_MONTHS[now.month]} {now.year}*\n"
        f"Gastos:        {_fmt_brl(summary['expenses'])}\n"
        f"Receitas:      {_fmt_brl(summary['income'])}\n"
        f"Top categoria: {top_str}\n"
        f"Reservas:      {_fmt_brl(reservas_total)}\n\n"
        "Como posso ajudar? Pode falar livremente — registre gastos, receitas, "
        "investimentos ou me faça perguntas sobre suas finanças."
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Cancel any pending AI registration."""
    chat_id = update.effective_chat.id
    pending = context.bot_data.get("pending", {})
    if pending.pop(chat_id, None):
        await update.message.reply_text("Registro cancelado.")
    else:
        await update.message.reply_text("Nada para cancelar.")


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
        "*BrokerShark — como usar*\n\n"
        "Fale livremente para registrar ou consultar:\n"
        "_\"gastei 45 reais no iFood hoje no crédito nubank\"_\n"
        "_\"recebi 3500 de salário na nubank\"_\n"
        "_\"investi 500 na caixinha nubank\"_\n"
        "_\"quanto gastei esse mês?\"_\n\n"
        "*Comandos rápidos*\n"
        "/start — resumo do mês\n"
        "/saldo — saldo por conta\n"
        "/resumo — gastos por categoria\n"
        "/fatura — faturas dos cartões\n"
        "/reservas — saldo dos investimentos\n"
        "/cancelar — cancela registro pendente\n\n"
        "Envie um arquivo _.csv_ para importar extratos bancários."
    )
    await update.message.reply_text(text, parse_mode="Markdown")
