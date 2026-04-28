# BrokerShark — Claude Reference Guide

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

## Overview

BrokerShark is a personal finance assistant accessible via **Telegram**, running **100% locally** on Linux.
All registration is done through buttons — no commands to memorize, no natural language parsing required.
Every transaction is persisted in a local SQLite database and immediately mirrored to **Google Sheets**,
which serves as a permanent append-only backup.
A local web dashboard (Flask + Chart.js) runs alongside the bot for visual analysis.

**User profile:** 24-year-old male, accounts at Nubank and Inter (credit card + conta corrente). Does **not** use debit card as a payment method. Investments: Caixinha Nubank, Porquinho Inter, Tesouro Direto.

---

## Repository Structure

```
brokershark/
├── backend/
│   ├── main.py            # Entry point — starts bot (polling) + scheduler + dashboard
│   ├── config.py          # Centralised env vars — only file that calls os.getenv()
│   ├── core/              # Infrastructure package
│   │   ├── __init__.py
│   │   ├── database.py    # Data layer — SQLite, table creation, all queries
│   │   ├── events.py      # SSE pub/sub — notify() after writes, subscribe()/unsubscribe()
│   │   └── backup.py      # Local SQLite backup (timestamped copy, prune old files)
│   ├── integrations/      # External services package
│   │   ├── __init__.py
│   │   └── sheets.py      # Google Sheets — append-only mirror after each INSERT
│   ├── dashboard/         # Flask dashboard package
│   │   ├── __init__.py    # Re-exports start_dashboard
│   │   └── server.py      # Flask routes + Waitress WSGI (8 threads, SSE endpoint)
│   └── bot/               # Telegram bot package
│       ├── __init__.py    # Re-exports build_application
│       ├── application.py # build_application(), scheduler lifecycle hooks
│       ├── constants.py   # State ints, ACCOUNT_MAP, INVESTMENT_META, *_LABELS, PARSER_MAP
│       ├── scheduler.py   # APScheduler — daily backup, weekly report, monthly closing
│       ├── utils.py       # _authorized, _fmt_brl, _fmt_date, _parse_*, _PT_MONTHS
│       ├── handlers/
│       │   ├── __init__.py    # Re-exports all build_*_handler functions
│       │   ├── commands.py    # /novo, /saldo, /resumo, /fatura, /reservas, /ajuda, /cancelar
│       │   ├── expense.py     # Expense registration flow
│       │   ├── income.py      # Income registration flow
│       │   ├── investment.py  # Investment deposit/withdrawal flow
│       │   └── csv_import.py  # CSV import flow
│       └── parsers/
│           ├── __init__.py
│           ├── nubank_cc.py   # Nubank credit card CSV parser
│           └── inter_cc.py    # Inter credit card CSV parser
├── frontend/
│   ├── index.html         # Markup only — refs to css/, js/, and img/
│   ├── img/
│   │   └── favicon.ico
│   ├── css/
│   │   └── style.css      # All styles — dark theme, CSS variables, responsive grid
│   └── js/
│       ├── api.js         # fetch wrappers for every endpoint (accepts optional ?bank=)
│       ├── charts.js      # Chart.js create/update functions (monthly, categories, accounts, investments)
│       └── main.js        # Init, tab switching, SSE connection, refresh loop
├── .claude/
│   └── commands/          # Claude Code project skills
│       ├── db-reset.md    # /db-reset  — wipe transaction data, keep seeds
│       ├── add-category.md# /add-category — add expense or income category
│       ├── new-parser.md  # /new-parser  — scaffold a new CSV bank parser
│       ├── check-health.md# /check-health — verify DB, config, and dashboard
│       ├── month-report.md# /month-report — formatted monthly financial report
│       └── venv.md        # /venv        — create, activate, verify virtualenv
├── data/                  # SQLite database (not versioned)
├── logs/                  # Runtime logs (not versioned)
├── backups/               # Local automatic backups (not versioned)
├── credentials/
│   └── service_account.json  # Google API credentials (not versioned)
├── requirements.txt
├── .env                   # Secrets (not versioned — see .env.example)
└── .env.example
```

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
      ↓ (after each expense)
bot/handlers/expense.py — checks if monthly expenses ≥ income → sends alert if true
```

### Key architectural principles

- **SQLite is the single source of truth.** Sheets is an output — it is never read back.
- **Sheets rows are immutable.** Nothing is ever edited or deleted in the spreadsheet.
- **Sheets failures never surface to the user.** Errors are logged; the bot continues normally.
- **No AI in the registration flow.** Buttons eliminate the need for language model parsing at record time.
- **Dashboard is read-only.** It only reads from SQLite via Flask API — never writes.
- **Dashboard updates in real-time via SSE.** `events.py` broadcasts after every DB write; the browser reacts immediately without polling.

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
| HTTP client | httpx |

> **Ollama (Phi-3.5 Mini / ROCm)** is reserved for future natural language queries and is **not** part of the registration flow.

---

## Running Locally

### Virtualenv

The project uses a virtualenv at `.venv/` (Python 3.14.4).

```bash
# Create (first time only)
python -m venv .venv

# Activate (fish shell)
source .venv/bin/activate.fish

# Activate (bash/zsh)
source .venv/bin/activate

# Install / sync dependencies
.venv/bin/pip install -r requirements.txt
```

Always run Python through the venv:
```bash
.venv/bin/python backend/main.py
```

Or activate first and then use `python` directly.

### First run

```bash
cp .env.example .env
# fill in your credentials
source .venv/bin/activate.fish
pip install -r requirements.txt
python backend/main.py
# Dashboard available at http://localhost:8080
```

---

## Bot Interaction Design

### Main menu

Every session starts with `/start` or `/novo`. The bot displays a financial snapshot for the current month before the action menu:

```
BrokerShark — 21/04/2026

Abril 2026
Gastos:        R$ X
Receitas:      R$ X
Top categoria: Alimentação — R$ X
Reservas:      R$ X

O que você quer fazer?

[ 💸 Gasto ]        [ 💰 Recebimento ]
[ 📈 Investimento ]
```

Each option enters its own dedicated `ConversationHandler`.

---

### Flow 1 — Expense Registration

**Conversation states:**
```
ACCOUNT → AMOUNT → INSTALLMENTS → DESCRIPTION → DATE → CATEGORY → CONFIRMATION
```
`INSTALLMENTS` is only visited for credit card payments (skipped for PIX and TED).
`DATE` accepts quick buttons (Hoje/Ontem) or typed input after selecting "Outra data".

**Step 1 — Payment method + bank (combined)**
```
Como foi o pagamento?
[ Nubank Crédito ]  [ Inter Crédito ]
[ Nubank PIX     ]  [ Inter PIX     ]
[ Nubank TED     ]  [ Inter TED     ]
```
One tap resolves both `account_id` and `method`.

| Button | `account_id` | `method` |
|---|---|---|
| Nubank Crédito | `nu-cc` | `credit` |
| Inter Crédito | `inter-cc` | `credit` |
| Nubank PIX | `nu-db` | `pix` |
| Inter PIX | `inter-db` | `pix` |
| Nubank TED | `nu-db` | `ted` |
| Inter TED | `inter-db` | `ted` |

**Step 2 — Amount**
```
Qual o valor? (ex: 45,90)
```
Accepts both comma and dot as decimal separators.

**Step 3 — Installments** *(credit card only)*
```
Em quantas vezes?
[ À vista ]  [ 2x ]   [ 3x ]
[ 4x ]       [ 6x ]   [ 12x ]
[ Outro número ]
```
Skipped for PIX and TED (defaults to 1). "Outro número" prompts for free-text entry.

**Step 4 — Description**
```
Como você quer chamar esse gasto?
```
Free text (e.g., "iFood", "Ingresso show", "PS Store").

**Step 5 — Date**
```
Quando foi a compra?
[ Hoje ]  [ Ontem ]  [ Outra data ]
```
"Outra data" prompts: `Qual a data? (ex: 19/04/2026 ou 19/04/2026 14:30)`

**Step 6 — Category**
```
Qual a categoria?
[ Alimentação ]        [ Carro ]
[ Jogos ]              [ Lazer ]
[ Atividade física ]   [ Eletrônicos ]
[ Educação ]           [ Igreja ]
[ Dízimo ]             [ Outro ]
```

**Step 7 — Confirmation summary**
```
Confirma o registro?

Tipo:      Crédito — Nubank
Valor:     R$ 89,90 (3x de R$ 29,97)
Gasto:     PS Store
Categoria: Jogos
Data:      17/04/2026

[ Confirmar ]  [ Cancelar ]
```

**After confirmation**
```
Gasto registrado!

PS Store — R$ 89,90
Nubank Crédito · Jogos
17/04/2026
```

If monthly expenses ≥ income, the bot immediately follows with a proactive alert.

---

### Flow 2 — Income Registration

**Conversation states:**
```
INCOME_TYPE → BANK → AMOUNT → DESCRIPTION → DATE → CONFIRMATION
```
`DATE` accepts quick buttons (Hoje/Ontem) or typed input after "Outra data".

**Step 1 — Income type**
```
O que você recebeu?

[ Salário ]          [ Freela ]
[ PIX recebido ]     [ Transferência ]
[ Outro ]
```

**Step 2 — Bank**
```
Em qual conta caiu?
[ Nubank ]  [ Inter ]
```
Income always goes into checking accounts: Nubank → `nu-db` ("Nubank Conta"), Inter → `inter-db` ("Inter Conta").

**Step 3 — Amount**
```
Qual o valor recebido? (ex: 3500,00)
```

**Step 4 — Description**
```
De onde veio? (ex: "Empresa X", "João", "Projeto site")
```

**Step 5 — Date**
```
Quando o valor foi recebido?
[ Hoje ]  [ Ontem ]  [ Outra data ]
```

**Step 6 — Confirmation summary**
```
Confirma o registro?

Tipo:  Salário
Valor: R$ 3.500,00
De:    Empresa X
Conta: Nubank Conta
Data:  17/04/2026

[ Confirmar ]  [ Cancelar ]
```

**After confirmation**
```
Recebimento registrado!

Salário — R$ 3.500,00
Empresa X · Nubank Conta
17/04/2026
```

---

### Flow 3 — Investment (Savings / Tesouro Direto)

**Conversation states:**
```
OPERATION → DESTINATION → AMOUNT → DESCRIPTION → DATE → CONFIRMATION
```
`DESCRIPTION` is optional — the user can tap "Pular" to skip it.
`DATE` accepts quick buttons (Hoje/Ontem) or typed input after "Outra data".

**Step 1 — Operation**
```
O que você quer fazer?

[ Investir (aporte) ]  [ Resgatar ]
```

**Step 2 — Destination**
```
Em qual investimento?

[ Caixinha Nubank ] [ Tesouro Direto ]
[ Porquinho Inter ]
```

**Step 3 — Amount**
```
Qual o valor? (ex: 500,00)
```

**Step 4 — Observation (optional)**
```
Alguma observação? (ex: "reserva emergência", "férias")
[ Pular ]
```
Tapping "Pular" saves `description=None` and goes directly to the date step.

**Step 5 — Date**
```
Quando foi realizado?
[ Hoje ]  [ Ontem ]  [ Outra data ]
```

**Step 6 — Confirmation summary**
```
Confirma o investimento?

Operação: Aporte
Onde:     Caixinha Nubank
Valor:    R$ 500,00
Obs:      reserva emergência
Data:     17/04/2026

[ Confirmar ]  [ Cancelar ]
```

**After confirmation**
```
Investimento registrado!

Aporte — R$ 500,00
Caixinha Nubank
17/04/2026
```

---

### Cancellation

`/cancelar` or the "Cancelar" button at any step aborts the active `ConversationHandler` and clears all collected state.

---

## Commands

| Command | Description |
|---|---|
| `/novo` / `/start` | Opens the main menu with monthly snapshot |
| `/saldo` | Balance per account |
| `/resumo` | Current month summary by category |
| `/fatura` | Current billing cycle for credit cards (total + days until due) |
| `/reservas` | Investment balances |
| `/ajuda` | Lists all commands |

---

## Google Sheets Integration

### Design

Google Sheets acts as an **immutable mirror** of the local database. Every INSERT generates one `append_row` call. Rows are never edited or deleted.

### Sheets layout

| Sheet | Columns | Written when |
|---|---|---|
| Gastos | id, data, meio, banco, conta_id, valor, parcelas, descricao, categoria, data_registro | Each confirmed expense |
| Recebimentos | id, data, meio, banco, conta_id, valor, descricao, data_registro | Each confirmed income |
| Investimentos | id, data, reserva, operacao, valor, descricao, data_registro | Each confirmed investment move |

### `integrations/sheets.py` public interface

```python
def append_expense(transaction: dict) -> None: ...
def append_income(transaction: dict) -> None: ...
def append_investment(movement: dict) -> None: ...
```

Implementation notes:
- Authenticate with `gspread.service_account(filename=CREDENTIALS_PATH)`
- Use `worksheet.append_row(row, value_input_option="USER_ENTERED")`
- Run in a thread via `asyncio.get_event_loop().run_in_executor(None, ...)` — never block the bot event loop
- Log failures to `logs/sheets_errors.log` — never raise or notify the user

---

## Local Dashboard

Flask/Waitress server runs as a daemon thread on port 8080 (configurable via `DASHBOARD_PORT`), 8 threads.

### API endpoints

All data endpoints accept an optional `?bank=nubank|inter` query parameter to filter by bank.

| Endpoint | Returns |
|---|---|
| `GET /api/events` | SSE stream — sends `update` event after every DB write, `heartbeat` every 30s |
| `GET /api/summary[?bank=][?account=]` | Current month: income, expenses, balance, reservas, top category |
| `GET /api/accounts[?bank=]` | All (or filtered) accounts with current balance |
| `GET /api/investments[?bank=]` | All (or filtered) investments with current balance |
| `GET /api/monthly[?bank=][?account=]` | Last 6 months of income vs expenses |
| `GET /api/categories[?bank=][?account=]` | Current month expenses grouped by category |
| `GET /api/expenses-by-method[?bank=]` | Current month expenses grouped by bank and payment method |
| `GET /api/faturas[?bank=]` | Credit card billing info (total, due date, days remaining) |
| `GET /api/account/<account_id>` | Full account detail: balance, monthly summary, billing info (credit only) |
| `GET /api/transactions?account=<id>[&limit=<n>][&month=<m>&year=<y>]` | Transactions for an account — filtered by month/year (max 200, default 100) |

### Dashboard panels

**Visão Geral** (bank filter tabs: Todos | Nubank | Inter)
- Cards: receitas, gastos, saldo líquido, reservas (current month, filtered by bank)
- Evolução 6 meses — line chart: receitas vs gastos
- Gastos por categoria — horizontal bar chart (current month, filtered)
- Faturas abertas — Nubank Crédito and/or Inter Crédito with cycle dates and days until due

**Contas**
- Account pills: Todas | Nubank Crédito | Nubank Conta | Inter Crédito | Inter Conta
- Grid view (default): all account cards with balance and type badge — clickable to drill down
- Drill-down view (single account):
  - Hero card: balance, monthly summary stats, billing cycle info (credit only)
  - Chart: gastos por categoria (credit) or evolução 6 meses (checking)
  - Transaction list with **month filter** (last 12 months, default current) and **category filter** (populated from fetched data)

**Investimentos**
- Investment cards: balance and % of total per product
- Distribuição — doughnut chart across Caixinha / Porquinho / Tesouro

Updates in real-time via SSE — dashboard reacts to any DB write in < 1s. Debounced 300ms to handle bulk CSV imports.

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
  method TEXT NOT NULL,        -- expense: pix|credit|ted  income: salary|freelance|pix_received|transfer|other
  account_id TEXT NOT NULL,
  amount REAL NOT NULL,
  installments INTEGER DEFAULT 1,
  description TEXT NOT NULL,
  category_id INTEGER,         -- required for expenses, null for income
  dest_account_id TEXT,        -- internal transfers only
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

### Required seed — accounts

```python
accounts = [
    ("nu-cc",    "nubank", "credit",   "Nubank Crédito", None, None),
    ("nu-db",    "nubank", "checking", "Nubank Conta",   None, None),
    ("inter-cc", "inter",  "credit",   "Inter Crédito",  None, None),
    ("inter-db", "inter",  "checking", "Inter Conta",    None, None),
]
```

> `nu-db` and `inter-db` are checking accounts used as destination for PIX and TED expenses and for all income. The label "Conta" deliberately avoids the word "Débito" since the user does not use debit card payments.

### Required seed — expense categories

```python
expense_categories = [
    "Alimentação",      # groceries, restaurants, snacks
    "Carro",            # fuel, maintenance, insurance
    "Jogos",            # PS Store, Steam, gaming subscriptions
    "Lazer",            # cinema, outings, hobbies
    "Atividade física", # gym, supplements, equipment
    "Eletrônicos",      # gadgets, accessories, repairs
    "Educação",         # college, courses, books
    "Igreja",           # church events, trips, contributions
    "Dízimo",           # monthly tithe
    "Outro",
]
```

### Required seed — income categories

```python
income_categories = [
    "Salário",
    "Freela",
    "PIX recebido",
    "Transferência",
    "Outro",
]
```

---

## CSV Import

Only credit card statements are supported for import.

Flow when a `.csv` file is received by the bot:

1. Bot detects incoming CSV file
2. Displays InlineKeyboard: `[ Nubank Crédito ]  [ Inter Crédito ]`
3. Calls the corresponding parser (`nubank_cc.py` or `inter_cc.py`)
4. Displays preview: transaction count, date range, total amount
5. Waits for `[Confirmar]` or `[Cancelar]`
6. Saves records and reports how many duplicates were skipped
7. Appends new transactions to Sheets in a background thread

Duplicate detection key: `(date, amount, description, account_id)`.

---

## Development Guidelines

### Code standards

- **Type hints are mandatory** on every function signature
- **Single-responsibility functions** — keep functions small and focused
- **All database access goes through `core/database.py`** — no inline SQL in any other module
- **The bot never writes directly to the database** — data collected by the `ConversationHandler` is validated before any INSERT
- Use `python-dotenv` to load environment variables
- Every incoming message must have its `chat_id` verified before any processing
- `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` are mandatory at database creation
- **Google Sheets errors must never propagate to the user or interrupt the main flow**
- **Dashboard Flask server runs in a daemon thread** — never block the bot event loop

### python-telegram-bot v21

- Use `Application.builder()` for setup
- Use `ConversationHandler` for all multi-step flows
- Use `InlineKeyboardMarkup` + `CallbackQueryHandler` for all buttons
- Register `CommandHandler` for `/novo`, `/start`, `/saldo`, `/resumo`, `/fatura`, `/reservas`, `/ajuda`
- Use `MessageHandler(filters.Document.ALL)` for CSV uploads

### SQLite

- Use context manager: `with sqlite3.connect(DB_PATH) as conn`
- Execute `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` at connection time

### gspread

- Authenticate: `gspread.service_account(filename=CREDENTIALS_PATH)`
- Append: `worksheet.append_row(row, value_input_option="USER_ENTERED")`
- Always run in a thread pool — never call synchronously from an async handler

---

## Configuration

### Environment variables (`.env.example`)

```env
# Telegram
TELEGRAM_TOKEN=YOUR_TOKEN_HERE
TELEGRAM_CHAT_ID=YOUR_CHAT_ID_HERE

# Database
DB_PATH=/home/YOUR_USER/brokershark/data/brokershark.db
BACKUP_DIR=/home/YOUR_USER/brokershark/backups

# Google Sheets
SHEETS_ID=YOUR_SPREADSHEET_ID_HERE
SHEETS_CREDENTIALS=/home/YOUR_USER/brokershark/credentials/service_account.json

# Dashboard (optional — default: 8080)
DASHBOARD_PORT=8080
```

### Security

```python
# First check in every message handler
if update.effective_chat.id != int(os.getenv("TELEGRAM_CHAT_ID")):
    return  # silently ignore
```

---

## Automated Jobs

### Daily backup (03:00)

Copies `brokershark.db` to `backups/brokershark_YYYY-MM-DD.db`. Retains only the last 30 files.

### Weekly report (Monday 08:00)

```
Resumo semanal — DD/MM a DD/MM

Gastos:        R$ X
Receitas:      R$ X
Top categoria: X — R$ X
Reservas:      R$ X

Faturas abertas
Nubank:  R$ X — vence em N dias
Inter:   R$ X — vence em N dias
```

### Monthly closing report (1st of each month, 08:00)

```
Fechamento de Mês/Ano

Receitas:  R$ X
Gastos:    R$ X
Saldo:     +/- R$ X

Gastos por categoria
  Alimentação: R$ X
  ...

Movimentações em investimentos
  Caixinha Nubank — Aporte: R$ X

Reservas acumuladas: R$ X
```

### Proactive spending alert

Triggered after every confirmed expense. If monthly expenses ≥ monthly income, the bot sends:

```
⚠️ Atenção! Seus gastos em Mês já representam X% das suas receitas.

Gastos:   R$ X
Receitas: R$ X
```

---

## Design Decisions

| Decision | Rationale |
|---|---|
| Button-only registration | Eliminates typos and makes recording instant on mobile |
| Three separate flows (expense / income / investment) | Each flow has distinct fields — merging them would require complex conditional branching |
| Payment methods: PIX, Crédito, TED only | User does not use debit card — removed to simplify the flow |
| Checking accounts labeled "Conta" not "Débito" | User doesn't use debit cards; "Conta" is neutral and accurate |
| CSV import limited to credit cards | No debit parsers needed since debit is not used |
| Income always goes to checking accounts | Salary, freelance, and received PIX never land on a credit card |
| Only Caixinha, Porquinho, and Tesouro as investments | These are the only active instruments |
| Sheets as append-only backup with three separate sheets | Each transaction type has different columns |
| SQLite is the single source of truth | Sheets is write-only output — never read back |
| Sheets failures are silent | Recording locally is always more important than mirroring |
| SQLite WAL over PostgreSQL | Personal use, zero configuration, single file, trivial to back up |
| Flask dashboard in a daemon thread | Runs alongside the async bot without blocking the event loop |
| Dashboard is read-only | Never writes to SQLite — only reads via Flask endpoints |
| Ollama excluded from the registration flow | Buttons replace language model parsing for the MVP |
| Authentication by chat_id | Single-user personal bot — simple and sufficient |

---

## Roadmap

### Phase 1 — Foundation ✅ DONE
- [x] `database.py` — table creation, PRAGMAs, account and category seeds, query functions
- [x] `sheets.py` — `append_expense`, `append_income`, `append_investment` (background thread)
- [x] `bot.py` — main menu + 3 ConversationHandlers (expense / income / investment)
- [x] `main.py` — start bot (polling) + scheduler
- [x] `backup.py` + `scheduler.py` — daily local backup + weekly report

### Phase 2 — Historical import ✅ DONE
- [x] `parsers/nubank_cc.py` and `parsers/inter_cc.py` (credit card only)
- [x] Duplicate detection by `(date, amount, description, account_id)`
- [x] Import preview before confirmation
- [x] Append imported transactions to Sheets after confirmation

### Phase 3 — Quick queries ✅ DONE
- [x] `/saldo` — balance per account
- [x] `/resumo` — current month summary by category
- [x] `/fatura` — current billing cycle for credit cards with due date and days remaining
- [x] `/reservas` — investment balances
- [x] `/start` and `/novo` — financial snapshot on the home screen

### Phase 4 — Investment management ✅ DONE
- [x] Caixinha Nubank, Tesouro Direto, Porquinho Inter
- [x] Deposit and withdrawal flow via buttons

### Phase 5 — Automation ✅ DONE
- [x] Fatura data included in the weekly report
- [x] Monthly closing report (sent on the 1st of each month at 08:00)
- [x] Proactive alert when monthly expenses ≥ monthly income

### Phase 6 — Local dashboard ✅ DONE
- [x] Flask API server (background thread, port 8080)
- [x] Single-page dashboard (`frontend/index.html`) — dark theme, Chart.js
- [x] Cards: receitas, gastos, saldo líquido, reservas
- [x] Charts: evolução 6 meses, gastos por categoria, saldo por conta, distribuição investimentos
- [x] Faturas abertas com dias até vencimento
- [x] Auto-refresh a cada 60 segundos

### Phase 6b — Dashboard v2 ✅ DONE
- [x] Frontend separado em `css/style.css` + `js/api.js` + `js/charts.js` + `js/main.js`
- [x] Tabs por banco: Todos | Nubank | Inter (filtra todos os painéis)
- [x] Parâmetro `?bank=nubank|inter` em todos os endpoints de dados
- [x] SSE real-time via `events.py` — dashboard atualiza em < 1s após cada registro
- [x] Debounce 300ms no frontend (evita multi-refresh em imports CSV)
- [x] Servidor Flask substituído por Waitress (produção, 8 threads)
- [x] SQLite otimizado: `synchronous=NORMAL`, `cache_size=-8000`, `temp_store=MEMORY`
- [x] N+1 eliminado em `/api/accounts` (1 query JOIN)
- [x] `get_monthly_history()` reescrito: 18 queries → 1 query
- [x] Cache do cliente gspread (1 autenticação por processo)
- [x] Job de backup async via `asyncio.to_thread()`

### Phase 6c — Reorganização de arquitetura + documentação ✅ DONE
- [x] Código separado em pacotes: `core/`, `integrations/`, `dashboard/`, `bot/parsers/`, `bot/scheduler.py`
- [x] Docstrings Google-style completas em todas as funções públicas
- [x] Skills Claude Code em `.claude/commands/`: db-reset, add-category, new-parser, check-health, month-report, venv
- [x] CLAUDE.md atualizado com nova estrutura

### Phase 6d — Simplificação dos fluxos de registro ✅ DONE
- [x] Pagamento + banco unidos em 1 tela (6 botões diretos → resolve `account_id` e `method`)
- [x] Parcelamento reescrito: 2 passos (Sim/Não + nº) → 1 tela (À vista / 2x / 3x / 4x / 6x / 12x / Outro)
- [x] Data com atalhos Hoje / Ontem / Outra data nos 3 fluxos (gasto, recebimento, investimento)
- [x] Observação do investimento opcional — botão "Pular"
- [x] `ACCOUNT_CHOICES` substitui `ACCOUNT_MAP` em `constants.py`

### Phase 7 — Reestruturação do dashboard ✅ DONE
- [x] Visão por conta individual com drill-down (saldo + evolução mensal + últimas transações)
- [x] Histórico de transações com filtros: mês/ano (backend) e categoria (frontend)

### Phase 8 — Serviço systemd + Histórico comparativo
- [ ] Serviço systemd para autostart no boot (brokershark.service)
- [ ] `/historico` — evolução mensal de gastos e receitas (últimos N meses)
- [ ] `/comparar` — comparação lado a lado de dois períodos
- [ ] Tendência de gastos por categoria ao longo do tempo

### Phase 8b — Edição e correção de dados históricos
- [ ] Edição de categoria por transação no dashboard (clique inline na lista de transações)
- [ ] Ajuste manual de saldo de investimento no dashboard — necessário porque RDB/CDB rendem juros diários que não aparecem no extrato como movimentos; o saldo importado do CSV reflete apenas aportes e resgates explícitos

### Phase 9 — Smart queries (Ollama)
- [ ] Natural language questions: "quanto gastei em jogos esse mês?"
- [ ] Consolidated net worth (accounts + investments)
- [ ] Spending goals with 80% threshold alerts
