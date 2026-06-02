# BrokerShark

A local tool to **understand and analyze my money**. Runs 100% on Linux, accounts at Nubank + Inter. It answers one question first — **"quanto eu posso gastar agora?"** — and then lets me dig into where the money goes.

## What it does

The product is the **analysis**, in a two-screen web dashboard at `http://localhost:8080`:

- **Dinheiro** (home) — one honest hero number, **Disponível pra gastar** = checking balance − open credit-card bills. Around it: open faturas, a "this month" cash-flow summary, account balances, recent activity, run-rate projections (month close, next fatura), and an optional reserve buffer ("Seguro pra gastar").
- **Histórico / Análise** — 36-month timeline, monthly metrics with sparklines, a 6-month cash-flow chart, investments, spending by category, top PIX destinations, and a filterable transaction table (by account, method, category, free text).

Supporting roles (not the center):

- **Telegram bot** — quick expense/income/investment entries in natural language; scheduled weekly/monthly reports; spending and budget alerts.
- **Monthly import** — bank/broker CSV (extratos + faturas) with preview and dedup.
- **AI chat** — conversational analysis via local Ollama. Fetches live data before answering — never fabricates; tool arguments are validated server-side.
- **Local-first** — SQLite is the single source of truth, SSE pushes live updates (< 1s), monthly backup to local HDD + Google Drive.

## Accounts

| Account | Type | Bank |
|---------|------|------|
| `nu-cc` | Credit card | Nubank |
| `nu-db` | Checking | Nubank |
| `inter-cc` | Credit card | Inter |
| `inter-db` | Checking | Inter |
| Caixinha Nubank | Investment | Nubank |
| Porquinho Inter | Investment | Inter |
| Tesouro Direto | Investment | — |

## Tech stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.12 |
| Bot framework | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads) |
| Dashboard frontend | React 18 + Babel standalone, Chart.js |
| Real-time | SSE via `core/events.py` |
| Scheduler | APScheduler |
| Backup (cloud) | google-api-python-client + google-auth (Drive) |
| Local LLM | Ollama (`qwen2.5:7b`, ROCm, RX 6600M) |
| HTTP client | httpx |

## Getting started

```bash
# Create virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate.fish   # fish
# source .venv/bin/activate      # bash/zsh

pip install -r requirements.txt

# Configure credentials
cp .env.example .env
# Fill in: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, DB_PATH,
#          GOOGLE_CREDENTIALS, DRIVE_BACKUP_FOLDER,
#          OLLAMA_URL, OLLAMA_MODEL

# Run
python backend/main.py
# Dashboard: http://localhost:8080
```

## Running as a system service (optional)

```bash
sudo cp deploy/brokershark.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now brokershark
```

Logs go to `logs/brokershark.log`.

## Development

Co-developed with [Claude Code](https://claude.ai/claude-code) and [Gemini CLI](https://github.com/google-gemini/gemini-cli). Architecture, data model, and design decisions are documented in [`CLAUDE.md`](./CLAUDE.md) and [`GEMINI.md`](./GEMINI.md).

```bash
# Run tests
python -m pytest tests/ -v
```
