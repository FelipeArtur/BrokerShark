"""AI chat handler — interface conversacional principal do BrokerShark.

Usa prompt-based tool calling (sem o campo nativo ``tools``) para compatibilidade
com modelos locais como phi3.5 que não suportam a API de ferramentas do Ollama.

Fluxo de registro:
  1. Usuário descreve o gasto/receita em texto livre
  2. Ollama responde com JSON  {"tool": "register_*", "args": {...}}
  3. Bot exibe a confirmação formatada ao usuário
  4. Usuário diz "sim" → Ollama chama {"tool": "confirm", "args": {}} → INSERT
  5. Usuário diz "não" → Ollama chama {"tool": "cancel", "args": {}}
"""
from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime, timedelta
from typing import Any, Optional

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import ContextTypes

from bot.utils import _authorized, _fmt_brl
from core import database
from integrations import ollama, sheets

_logger = logging.getLogger(__name__)
# Habilita INFO para ver respostas do modelo no log
logging.basicConfig(level=logging.INFO)

MAX_ROUNDS = 6
MAX_HISTORY = 6
HISTORY_PURGE_AT = 16

_VALID_TOOLS = {
    "get_monthly_summary", "get_expenses_by_category", "get_account_balances",
    "get_investments", "get_recent_transactions", "get_budgets",
    "get_monthly_comparison",
    "register_expense", "register_income", "register_investment",
    "register_transfer", "confirm", "cancel",
}

# ── Mapeamentos ───────────────────────────────────────────────────────────────

_ACCOUNT_LABELS: dict[str, str] = {
    "nu-cc": "Nubank Crédito", "nu-db": "Nubank Conta",
    "inter-cc": "Inter Crédito", "inter-db": "Inter Conta",
}
_ACCOUNT_BANK: dict[str, str] = {
    "nu-cc": "nubank", "nu-db": "nubank",
    "inter-cc": "inter", "inter-db": "inter",
}
_METHOD_LABELS: dict[str, str] = {
    "credit": "Crédito", "pix": "PIX", "ted": "TED",
}
_INCOME_LABELS: dict[str, str] = {
    "salary": "Salário", "freelance": "Freela",
    "pix_received": "PIX recebido", "other": "Outro",
}

# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
Você é o BrokerShark, assistente financeiro pessoal. Toda interação é por texto livre.

CONTAS:
- nu-cc    = Nubank Crédito   (método: credit)
- nu-db    = Nubank Conta     (métodos: pix, ted)
- inter-cc = Inter Crédito    (método: credit)
- inter-db = Inter Conta      (métodos: pix, ted)

CATEGORIAS DE GASTO: Alimentação, Carro, Jogos, Lazer, Atividade física, Eletrônicos, Educação, Igreja, Dízimo, Outro
INVESTIMENTOS: "Caixinha Nubank", "Porquinho Inter", "Tesouro Direto"
TIPOS DE RECEITA: salary, freelance, pix_received, other

════════════════════════════════════════
FERRAMENTAS — quando precisar de dados ou registrar algo, responda SOMENTE com JSON puro, sem nenhum texto antes ou depois:
{"tool": "NOME", "args": {ARGUMENTOS}}

Ferramentas disponíveis:
  get_monthly_summary       args: year, month
  get_monthly_comparison    args: month1_year, month1, month2_year, month2  ← USE ISSO para comparar dois meses
  get_expenses_by_category  args: year, month
  get_account_balances      args: (nenhum)
  get_investments           args: (nenhum)
  get_recent_transactions   args: (nenhum)
  get_budgets               args: (nenhum)
  register_expense          args: date(YYYY-MM-DD), amount, description, category, account_id, method, installments(padrão=1)
  register_income           args: date, amount, description, income_type, account_id
  register_investment       args: date, amount, investment_name, operation(deposit|withdrawal), description(opcional)
  register_transfer         args: date, amount, from_account, to_account
  confirm                   args: (nenhum) — após usuário dizer sim
  cancel                    args: (nenhum) — após usuário dizer não

EXEMPLOS:
Usuário: "quanto gastei em maio?"
→ {"tool": "get_monthly_summary", "args": {"year": 2026, "month": 5}}

Usuário: "compare meus gastos de abril e maio" ou "compare os últimos dois meses"
→ {"tool": "get_monthly_comparison", "args": {"month1_year": 2026, "month1": 4, "month2_year": 2026, "month2": 5}}

Usuário: "gastei 80 no iFood hoje no nubank crédito"
→ {"tool": "register_expense", "args": {"date": "DATA_ATUAL", "amount": 80.0, "description": "iFood", "category": "Alimentação", "account_id": "nu-cc", "method": "credit", "installments": 1}}

Usuário: "sim"  (após ver confirmação pendente)
→ {"tool": "confirm", "args": {}}

════════════════════════════════════════
REGRAS:
1. Saudações, perguntas e conversas gerais → responda diretamente em texto. NÃO chame nenhuma ferramenta.
2. Perguntas sobre dados financeiros → chame a ferramenta de leitura adequada, depois responda em português.
3. Para registrar → chame register_*, o sistema exibe a confirmação automaticamente.
4. confirm() → SOMENTE quando o usuário responder explicitamente "sim", "ok", "pode", "confirma" a uma confirmação pendente.
5. cancel() → SOMENTE quando o usuário responder "não", "cancela", "errado" a uma confirmação pendente.
6. NUNCA chame confirm() ou cancel() em resposta a saudações, perguntas ou mensagens que não sejam resposta a uma confirmação.
7. Resolva datas: "hoje" e "ontem" usando a data atual fornecida no contexto.
8. Responda sempre em português brasileiro. Seja conciso (máx 4 linhas fora das confirmações).\
"""


# ── Parser de tool call ───────────────────────────────────────────────────────

def _parse_tool_call(content: str) -> dict[str, Any] | None:
    """Extrai um JSON de tool call do texto retornado pelo modelo.

    Percorre o texto procurando por blocos JSON que contenham a chave "tool",
    respeitando chaves aninhadas (ex: "args": {...}).
    """
    # Percorre o texto procurando blocos JSON com "tool" válido
    for start in (m.start() for m in re.finditer(r'\{', content)):
        depth = 0
        for i, ch in enumerate(content[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = content[start:i + 1]
                    try:
                        data = json.loads(candidate)
                        if (
                            isinstance(data, dict)
                            and "tool" in data
                            and data["tool"] in _VALID_TOOLS
                        ):
                            return data
                    except json.JSONDecodeError:
                        pass
                    break
    return None


# ── Formatação de confirmações ────────────────────────────────────────────────

def _fmt_date_br(iso: str) -> str:
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return iso


def _installment_str(amount: float, installments: int) -> str:
    if installments <= 1:
        return _fmt_brl(amount)
    return f"{_fmt_brl(amount)} ({installments}x de {_fmt_brl(amount / installments)})"


def _confirmation_expense(d: dict) -> str:
    acc = _ACCOUNT_LABELS.get(d["account_id"], d["account_id"])
    method = _METHOD_LABELS.get(d["method"], d["method"])
    return (
        f"Confirmar registro?\n\n"
        f"*{_installment_str(d['amount'], d.get('installments', 1))} — {d['description']}*\n"
        f"{d['category']} · {acc} ({method})\n"
        f"{_fmt_date_br(d['date'])}\n\n"
        f"_Diga_ *sim* _para confirmar ou_ *não* _para cancelar._"
    )


def _confirmation_income(d: dict) -> str:
    return (
        f"Confirmar registro?\n\n"
        f"*{_fmt_brl(d['amount'])} — {d['description']}*\n"
        f"{_INCOME_LABELS.get(d['income_type'], d['income_type'])} · "
        f"{_ACCOUNT_LABELS.get(d['account_id'], d['account_id'])}\n"
        f"{_fmt_date_br(d['date'])}\n\n"
        f"_Diga_ *sim* _para confirmar ou_ *não* _para cancelar._"
    )


def _confirmation_investment(d: dict) -> str:
    op = "Aporte" if d["operation"] == "deposit" else "Resgate"
    obs = f"\n_{d['description']}_" if d.get("description") else ""
    return (
        f"Confirmar registro?\n\n"
        f"*{op} — {_fmt_brl(d['amount'])}*\n"
        f"{d['investment_name']}\n"
        f"{_fmt_date_br(d['date'])}{obs}\n\n"
        f"_Diga_ *sim* _para confirmar ou_ *não* _para cancelar._"
    )


def _confirmation_transfer(d: dict) -> str:
    return (
        f"Confirmar transferência?\n\n"
        f"*{_fmt_brl(d['amount'])}*\n"
        f"{_ACCOUNT_LABELS.get(d['from_account'], d['from_account'])} → "
        f"{_ACCOUNT_LABELS.get(d['to_account'], d['to_account'])}\n"
        f"{_fmt_date_br(d['date'])}\n\n"
        f"_Diga_ *sim* _para confirmar ou_ *não* _para cancelar._"
    )


# ── Execução dos registros ────────────────────────────────────────────────────

def _do_confirm_expense(data: dict) -> str:
    cats = database.get_categories("expense")
    cat_id = next((c["id"] for c in cats if c["name"] == data["category"]), None)
    tx_id = database.insert_transaction(
        date=data["date"], flow="expense", method=data["method"],
        account_id=data["account_id"], amount=data["amount"],
        description=data["description"], installments=data.get("installments", 1),
        category_id=cat_id,
    )
    row = {
        "id": tx_id, "date": data["date"], "method": data["method"],
        "bank": _ACCOUNT_BANK.get(data["account_id"], "nubank"),
        "account_id": data["account_id"], "amount": data["amount"],
        "installments": data.get("installments", 1), "description": data["description"],
        "category": data["category"],
        "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    threading.Thread(target=sheets.append_expense, args=(row,), daemon=True).start()
    return f"✅ Gasto registrado! (#{tx_id})"


def _do_confirm_income(data: dict) -> str:
    tx_id = database.insert_transaction(
        date=data["date"], flow="income", method=data["income_type"],
        account_id=data["account_id"], amount=data["amount"],
        description=data["description"], is_revenue=1,
    )
    row = {
        "id": tx_id, "date": data["date"], "method": data["income_type"],
        "bank": _ACCOUNT_BANK.get(data["account_id"], "nubank"),
        "account_id": data["account_id"], "amount": data["amount"],
        "description": data["description"],
        "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    threading.Thread(target=sheets.append_income, args=(row,), daemon=True).start()
    return f"✅ Recebimento registrado! (#{tx_id})"


def _do_confirm_investment(data: dict) -> str:
    inv = database.get_investment_by_name(data["investment_name"])
    if inv is None:
        return f"❌ Investimento '{data['investment_name']}' não encontrado."
    mv_id = database.insert_investment_movement(
        date=data["date"], investment_id=inv["id"],
        operation=data["operation"], amount=data["amount"],
        description=data.get("description"),
    )
    row = {
        "id": mv_id, "date": data["date"], "name": data["investment_name"],
        "operation": data["operation"], "amount": data["amount"],
        "description": data.get("description"),
        "registered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    threading.Thread(target=sheets.append_investment, args=(row,), daemon=True).start()
    op = "Aporte" if data["operation"] == "deposit" else "Resgate"
    return f"✅ {op} registrado! (#{mv_id})"


def _do_confirm_transfer(data: dict) -> str:
    tx_id = database.insert_transaction(
        date=data["date"], flow="expense", method="transfer",
        account_id=data["from_account"], amount=data["amount"],
        description="Transferência entre contas",
        dest_account_id=data["to_account"],
    )
    return f"✅ Transferência registrada! (#{tx_id})"


# ── Executor de ferramentas ───────────────────────────────────────────────────

async def _execute_tool(
    name: str,
    args: dict[str, Any],
    chat_id: int,
    context: ContextTypes.DEFAULT_TYPE,
) -> tuple[str, str | None]:
    """Executa uma ferramenta e retorna (resultado_json, mensagem_direta_ou_None).

    Quando mensagem_direta não é None, ela deve ser enviada ao usuário imediatamente
    (confirmações e resultados de confirm/cancel) sem passar pelo modelo novamente.
    """
    pending: dict = context.bot_data.setdefault("pending", {})

    try:
        # ── Leitura ──────────────────────────────────────────────────────────
        if name == "get_monthly_summary":
            return json.dumps(database.get_monthly_summary(args["year"], args["month"]), ensure_ascii=False), None
        if name == "get_expenses_by_category":
            return json.dumps(database.get_expenses_by_category(args["year"], args["month"]), ensure_ascii=False), None
        if name == "get_account_balances":
            return json.dumps(database.get_all_accounts_with_balance(), ensure_ascii=False), None
        if name == "get_investments":
            return json.dumps(database.get_all_investments(), ensure_ascii=False), None
        if name == "get_recent_transactions":
            return json.dumps(database.get_recent_activity(10), ensure_ascii=False), None
        if name == "get_budgets":
            return json.dumps(database.get_budgets(), ensure_ascii=False), None
        if name == "get_monthly_comparison":
            m1 = database.get_monthly_summary(args["month1_year"], args["month1"])
            m2 = database.get_monthly_summary(args["month2_year"], args["month2"])
            return json.dumps({"month1": m1, "month2": m2}, ensure_ascii=False), None

        # ── Registro (armazena pendente, envia confirmação direto ao usuário) ─
        if name == "register_expense":
            data = {
                "date": args["date"], "amount": float(args["amount"]),
                "description": args["description"],
                "category": args.get("category", "Outro"),
                "account_id": args["account_id"], "method": args["method"],
                "installments": int(args.get("installments", 1)),
            }
            pending[chat_id] = {"type": "expense", "data": data}
            return "ok", _confirmation_expense(data)

        if name == "register_income":
            data = {
                "date": args["date"], "amount": float(args["amount"]),
                "description": args["description"],
                "income_type": args.get("income_type", "other"),
                "account_id": args["account_id"],
            }
            pending[chat_id] = {"type": "income", "data": data}
            return "ok", _confirmation_income(data)

        if name == "register_investment":
            data = {
                "date": args["date"], "amount": float(args["amount"]),
                "investment_name": args["investment_name"],
                "operation": args["operation"],
                "description": args.get("description"),
            }
            pending[chat_id] = {"type": "investment", "data": data}
            return "ok", _confirmation_investment(data)

        if name == "register_transfer":
            data = {
                "date": args["date"], "amount": float(args["amount"]),
                "from_account": args["from_account"],
                "to_account": args["to_account"],
            }
            pending[chat_id] = {"type": "transfer", "data": data}
            return "ok", _confirmation_transfer(data)

        # ── Confirm / Cancel ──────────────────────────────────────────────────
        if name == "confirm":
            entry = pending.pop(chat_id, None)
            if not entry:
                # Sem pendente: devolve erro para o modelo tratar, não envia msg direta
                return json.dumps({"error": "Nenhum registro pendente. Nada foi salvo."}), None
            ptype = entry["type"]
            if ptype == "expense":
                msg = _do_confirm_expense(entry["data"])
            elif ptype == "income":
                msg = _do_confirm_income(entry["data"])
            elif ptype == "investment":
                msg = _do_confirm_investment(entry["data"])
            else:
                msg = _do_confirm_transfer(entry["data"])
            return "ok", msg

        if name == "cancel":
            pending.pop(chat_id, None)
            return "ok", "❌ Registro cancelado."

        return json.dumps({"error": f"ferramenta desconhecida: {name}"}), None

    except Exception as exc:
        _logger.error("Tool %s failed: %s", name, exc)
        return json.dumps({"error": str(exc)}), None


# ── Histórico ─────────────────────────────────────────────────────────────────

def _get_history(context: ContextTypes.DEFAULT_TYPE, chat_id: int) -> list[dict]:
    return context.bot_data.setdefault("ai_history", {}).setdefault(chat_id, [])


def _trim_history(context: ContextTypes.DEFAULT_TYPE, chat_id: int) -> None:
    hist = context.bot_data.get("ai_history", {}).get(chat_id, [])
    if len(hist) > HISTORY_PURGE_AT:
        context.bot_data["ai_history"][chat_id] = hist[-MAX_HISTORY:]


# ── Handler principal ─────────────────────────────────────────────────────────

async def ai_chat_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Catch-all handler — processa mensagens de texto livre via Ollama."""
    if not _authorized(update) or not update.message or not update.message.text:
        return

    chat_id = update.effective_chat.id
    user_text = update.message.text.strip()

    await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    if not await ollama.is_available():
        await update.message.reply_text(
            "🤖 IA indisponível no momento. Tente novamente em instantes."
        )
        return

    # Limpa histórico se /start foi chamado (sinalizado via bot_data)
    if context.bot_data.pop(f"clear_history_{chat_id}", False):
        context.bot_data.get("ai_history", {}).pop(chat_id, None)
        context.bot_data.get("pending", {}).pop(chat_id, None)

    now = datetime.now()
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    system = (
        f"{_SYSTEM_PROMPT}\n\n"
        f"Data atual: {now.strftime('%Y-%m-%d')} ({now.strftime('%d/%m/%Y')}). "
        f"Ontem: {yesterday}."
    )

    history = _get_history(context, chat_id)
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    messages.extend(history[-MAX_HISTORY:])
    messages.append({"role": "user", "content": user_text})

    final_text: str | None = None

    for round_n in range(MAX_ROUNDS):
        msg = await ollama.chat_with_tools(messages, None)
        if msg is None:
            break

        content: str = (msg.get("content") or "").strip()
        _logger.info("[AI round %d] raw response: %s", round_n, content[:300])
        if not content:
            break

        tool_call = _parse_tool_call(content)

        if tool_call is None:
            # Resposta em linguagem natural — encerra o loop
            final_text = content
            break

        tool_name = tool_call.get("tool", "")
        tool_args = tool_call.get("args", {})
        if not isinstance(tool_args, dict):
            tool_args = {}

        result_str, direct_msg = await _execute_tool(tool_name, tool_args, chat_id, context)

        # Confirmações e resultados de confirm/cancel vão direto ao usuário
        if direct_msg is not None:
            history.append({"role": "user", "content": user_text})
            history.append({"role": "assistant", "content": direct_msg})
            _trim_history(context, chat_id)
            await update.message.reply_text(direct_msg, parse_mode="Markdown")
            return

        # Ferramenta de leitura: devolve resultado e pede resposta em português
        _logger.info("[AI round %d] tool=%s result=%s", round_n, tool_name, result_str[:200])
        messages.append({"role": "assistant", "content": content})
        messages.append({
            "role": "user",
            "content": (
                f"[Resultado de {tool_name}]: {result_str}\n\n"
                "Com base nesses dados, responda ao usuário em português de forma clara e concisa. "
                "Se precisar de mais dados, chame outra ferramenta. Caso contrário, responda diretamente."
            ),
        })
        await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    if not final_text:
        await update.message.reply_text(
            "Não consegui processar sua mensagem. Tente reformular."
        )
        return

    history.append({"role": "user", "content": user_text})
    history.append({"role": "assistant", "content": final_text})
    _trim_history(context, chat_id)

    await update.message.reply_text(final_text, parse_mode="Markdown")
