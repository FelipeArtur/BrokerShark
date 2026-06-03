"""Handler de IA — interface conversacional do BrokerShark via Ollama.

Somente consulta: o Telegram lê dados e responde perguntas. NENHUM registro
ou edição acontece por aqui — isso é exclusivo da interface web.

Fluxo:
  1. Mensagem do usuário é verificada: deve ser sobre finanças pessoais
  2. Ollama processa via prompt-based tool calling (JSON no texto)
  3. Se tool call (somente leitura) detectado: executa e continua o loop (máx 3 rodadas)
  4. Se linguagem natural: faz streaming progressivo na mensagem do Telegram
"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import ContextTypes

from bot.utils import _authorized
from core import database
from integrations import ollama

_logger = logging.getLogger(__name__)

MAX_ROUNDS = 3
MAX_HISTORY = 6
HISTORY_PURGE_AT = 16

_VALID_TOOLS = {
    "get_monthly_summary", "get_expenses_by_category", "get_account_balances",
    "get_investments", "get_recent_transactions", "get_budgets",
    "get_monthly_comparison",
}

# ── Filtro de tópico ──────────────────────────────────────────────────────────

_FINANCIAL_RE = re.compile(
    r"\b(gast|recebi|salári|pagament|pix|ted|crédit|fatur|cartão|conta|saldo"
    r"|nubank|inter|investimento|caixinha|porquinho|tesouro|aport|resgate"
    r"|banco|dinheiro|compr|valor|reais|r\$|quanto|resumo|extrato|transferên"
    r"|orçamento|budget|categoria|mensal|semana|histórico|entrada|saída)\w*",
    re.IGNORECASE,
)
_PASS_WORDS = {"sim", "não", "nao", "ok", "pode", "obrigado", "obrigada", "valeu"}


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

Você é o BrokerShark, um especialista financeiro focado em dados. Seu tom de voz é extremamente assertivo, direto ao ponto e objetivo. NUNCA peça desculpas, não use jargões desnecessários e evite frases de suporte genéricas (como 'em que posso ajudar hoje?'). Responda com confiança analítica.

CONTAS:
- nu-cc    = Nubank Crédito   (método: credit)
- nu-db    = Nubank Conta     (métodos: pix, ted)
- inter-cc = Inter Crédito    (método: credit)
- inter-db = Inter Conta      (métodos: pix, ted)

CATEGORIAS DE GASTO: Alimentação, Carro, Jogos, Lazer, Atividade física, Eletrônicos, Educação, Igreja, Dízimo, Outro
INVESTIMENTOS: "Caixinha Nubank", "Porquinho Inter", "Tesouro Direto"
TIPOS DE RECEITA: salary, freelance, pix_received, other

════════════════════════════════════════
FERRAMENTAS — quando precisar de dados, responda SOMENTE com JSON puro, sem nenhum texto antes ou depois:
{"tool": "NOME", "args": {ARGUMENTOS}}

Ferramentas disponíveis:
  get_monthly_summary       args: year, month
  get_monthly_comparison    args: month1_year, month1, month2_year, month2
  get_expenses_by_category  args: year, month
  get_account_balances      args: (nenhum)
  get_investments           args: (nenhum)
  get_recent_transactions   args: (nenhum)
  get_budgets               args: (nenhum)

EXEMPLOS:
Usuário: "quanto gastei em maio?"
→ {"tool": "get_monthly_summary", "args": {"year": 2026, "month": 5}}

════════════════════════════════════════
REGRAS COMUNICACIONAIS (MUITO IMPORTANTE):
1. NUNCA inicie as respostas com 'Claro!', 'Com certeza!', 'Entendi', ou saudações desnecessárias. Vá direto ao ponto.
2. Formatação Baseada em Dados: Sempre que apresentar saldos, faturas ou relatórios, use bullet points e coloque os números em *negrito*.
3. Seja implacável na concisão: Máximo de 4 linhas. Evite texto corrido (parágrafos longos).

REGRAS TÉCNICAS:
1. Saudações diretas → responda em texto curto e direto. NÃO chame ferramentas.
2. Perguntas sobre dados financeiros → chame a ferramenta adequada, depois responda em português aplicando as Regras Comunicacionais.
3. NENHUM REGISTRO DEVE SER FEITO POR AQUI. Se o usuário pedir para registrar um gasto, aporte, receita ou transferência, RESPONDA: "Os registros e edições devem ser feitos exclusivamente pela interface web. O Telegram é apenas para consultas e notificações."
4. Resolva datas: "hoje" e "ontem" usando a data atual fornecida no contexto.\
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


# ── Executor de ferramentas (somente leitura) ─────────────────────────────────

async def _execute_tool(name: str, args: dict[str, Any]) -> str:
    """Executa uma ferramenta de leitura e retorna o resultado serializado em JSON."""
    try:
        if name == "get_monthly_summary":
            return json.dumps(database.get_monthly_summary(args["year"], args["month"]), ensure_ascii=False)
        if name == "get_expenses_by_category":
            return json.dumps(database.get_expenses_by_category(args["year"], args["month"]), ensure_ascii=False)
        if name == "get_account_balances":
            return json.dumps(database.get_all_accounts_with_balance(), ensure_ascii=False)
        if name == "get_investments":
            return json.dumps(database.get_all_investments(), ensure_ascii=False)
        if name == "get_recent_transactions":
            return json.dumps(database.get_recent_activity(10), ensure_ascii=False)
        if name == "get_budgets":
            return json.dumps(database.get_budgets(), ensure_ascii=False)
        if name == "get_monthly_comparison":
            m1 = database.get_monthly_summary(args["month1_year"], args["month1"])
            m2 = database.get_monthly_summary(args["month2_year"], args["month2"])
            return json.dumps({"month1": m1, "month2": m2}, ensure_ascii=False)

        return json.dumps({"error": f"ferramenta desconhecida: {name}"})

    except Exception as exc:
        _logger.error("Tool %s failed: %s", name, exc)
        return json.dumps({"error": str(exc)})


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

        result_str = await _execute_tool(tool_name, tool_args)

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
