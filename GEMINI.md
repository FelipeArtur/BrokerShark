# BrokerShark — Gemini CLI Reference Guide

> Specs completas e invariantes detalhadas: [`CLAUDE.md`](./CLAUDE.md). Roadmap/hashes/logs datados vivem no `git log`.

Co-desenvolvido com **Claude Code CLI** e **Gemini CLI**. `.agents/skills/` = skills do Gemini; `.claude/commands/` = slash-commands do Claude. **Mudança permanente (categoria/conta/schema) → atualizar `CLAUDE.md` e `GEMINI.md`.**

---

## Overview

Ferramenta pessoal de análise de dinheiro, 100% local (Linux, 1 usuário). Pergunta central: **"quanto eu posso gastar agora?"**.

**O centro é a análise (web, React 18 + Flask, `http://localhost:8080`):**
- **Dinheiro** — herói **Disponível pra gastar** (liquidez = contas − faturas) + faturas, "Este mês", contas, atividade, projeções.
- **Histórico / Análise** — meses com dados, métricas, fluxo 6m, investimentos, categorias, Top PIX, tabela filtrável.
- **Investimentos** — donut + posições editáveis + "+ Movimento".

**Apoio:** Telegram (**somente consulta + notificações**; não escreve), import CSV mensal pela web, chat de IA local. SQLite = fonte única; backup mensal local (HDD).

> **Regra de ouro:** toda escrita é pela web. Telegram lê e notifica — nunca escreve.

> **North star:** fácil de alimentar + extremamente confiável. Registro = **import de extratos/faturas em lote** com resumo editável antes de confirmar; correções na web = alinhamento de valores. Re-import semanal só acrescenta a cauda nova (dedup).

**User:** Nubank + Inter (CC + conta corrente). Débito não é rotina (defensivo: tolera `debit` avulso). Investimentos: Caixinha Nubank, Porquinho Inter, Tesouro Direto, CDBs.

---

## Architecture

```
User (web form / CSV import — único caminho de escrita)
      ↓
core/database.py — INSERT (SQLite)
      ↓
core/events.notify() — SSE push ao browser (< 1s)

Telegram = somente leitura (consulta + notificações)
```

- **SQLite = fonte única.** Sem write-back externo. Toda escrita pela web; Telegram read-only.
- **AI Pierre-inspired** (Telegram only): tool calling, nunca fabrica dado. **7 tools, todas de leitura** — sem `register_*`/`confirm`/`cancel`. Pedido de registro → prompt redireciona pra web.
- **CSV import via web** ("+ Importar" → preview/staging → confirm; dedup UUID/hash). Pipeline `backend/core/ingestion/`. Fontes: `nu-db`, `inter-db`, `inter-cc`. Importados entram com `category_id=NULL`; **categorização manual no Histórico** (filtro "Sem categoria" + inline → `PATCH /api/transactions/<id>`).
- **Runtime (alvo):** híbrido — dashboard+bot sob demanda (launcher); jobs (backup/semanal/fechamento) como **systemd user timers** (`Persistent=true`, catch-up no boot, exige `loginctl enable-linger`). APScheduler aposentado. Backup via **API SQLite** (`conn.backup()`, WAL-safe), não `shutil.copy2`. Hoje: processo único.

---

## Repository Structure

```
backend/
  main.py, config.py, bootstrap.py
  core/  database.py (shim), events.py, backup.py,
         db/ (schema, crud, analytics, categories), ingestion/ (adapters, dedup, service, b3)
  jobs/  backup, weekly_report, monthly_closing (python -m)
  integrations/ollama.py | dashboard/server.py
  bot/   application.py, constants.py, utils.py, reports.py, handlers/ (commands, ai_chat)
frontend/js/  api.js, primitives.js, view-overview.js, view-history.js, view-investments.js, app.js
deploy/  systemd/*, brokershark.sh, README.md
tests/   test_database, test_ingestion, test_ai_chat, test_b3, test_backup, test_server_writes
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.14 (venv); código 3.12+ |
| Bot | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Backup | local HDD copy (mensal) |
| Scheduler | **systemd user timers** (`Persistent`) via `backend/jobs/*`; APScheduler aposentado |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads) |
| Frontend | React 18 + Babel standalone, Chart.js |
| Real-time | SSE via `events.py` |
| AI | Ollama `qwen2.5:7b` (ROCm, RX 6600M) |

---

## Data Model

```sql
accounts (id: nu-cc | nu-db | inter-cc | inter-db, bank, type, name, billing_day, due_day)
categories (id, name, flow: expense|income)
transactions (id, date, flow, method, account_id, amount, installments, description,
              category_id, dest_account_id, counterpart, is_revenue, external_id,
              display_name, is_third_party, original_amount, import_batch_id)
              -- import_batch_id: tag de sessão de import (1 por drop) → reversível via crud.delete_batch
investments (id, name, type, bank, current_balance)
investment_movements (id, date, investment_id, operation, amount, description)
budgets (id, category_id, amount_limit)
```

`method` CHECK: `pix | credit | ted | transfer | debit | salary | freelance | pix_received | other` (4 últimos = subtipos de receita; sem eles `INSERT OR IGNORE` descartava receita em silêncio).

### Invariantes financeiras (load-bearing)

- **Consumption-expense rule:** despesa filtra `dest_account_id IS NULL AND method != 'transfer'` — transferência (leg de investimento / pagamento de fatura) nunca é despesa. Aplicada no backend e replicada no front (Histórico recebe `is_revenue`). Despesas/Receitas batem em todas as telas.
- **CC anti-duplicação:** total da fatura em `nu-db`/`inter-db` com `dest_account_id='nu-cc'/'inter-cc'` (patrimônio); compras individuais em `nu-cc`/`inter-cc` com `dest_account_id IS NULL` (resumos). Nunca se sobrepõem; simétrico Nubank/Inter.
- **Patrimônio:** `get_patrimonio_history()` = só conta corrente (`initial_balances + income − expenses`); investimentos entram no display via `current_balance`. **Não filtra por method** (precisa contar pagamento de fatura via `dest IN ('nu-cc','inter-cc')`).
- **`is_revenue`:** `1` receita real, `0` self-transfer. **Sempre explícito** em `insert_transaction()`.
- **`counterpart='SELF'`** (auto-Pix/TED entre contas próprias): nem despesa/receita/investimento. Saída `method='transfer'`, entrada `is_revenue=0`, ambas `SELF`. Saldos preservados, fora de Despesas/Receitas e `investment_net`. Via `adapters._is_self_transfer` (`config.OWNER_SELF_KEYWORDS`).
- **Transferência interna:** `flow='expense', method='transfer', dest_account_id=<dest>` — excluída via `AND dest_account_id IS NULL`.
- **Investimento (fonte = transações, não `investment_movements`):** aplicação = `expense/transfer/dest NULL`; resgate = `income/is_revenue=0/dest NULL`. `free_balance = receitas − despesas − investment_net`. "+ Movimento" → `crud.register_investment_transfer` (leg na conta + ajusta `current_balance`; **não** escreve `investment_movements`, que causaria dupla contagem).
- **Parcelamento:** crédito parcelado → N lançamentos via `crud.insert_expense`. Insert sem `external_id` levanta `IntegrityError` (não retorna `-1`). `is_third_party` excluído de saldos/resumos.
- **Exclusão segura** (`crud.delete_transaction` + `ConfirmDeleteModal`): pagamento de fatura não excluível (409); parcela apaga grupo `(k/N)`; SELF apaga 2 legs; legs de investimento revertem `current_balance`.
- **Import reversível** (`crud.delete_batch`): cada confirm marca as linhas com um `import_batch_id` de sessão; `delete_batch` remove o lote inteiro **incl. a linha-total da fatura** (que o delete por linha recusa e o Histórico esconde — senão ficaria órfão de dupla contagem). UI: toast "Desfazer" (5 s) pós-import; `DELETE /api/import/batch/<id>`.

---

## AI Architecture (Pierre-inspired)

`backend/bot/handlers/ai_chat.py` — **Telegram only, somente consulta** (sem IA na web): tool calling via prompt (não native API — qwen2.5:7b). MAX_ROUNDS=3, persona "BrokerShark". Tools (7, leitura): `get_monthly_summary`, `get_monthly_comparison`, `get_expenses_by_category`, `get_account_balances`, `get_investments`, `get_recent_transactions`, `get_budgets`. Tools de escrita removidas.

> **ROADMAP (Hermes Agent):** O uso atual de `qwen2.5:7b` via parsing manual de JSON provou-se ineficiente e propenso a quebras de loop. Há um plano de refatoração (`T-C`) para acoplar um **Agente Hermes** (ex: `Hermes-3-Llama-3.1-8B`) focado nativamente em Tool Calling, substituindo a lógica manual por uma comunicação mais fluida, efetiva e rápida com o banco de dados via Telegram.

---

## Dashboard API (resumo)

Escrita (validada no servidor): `POST /api/transactions` (despesa), `POST /api/incomes` (receita/transferência), `POST /api/investment-movements`, `PATCH /api/transactions/<id>`, `PATCH /api/budgets/<id>`, `DELETE /api/transactions/<id>` (409 fatura), `POST /api/transactions/restore`. Import: `POST /api/import/preview` (múltiplos `file` da mesma conta), `GET /api/import/staging/<batch_id>`, `PATCH /api/import/staging/<batch_id>/<row_id>` (edita preview → `amount_divergence`), `POST /api/import/confirm` (recebe/ecoa `import_batch_id`), `DELETE /api/import/batch/<id>` (reverte o lote).

Leitura: `/api/available` (herói), `/api/summary`, `/api/accounts`, `/api/investments`, `/api/monthly` (`?present=1` = só meses com dados), `/api/categories`, `/api/faturas` (inclui `last_total`), `/api/transactions`, `/api/recent-activity`, `/api/patrimonio-history`, `/api/daily-spend` (mês zero-filled), `/api/month-transactions` (inclui `is_revenue`), `/api/budgets`, `/api/categories-full`, `/api/pix-top`, `/api/expenses-by-method`, `/api/events` (SSE).

---

## Frontend — 3 telas

Navegação: **Visão do Mês** (`OverviewView`), **Histórico** (`HistoryView`), **Investimentos** (`InvestmentsView`). Atalhos `1`/`2`/`3`. Categorias vive em Configurações.

- **Dinheiro** (agora): herói **Disponível pra gastar** (`/api/available`); direita = ledger Patrimônio líquido. Sempre mês atual. Projeções advisory. Clicar fatura/conta → Histórico filtrado.
- **Histórico** (análise): meses com dados (`/api/monthly?present=1`), 4 métricas (Δ vs média), fluxo 6m (`DualLine`), por categoria, Top PIX, tabela filtrável (flow · método · categoria · conta · busca) + categorização inline.
- **Investimentos:** donut (`Donut`) + Σ `current_balance` + lista editável + "+ Movimento".

---

## Engineering Directives

- **Todo SQL via `core/database.py`** — sem SQL inline.
- **Type hints obrigatórias** — verificadas por mypy. Health Stack: `ruff` + `mypy` + `pytest` verdes antes de commitar (`pyproject.toml`, mypy estrito em `core/`).
- `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` no connect.
- **Bot nunca escreve direto no DB**; dado validado antes do INSERT. **Auth check primeiro** em todo handler (chat_id).
- Backup failures silent (logged, never raised). Dashboard em daemon thread, nunca bloqueia event loop.
- `ollama.py` = cliente HTTP puro (sem lógica de negócio/prompt).
- **B3 ingestion:** `core/ingestion/b3.py` → `investments` (snapshot, upsert por nome; Renda Fixa = valor CURVA, Tesouro = Valor líquido). Memória (sem zip-slip), cap de tamanho, sem XXE.

---

## Configuration (`.env`)

```env
TELEGRAM_TOKEN=seu_token_aqui
TELEGRAM_CHAT_ID=seu_chat_id_aqui
DB_PATH=/home/SEU_USUARIO/brokershark/data/brokershark.db
DASHBOARD_PORT=8080
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT=60
```
> `LOCAL_BACKUP_DIR` é hardcoded em `config.py`.

---

## Running

```bash
source .venv/bin/activate.fish
python backend/main.py
# Dashboard at http://localhost:8080
```
