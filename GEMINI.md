# BrokerShark — Gemini CLI Reference Guide

> For complete specs — conversation flows, full roadmap, design decisions — read [`CLAUDE.md`](./CLAUDE.md).

---

## AI Development Tools

This project is co-developed using **Claude Code CLI** and **Gemini CLI**.

| File | Purpose |
|---|---|
| `CLAUDE.md` | Full source of truth — architecture, flows, design decisions (Claude Code) |
| `GEMINI.md` | Concise context guide for Gemini CLI |
| `.agents/skills/` | Gemini CLI skills (e.g., `impeccable`) |
| `.claude/commands/` | Claude Code slash-command skills |

When making permanent changes (new categories, new accounts, schema changes), update **both** `CLAUDE.md` and `GEMINI.md`.

---

## Overview

BrokerShark is a **personal money-analysis tool** running **100% locally** on Linux. Pergunta central: **"quanto eu posso gastar agora?"**, e então análise do dinheiro ao longo do tempo.

**O centro é a análise (web, React 18 + Flask, `http://localhost:8080`):**
- **Dinheiro** — herói **Disponível pra gastar** (liquidez = contas − faturas) + faturas, "Este mês", contas, atividade, projeções e reserva.
- **Histórico / Análise** — 36 meses, métricas, fluxo 6m, investimentos, categorias, Top PIX, tabela filtrável.

**Apoio:** Telegram (entradas rápidas + relatórios/alertas), importação CSV mensal, chat de IA local. SQLite é a fonte única; backup mensal HDD + Drive.

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
- **A análise é o produto.** Web (Dinheiro + Histórico) no centro; Telegram/import/IA são apoio.
- **CSV import via web UI** ("+ Importar" modal → preview/staging → confirm; dedup por UUID/hash; sem categorização automática — categoriza depois). Pipeline em `backend/core/ingestion/`. Fontes: `nu-db`, `inter-db`, `inter-cc`.
- **AI is Pierre-inspired:** tool calling, never fabricates data, always fetches via tools; args das tools validados no servidor.
- **Backup is monthly:** `should_backup()` checa por mês-calendário → local HDD + Drive.

---

## Repository Structure

```
backend/
  main.py, config.py
  core/     database.py (shim), events.py, backup.py,
            db/ (schema, crud, analytics, categories), ingestion/ (adapters, dedup, service)
  integrations/  drive.py, ollama.py
  dashboard/     server.py
  bot/      application.py, scheduler.py, utils.py, constants.py, handlers/ (commands, ai_chat)
frontend/
  css/ style.css   img/ favicon.ico
  js/  api.js, primitives.js, view-overview.js, view-history.js, app.js
deploy/  brokershark.service
docs/    (PRODUCT.md, notas)
tests/   conftest.py, test_database.py, test_ingestion.py, test_ai_chat.py
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
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads) |
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

**Patrimônio:** `get_patrimonio_history()` returns **checking balance only** (`initial_balances + income - expenses`). Investment movements are excluded. Frontend computes `patrTotal = patrNow + totalReservas` (investments.current_balance) for the big number; sparkline shows checking history only. CC fatura payments are counted as outflows via `dest_account_id IN ('nu-cc','inter-cc')`.

---

## AI Architecture (Pierre-inspired)

`backend/bot/handlers/ai_chat.py` — **Telegram only** (não há chat de IA na web):
- Tool calling via prompt engineering (not native tools API — qwen2.5:7b compatible)
- MAX_ROUNDS=3 agentic loop; args das tools `register_*` validados contra allow-lists antes de gravar
- Persona: "BrokerShark" — direct, analytical, finance-scoped only

Tools (13): `get_monthly_summary`, `get_monthly_comparison`, `get_expenses_by_category`, `get_account_balances`, `get_investments`, `get_recent_transactions`, `get_budgets`, `register_expense`, `register_income`, `register_investment`, `register_transfer`, `confirm`, `cancel`

---

## Dashboard API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/summary` | Monthly totals (bank?, account?, month?, year?) |
| GET | `/api/accounts` | Balances |
| GET | `/api/investments` | Investment balances |
| GET | `/api/monthly` | Income vs expenses (`months=N`, default 6; `bank=?`; `account=?`) |
| GET | `/api/daily-spend` | Full calendar month zero-filled (`month=M&year=Y`; defaults to current month) |
| GET | `/api/month-transactions` | All non-transfer txns for a month (`month=M&year=Y` required) |
| GET | `/api/categories` | Expenses by category |
| GET | `/api/faturas` | CC billing — includes `last_total` for trend display |
| GET | `/api/transactions` | Account transactions |
| GET | `/api/recent-activity` | 20 latest |
| GET | `/api/available` | Liquidez "disponível pra gastar": `{checking_total, faturas_total, available}` (available = checking − faturas) |
| GET | `/api/liquidity-history` | Tendência de liquidez 12M `{label, value}[]` (sparkline do herói) |
| GET | `/api/patrimonio-history` | 12-month net worth |
| GET | `/api/budgets` | Budget limits |
| GET | `/api/events` | SSE stream |
| POST | `/api/transactions` | Create expense |
| POST | `/api/incomes` | Create income/transfer |
| POST | `/api/investment-movements` | Create investment movement |
| POST | `/api/import/preview` | Upload+parse+classify+stage (`file`, `account_id`) |
| GET | `/api/import/staging/<batch_id>` | Re-read staged rows |
| POST | `/api/import/confirm` | Promote `new` rows (`batch_id`, `exclude_ids[]`) |
| PATCH | `/api/budgets/<id>` | Update budget |
| PATCH | `/api/transactions/<id>` | Reassign category |

### Response shape notes
- `/api/monthly` items: `{ label: "Mar/26", month: 3, year: 2026, income, expenses }` — `month`/`year` as int in all variants (global and per-account)
- `/api/daily-spend` always zero-fills every day of the month — no sparse "last 30 days" mode
- `/api/month-transactions` items: `{ id, date, description, amount, flow, account_id, bank, category, category_id }`
- `/api/faturas` items include `last_total` (previous billing cycle BRL total)

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
- **CSV ingestion:** `core/ingestion/` — `adapters.py` (parse), `dedup.py` (classify), `service.py` (orchestrate). Fontes: `nu-db`, `inter-db`, `inter-cc`

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

## Dashboard frontend — 2 telas (Fase 14)

Navegação = **2 telas**: **Dinheiro** (`OverviewView`) e **Histórico** (`HistoryView`). Atalhos `1`/`2`. Categorias saiu da nav → vive em Configurações.

**Dinheiro (tela "agora"):** herói = **Disponível pra gastar** (`fetchAvailable` → `/api/available`, liquidez = contas − faturas), verde/vermelho, com equação `Contas − Faturas` + sparkline de liquidez; direita = contexto (Patrimônio/Investimentos/Faturas). Abaixo: cards de fatura, "Este mês", lista de contas correntes, atividade recente. Sempre mês atual. Estado de 1ª vez (zero dados) = convite **Importar**. Clicar fatura/conta → vai pra Histórico filtrado pela conta.

**HistoryView (tela "análise"):** seletor de 36 meses + 4 métricas com Sparkline + gráfico fluxo 6m + `InvestmentsView` embutido (donut + movimentos) + por categoria + Top PIX + tabela filtrável (flow · método · categoria · **conta** · busca). Props `initialAccount`/`onAccountConsumed` = drill-down.

## Estado dos dados

| Conta | Situação |
|-------|----------|
| `nu-cc` | **Sem lançamentos individuais** — apenas totais de fatura |
| `inter-cc` | Lançamentos importados |
| `nu-db`, `inter-db` | Histórico completo |
| `budgets` | Seeded com limites padrão (Alimentação R$1500, etc.) — editáveis no dashboard |

## Running

```bash
source .venv/bin/activate.fish
python backend/main.py
# Dashboard at http://localhost:8080
```
