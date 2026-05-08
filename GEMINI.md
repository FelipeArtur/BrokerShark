# BrokerShark — Gemini CLI Reference Guide

> For complete specs — conversation flows, full roadmap, design decisions — read [`CLAUDE.md`](./CLAUDE.md).

---

## Overview

BrokerShark is a personal finance assistant running **100% locally** on Linux.

**Primary interface:** Web dashboard (React 18 + Flask) at `http://localhost:8080`
**Secondary interface:** Telegram bot — quick registrations and scheduled reports only

SQLite is the single source of truth. Monthly backups go to local HDD + Google Drive.

**User:** Single user, Nubank + Inter (CC + conta corrente). No debit card. Investments: Caixinha Nubank, Porquinho Inter, Tesouro Direto.

---

## Architecture

### Data flow

```
User (web form or Telegram)
      ↓
core/database.py — INSERT (SQLite)
      ↓
core/events.notify() — SSE push to browser (< 1s)
      ↓
bot/handlers/ — Telegram confirmation (if Telegram)
```

### Key principles

- **SQLite = single source of truth.** No external write-back.
- **Web = primary interface.** Telegram for quick entries + reports only.
- **CSV import via web UI** (drag-and-drop with Ollama categorization).
- **AI is Pierre-inspired:** tool calling, never fabricates data, always fetches via tools.
- **Backup is monthly, condition-based:** 30-day check on startup → local HDD + Drive.
- **No AI in button registration flow.**

---

## Repository Structure

```
backend/
  main.py, config.py
  core/     database.py, events.py, backup.py, ai_service.py
  integrations/  drive.py, ollama.py
  dashboard/     server.py
  bot/      application.py, scheduler.py, handlers/, parsers/
frontend/
  js/  api.js, primitives.js, quick-entry.js, view-overview.js,
       view-secondary.js, view-chat.js, app.js
load_data/  import_history.py, Extrato completo Nubank/,
            Extrato completo Inter/, Fatura banco Inter/, Fatura Nubank/
scripts/  recover.py
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.12 |
| Bot | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Backup | google-api-python-client + google-auth (Drive) |
| Scheduler | APScheduler |
| Dashboard API | Flask 3.1 + Waitress 3.0 (8 threads) |
| Frontend | React 18 + Babel standalone, Chart.js |
| Real-time | SSE via `events.py` |
| AI | Ollama `qwen2.5:7b` (ROCm, RX 6600M) |

---

## Data Model

```sql
accounts (id: nu-cc | nu-db | inter-cc | inter-db, bank, type, name, billing_day, due_day)
categories (id, name, flow: expense|income)
transactions (id, date, flow, method, account_id, amount, installments,
              description, category_id, dest_account_id, counterpart, is_revenue)
investments (id, name, type, bank, current_balance)
investment_movements (id, date, investment_id, operation, amount, description)
budgets (id, category_id, amount_limit)
```

Internal transfers: `flow='expense', method='transfer', dest_account_id=<dest>`.
Excluded from summaries via `AND dest_account_id IS NULL`.

**`is_revenue`:** Integer flag — `1` for real income, `0` for self-transfers (`counterpart='SELF'`). Critical: must be set explicitly on every `insert_transaction()` for income rows.

**CC anti-duplication:** Fatura total payment sits in nu-db/inter-db with `dest_account_id='nu-cc'/'inter-cc'` (for patrimônio); individual purchases sit in nu-cc/inter-cc with `dest_account_id IS NULL` (for expense summaries). They never overlap. Logic is symmetric for Nubank and Inter.

**Patrimônio expenses:** `get_patrimonio_history()` uses `(dest_account_id IS NULL OR dest_account_id IN ('nu-cc','inter-cc'))` — CC fatura payments are real cash outflows.

---

## AI Architecture (Pierre-inspired)

`backend/core/ai_service.py` — shared by Telegram (`ai_chat.py`) and web (`POST /api/chat`):
- Tool calling via prompt engineering (not native tools API — qwen2.5:7b compatible)
- MAX_ROUNDS=3 agentic loop
- Persona: "BrokerShark" — direct, analytical, finance-scoped only

Tools (13): `get_monthly_summary`, `get_monthly_comparison`, `get_expenses_by_category`, `get_account_balances`, `get_investments`, `get_recent_transactions`, `get_budgets`, `register_expense`, `register_income`, `register_investment`, `register_transfer`, `confirm`, `cancel`

---

## Dashboard API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/summary` | Monthly totals (bank?, account?, month?, year?) |
| GET | `/api/accounts` | Balances |
| GET | `/api/investments` | Investment balances |
| GET | `/api/monthly` | Income vs expenses (`months=N`, default 6; `bank=?`) |
| GET | `/api/daily-spend` | Daily spend bar chart (`month=M&year=Y`, zero-filled) |
| GET | `/api/categories` | Expenses by category |
| GET | `/api/faturas` | CC billing |
| GET | `/api/transactions` | Account transactions |
| GET | `/api/recent-activity` | 20 latest |
| GET | `/api/patrimonio-history` | 12-month net worth |
| GET | `/api/budgets` | Budget limits |
| GET | `/api/events` | SSE stream |
| POST | `/api/transactions` | Create expense |
| POST | `/api/incomes` | Create income/transfer |
| POST | `/api/investment-movements` | Create investment movement |
| POST | `/api/import-csv/preview` | Parse CSV, return preview |
| POST | `/api/import-csv/confirm` | Confirm CSV import |
| POST | `/api/chat` | AI chat message |
| PATCH | `/api/budgets/<id>` | Update budget |
| PATCH | `/api/transactions/<id>` | Reassign category |

---

## Engineering Directives

- **All SQL through `core/database.py`** — no inline SQL elsewhere
- **Type hints mandatory** on every function signature
- **`PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON`** at connection time
- **Bot never writes to DB directly** — data validated before INSERT
- **Drive/backup failures silent** — logged, never raised
- **Async:** Dashboard in daemon thread, never block event loop
- **Authorization check first** in every Telegram handler (chat_id)
- **Internal transfers ≠ income:** `flow='expense', method='transfer', dest_account_id=<dest>`
- **`ollama.py` is pure HTTP client:** no business logic, no system prompts
- **CSV parsers:** `inter_cc.parse(content, adjust_installment_dates=False)` for historical monthly faturas

---

## Configuration (`.env`)

```env
TELEGRAM_TOKEN=seu_token_aqui
TELEGRAM_CHAT_ID=seu_chat_id_aqui
DB_PATH=/home/SEU_USUARIO/brokershark/data/brokershark.db
LOCAL_BACKUP_DIR=/mnt/seu-hdd/brokershark/backups
GOOGLE_CREDENTIALS=/home/SEU_USUARIO/brokershark/credentials/service_account.json
DRIVE_BACKUP_FOLDER=BrokerShark Backups
DASHBOARD_PORT=8080
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60
```

## Running

```bash
source .venv/bin/activate.fish
python backend/main.py
# Dashboard at http://localhost:8080
```
