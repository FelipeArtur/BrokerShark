"""Tests for AI chat handler — topic filter and tool call parsing."""
import sys
import types
import unittest.mock as mock

import pytest


def _mock_telegram():
    """Inject minimal telegram stubs before importing bot modules."""
    def _make_mock_module(name):
        m = types.ModuleType(name)
        m.__spec__ = mock.MagicMock()
        return m

    for mod_name in [
        "telegram", "telegram.ext", "telegram.constants",
        "telegram.error", "telegram.request",
    ]:
        if mod_name not in sys.modules:
            sys.modules[mod_name] = _make_mock_module(mod_name)

    # Attributes accessed at import time by application.py
    tg = sys.modules["telegram"]
    tg.Update = mock.MagicMock()
    tg.Bot = mock.MagicMock()
    tg.constants = sys.modules["telegram.constants"]
    tg.constants.ChatAction = mock.MagicMock()

    tg_ext = sys.modules["telegram.ext"]
    for attr in ["Application", "CommandHandler", "MessageHandler",
                 "filters", "ContextTypes", "ConversationHandler",
                 "TypeHandler", "ApplicationHandlerStop"]:
        setattr(tg_ext, attr, mock.MagicMock())

    # Avoid re-initializing bot/__init__.py side effects
    if "bot" in sys.modules:
        del sys.modules["bot"]
    for key in list(sys.modules):
        if key.startswith("bot."):
            del sys.modules[key]


@pytest.fixture(autouse=True)
def telegram_mocked():
    _mock_telegram()
    yield


def _import_ai_chat():
    from bot.handlers import ai_chat
    return ai_chat


def test_is_on_topic_finance():
    ai_chat = _import_ai_chat()
    assert ai_chat._is_on_topic("Quanto gastei em maio?") is True
    assert ai_chat._is_on_topic("Quanto gastei no supermercado esse mês?") is True
    assert ai_chat._is_on_topic("Qual meu saldo atual?") is True
    assert ai_chat._is_on_topic("quanto recebi esse mês") is True


def test_is_on_topic_offtopic():
    ai_chat = _import_ai_chat()
    assert ai_chat._is_on_topic("Qual a capital do Brasil?") is False
    assert ai_chat._is_on_topic("Como fazer bolo de cenoura?") is False
    assert ai_chat._is_on_topic("Quem ganhou o Oscar de melhor filme?") is False


def test_parse_tool_call_valid_json():
    ai_chat = _import_ai_chat()
    # The model emits JSON directly in text (no markdown fences)
    text = '{"tool": "get_monthly_summary", "args": {"year": 2026, "month": 5}}'
    result = ai_chat._parse_tool_call(text)
    assert result is not None
    assert result["tool"] == "get_monthly_summary"
    assert result["args"]["year"] == 2026


def test_parse_tool_call_valid_json_embedded():
    ai_chat = _import_ai_chat()
    text = 'Analisando seus dados... {"tool": "get_account_balances", "args": {}} por favor aguarde.'
    result = ai_chat._parse_tool_call(text)
    assert result is not None
    assert result["tool"] == "get_account_balances"


def test_parse_tool_call_invalid_returns_none():
    ai_chat = _import_ai_chat()
    assert ai_chat._parse_tool_call("Claro! Aqui está o resumo...") is None
    assert ai_chat._parse_tool_call("") is None
    assert ai_chat._parse_tool_call('{"broken json}') is None


def test_parse_tool_call_unknown_tool_returns_none():
    ai_chat = _import_ai_chat()
    # Valid JSON but tool name not in _VALID_TOOLS
    text = '{"tool": "delete_all_data", "args": {}}'
    assert ai_chat._parse_tool_call(text) is None


def test_parse_tool_call_missing_tool_key_returns_none():
    ai_chat = _import_ai_chat()
    text = '{"name": "get_monthly_summary", "args": {"year": 2026}}'
    assert ai_chat._parse_tool_call(text) is None


def test_valid_tools_are_read_only():
    ai_chat = _import_ai_chat()
    # Telegram é somente consulta: nenhuma ferramenta de registro/edição deve existir.
    assert ai_chat._VALID_TOOLS == {
        "get_monthly_summary", "get_monthly_comparison", "get_expenses_by_category",
        "get_account_balances", "get_investments", "get_recent_transactions",
        "get_budgets",
    }
    assert not any(t.startswith("register") for t in ai_chat._VALID_TOOLS)
    assert "confirm" not in ai_chat._VALID_TOOLS
    assert "cancel" not in ai_chat._VALID_TOOLS


def test_register_tool_call_is_rejected():
    ai_chat = _import_ai_chat()
    # Mesmo que o modelo emita um register_*, o parser não o reconhece como tool.
    text = '{"tool": "register_expense", "args": {"amount": 50}}'
    assert ai_chat._parse_tool_call(text) is None
