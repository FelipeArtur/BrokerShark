# BrokerShark

A local tool to **understand and analyze my money**. Runs 100% on Linux, accounts at Nubank + Inter. It answers one question first — **"quanto eu posso gastar agora?"** — and then lets me dig into where the money goes.

## What it does

The product is the **analysis**, powered by a three-screen web dashboard at `http://localhost:8080`:

- **Visão do Mês** (home) — one honest hero number, **Disponível pra gastar** = checking balance − open credit-card bills. Around it: open faturas, a "this month" cash-flow summary, account balances, recent activity, and run-rate projections (month close, next fatura).
- **Histórico** — 36-month timeline, monthly metrics with sparklines, a 6-month cash-flow chart, spending by category, top PIX destinations, and a filterable transaction table (by account, method, category, free text) with inline categorization.
- **Investimentos** — A donut chart visualization, sum of current balances, and editable investment positions with movement tracking.

Supporting roles (not the center):

- **Telegram bot** — **Read-only**: Quick query tools via natural language, scheduled weekly/monthly reports, and spending alerts. **No data entry is allowed via Telegram.**
- **Monthly import** — Bank/broker CSV (extratos + faturas) imported exclusively via the web interface. Features a full staging preview and deduplication against existing records.
- **AI chat** — Conversational analysis via local Ollama. Fetches live data before answering (using 7 specialized, read-only tools). Never fabricates data.
- **Local-first** — SQLite is the single source of truth, SSE pushes live updates (< 1s), monthly backup directly to local HDD.

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
| Language | Python 3.12+ (in a 3.14 venv) |
| Bot framework | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads) |
| Dashboard frontend | React 18 + Babel standalone, Chart.js |
| Real-time | SSE via `core/events.py` |
| Scheduler | systemd user timers (`Persistent=true`) |
| Backup | Local HDD copy via SQLite API |
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
#          OLLAMA_URL, OLLAMA_MODEL

# Run
python backend/main.py
# Dashboard: http://localhost:8080
```

## Running background jobs via systemd

BrokerShark uses `systemd user timers` instead of internal schedulers to ensure robustness (even catching up on missed executions during downtime).

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/brokershark-*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now brokershark-backup.timer brokershark-weekly-report.timer brokershark-monthly-closing.timer
loginctl enable-linger $USER # Crucial for background tasks to run without an active session
```

Logs go to `logs/brokershark.log`.

## Development

Co-developed with [Claude Code](https://claude.ai/claude-code) and [Gemini CLI](https://github.com/google-gemini/gemini-cli). Architecture, data model, and design decisions are documented in [`CLAUDE.md`](./CLAUDE.md) and [`GEMINI.md`](./GEMINI.md).

```bash
# Run tests
python -m pytest tests/ -v
```
