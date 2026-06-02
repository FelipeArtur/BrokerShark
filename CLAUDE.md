# BrokerShark — Claude Reference Guide

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

---

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

BrokerShark is a **personal money-analysis tool** running **100% locally** on Linux. Its job is to answer one question first — **"quanto eu posso gastar agora?"** — and then let me dig into where my money goes over time.

**The product is the analysis (web dashboard, `http://localhost:8080`):**
- **Dinheiro** (home) — the hero number **Disponível pra gastar** (liquidez = saldo das contas correntes − faturas em aberto), plus faturas, "Este mês", contas, atividade e projeções (fechamento do mês / próxima fatura).
- **Histórico / Análise** — linha do tempo dos meses com lançamentos (segue o intervalo real do banco), métricas mensais, fluxo 6m, investimentos, por categoria, Top PIX e a tabela filtrável.

**Supporting roles (não são o centro):** Telegram bot (entradas rápidas em linguagem natural + relatórios/alertas agendados), importação mensal de CSV (extratos/faturas), e chat de IA local (Ollama) que sempre busca dados reais antes de responder.

Every transaction is persisted in a local SQLite database (single source of truth). Monthly backups go to a local HDD directory and to Google Drive (same service account).

**User profile:** Single user, accounts at Nubank and Inter (credit card + conta corrente). Does **not** use debit card. Investments: Caixinha Nubank, Porquinho Inter, Tesouro Direto.

---

## Repository Structure

```
brokershark/
├── backend/
│   ├── main.py            # Entry point — starts bot + scheduler + dashboard
│   ├── config.py          # Centralised env vars — only file that calls os.getenv()
│   ├── core/
│   │   ├── database.py    # Data layer — SQLite, all queries (re-export shim → core/db/)
│   │   ├── db/            # Sub-modules: schema.py, crud.py, analytics.py, categories.py
│   │   ├── events.py      # SSE pub/sub — notify() after writes
│   │   └── backup.py      # Monthly backup: local HDD (should_backup + run_backup)
│   ├── integrations/
│   │   ├── drive.py       # Google Drive — monthly backup upload + recovery
│   │   └── ollama.py      # Ollama async client — chat, chat_stream
│   ├── dashboard/
│   │   └── server.py      # Flask routes + Waitress WSGI (32 threads, SSE)
│   └── bot/
│       ├── application.py # build_application(), scheduler lifecycle hooks
│       ├── constants.py   # ACCOUNT_CHOICES, INVESTMENT_META, ACCOUNT_LABELS, METHOD_LABELS, ACCOUNT_BANK, INCOME_LABELS
│       ├── scheduler.py   # APScheduler — monthly backup, weekly report, monthly closing
│       ├── utils.py       # _authorized, _fmt_brl, _fmt_date, _PT_MONTHS
│       ├── handlers/
│       │   ├── commands.py    # /saldo, /resumo, /fatura, /reservas, /ajuda
│       │   └── ai_chat.py     # AI chat handler — agentic loop, tool calling, system prompt
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js             # Fetch wrappers for all endpoints
│       ├── primitives.js      # Charts, shared UI components
│       ├── view-overview.js   # OverviewView (tela Dinheiro) + CategoriesPanel
│       ├── view-history.js     # InvestmentsView + HistoryView (tela Histórico/Análise)
│       └── app.js             # App shell — nav, SSE, search, tweaks
├── .claude/commands/      # /db-reset, /add-category, /check-health,
│                          # /month-report, /venv
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
      ↓ (Telegram only)
bot/handlers/ai_chat.py — confirmation message + spending alert if expenses ≥ income
```

### Key principles

- **SQLite is the single source of truth.** No external write-back.
- **A análise (web: Dinheiro + Histórico) é o produto.** Telegram, importação CSV e chat de IA são apoio.
- **AI is Pierre-inspired:** tool calling, context injection, conversation-as-interface (Telegram only). Never fabricates data — always fetches via tools before answering.
- **Backup runs on the 1st of each month** (cron 07:00): `should_backup()` guards against double-runs by checking if `brokershark_YYYY-MM.db` already exists this month. Path hardcoded to `/mnt/HDD_Arquivos/Backups/brokershark`.
- **All Telegram registrations go through AI.** The bot has a single `MessageHandler` catch-all → `ai_chat_handler`. No `ConversationHandler` flows exist.

### Patrimônio calculation

`get_patrimonio_history()` computes **checking account net worth only**: `initial_balances + income - expenses`. Investment movements are intentionally excluded — investments are added at display time via `investments.current_balance` (totalReservas). This separation prevents inconsistency between movement-based history and actual current balance.

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
- CC transactions: `amount <= 0` rows are excluded at import time — "Pagamento da fatura" row is never in the individual purchases account

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
- Path hardcoded: `/mnt/HDD_Arquivos/Backups/brokershark`
- `should_backup()` — returns `True` if `brokershark_YYYY-MM.db` does not yet exist this calendar month
- `run_backup()` — copies DB if due; keeps last 12 monthly files
- Triggered by monthly cron job (1st of each month at 07:00)

**Google Drive:**
- Upload runs after successful local backup (same cron job)
- Folder: `DRIVE_BACKUP_FOLDER` (default: "BrokerShark Backups")
- Files named `brokershark_YYYY-MM.db`; keeps last 6

---

## AI Architecture (Pierre-inspired)

The AI handler implements the same architectural pattern as Pierre (InfinitePay):

1. **Tool calling:** model receives a list of tools (JSON), calls them to fetch live data before responding
2. **Context injection:** tool results are injected back into the conversation — model never answers from memory
3. **Conversation as interface:** available in Telegram only
4. **Persona:** "BrokerShark" — direct, analytical, slightly cartoonish

**`backend/bot/handlers/ai_chat.py`** — all AI logic lives here:
- Agentic loop (MAX_ROUNDS=3), system prompt, tool definitions (13 tools), streaming
- `_is_on_topic()` — finance-domain filter before forwarding to Ollama
- `_parse_tool_call()` — JSON-in-text extraction (qwen2.5 format, not native tool API)
- `_execute_tool()` — dispatches tool calls to `core/database.py`

**Model:** `qwen2.5:7b` (Q4_K_M, ~4.7GB VRAM) — better JSON structured output than phi3.5

**Tools (13):** `get_monthly_summary`, `get_monthly_comparison`, `get_expenses_by_category`, `get_account_balances`, `get_investments`, `get_recent_transactions`, `get_budgets`, `register_expense`, `register_income`, `register_investment`, `register_transfer`, `confirm`, `cancel`

---

## Bot Interaction Design

### Main menu

```
BrokerShark — 21/04/2026
Abril 2026
Gastos: R$ X | Receitas: R$ X | Reservas: R$ X

[ 💸 Gasto ]  [ 💰 Recebimento ]  [ 📈 Investimento ]
```

### Registration flow (AI-driven)

All registrations go through the AI chat handler. The user describes the transaction in natural language; the AI extracts fields, calls the appropriate `register_*` tool (pending state), then asks for confirmation before persisting.

Internal transfers: stored as `flow='expense', method='transfer', dest_account_id=<dest>`.

---

## Data Model

```sql
accounts (id, bank, type, name, billing_day, due_day, initial_balance)
categories (id, name, flow)        -- flow: expense | income
transactions (id, date, flow, method, account_id, amount, installments,
              description, category_id, dest_account_id, counterpart,
              is_revenue, external_id, display_name, is_third_party)
              -- external_id: UUID do Nubank extrato (Identificador), dedup
              -- display_name: nome fantasia editável (substitui description na UI)
              -- is_third_party: 1 = excluído de todos os cálculos pessoais (ex: dinheiro de evento)
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
| GET | `/api/monthly` | Income vs expenses (`months=N`, default 6; `bank=?`; `account=?`) |
| GET | `/api/categories` | Expenses by category |
| GET | `/api/faturas` | Credit card billing — returns `total`, `last_total`, `cycle_start`, `cycle_end`, `days_until_due` |
| GET | `/api/transactions` | Account transactions (account, limit, month, year) |
| GET | `/api/recent-activity` | 20 most recent transactions |
| GET | `/api/available` | Real liquidity ("disponível pra gastar"): `{checking_total, faturas_total, available}` where `available = checking_total − faturas_total` (hero number of the Dinheiro screen) |
| GET | `/api/liquidity-history` | 12-month liquidity trend `{label, value}[]` (checking net worth EOM − card spend that month; proxy series powering the hero sparkline) |
| GET | `/api/patrimonio-history` | 12-month net worth (CC fatura payments counted as expenses) |
| GET | `/api/daily-spend` | Full calendar month zero-filled (`month=M&year=Y`; defaults to current month) |
| GET | `/api/month-transactions` | All non-transfer transactions for a month (`month=M&year=Y` required) |
| GET | `/api/budgets` | Budget limits |
| POST | `/api/transactions` | Create expense |
| POST | `/api/incomes` | Create income or transfer |
| POST | `/api/investment-movements` | Create investment movement |
| PATCH | `/api/budgets/<id>` | Update budget limit |
| PATCH | `/api/transactions/<id>` | Update category_id, display_name, and/or is_third_party |
| GET | `/api/pix-top` | Top PIX destinations (month, year) — `{label, count, total}[]` |
| POST | `/api/import/preview` | Multipart upload (`file`, `account_id`) → parse + classify + stage. Returns `{batch_id, source, counts, rows[]}` |
| GET | `/api/import/staging/<batch_id>` | Re-read staged rows for a batch |
| POST | `/api/import/confirm` | Promote a batch's `new` rows to transactions (`{batch_id, exclude_ids[]}`) |

### Web Import (ingestão mensal)

Sources are uploaded via the **"+ Importar"** header button (3-step modal: conta+arquivo → preview → confirmar). Pipeline lives in `backend/core/ingestion/` (`adapters.py` parse, `dedup.py` classify, `service.py` orchestrate) — all DB access routes through `crud`/`analytics`.

- **Supported now:** `nu-db` (extrato Nubank, comma/point, UUID dedup), `inter-db` (extrato Inter, semicolon/comma decimal, 5-line preamble), `inter-cc` (fatura Inter, quoted `R$`, bank category). `nu-cc` (fatura Nubank) deferred — sample dir empty, format unknown.
- **Staging:** rows land in `import_staging` (batch_id + status `new`/`duplicate`/`skipped`); `confirm` promotes `new` rows then deletes the batch. Nothing is written to `transactions` until confirm.
- **Dedup:** Nubank by `external_id` (partial UNIQUE index `idx_tx_external_id WHERE external_id IS NOT NULL` + `INSERT OR IGNORE`); Inter by occurrence count on `(account, date, round(amount,2), description)` — re-uploaded cumulative files add only the new tail, legitimate same-day duplicates preserved.
- **Investment rows** (Nubank: `Aplicação RDB`, `NuInvest`, `IRRF/resgate`, `Cobrança de investimentos`) → `method='transfer'`, `is_revenue=0`. **CC bill payments** (extrato `…fatura…`) → `method='transfer'`, `dest_account_id=<bank>-cc`. Both keep the account balance correct but are excluded from consumption totals.
- **Consumption-expense rule:** analytics expense totals now filter `dest_account_id IS NULL AND method != 'transfer'` — a transfer (investment leg or fatura payment) is never "despesa". Patrimônio query is intentionally **not** filtered by method (it must still count CC fatura payments via `dest IN ('nu-cc','inter-cc')`).
- Imports enter with `category_id=NULL` (categorize later in `TransactionPanel`).

### API response shapes (selected)

**`/api/monthly`** — each item: `{ label: "Mar/26", month: 3, year: 2026, income: 4200.0, expenses: 1500.0 }`
`month` and `year` integer fields are present in both global and per-account variants.

**`/api/faturas`** — each item includes `last_total` (previous billing cycle total in BRL) for trend calculation.

**`/api/daily-spend`** — always returns every day of the requested month zero-filled. Without params returns the current calendar month (not a rolling 30-day window).

**`/api/month-transactions`** — returns `{ id, date, description, display_name, amount, flow, method, account_id, bank, category, category_id, is_third_party }` for all non-transfer transactions across all accounts in that month, ordered by date ASC.

**`/api/pix-top`** — returns `{ label, count, total }[]` — top PIX expense destinations for a month, grouped by `COALESCE(display_name, description)`, ordered by total descending.

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
GOOGLE_CREDENTIALS=/home/SEU_USUARIO/brokershark/credentials/service_account.json
DRIVE_BACKUP_FOLDER=BrokerShark Backups
DASHBOARD_PORT=8080
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60
```

> `LOCAL_BACKUP_DIR` is hardcoded to `/mnt/HDD_Arquivos/Backups/brokershark` in `config.py` — no longer an env variable.

---

## Dashboard Frontend Notes

### Navigation — 2-screen IA (Fase 14 redesign)

The dashboard navigates **2 screens** (`app.js` `SECTIONS`): **Dinheiro** (`OverviewView`) and **Histórico** (`HistoryView`). Keyboard shortcuts `1`=Dinheiro, `2`=Histórico.

- **Dinheiro** = "como estou agora". Hero number is **Disponível pra gastar** (`fetchAvailable` → `/api/available`, liquidez = contas correntes − faturas em aberto), colored green/red, with the equation `Contas − Faturas` below and a real liquidity-trend sparkline (`/api/liquidity-history`). Right column = **ledger** mono (Patrimônio total / Contas / Investimentos / Faturas em aberto) via `LedgerRow` — sem barras de progresso decorativas. Layout: faturas em aberto logo abaixo do herói; depois **Este mês** + **Contas correntes** lado a lado (grid `var(--col-2)`); por fim atividade recente. Sempre no mês atual (sem seletor de período aqui). First-run (zero data) colapsa num único convite **Importar**. Clicar numa fatura/conta abre o Histórico filtrado por aquela conta.
- **Fase 14b — money assistant (advisory):** "Este mês" card shows a run-rate month-close projection; fatura cards show a cycle run-rate "projeção fechamento ~R$Y" (attenuated in the first 5 days of the cycle). Projections are client-side estimates, labelled as such.
- **Histórico** = "o que aconteceu". Hosts the **period selector** (timeline dos meses com dados — `fetchMonthlyFull` → `/api/monthly?present=1` → `get_monthly_history_present`, só meses com lançamentos), 4 metric cards (número + Δ vs média, sem sparkline), 6-month flow chart, embedded `InvestmentsView` (donut + movimentos), por categoria, Top PIX, and the **filterable table** (filtros: flow · método · categoria · **conta** · busca). Resumos (Por categoria + Top PIX) lado a lado; tabela em largura total. `initialAccount`/`onAccountConsumed` props drive the drill-down filter.
- **Categorias** (`CategoriesPanel`) is no longer a nav tab — reached via Configurações (`TweaksPanel`). The old `CardsView`/`AccountsView`/`AccountsCardsView` were **removed** (Fase 14 cleanup); their content lives in Histórico (`view-history.js` = `InvestmentsView` + `HistoryView`).

### Charts (`primitives.js`)

| Component | Type | Used in |
|-----------|------|---------|
| `Sparkline` | Chart.js line, no axes | Dinheiro hero (liquidez 12M), Histórico metric cards |
| `DualLine` | Chart.js 2-line with axes | Histórico (fluxo 6 meses) |
| `Donut` | Chart.js doughnut | Histórico → InvestmentsView |
| `Progress` | Pure CSS bar | definido, **não usado** (era hero breakdown, agora ledger) |
| `BarChart` | Chart.js bar | definido; disponível para barras mensais |
| `PatrimonioChart` | Chart.js filled area | definido, **não usado** |

All chart components receive **real API data only** — no placeholder data.

### Telas (arquivos)

- `view-overview.js` → **Dinheiro** (`OverviewView`) + `CategoriesPanel`. Comportamento detalhado na seção "Navigation — 2-screen IA" acima.
- `view-history.js` → **Histórico / Análise** (`InvestmentsView` + `HistoryView`).
- `app.js` → shell (nav de 2 telas, SSE, busca, Configurações, importação).

### Outros

- **Date labels:** formato `"Jan/26"` (mês abreviado PT + ano 2 dígitos). Definido em `_PT_SHORT` / `_PT_SHORT_ACC` em `database.py`.
- **Daily spend:** `fetchDailySpend({ month, year })` sempre retorna o mês calendário inteiro zerado (sem parâmetros = mês atual).
- **Fatura dates:** formato `"19 Abr → 18 Mai"` via `_fmtCycleDate()` em `view-overview.js` e `view-history.js`.
- **Configurações (`TweaksPanel`):** tema, atalho pra Categorias, "Restaurar padrões". Densidade é fixa em `comfortable` (não editável). Tweaks persistidos em localStorage.
- **`backup.py` resilience:** `run_backup()` captura `PermissionError`/`OSError` — retorna `False` silenciosamente quando o HDD não está montado.

---

## Automated Jobs

**Monthly backup (1st, 07:00):** local backup to `/mnt/HDD_Arquivos/Backups/brokershark` if not yet done this month + Drive upload + prune.

**Weekly report (Monday 08:00):** expenses, income, top category, reserves, fatura due dates.

**Monthly closing (1st, 08:00):** full previous-month breakdown — income, expenses, categories, investments, net balance.

**Proactive spending alert:** after every expense, if monthly expenses ≥ income → sends alert.

**Budget alert:** after every confirmed expense, `_check_budget_alerts()` checks if any category is ≥80% of its monthly limit → sends alert with 🟡 (80–99%) or 🔴 (≥100%) per category. Runs only when `budgets` table has non-zero limits.

---

## Estado dos dados (referência)

| Conta | Situação |
|-------|----------|
| `nu-db` | Extrato histórico completo importado (2020–2026, 67 arquivos) |
| `nu-cc` | Faturas individuais importadas (2024–2026, 28 arquivos) |
| `inter-db` | Extrato histórico importado (2025-01 a 2026-05) |
| `inter-cc` | Faturas individuais importadas (2025-01 a 2026-07) |
| Caixinha Nubank | 44 depósitos / 41 saques — saldo via movimentos de investimento |
| Porquinho Inter | 22 depósitos / 28 saques — saldo via movimentos de investimento |
| Tesouro Direto | Sem movimentos cadastrados ainda |
| Orçamentos (`budgets`) | Seeded com limites padrão por categoria via `_seed_budgets()` — editáveis no dashboard |

**Todos os dados importados via pipeline one-time (2026-05-13):**
- 1.291 transações + 135 movimentos de investimento
- Zero duplicatas — pipeline de import foi executado e descartado

---

## Estado atual

Produto = **análise do meu dinheiro**. A web (2 telas: **Dinheiro** + **Histórico/Análise**) é o centro; Telegram, importação CSV e chat de IA são apoio. O histórico completo das fases vive no `git log`.

**Já entregue (resumo):**
- Número herói **Disponível pra gastar** (liquidez = contas − faturas) + projeções (fechamento do mês / próxima fatura).
- **Histórico**: timeline dos meses com dados, 4 métricas, fluxo 6m, investimentos (donut + movimentos), por categoria, Top PIX, tabela filtrável (conta/método/categoria/busca).
- Importação mensal de CSV (`nu-db`, `inter-db`, `inter-cc`) com preview + dedup; staging em `import_staging`.
- Bot Telegram (entradas em linguagem natural + relatórios/alertas agendados; args das tools do LLM validados).
- Backup mensal: HDD + Google Drive; SSE ao vivo.

**Backlog (diferido):**
- [ ] Importar Relatório B3 (xlsx) → posições CDB/Tesouro em `investments.current_balance` (precisa `openpyxl`; tratar XXE/zip-slip).
- [ ] Adapter fatura Nubank (`nu-cc`) — formato desconhecido (diretório de exemplo vazio).
- [ ] Desfazer última importação (reverter batch por `batch_id`).
- [ ] Filtro "sem categoria" no Histórico (categorizar importados em lote).
- [ ] Registrar movimentos do Tesouro Direto.

**Revisão da lógica financeira (2026-06-02) — corrigido:**
- **CHECK de `method`** agora inclui os subtipos de receita: `IN ('pix','credit','ted','transfer','debit','salary','freelance','pix_received','other')`. Antes, num DB novo, `/api/incomes` e o registro de receita do bot violavam o CHECK e o `INSERT OR IGNORE` **descartava a receita silenciosamente** (retornando `id=-1` com `ok:True`).
- **`insert_transaction`** só usa `INSERT OR IGNORE` quando há `external_id` (caminho de dedup). Insert manual sem `external_id` agora **levanta** `IntegrityError` em vez de sumir com `-1`.
- **Parcelamento:** compra parcelada no crédito é expandida em N lançamentos mensais (`crud.insert_expense` → 1/N por ciclo, resto nos centavos da última parcela, dia clampado). Antes o valor cheio caía numa única fatura. Bot e web usam `insert_expense`. Faturas importadas já vinham por parcela.
- **`is_third_party`** agora é excluído também de `get_all_accounts_with_balance` (saldo do herói "Disponível"), consistente com `get_account_balance` e com os resumos.
- **`/api/incomes`** marca receita como `is_revenue=1` por padrão (só `is_revenue=0` explícito opta por fora); valida `type` e `method`/`installments` nas rotas de escrita.
- **`parse_money`** trata ponto-milhar sem decimais (`"1.000"` → 1000).
- Decisões deliberadas documentadas no código: `get_credit_card_statement` inclui terceiros de propósito (dívida com o banco); `get_patrimonio_history` e `_checking_balance_at` são séries distintas e não devem ser unificadas. Dinheiro continua como `REAL` (migração para centavos inteiros avaliada e descartada — risco desproporcional). Testes em `tests/test_database.py`, `tests/test_ingestion.py`, `tests/test_server_writes.py`.

**Notas de segurança (revisão VibeSec + 3 subagentes):**
- Hardening aplicado: gate de auth central no bot (owner-only), `_authorized` fail-closed, `config.validate()` no startup, gate Host/Origin no dashboard (DNS-rebinding + CSRF), OLLAMA_URL loopback + cap de stream, `Cache-Control: no-store` em `/api/`, systemd sandboxing.
- [x] **Resolvido (VibeSec, 2026-06-02):** args das tools `register_*` do LLM agora são validados em `ai_chat.py` antes de encenar/gravar — allow-lists derivadas das constantes (`_VALID_ACCOUNTS`/`_VALID_EXPENSE_METHODS`/`_VALID_INCOME_TYPES`/`_VALID_OPERATIONS`/`_VALID_INVESTMENTS`) + `_pos_amount` (>0, finito) + parcelas 1–99 + origem≠destino. Falha fechada (ValueError → nada gravado). Defesa contra prompt-injection. Testes em `tests/test_ai_chat.py`.
- [ ] **Ao construir B3 (xlsx):** xlsx é XML em zip → risco de XXE/zip-slip. Usar parser que desabilite entidades externas (openpyxl não resolve por padrão; confirmar) e validar caminhos extraídos.
- [ ] **Se adicionar export (CSV/planilha):** neutralizar CSV formula injection (células começando com `= + - @`) — hoje os dados são só renderizados via React (escapados), sem export, então não explorável.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
