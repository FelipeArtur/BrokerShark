# BrokerShark — Gemini CLI Reference Guide

> Specs completas e invariantes detalhadas: [`CLAUDE.md`](./CLAUDE.md). Roadmap/hashes/logs datados vivem no `git log`.

Co-desenvolvido com **Claude Code CLI** e **Gemini CLI**. `.agents/skills/` = skills do Gemini; `.claude/commands/` = slash-commands do Claude. **Mudança permanente (categoria/conta/schema) → atualizar `CLAUDE.md` e `GEMINI.md`.**

---

## Overview

Ferramenta pessoal de análise de dinheiro, 100% local (Linux, 1 usuário). Pergunta central: **"quanto eu posso gastar agora?"**.

**O centro é a análise (web, React 18 + Flask, `http://localhost:8080`):**
- **Dinheiro** — herói **Disponível pra gastar** (liquidez = saldos em conta) + "Este mês", contas, atividade, projeções.
- **Histórico / Análise** — meses com dados, métricas, fluxo 6m, investimentos, categorias, Top PIX, tabela filtrável.
- **Investimentos** — donut + posições editáveis + "+ Movimento".

**Apoio:** import mensal de extratos (CSV) e posições B3 (xlsx) pela web. SQLite = fonte única; backup local mensal (HDD).

> **Regra de ouro:** toda escrita é pela web — não existe outro caminho (Telegram bot e IA local removidos em 2026-06-11; produto é web-only).

> **North star:** fácil de alimentar + extremamente confiável. Registro = **import de extratos em lote** com resumo editável antes de confirmar; correções na web = alinhamento de valores. Re-import semanal só acrescenta a cauda nova (dedup).

**User:** Nubank + Inter (conta corrente). Débito não é rotina (defensivo: tolera `debit` avulso). Investimentos: Caixinha Nubank, Porquinho Inter, Tesouro Direto, CDBs.

---

## Architecture

```
User (web form / CSV import — único caminho de escrita)
      ↓
core/database.py — INSERT (SQLite)
      ↓
core/events.notify() — SSE push ao browser (< 1s)
```

- **SQLite = fonte única.** Sem write-back externo. Toda escrita pela web.
- **CSV import via web** ("+ Importar" → preview/staging → confirm; dedup UUID/hash). Pipeline `backend/core/ingestion/`. Fontes: `nu-db`, `inter-db`. Importados entram com `category_id=NULL`; **categorização manual no Histórico** (filtro "Sem categoria" + inline → `PATCH /api/transactions/<id>`).
- **Runtime: always-on** — dashboard como serviço systemd de usuário (`brokershark-dashboard.service`, `Restart=on-failure`, `main.py` bloqueia em foreground) + backup como timer (`brokershark-backup.timer`, checagem diária 07h, `Persistent=true`). Exige `loginctl enable-linger`. Backup **mensal-apenas** (1 arquivo/mês, retém 12) via **API SQLite** (`conn.backup()`, WAL-safe), refrescado a cada import confirmado. `deploy/brokershark.sh` = atalho de browser; restore via `deploy/restore.sh` (para o serviço antes). Ver `deploy/README.md`.
- **Segurança de rede:** bind `127.0.0.1` + guard Host/Origin em `server.py` (DNS-rebinding/CSRF) — API sem auth, guard é load-bearing.

---

## Repository Structure

```
backend/
  main.py, config.py, bootstrap.py
  core/  database.py (shim), events.py, backup.py (snapshot mensal, tri-state),
         db/ (schema, crud, analytics, categories), ingestion/ (adapters, dedup, service, b3)
  jobs/backup.py  (python -m, entrypoint do timer)
  dashboard/server.py
frontend/js/  api.js, primitives.js, view-overview.js, view-history.js, view-investments.js, app.js
deploy/  systemd/* (dashboard.service, backup.{service,timer}, backup-alert.service),
         brokershark.sh, restore.sh, README.md
tests/   test_database, test_ingestion, test_b3, test_backup, test_jobs, test_delete,
         test_import_batch, test_investments, test_server_writes
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.14 (venv); código 3.12+ |
| Database | SQLite (WAL mode) |
| Backup | snapshot local mensal no HDD (retém 12), WAL-safe, refresh pós-import |
| Scheduler | **systemd user units** (`Persistent`) — dashboard.service + backup.timer |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads, foreground/systemd) |
| Frontend | React 18 + Babel standalone, Chart.js |
| Real-time | SSE via `events.py` |

---

## Data Model

```sql
accounts (id: nu-db | inter-db, bank, type, name)
categories (id, name, flow: expense|income)
transactions (id, date, flow, method, account_id, amount, description,
              category_id, dest_account_id, counterpart, is_revenue, external_id,
              display_name, is_third_party, original_amount, import_batch_id)
              -- import_batch_id: tag de sessão de import (1 por drop) → reversível via crud.delete_batch
investments (id, name, type, bank, current_balance)
investment_movements (id, date, investment_id, operation, amount, description)
budgets (id, category_id, amount_limit)
```

`method` CHECK: `pix | credit | ted | transfer | debit | salary | freelance | pix_received | other` (4 últimos = subtipos de receita; sem eles `INSERT OR IGNORE` descartava receita em silêncio).

### Invariantes financeiras (load-bearing)

- **Consumption-expense rule:** despesa filtra `dest_account_id IS NULL AND method != 'transfer'` — transferência (leg de investimento) nunca é despesa. Aplicada no backend e replicada no front (Histórico recebe `is_revenue`). Despesas/Receitas batem em todas as telas.
- **Patrimônio:** `get_patrimonio_history()` = só conta corrente (`initial_balances + income − expenses`); investimentos entram no display via `current_balance`. **Não filtra por method**.
- **`is_revenue`:** `1` receita real, `0` self-transfer. **Sempre explícito** em `insert_transaction()`.
- **`counterpart='SELF'`** (auto-Pix/TED entre contas próprias): nem despesa/receita/investimento. Saída `method='transfer'`, entrada `is_revenue=0`, ambas `SELF`. Saldos preservados, fora de Despesas/Receitas e `investment_net`. Via `adapters._is_self_transfer` (`config.OWNER_SELF_KEYWORDS`).
- **Transferência interna:** `flow='expense', method='transfer', dest_account_id=<dest>` — excluída via `AND dest_account_id IS NULL`.
- **Investimento (fonte = transações, não `investment_movements`):** aplicação = `expense/transfer/dest NULL`; resgate = `income/is_revenue=0/dest NULL`. `free_balance = receitas − despesas − investment_net`. "+ Movimento" → `crud.register_investment_transfer` (leg na conta + ajusta `current_balance`; **não** escreve `investment_movements`, que causaria dupla contagem).
- **Exclusão segura** (`crud.delete_transaction` + `ConfirmDeleteModal`): SELF apaga 2 legs; legs de investimento revertem `current_balance`.
- **Import reversível** (`crud.delete_batch`): cada confirm marca as linhas com um `import_batch_id` de sessão; `delete_batch` remove o lote inteiro. UI: toast "Desfazer" (5 s) pós-import; `DELETE /api/import/batch/<id>`.

---

## Dashboard API (resumo)

Escrita (validada no servidor): `POST /api/transactions` (despesa), `POST /api/incomes` (receita/transferência), `POST /api/investment-movements`, `PATCH /api/transactions/<id>` (category_id/display_name/is_third_party), `PATCH /api/budgets/<id>`, `DELETE /api/transactions/<id>`, `POST /api/transactions/restore`. Import: `POST /api/import/preview` (múltiplos `file` da mesma conta), `GET /api/import/staging/<batch_id>`, `PATCH /api/import/staging/<batch_id>/<row_id>` (edita preview → `amount_divergence`), `POST /api/import/confirm` (recebe/ecoa `import_batch_id`), `DELETE /api/import/batch/<id>` (reverte o lote).

Leitura: `/api/available` (herói), `/api/summary`, `/api/accounts`, `/api/investments`, `/api/monthly` (`?present=1` = só meses com dados), `/api/categories`, `/api/transactions`, `/api/recent-activity`, `/api/patrimonio-history`, `/api/daily-spend` (mês zero-filled), `/api/month-transactions` (inclui `is_revenue`), `/api/budgets`, `/api/categories-full`, `/api/pix-top`, `/api/expenses-by-method`, `/api/events` (SSE).

---

## Frontend — 3 telas

Navegação: **Visão do Mês** (`OverviewView`), **Histórico** (`HistoryView`), **Investimentos** (`InvestmentsView`). Atalhos `1`/`2`/`3`. Categorias vive em Configurações.

- **Dinheiro** (agora): herói **Disponível pra gastar** (`/api/available`); direita = ledger Patrimônio líquido. Sempre mês atual. Projeções advisory. Clicar conta → Histórico filtrado.
- **Histórico** (análise): meses com dados (`/api/monthly?present=1`), 4 métricas (Δ vs média), fluxo 6m (`DualLine`), por categoria, Top PIX, tabela filtrável (flow · método · categoria · conta · busca) + categorização inline.
- **Investimentos:** donut (`Donut`) + Σ `current_balance` + lista editável + "+ Movimento".

---

## Engineering Directives

- **Todo SQL via `core/database.py`** — sem SQL inline.
- **Type hints obrigatórias** — verificadas por mypy. Health Stack: `ruff` + `mypy` + `pytest` verdes antes de commitar (`pyproject.toml`, mypy estrito em `core/`). Enforçado pelo hook `deploy/hooks/pre-commit` (`git config core.hooksPath deploy/hooks`); bypass: `git commit --no-verify`.
- `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` no connect.
- Backup/restore nunca propagam exceção (logado + valor de retorno). `run_backup` é **tri-state** (`created|skipped|failed`) — o job sai ≠0 só em falha REAL (→ alerta via `OnFailure`).
- `main.py` bloqueia em foreground (`waitress.serve`) e sai ≠0 em ambiente inválido — systemd (`Restart=on-failure`) reage.
- **B3 ingestion:** `core/ingestion/b3.py` → `investments` (snapshot, upsert por nome; Renda Fixa = valor CURVA, Tesouro = Valor líquido). Memória (sem zip-slip), cap de tamanho, sem XXE.

---

## Configuration (`.env`)

```env
DB_PATH=/home/SEU_USUARIO/brokershark/data/brokershark.db   # ABSOLUTO
DASHBOARD_PORT=8080
OWNER_SELF_KEYWORDS=seu nome completo,fragmento-cpf
```
> `LOCAL_BACKUP_DIR` e retenção (12 mensais) hardcoded em `config.py`. `validate()` fail-fasta em `DB_PATH` inutilizável.

---

## Running

Produção local = systemd (ver `deploy/README.md`). Dev em foreground:

```bash
source .venv/bin/activate.fish
python backend/main.py
# Dashboard at http://localhost:8080  (parar o serviço antes, ou outra DASHBOARD_PORT)
```
