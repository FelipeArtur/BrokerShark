"""Ollama integration — async HTTP client for phi3.5 tool calling.

All public functions return None / empty results on error.
Errors are logged to logs/ollama_errors.log and never propagated.
"""
from __future__ import annotations

import json
import logging
import logging.handlers
import os
from pathlib import Path
from typing import Any

import httpx

from config import OLLAMA_MODEL, OLLAMA_TIMEOUT, OLLAMA_URL

# ── Logger ────────────────────────────────────────────────────────────────────
_log_path = Path("logs/ollama_errors.log")
_log_path.parent.mkdir(exist_ok=True)
_logger = logging.getLogger("ollama")
if not _logger.handlers:
    _handler = logging.handlers.RotatingFileHandler(
        _log_path, maxBytes=1_000_000, backupCount=3, encoding="utf-8"
    )
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s: %(message)s"))
    _logger.addHandler(_handler)
_logger.setLevel(logging.ERROR)

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Você é o BrokerShark, assistente financeiro pessoal.
O usuário tem contas no Nubank e Inter (crédito e conta corrente).
Investimentos: Caixinha Nubank, Porquinho Inter, Tesouro Direto.
Categorias de gasto: Alimentação, Carro, Jogos, Lazer, Atividade física, Eletrônicos, Educação, Igreja, Dízimo, Outro.
Sempre responda em português brasileiro.
Use as ferramentas disponíveis para buscar dados reais — nunca invente valores.
Seja conciso: máximo 6 linhas por resposta, use Markdown do Telegram (*bold*, _italic_)."""


# ── Internal helpers ──────────────────────────────────────────────────────────

def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=OLLAMA_URL, timeout=OLLAMA_TIMEOUT)


def _build_payload(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
    return payload


# ── Public API ────────────────────────────────────────────────────────────────

async def is_available() -> bool:
    """Quick health check — returns True if Ollama responds within 3 s."""
    try:
        async with httpx.AsyncClient(base_url=OLLAMA_URL, timeout=3) as client:
            r = await client.get("/api/tags")
            return r.status_code == 200
    except Exception:
        return False


async def chat(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> str | None:
    """Send a messages list to Ollama and return the assistant text.

    Returns None on error or timeout. Tool call processing is left to the caller.
    """
    try:
        async with _make_client() as client:
            r = await client.post("/api/chat", json=_build_payload(messages, tools))
            r.raise_for_status()
            data = r.json()
            msg = data.get("message", {})
            return msg.get("content") or None
    except Exception as exc:
        _logger.error("chat() failed: %s", exc)
        return None


async def chat_with_tools(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Send messages to Ollama and return the full message object.

    Tools are injected via the system prompt (prompt engineering) because most
    local models, including phi3.5, don't support the native ``tools`` field.
    The caller parses tool calls from the text content.

    Returns None on error.
    """
    try:
        async with _make_client() as client:
            # Never pass `tools` field — rely on prompt-based tool calling
            r = await client.post("/api/chat", json=_build_payload(messages, None))
            r.raise_for_status()
            data = r.json()
            return data.get("message")
    except Exception as exc:
        _logger.error("chat_with_tools() failed: %s", exc)
        return None


async def suggest_categories(
    transactions: list[dict[str, Any]],
    patterns: list[dict[str, Any]],
    valid_categories: list[str],
) -> dict[str, str]:
    """Batch-categorize a list of transactions using historical patterns.

    Args:
        transactions: list of {description, amount} dicts from the CSV parser.
        patterns: list of {description, category, freq} from get_categorization_patterns().
        valid_categories: list of category names that exist in the DB.

    Returns:
        {description: category_name} mapping. Missing entries mean no suggestion.
    """
    if not transactions:
        return {}

    history_lines = "\n".join(
        f'- "{p["description"]}" → {p["category"]} ({p["freq"]}x)'
        for p in patterns[:50]
    )
    tx_lines = "\n".join(
        f'- "{t["description"]}" (R$ {t["amount"]:.2f})' for t in transactions
    )
    cats = ", ".join(valid_categories)

    prompt = f"""Categorize as transações abaixo usando o histórico do usuário como referência prioritária.
Categorias válidas: {cats}

Histórico de categorizações do usuário:
{history_lines or "(sem histórico ainda)"}

Transações a categorizar:
{tx_lines}

Responda APENAS com JSON no formato:
{{"descrição exata": "categoria"}}
Não inclua explicações, apenas o JSON."""

    messages = [{"role": "user", "content": prompt}]
    try:
        async with httpx.AsyncClient(base_url=OLLAMA_URL, timeout=20) as client:
            r = await client.post(
                "/api/chat",
                json={"model": OLLAMA_MODEL, "messages": messages, "stream": False},
            )
            r.raise_for_status()
            content = r.json().get("message", {}).get("content", "")
            # Extract JSON block from the response
            start = content.find("{")
            end = content.rfind("}") + 1
            if start == -1 or end == 0:
                return {}
            raw: dict[str, str] = json.loads(content[start:end])
            # Validate that suggested categories actually exist
            valid_set = set(valid_categories)
            return {k: v for k, v in raw.items() if v in valid_set}
    except Exception as exc:
        _logger.error("suggest_categories() failed: %s", exc)
        return {}
