# BrokerShark — Claude Reference Guide

## Overview

BrokerShark is a personal finance assistant accessible via **Telegram**, running **100% locally** on Linux.
All registration is done through buttons — no commands to memorize, no natural language parsing required.
Every transaction is persisted in a local SQLite database and immediately mirrored to **Google Sheets**,
which serves as a permanent append-only backup.

**User profile:** 24-year-old male, accounts at Nubank and Inter (checking + credit card), Nubank savings account, and Tesouro Direto.

---

## Repository Structure

```
brokershark/
├── backend/
│   ├── main.py            # Entry point — starts bot (polling) + scheduler
│   ├── bot.py             # Bot logic — ConversationHandlers, InlineKeyboard, commands
│   ├── database.py        # Data layer — SQLite, table creation, queries
│   ├── sheets.py          # Google Sheets — append-only mirror after each INSERT
│   ├── backup.py          # Local SQLite backup (daily copy)
│   ├── scheduler.py       # APScheduler — daily backup + weekly report
│   └── parsers/
│       ├── nubank_cc.py   # Nubank credit card CSV parser
│       ├── nubank_db.py   # Nubank checking account CSV parser
│       ├── inter_cc.py    # Inter credit card CSV parser
│       └── inter_db.py    # Inter checking account CSV parser
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
ConversationHandler (bot.py) — guides the user step-by-step via inline buttons
      ↓
On confirmation: database.py — INSERT into transactions table (SQLite)
      ↓
sheets.py — append row in a background thread (non-blocking)
      ↓
bot.py — sends formatted confirmation to the user
```

### Key architectural principles

- **SQLite is the single source of truth.** Sheets is an output — it is never read back.
- **Sheets rows are immutable.** Nothing is ever edited or deleted in the spreadsheet.
- **Sheets failures never surface to the user.** Errors are logged; the bot continues normally.
- **No AI in the registration flow.** Buttons eliminate the need for language model parsing at record time.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.12 |
| Bot framework | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Sheets integration | gspread + google-auth (Service Account) |
| Scheduler | APScheduler |
| HTTP client | httpx |

> **Ollama (Phi-3.5 Mini / ROCm)** is reserved for future natural language queries and is **not** part of the registration flow.

---

## Running Locally

```bash
cp .env.example .env
# fill in your credentials
pip install -r requirements.txt
python backend/main.py
```

---

## Bot Interaction Design

### Main menu

Every session starts with `/novo` or the bot presents this menu:

```
O que você quer registrar?

[ Gasto ]           [ Recebimento ]
[ Investimento ]
```

Each option enters its own dedicated `ConversationHandler`.

---

### Flow 1 — Expense Registration

**Conversation states:**
```
PAYMENT_TYPE → BANK → AMOUNT → INSTALLMENTS → NUM_INSTALLMENTS → DESCRIPTION → CATEGORY → CONFIRMATION
```
`NUM_INSTALLMENTS` is only visited when the user answers "Sim" in `INSTALLMENTS`.

**Step 1 — Payment type**
```
Como foi o pagamento?
[ PIX ]  [ Crédito ]
[ Débito ]  [ TED ]
```

**Step 2 — Bank**
```
Qual banco?
[ Nubank ]  [ Inter ]
```
This resolves the `account_id`:
| Payment type | Bank | `account_id` |
|---|---|---|
| PIX / Débito / TED | Nubank | `nu-db` |
| PIX / Débito / TED | Inter | `inter-db` |
| Crédito | Nubank | `nu-cc` |
| Crédito | Inter | `inter-cc` |

**Step 3 — Amount**
```
Qual o valor? (ex: 45,90)
```
Accept both comma and dot as decimal separators.

**Step 4 — Installments?** *(credit card only)*
```
Foi parcelado?
[ Sim ]  [ Não ]
```
Skipped for PIX, Débito, and TED (defaults to 1).

**Step 5 — Number of installments** *(only if Sim)*
```
Em quantas vezes?
```

**Step 6 — Description**
```
Como você quer chamar esse gasto?
```
Free text (e.g., "iFood", "Ingresso show", "PS Store").

**Step 7 — Category**
```
Qual a categoria?
[ Alimentação ]        [ Carro ]
[ Jogos ]              [ Lazer ]
[ Atividade física ]   [ Eletrônicos ]
[ Educação ]           [ Igreja ]
[ Dízimo ]             [ Outro ]
```

**Step 8 — Confirmation summary**
```
Confirma o registro?

Tipo:      Crédito — Nubank
Valor:     R$ 89,90 (3x de R$ 29,97)
Gasto:     PS Store
Categoria: Jogos

[ Confirmar ]  [ Cancelar ]
```

**After confirmation**
```
Gasto registrado!

PS Store — R$ 89,90
Nubank Crédito · Jogos
17/04/2026
```

---

### Flow 2 — Income Registration

**Conversation states:**
```
INCOME_TYPE → BANK → AMOUNT → DESCRIPTION → CONFIRMATION
```

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
Income always goes into checking accounts: Nubank → `nu-db`, Inter → `inter-db`.

**Step 3 — Amount**
```
Qual o valor recebido? (ex: 3500,00)
```

**Step 4 — Description**
```
De onde veio? (ex: "Empresa X", "João", "Projeto site")
```

**Step 5 — Confirmation summary**
```
Confirma o registro?

Tipo:    Salário
Valor:   R$ 3.500,00
De:      Empresa X
Conta:   Nubank Débito

[ Confirmar ]  [ Cancelar ]
```

**After confirmation**
```
Recebimento registrado!

Salário — R$ 3.500,00
Empresa X · Nubank Débito
17/04/2026
```

---

### Flow 3 — Investment (Savings / Tesouro Direto)

**Conversation states:**
```
OPERATION → DESTINATION → AMOUNT → DESCRIPTION → CONFIRMATION
```

**Step 1 — Operation**
```
O que você quer fazer?

[ Investir (aporte) ]  [ Resgatar ]
```

**Step 2 — Destination**
```
Em qual investimento?

[ Caixinha Nubank ] [ Tesouro Direto ]
[ Porquuinho Inter ]
```

**Step 3 — Amount**
```
Qual o valor? (ex: 500,00)
```

**Step 4 — Description**
```
Alguma observação? (ex: "reserva emergência", "férias")
```

**Step 5 — Confirmation summary**
```
Confirma o investimento?

Operação:   Aporte
Onde:       Caixinha Nubank
Valor:      R$ 500,00
Obs:        reserva emergência

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

## Google Sheets Integration

### Design

Google Sheets acts as an **immutable mirror** of the local database. Every INSERT generates one `append_row` call. Rows are never edited or deleted.

If the local database is lost, the spreadsheet contains the complete transaction history and can be used for manual restoration.

### Sheets layout

| Sheet | Columns | Written when |
|---|---|---|
| Gastos | id, data, meio, banco, conta_id, valor, parcelas, descricao, categoria, data_registro | Each confirmed expense |
| Recebimentos | id, data, meio, banco, conta_id, valor, descricao, data_registro | Each confirmed income |
| Investimentos | id, data, reserva, operacao, valor, descricao, data_registro | Each confirmed investment move |

Summary sheets are not automated — native Google Sheets formulas handle aggregation on the spreadsheet side.

### `sheets.py` public interface

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

### One-time setup

```
1. Google Cloud Console → create project → enable Google Sheets API + Google Drive API
2. Create a Service Account → download JSON → save to credentials/service_account.json
3. Create a Google Sheets spreadsheet → copy the ID from the URL
4. Share the spreadsheet with the Service Account email (Editor permission)
5. Set SHEETS_ID in .env
```

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
  method TEXT NOT NULL,        -- expense: pix|credit|debit|ted  income: salary|freelance|pix_received|transfer|other
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
  name TEXT NOT NULL,          -- "Caixinha Nubank" | "Tesouro Direto"
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
    ("nu-cc",    "nubank", "credit",   "Nubank Crédito"),
    ("nu-db",    "nubank", "checking", "Nubank Débito"),
    ("inter-cc", "inter",  "credit",   "Inter Crédito"),
    ("inter-db", "inter",  "checking", "Inter Débito"),
]
```

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

Flow when a `.csv` file is received by the bot:

1. Bot detects incoming CSV file
2. Displays InlineKeyboard: which account? (`nu-cc` / `nu-db` / `inter-cc` / `inter-db`)
3. Calls the corresponding parser
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
- **All database access goes through `database.py`** — no inline SQL in any other module
- **The bot never writes directly to the database** — data collected by the `ConversationHandler` is validated before any INSERT
- Use `python-dotenv` to load environment variables
- Every incoming message must have its `chat_id` verified before any processing
- `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON` are mandatory at database creation
- **Google Sheets errors must never propagate to the user or interrupt the main flow**

### python-telegram-bot v21

- Use `Application.builder()` for setup
- Use `ConversationHandler` for all multi-step flows
- Use `InlineKeyboardMarkup` + `CallbackQueryHandler` for all buttons
- Register `CommandHandler` for `/novo`, `/saldo`, `/resumo`, `/reservas`, `/ajuda`
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
```

### Security

```python
# First check in every message handler
if update.effective_chat.id != int(os.getenv("TELEGRAM_CHAT_ID")):
    return  # silently ignore
```

---

## Automated Jobs

### Weekly backup

- Copies `brokershark.db` to `backups/brokershark_YYYY-MM-DD.db`
- Retains only the last 30 files
- Scheduled via APScheduler in `scheduler.py`

### Weekly report (Monday 08:00)

Sends the following message on Telegram:

```
Resumo da semana passada

Gastos: R$ X
Receitas: R$ X
Top categoria: X — R$ X
Fatura Nubank: R$ X (vence em N dias)
Fatura Inter: R$ X (vence em N dias)
Reservas: R$ X
```

---

## Design Decisions

| Decision | Rationale |
|---|---|
| Button-only registration | Eliminates typos and makes recording instant on mobile |
| Three separate flows (expense / income / investment) | Each flow has distinct fields — merging them would require complex conditional branching |
| Income always goes to checking accounts | Salary, freelance, and received PIX never land on a credit card — simplifies bank selection |
| Only Caixinha and Tesouro Direto as investments | These are the only active instruments — avoids premature complexity |
| Sheets as append-only backup with three separate sheets | Each transaction type has different columns; separate sheets make filtering straightforward |
| SQLite is the single source of truth | Sheets is write-only output — it is never read back by the application |
| Sheets failures are silent | Recording locally is always more important than mirroring; errors are logged only |
| SQLite WAL over PostgreSQL | Personal use, zero configuration, single file, trivial to back up |
| Ollama excluded from the registration flow | Buttons replace language model parsing for the MVP |
| Categories reflect the user's actual spending patterns | Generic categories don't map to real-world usage |
| Authentication by chat_id | Single-user personal bot — simple and sufficient |
| Investments limited to current instruments | Stocks, REITs, and crypto require live pricing APIs — out of scope for now |

---

## Roadmap

### Phase 1 — Foundation ← current
- [ ] `database.py` — table creation, PRAGMAs, account and category seeds, query functions
- [ ] `sheets.py` — `append_expense`, `append_income`, `append_investment` (background thread)
- [ ] `bot.py` — main menu + 3 ConversationHandlers (expense / income / investment)
- [ ] `main.py` — start bot (polling) + scheduler
- [ ] `backup.py` + `scheduler.py` — daily local backup + weekly report

### Phase 2 — Historical import
- [ ] Initial balance per account as an anchor before importing
- [ ] `parsers/nubank_cc.py` and `parsers/nubank_db.py`
- [ ] `parsers/inter_cc.py` and `parsers/inter_db.py`
- [ ] Duplicate detection by `(date, amount, description, account_id)`
- [ ] Import preview before confirmation
- [ ] Append imported transactions to Sheets after confirmation

### Phase 3 — Quick queries
- [ ] `/saldo` — balance per account
- [ ] `/resumo` — current month summary by category
- [ ] `/fatura` — current statement for credit cards (Nubank and Inter)
- [ ] `/reservas` — investment balances

### Phase 4 — Investment management
- [ ] Caixinha Nubank, Tesouro Direto
- [ ] Deposit and withdrawal flow via buttons

### Phase 5 — Smart queries (Ollama)
- [ ] Natural language questions: "quanto gastei em jogos esse mês?"
- [ ] Consolidated net worth (accounts + investments)
- [ ] Spending goals with 80% threshold alerts

### Phase 6 — Automation
- [ ] Automated weekly report via APScheduler

### Phase 7 — Local dashboard
- [ ] HTML page + Chart.js with account, investment, and net worth views

### Phase 8 — Extended investments (future)
- [ ] Stocks, REITs, Crypto
- [ ] Live pricing via yfinance + CoinGecko
