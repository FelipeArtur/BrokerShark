"""Handler de IA — interface conversacional do BrokerShark via Ollama.

Fluxo:
  1. Mensagem do usuário é verificada: deve ser sobre finanças pessoais
  2. Ollama processa via prompt-based tool calling (JSON no texto)
  3. Se tool call detectado: executa e continua o loop (máx 3 rodadas)
  4. Se linguagem natural: faz streaming progressivo na mensagem do Telegram
  5. confirm/cancel → persiste ou descarta o registro pendente
"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any, Optional

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import ContextTypes

from bot.utils import _authorized, _fmt_brl
from core import database
from integrations import ollama

_logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

MAX_ROUNDS = 3
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

# ── Filtro de tópico ──────────────────────────────────────────────────────────

_FINANCIAL_RE = re.compile(
    r"\b(gast|recebi|salári|pagament|pix|ted|crédit|fatur|cartão|conta|saldo"
    r"|nubank|inter|investimento|caixinha|porquinho|tesouro|aport|resgate"
    r"|banco|dinheiro|compr|valor|reais|r\$|quanto|resumo|extrato|transferên"
    r"|orçamento|budget|categoria|mensal|semana|histórico|entrada|saída)\w*",
    re.IGNORECASE,
)
_PASS_WORDS = {"sim", "não", "nao", "ok", "pode", "confirma", "cancela", "cancelar", "errado"}


def _is_on_topic(text: str) -> bool:
    """Retorna True se a mensagem parece ser sobre finanças pessoais."""
    words = text.strip().split()
    if len(words) <= 3:
        return True  # saudações curtas e confirmações sempre passam
    if any(w.lower() in _PASS_WORDS for w in words):
        return True
    return bool(_FINANCIAL_RE.search(text))


# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
ESCOPO: Você responde EXCLUSIVAMENTE sobre as finanças pessoais do usuário
(gastos, receitas, saldos, contas, faturas, investimentos). Qualquer outro
assunto → responda APENAS: "Só posso ajudar com suas finanças pessoais."

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
  get_monthly_comparison    args: month1_year, month1, month2_year, month2
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

Usuário: "gastei 80 no iFood hoje no nubank crédito"
→ {"tool": "register_expense", "args": {"date": "DATA_ATUAL", "amount": 80.0, "description": "iFood", "category": "Alimentação", "account_id": "nu-cc", "method": "credit", "installments": 1}}

Usuário: "sim"  (após ver confirmação pendente)
→ {"tool": "confirm", "args": {}}

════════════════════════════════════════
REGRAS:
1. Saudações e conversas gerais sobre finanças → responda em texto. NÃO chame ferramentas.
2. Perguntas sobre dados financeiros → chame a ferramenta adequada, depois responda em português.
3. Para registrar → chame register_*, o sistema exibe a confirmação automaticamente.
4. confirm() → SOMENTE quando o usuário responder explicitamente "sim", "ok", "pode", "confirma".
5. cancel() → SOMENTE quando o usuário responder "não", "cancela", "errado" a uma confirmação pendente.
6. NUNCA chame confirm() ou cancel() em saudações ou perguntas que não sejam resposta a uma confirmação.
7. Resolva datas: "hoje" e "ontem" usando a data atual fornecida no contexto.
8. Responda sempre em português brasileiro. Seja conciso (máx 4 linhas fora das confirmações).\
"""


# ── Parser de tool call ───────────────────────────────────────────────────────

def _parse_tool_call(content: str) -> dict[str, Any] | None:
    """Extrai JSON de tool call do texto retornado pelo modelo."""
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
    return f"✅ Gasto registrado! (#{tx_id})"


def _do_confirm_income(data: dict) -> str:
    tx_id = database.insert_transaction(
        date=data["date"], flow="income", method=data["income_type"],
        account_id=data["account_id"], amount=data["amount"],
        description=data["description"], is_revenue=1,
    )
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
    sem passar pelo modelo novamente.
    """
    pending: dict = context.bot_data.setdefault("pending", {})

    try:
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

        if name == "confirm":
            entry = pending.pop(chat_id, None)
            if not entry:
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

    if not _is_on_topic(user_text):
        await update.message.reply_text(
            "Só posso ajudar com suas finanças pessoais 💰\n"
            "Pergunte sobre gastos, receitas, saldo, faturas ou investimentos."
        )
        return

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

    sent_msg = None  # mensagem do Telegram que recebe o streaming

    for round_n in range(MAX_ROUNDS):
        full_content = ""
        is_natural: bool | None = None
        last_edit = 0.0
        last_typing = time.monotonic()

        async for delta, accumulated, done in ollama.chat_stream(messages):
            full_content = accumulated

            # Detecta tipo da resposta nos primeiros tokens significativos
            if is_natural is None and len(accumulated.strip()) >= 10:
                is_natural = not accumulated.strip().startswith("{")

            if is_natural:
                # Linguagem natural: faz streaming progressivo no Telegram
                ts = time.monotonic()
                if sent_msg is None:
                    sent_msg = await update.message.reply_text(accumulated)
                    last_edit = ts
                elif ts - last_edit >= 1.5:
                    try:
                        await sent_msg.edit_text(accumulated, parse_mode="Markdown")
                    except Exception:
                        pass
                    last_edit = ts
            else:
                # Tool call em andamento: renova typing indicator a cada 4s
                ts = time.monotonic()
                if ts - last_typing > 4.0:
                    await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
                    last_typing = ts

        content = full_content.strip()
        _logger.info("[AI round %d] type=%s content=%s", round_n, "text" if is_natural else "tool", content[:200])

        if not content:
            break

        tool_call = _parse_tool_call(content)

        if tool_call is None:
            # Resposta em linguagem natural: edição final para garantir Markdown correto
            if sent_msg is not None:
                try:
                    await sent_msg.edit_text(content, parse_mode="Markdown")
                except Exception:
                    pass
            else:
                await update.message.reply_text(content, parse_mode="Markdown")
            history.append({"role": "user", "content": user_text})
            history.append({"role": "assistant", "content": content})
            _trim_history(context, chat_id)
            return

        tool_name = tool_call.get("tool", "")
        tool_args = tool_call.get("args", {})
        if not isinstance(tool_args, dict):
            tool_args = {}

        result_str, direct_msg = await _execute_tool(tool_name, tool_args, chat_id, context)

        if direct_msg is not None:
            # Confirmação ou resultado de confirm/cancel: envia direto ao usuário
            history.append({"role": "user", "content": user_text})
            history.append({"role": "assistant", "content": direct_msg})
            _trim_history(context, chat_id)
            await update.message.reply_text(direct_msg, parse_mode="Markdown")
            return

        # Resultado de leitura: devolve ao modelo para formulação da resposta
        _logger.info("[AI round %d] tool=%s result=%s", round_n, tool_name, result_str[:200])
        messages.append({"role": "assistant", "content": content})
        messages.append({
            "role": "user",
            "content": (
                f"[Resultado de {tool_name}]: {result_str}\n\n"
                "Com base nesses dados, responda ao usuário em português de forma clara e concisa."
            ),
        })
        await context.bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)

    # Esgotou MAX_ROUNDS sem resposta definitiva
    fallback = "Não consegui processar sua mensagem. Tente reformular."
    if sent_msg is not None:
        try:
            await sent_msg.edit_text(fallback)
        except Exception:
            await update.message.reply_text(fallback)
    else:
        await update.message.reply_text(fallback)
