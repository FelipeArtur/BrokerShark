# BrokerShark

Personal finance assistant running 100% locally on Linux. Nubank + Inter, dashboard-first, Telegram for quick entries.

## What it does

- **Web dashboard** at `http://localhost:8080` — primary interface. Overview, accounts, credit cards, investments, 36-month history, transaction search and editing, budget tracking.
- **Telegram bot** — quick expense/income/investment registration via natural language, scheduled weekly and monthly reports, proactive spending alerts.
- **AI chat** — conversational analysis via local Ollama (`qwen2.5:7b`). Fetches live data before answering — never fabricates.
- **Real-time updates** — SSE push to the dashboard on every write, < 1s latency.
- **Monthly backup** — local HDD + Google Drive on the 1st of each month.
- **Budget alerts** — Telegram notification when a category reaches 80% of its monthly limit.

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
