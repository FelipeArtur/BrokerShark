"""Ollama integration — async HTTP client para comunicação com modelos locais.

Funções públicas:
- is_available()   health check com cache de 30s
- chat()           chamada simples, retorna string (usado pelo scheduler)
- chat_stream()    gerador de streaming (usado pelo handler de IA)

Todos os erros são logados em logs/ollama_errors.log e nunca propagados.
"""
from __future__ import annotations

import json
import logging
import logging.handlers
import time as _time
from pathlib import Path
from typing import Any, AsyncGenerator

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

# Guard against an env-tampered OLLAMA_URL turning every chat turn into an SSRF
# pivot. The app is designed for a local Ollama; warn loudly if it points
# elsewhere (logged, not blocked — remote Ollama remains possible by choice).
from urllib.parse import urlparse as _urlparse  # noqa: E402
_ollama_host = _urlparse(OLLAMA_URL).hostname or ""
if _ollama_host not in ("localhost", "127.0.0.1", "::1"):
    _logger.error("OLLAMA_URL aponta para host não-loopback %r — risco de SSRF se não confiável", _ollama_host)

# Cap the accumulated streamed response so a hostile/buggy endpoint can't grow
# memory without bound.
_MAX_STREAM_CHARS = 100_000

# ── Cache de disponibilidade ──────────────────────────────────────────────────
_avail_ts: float = 0.0
_avail_ok: bool = False


# ── Internal helpers ──────────────────────────────────────────────────────────

def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=OLLAMA_URL, timeout=OLLAMA_TIMEOUT)


def _build_payload(
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
    }


# ── Public API ────────────────────────────────────────────────────────────────

async def is_available() -> bool:
    """Health check — retorna True se Ollama responde. Resultado cacheado por 30s."""
    global _avail_ts, _avail_ok
    now = _time.monotonic()
    if now - _avail_ts < 30.0:
        return _avail_ok
    try:
        async with httpx.AsyncClient(base_url=OLLAMA_URL, timeout=3) as client:
            r = await client.get("/api/tags")
            _avail_ok = r.status_code == 200
    except Exception:
        _avail_ok = False
    _avail_ts = now
    return _avail_ok


async def chat(
    messages: list[dict[str, Any]],
) -> str | None:
    """Envia mensagens ao Ollama e retorna o texto da resposta.

    Usado pelo scheduler para relatórios semanais e mensais.
    Retorna None em caso de erro ou timeout.
    """
    try:
        async with _make_client() as client:
            r = await client.post("/api/chat", json=_build_payload(messages))
            r.raise_for_status()
            return r.json().get("message", {}).get("content") or None
    except Exception as exc:
        _logger.error("chat() failed: %s", exc)
        return None


async def chat_stream(
    messages: list[dict[str, Any]],
) -> AsyncGenerator[tuple[str, str, bool], None]:
    """Faz streaming da resposta do Ollama.

    Yields (delta, accumulated, done):
    - delta: novo trecho de texto gerado neste chunk
    - accumulated: texto acumulado até agora
    - done: True no último chunk

    Usado pelo handler de IA para streaming progressivo no Telegram.
    Em caso de erro, o gerador termina silenciosamente após logar.
    """
    payload = {**_build_payload(messages), "stream": True}
    accumulated = ""
    try:
        async with _make_client() as client:
            async with client.stream("POST", "/api/chat", json=payload) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line or len(line) > 1_000_000:  # skip empty / absurd single lines
                        continue
                    data = json.loads(line)
                    delta = data.get("message", {}).get("content", "")
                    accumulated += delta
                    done = data.get("done", False)
                    yield delta, accumulated, done
                    if len(accumulated) > _MAX_STREAM_CHARS:
                        _logger.error("chat_stream() excedeu %d chars; truncando", _MAX_STREAM_CHARS)
                        break
    except Exception as exc:
        _logger.error("chat_stream() failed: %s", exc)


