# BrokerShark — Gemini CLI Reference Guide

## Overview

BrokerShark is a personal finance assistant accessible via **Telegram**, running **100% locally** on Linux.
All registration is done through buttons — no commands to memorize, no natural language parsing required.
Every transaction is persisted in a local SQLite database and immediately mirrored to **Google Sheets**,
which serves as a permanent append-only backup.
A local web dashboard (Flask + Chart.js) runs alongside the bot for visual analysis.

**User profile:** 24-year-old male, accounts at Nubank and Inter (credit card + conta corrente). Does **not** use debit card as a payment method. Investments: Caixinha Nubank, Porquinho Inter, Tesouro Direto.

> For complete specs — conversation flows, all bot commands, full roadmap, design decisions — read [`CLAUDE.md`](./CLAUDE.md).

---

## AI Development Tools

This project is co-developed using **Claude Code CLI** and **Gemini CLI**.

| File | Purpose |
|---|---|
| `CLAUDE.md` | Full source of truth — architecture, flows, roadmap, design decisions (Claude Code) |
| `GEMINI.md` | Concise context guide for Gemini CLI — architecture summary + engineering directives |
| `.claude/commands/` | Claude Code slash-command skills (`/db-reset`, `/add-category`, etc.) |
| `.gemini/commands/` | Gemini CLI slash-command skills (mirrors `.claude/commands/`) |

When making permanent changes (new categories, new accounts, schema changes), update **both** `CLAUDE.md` and `GEMINI.md` to keep them in sync.

---

## Architecture

### Core data flow

```
User taps /novo in Telegram
      ↓
ConversationHandler (bot/handlers/) — guides the user step-by-step via inline buttons
      ↓
On confirmation: core/database.py — INSERT into transactions table (SQLite)
      ↓
core/events.notify() — SSE push to all connected dashboard clients (< 1s latency)
      ↓
integrations/sheets.py — append row in a background thread (non-blocking)
      ↓
bot/handlers/ — sends formatted confirmation to the user
```

### Key principles

- **SQLite is the single source of truth.** Sheets is an output — it is never read back.
- **Sheets rows are immutable.** Nothing is ever edited or deleted in the spreadsheet.
- **Sheets failures never surface to the user.** Errors are logged; the bot continues normally.
- **No AI in the registration flow.** Buttons eliminate the need for language model parsing at record time.
- **Dashboard is read-only.** It only reads from SQLite via Flask API — never writes.
- **Dashboard updates in real-time via SSE.** `events.py` broadcasts after every DB write.

---

## Repository Structure

```
brokershark/
├── backend/
│   ├── main.py            # Entry point — starts bot (polling) + scheduler + dashboard
│   ├── config.py          # Centralised env vars — only file that calls os.getenv()
│   ├── core/
│   │   ├── database.py    # Data layer — SQLite, table creation, all queries
│   │   ├── events.py      # SSE pub/sub — notify() after writes, subscribe()/unsubscribe()
│   │   └── backup.py      # Local SQLite backup (timestamped copy, prune old files)
│   ├── integrations/
│   │   └── sheets.py      # Google Sheets — append-only mirror after each INSERT
│   ├── dashboard/
│   │   └── server.py      # Flask routes + Waitress WSGI (8 threads, SSE endpoint)
│   └── bot/
│       ├── application.py # build_application(), scheduler lifecycle hooks
│       ├── constants.py   # State ints, ACCOUNT_MAP, INVESTMENT_META, *_LABELS, PARSER_MAP
│       ├── scheduler.py   # APScheduler — daily backup, weekly report, monthly closing
│       ├── utils.py       # _authorized, _fmt_brl, _fmt_date, _parse_*, _PT_MONTHS
│       ├── handlers/
│       │   ├── commands.py    # /novo, /saldo, /resumo, /fatura, /reservas, /ajuda, /cancelar
│       │   ├── expense.py     # Expense registration flow
│       │   ├── income.py      # Income registration flow
│       │   ├── investment.py  # Investment deposit/withdrawal flow
│       │   └── csv_import.py  # CSV import flow
│       └── parsers/
│           ├── nubank_cc.py   # Nubank credit card CSV parser
│           └── inter_cc.py    # Inter credit card CSV parser
├── frontend/
│   ├── index.html         # Markup only — refs to css/, js/, and img/
│   ├── css/style.css      # All styles — dark theme, CSS variables, responsive grid
│   └── js/
│       ├── api.js         # fetch wrappers for every endpoint (accepts optional ?bank=)
│       ├── charts.js      # Chart.js create/update functions
│       └── main.js        # Init, tab switching, SSE connection, refresh loop
├── .gemini/commands/      # Gemini CLI slash-command skills
├── .claude/commands/      # Claude Code slash-command skills
├── data/                  # SQLite database (not versioned)
├── logs/                  # Runtime logs (not versioned)
├── backups/               # Local automatic backups (not versioned)
├── credentials/
│   └── service_account.json  # Google API credentials (not versioned)
├── requirements.txt
└── .env                   # Secrets (not versioned — see .env.example)
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.12 |
| Bot framework | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Sheets integration | gspread + google-auth (Service Account) |
| Scheduler | APScheduler |
| Dashboard API | Flask 3.1 + Waitress 3.0 (8 threads, background thread) |
| Dashboard frontend | Chart.js 4.4 (CDN), vanilla JS (api.js / charts.js / main.js) |
| Real-time updates | SSE via `events.py` — no polling, < 1s latency |

---

## Data Model

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,         -- nu-cc | nu-db | inter-cc | inter-db
  bank TEXT NOT NULL,          -- nubank | inter
  type TEXT NOT NULL,          -- checking | credit
  name TEXT NOT NULL,
  billing_day INTEGER,         -- credit cards only
  due_day INTEGER,             -- credit cards only
  initial_balance REAL DEFAULT 0
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  flow TEXT NOT NULL           -- expense | income
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  flow TEXT NOT NULL,          -- expense | income
  method TEXT NOT NULL,        -- expense: pix|credit|ted|transfer  income: salary|freelance|pix_received|other
  account_id TEXT NOT NULL,
  amount REAL NOT NULL,
  installments INTEGER DEFAULT 1,
  description TEXT NOT NULL,
  category_id INTEGER,         -- required for expenses, null for income
  dest_account_id TEXT,        -- set for internal transfers (fatura payments: nu-db→nu-cc, inter-db→inter-cc; inter-account transfers: nu-db↔inter-db)
  counterpart TEXT,            -- sender/recipient name (external PIX)
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (dest_account_id) REFERENCES accounts(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,          -- "Caixinha Nubank" | "Tesouro Direto" | "Porquinho Inter"
  type TEXT NOT NULL,          -- savings | treasury
  bank TEXT NOT NULL,          -- nubank | inter
  current_balance REAL DEFAULT 0
);

CREATE TABLE investment_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  investment_id INTEGER NOT NULL,
  operation TEXT NOT NULL,     -- deposit | withdrawal
  amount REAL NOT NULL,
  description TEXT,
  FOREIGN KEY (investment_id) REFERENCES investments(id)
);

CREATE TABLE unrecognized_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  message TEXT NOT NULL
);
```

### Seed data

```python
# Accounts (id, bank, type, name, billing_day, due_day)
("nu-cc",    "nubank", "credit",   "Nubank Crédito", None, None)
("nu-db",    "nubank", "checking", "Nubank Conta",   None, None)
("inter-cc", "inter",  "credit",   "Inter Crédito",  None, None)
("inter-db", "inter",  "checking", "Inter Conta",    None, None)

# Expense categories
"Alimentação", "Carro", "Jogos", "Lazer", "Atividade física",
"Eletrônicos", "Educação", "Igreja", "Dízimo", "Outro"

# Income categories
"Salário", "Freela", "PIX recebido", "Transferência", "Outro"
```

---

## Dashboard API Endpoints

All data endpoints accept an optional `?bank=nubank|inter` query parameter.

| Endpoint | Returns |
|---|---|
| `GET /api/events` | SSE stream — `update` event after every DB write, `heartbeat` every 30s |
| `GET /api/summary[?bank=][?account=]` | Current month: income, expenses, balance, reservas, top category |
| `GET /api/accounts[?bank=]` | All (or filtered) accounts with current balance |
| `GET /api/investments[?bank=]` | All (or filtered) investments with current balance |
| `GET /api/monthly[?bank=][?account=]` | Last 6 months of income vs expenses |
| `GET /api/categories[?bank=][?account=]` | Current month expenses grouped by category |
| `GET /api/expenses-by-method[?bank=]` | Current month expenses grouped by bank and payment method |
| `GET /api/faturas[?bank=]` | Credit card billing info (total, due date, days remaining) |
| `GET /api/account/<account_id>` | Full account detail: balance, monthly summary, billing info |
| `GET /api/transactions?account=<id>[&limit=<n>][&month=<m>&year=<y>]` | Transactions for an account (max 200, default 100) |

Dashboard runs at `http://localhost:8080` (configurable via `DASHBOARD_PORT`).

---

## Engineering Directives

Follow these rules strictly when writing or modifying code:

- **Virtual environment:** Always use `.venv/bin/python` and `.venv/bin/pip`. Never run bare `python` or `pip`.
- **Database access:** All SQL goes through `backend/core/database.py`. Never write inline SQL in any other module.
- **Type hints:** Mandatory on every function signature.
- **Async constraints:** The Flask dashboard runs in a daemon thread. Never block the Telegram bot's async event loop. Google Sheets calls must run via `asyncio.get_event_loop().run_in_executor(None, ...)`.
- **Sheets failures are silent:** Log errors to `logs/sheets_errors.log` — never raise exceptions or notify the user.
- **Bot never writes to DB directly:** Data collected by `ConversationHandler` flows are validated before any INSERT is delegated to `core/database.py`.
- **Authorization check first:** Every incoming Telegram message handler must verify `chat_id` before any processing.
- **SQLite pragmas:** `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` are mandatory at connection time.
- **Internal transfers are not income:** A transfer between own accounts (Nubank → Inter) is stored as `flow='expense'`, `method='transfer'`, `dest_account_id=<destination>`. The destination balance is credited via the `inbound` subquery in `get_account_balance`. All summary queries filter `AND dest_account_id IS NULL` so transfers never appear in income or expense totals. Never record an internal transfer as `flow='income'`.

---

## Available Commands

These slash commands are available in `.gemini/commands/`:

| Command | Description |
|---|---|
| `/db-reset` | Wipe all transaction and investment data, keep account/category seeds |
| `/add-category` | Add a new expense or income category to the database |
| `/new-parser` | Scaffold a new CSV bank statement parser |
| `/check-health` | Verify DB integrity, seeds, investments, dashboard, and config |
| `/month-report` | Generate a formatted monthly financial report from SQLite |
| `/venv` | Create, activate, and verify the Python virtualenv |

---

## Configuration

### Environment variables (`.env`)

```env
TELEGRAM_TOKEN=...
TELEGRAM_CHAT_ID=...
DB_PATH=/home/felipe/brokershark/data/brokershark.db
BACKUP_DIR=/home/felipe/brokershark/backups
SHEETS_ID=...
SHEETS_CREDENTIALS=/home/felipe/brokershark/credentials/service_account.json
DASHBOARD_PORT=8080
```

### Running the project

```bash
source .venv/bin/activate.fish   # or .venv/bin/activate for bash/zsh
python backend/main.py
# Dashboard available at http://localhost:8080
```
