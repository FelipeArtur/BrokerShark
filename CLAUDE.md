# BrokerShark — Claude Reference Guide

## AI Development Tools

This project is co-developed using **Claude Code CLI** and **Gemini CLI**.

| File | Purpose |
|---|---|
| `CLAUDE.md` | Full source of truth — architecture, flows, design decisions (Claude Code) |
| `GEMINI.md` | Concise context guide for Gemini CLI |
| `.claude/commands/` | Claude Code slash-command skills |

When making permanent changes (new categories, new accounts, schema changes), update **both** `CLAUDE.md` and `GEMINI.md`.

---

## Overview

BrokerShark is a personal finance assistant running **100% locally** on Linux.

**Primary interface:** Web dashboard (React 18 + Flask) at `http://localhost:8080`
**Secondary interface:** Telegram bot — quick registrations and scheduled reports only

Every transaction is persisted in a local SQLite database. Monthly backups go to a local HDD directory and to Google Drive (same service account).

**User profile:** Single user, accounts at Nubank and Inter (credit card + conta corrente). Does **not** use debit card. Investments: Caixinha Nubank, Porquinho Inter, Tesouro Direto.

---

## Repository Structure

```
brokershark/
├── backend/
│   ├── main.py            # Entry point — starts bot + scheduler + dashboard
│   ├── config.py          # Centralised env vars — only file that calls os.getenv()
│   ├── core/
│   │   ├── database.py    # Data layer — SQLite, all queries
│   │   ├── events.py      # SSE pub/sub — notify() after writes
│   │   ├── backup.py      # Monthly backup: local HDD (should_backup + run_backup)
│   │   └── ai_service.py  # Shared AI chat logic — tools, agentic loop, system prompt
│   ├── integrations/
│   │   ├── drive.py       # Google Drive — monthly backup upload + recovery
│   │   └── ollama.py      # Ollama async client — chat, chat_stream, suggest_categories
│   ├── dashboard/
│   │   └── server.py      # Flask routes + Waitress WSGI (32 threads, SSE)
│   └── bot/
│       ├── application.py # build_application(), scheduler lifecycle hooks
│       ├── constants.py   # State ints, ACCOUNT_MAP, INVESTMENT_META, *_LABELS
│       ├── scheduler.py   # APScheduler — startup backup, weekly report, monthly closing
│       ├── utils.py       # _authorized, _fmt_brl, _fmt_date, _PT_MONTHS
│       ├── handlers/
│       │   ├── commands.py    # /novo, /saldo, /resumo, /fatura, /reservas, /ajuda
│       │   ├── expense.py     # Expense ConversationHandler
│       │   ├── income.py      # Income ConversationHandler
│       │   ├── investment.py  # Investment ConversationHandler
│       │   └── ai_chat.py     # AI chat handler (wrapper over core/ai_service.py)
│       └── parsers/
│           ├── nubank_cc.py   # Nubank CC CSV parser
│           └── inter_cc.py    # Inter CC CSV parser (adjust_installment_dates param)
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js             # Fetch wrappers for all endpoints
│       ├── primitives.js      # Charts, shared UI components
│       ├── quick-entry.js     # ExpenseForm, IncomeForm, InvestmentForm, ImportModal
│       ├── view-overview.js   # OverviewView
│       ├── view-secondary.js  # CardsView, AccountsView, InvestmentsView, HistoryView
│       ├── view-chat.js       # ChatView — AI chat interface (Pierre-inspired)
│       └── app.js             # App shell — nav, SSE, search, tweaks
├── load_data/
│   ├── import_history.py  # Batch historical import (--dry-run flag)
│   ├── Extrato completo Nubank/
│   ├── Extrato completo Inter/
│   ├── Fatura banco Inter/
│   └── Fatura Nubank/
├── scripts/
│   └── recover.py         # Interactive Drive backup recovery
├── .claude/commands/      # /db-reset, /add-category, /new-parser, /check-health,
│                          # /month-report, /venv, /load-data
├── data/                  # SQLite database (not versioned)
├── logs/                  # Runtime logs (not versioned)
├── credentials/
│   └── service_account.json  # Google API credentials (not versioned)
├── requirements.txt
├── .env
└── .env.example
```

---

## Architecture

### Core data flow

```
User (web form or Telegram)
      ↓
core/database.py — INSERT (SQLite)
      ↓
core/events.notify() — SSE push to browser (< 1s)
      ↓
bot/handlers/ — confirmation message (Telegram only)
      ↓ (after each expense)
bot/handlers/expense.py — spending alert if expenses ≥ income
```

### Key principles

- **SQLite is the single source of truth.** No external write-back.
- **Web dashboard is the primary interface.** Telegram handles quick entries and reports.
- **CSV import happens via the web UI** — drag-and-drop modal with Ollama-assisted categorization.
- **AI is Pierre-inspired:** tool calling, context injection, conversation-as-interface. Never fabricates data — always fetches via tools before answering.
- **Backup is monthly, condition-based:** `should_backup()` checks if > 30 days since last backup. On startup (30s delay) → local HDD copy → Drive upload.
- **No AI in the button registration flow.** Buttons eliminate parsing at record time.

### Patrimônio calculation

`get_patrimonio_history()` computes net worth as: `initial_balances + income - expenses + investment_movements`.

**Expenses include CC fatura payments:** condition is `(dest_account_id IS NULL OR dest_account_id IN ('nu-cc','inter-cc'))`. This ensures the total monthly CC payment (stored as a transfer from the checking account) is counted as a cash outflow — even though the individual purchases live in a separate account.

### CC anti-duplication guarantee

Two levels of data exist for credit card spending. They never overlap:

| Data | Location | Used for |
|------|----------|----------|
| Total fatura payment | `nu-db`/`inter-db`, `dest_account_id='nu-cc'/'inter-cc'` | Patrimônio (real cash out) |
| Individual purchases | `nu-cc`/`inter-cc`, `dest_account_id IS NULL` | Monthly expense summaries |

Why they don't conflict:
- Expense summaries filter `AND dest_account_id IS NULL` → fatura payments are excluded
- Patrimônio includes `dest_account_id IN ('nu-cc','inter-cc')` → fatura payments are included
- CC parsers skip `amount <= 0` → the "Pagamento da fatura" row in CC exports is never imported

This logic is symmetric for both Nubank CC and Inter CC.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.12 |
| Bot framework | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Backup (cloud) | google-api-python-client + google-auth (Drive) |
| Scheduler | APScheduler |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads, daemon thread) |
| Dashboard frontend | React 18 + Babel standalone (no build step), Chart.js |
| Real-time updates | SSE via `events.py` — no polling, < 1s latency |
| HTTP client | httpx |
| Local LLM | Ollama (`qwen2.5:7b` / ROCm, RX 6600M) |

---

## Running Locally

```bash
cp .env.example .env
# fill in credentials
source .venv/bin/activate.fish
pip install -r requirements.txt
python backend/main.py
# Dashboard at http://localhost:8080
```

---

## Backup Strategy

**Local (HDD):**
- `should_backup()` — returns `True` if last `brokershark_YYYY-MM.db` in `LOCAL_BACKUP_DIR` is > 30 days old
- `run_backup()` — copies DB only if due; keeps last 12 monthly files
- Triggered 30s after application startup

**Google Drive:**
- Upload runs after successful local backup (same startup job)
- Folder: `DRIVE_BACKUP_FOLDER` (default: "BrokerShark Backups")
- Files named `brokershark_YYYY-MM.db`; keeps last 6
- Recovery: `python scripts/recover.py` — interactive download from Drive

---

## AI Architecture (Pierre-inspired)

The AI handler implements the same architectural pattern as Pierre (InfinitePay):

1. **Tool calling:** model receives a list of tools (JSON), calls them to fetch live data before responding
2. **Context injection:** tool results are injected back into the conversation — model never answers from memory
3. **Conversation as interface:** available in Telegram + web chat panel
4. **Persona:** "BrokerShark" — direct, analytical, slightly cartoonish

**`backend/core/ai_service.py`** — shared service:
- `chat(message, history, stream_callback)` — agentic loop (MAX_ROUNDS=3)
- Handles tool dispatch, history management, system prompt
- Used by both `bot/handlers/ai_chat.py` (Telegram) and `dashboard/server.py` (web `POST /api/chat`)

**Model:** `qwen2.5:7b` (Q4_K_M, ~4.7GB VRAM) — better JSON structured output than phi3.5

**Tools (13):** `get_monthly_summary`, `get_monthly_comparison`, `get_expenses_by_category`, `get_account_balances`, `get_investments`, `get_recent_transactions`, `get_budgets`, `register_expense`, `register_income`, `register_investment`, `register_transfer`, `confirm`, `cancel`

---

## CSV Import (Web)

Upload via dashboard ImportModal (`/api/import-csv/preview` → `/api/import-csv/confirm`).

**Parsers:**
- `nubank_cc.parse(content)` — Nubank CC fatura
- `inter_cc.parse(content, adjust_installment_dates=False)` — Inter CC fatura (monthly files already have correct dates)
- `adjust_installment_dates=True` only for single-fatura imports where CSV shows original purchase date

**Historical bulk import (4 steps):**
```bash
python load_data/import_history.py          # import
python load_data/import_history.py --dry-run  # preview only
```

Steps: [1/4] Nubank extrato (nu-db) → [2/4] Nubank CC faturas (nu-cc) → [3/4] Inter CC faturas (inter-cc, `adjust_installment_dates=False`) → [4/4] Inter extrato (inter-db).

Duplicate detection key: `(date, amount, description, account_id)`.

**`is_revenue` on import:** All income transactions imported via `import_history.py` must pass `is_revenue=1` (except self-transfers where `counterpart='SELF'`, which stay `is_revenue=0`).

---

## Bot Interaction Design

### Main menu

```
BrokerShark — 21/04/2026
Abril 2026
Gastos: R$ X | Receitas: R$ X | Reservas: R$ X

[ 💸 Gasto ]  [ 💰 Recebimento ]  [ 📈 Investimento ]
```

### Expense flow
`ACCOUNT → AMOUNT → INSTALLMENTS → DESCRIPTION → DATE → CATEGORY → CONFIRMATION`

Payment + bank resolved in one tap (6 buttons): Nubank/Inter × Crédito/PIX/TED.

### Income flow
`INCOME_TYPE → BANK → AMOUNT → DESCRIPTION → DATE → CONFIRMATION`

"Transferência" opens internal transfer sub-flow (stored as `flow='expense', method='transfer', dest_account_id=<dest>`).

### Investment flow
`OPERATION → DESTINATION → AMOUNT → DESCRIPTION(optional) → DATE → CONFIRMATION`

---

## Data Model

```sql
accounts (id, bank, type, name, billing_day, due_day, initial_balance)
categories (id, name, flow)        -- flow: expense | income
transactions (id, date, flow, method, account_id, amount, installments,
              description, category_id, dest_account_id, counterpart, is_revenue)
investments (id, name, type, bank, current_balance)
investment_movements (id, date, investment_id, operation, amount, description)
budgets (id, category_id, amount_limit)
unrecognized_log (id, date, message)
```

Accounts: `nu-cc`, `nu-db`, `inter-cc`, `inter-db`

Internal transfers: `flow='expense'`, `method='transfer'`, `dest_account_id=<dest>`.
Excluded from summaries via `AND dest_account_id IS NULL`.

**`is_revenue` flag (critical):** Integer column on `transactions`. Must be set to `1` for real income transactions, `0` for self-transfers (`counterpart='SELF'`). Controls monthly income totals, account summaries, and patrimônio history. Always pass explicitly in `insert_transaction()` — never rely on migration defaults.

---

## Dashboard API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/events` | SSE stream |
| GET | `/api/summary` | Monthly totals (bank?, account?, month?, year?) |
| GET | `/api/accounts` | All accounts with balance |
| GET | `/api/investments` | All investments |
| GET | `/api/monthly` | Income vs expenses (`months=N`, default 6; `bank=?`) |
| GET | `/api/categories` | Expenses by category |
| GET | `/api/faturas` | Credit card billing |
| GET | `/api/transactions` | Account transactions (account, limit, month, year) |
| GET | `/api/recent-activity` | 20 most recent transactions |
| GET | `/api/patrimonio-history` | 12-month net worth (CC fatura payments counted as expenses) |
| GET | `/api/daily-spend` | Daily spend bar chart (`month=M&year=Y` for specific month, zero-filled) |
| GET | `/api/budgets` | Budget limits |
| POST | `/api/transactions` | Create expense |
| POST | `/api/incomes` | Create income or transfer |
| POST | `/api/investment-movements` | Create investment movement |
| POST | `/api/import-csv/preview` | Parse CSV, return preview |
| POST | `/api/import-csv/confirm` | Confirm and save CSV import |
| POST | `/api/chat` | AI chat message |
| PATCH | `/api/budgets/<id>` | Update budget limit |
| PATCH | `/api/transactions/<id>` | Reassign category |

---

## Development Guidelines

- **Type hints mandatory** on every function signature
- **All DB access through `core/database.py`** — no inline SQL elsewhere
- **Bot never writes directly to DB** — data validated before INSERT
- `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` at connection time
- **Drive/backup failures never propagate** — logged silently
- **Dashboard Flask server runs in a daemon thread** — never block the event loop

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

---

## Dashboard Frontend Notes

- **Date labels:** All monthly data uses `"Jan/26"` format (Portuguese abbreviated month + 2-digit year). Defined in `_PT_SHORT` in `database.py` for API responses and replicated in frontend components.
- **PatrimonioChart:** Chart.js filled area chart in `primitives.js` — gradient fill, visible x/y axes, compact BRL ticks, hover tooltip. Height 150px in overview card.
- **OverviewView patrimônio card:** Full-width; shows current value + trend chip (▲/▼ % + R$ diff vs prior month). Trend index resolved dynamically from `filterMonth` — not hardcoded to `length-1`.
- **HistoryView:** Uses `fetchMonthlyFull()` → `/api/monthly?months=36` for all-time view.
- **Daily spend:** `fetchDailySpend({ month, year })` → `/api/daily-spend?month=M&year=Y`. Returns all calendar days zero-filled when month/year provided.
- **Configurações panel:** Renamed from "Aparência". Organized into 3 sections (Aparência / Layout / Interface) with "Restaurar padrões" button.
- **Fatura dates:** Displayed as `"19 Abr → 18 Mai"` format via `_fmtCycleDate()` helper in both `view-overview.js` and `view-secondary.js`.
- **`backup.py` resilience:** `run_backup()` wraps `mkdir()` in try/except for `PermissionError`/`OSError` — returns `False` silently when HDD not mounted instead of crashing the scheduler.

---

## Automated Jobs

**Startup backup (30s after start):** local backup if due + Drive upload + prune.

**Weekly report (Monday 08:00):** expenses, income, top category, reserves, fatura due dates.

**Monthly closing (1st, 08:00):** full previous-month breakdown — income, expenses, categories, investments, net balance.

**Proactive alert:** after every expense, if monthly expenses ≥ income → sends alert.

---

## Roadmap

### Concluído (Fases 1–9c)
Bot flows (expense/income/investment), dashboard v1→v3, SSE, CSV import, investments, history, global month selector, AI chat with 13 tools, Ollama streaming, web-first pivot, Drive backup, Pierre-inspired AI architecture (`ai_service.py` shared module), `ChatView` (section 6 keyboard shortcut), `ImportModal` with drag-and-drop + Ollama categorization, `PatrimonioChart` with gradient fill and month/year labels, patrimônio calculation fix (CC fatura payments), `is_revenue` flag, HistoryView 36-month range, Configurações panel.

### Próximas fases

**Fase 10 — Systemd service**
- [ ] `brokershark.service` — autostart, low resource footprint

**Fase 10b — Edição e ajustes históricos**
- [ ] Delete transaction from dashboard
- [ ] Manual investment balance adjustment (for RDB/CDB daily yield that doesn't appear as movements)
- [ ] Spending goal alerts at 80% threshold (using `budgets` table)
