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
- **CSV import via web** ("+ Importar" → preview/staging → confirm; dedup UUID/hash). Pipeline `backend/core/ingestion/`. Fontes: `nu-db`, `inter-db`. Importados entram com `category_id=NULL`; **categorização manual no Histórico** (filtro "Sem categoria" + inline → `PATCH /api/transactions/<id>`). Preview tem **sugestão suggest-only** de categoria (aprendida do histórico via `domain.classification` + `analytics.get_categorized_history`; staging traz `counterpart`/`suggested_category_id`/`suggested_category_name`) — nunca auto-aplica: troca manual persiste na hora, sugestão intocada só grava no confirm p/ linhas incluídas.
- **Runtime: foreground via `./run.sh`** (deploy em rethink — TODOS T-C; `deploy/` apagado 2026-06-23). `main.py` bloqueia no `waitress.serve`. Backup **manual** (`PYTHONPATH=backend .venv/bin/python -m jobs.backup`), mensal-apenas (1/mês, retém 12) via API SQLite (`conn.backup()`, WAL-safe). Restore = cópia manual do `.db` com app parado (wrapper `restore.sh` apagado; lógica em `core/backup.py::restore_backup`; redesenho seguro = P1 no T-C). Modelo antigo systemd no `git log`.
- **Segurança de rede:** bind `127.0.0.1` + guard Host/Origin em `server.py` (DNS-rebinding/CSRF) — API sem auth, guard é load-bearing.

---

## Repository Structure

```
backend/
  main.py, config.py, bootstrap.py
  core/  database.py (facade), events.py, backup.py (snapshot mensal, tri-state),
         db/ (schema c/ conn-factory seam, crud, analytics, categories, _sql consumption clause),
         domain/ (classification — PURO, sem DB), ingestion/ (adapters, dedup, service, b3)
  jobs/backup.py  (python -m, entrypoint do timer)
  dashboard/server.py
frontend/js/  api.js, primitives.js, view-overview.js, view-history.js, view-investments.js, app.js
.githooks/  pre-commit (Health Stack gate — core.hooksPath .githooks)
         # deploy/ apagado 2026-06-23 — runtime/restore em rethink (TODOS T-C)
tests/   conftest.py (raiz); unit/ (puro, sem DB: classification, jobs);
         integration/ (DB/Flask/backup: database, ingestion, b3, backup, delete,
         import_batch, investments, server_writes, golden_totals, db_seam)
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.14 (venv); código 3.12+ |
| Database | SQLite (WAL mode) |
| Backup | snapshot local mensal no HDD (retém 12), WAL-safe, refresh pós-import |
| Scheduler | **nenhum** — deploy em rethink (TODOS T-C); backup manual |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads, foreground via `./run.sh`) |
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
statement_coverage (id, year, month, origin, created_at)  -- UNIQUE(year,month); origin import|manual; rede de segurança
budgets (id, category_id, amount_limit)
```

`method` CHECK: `pix | credit | ted | transfer | debit | salary | freelance | pix_received | other` (4 últimos = subtipos de receita; sem eles `INSERT OR IGNORE` descartava receita em silêncio).

### Invariantes financeiras (load-bearing)

- **Consumption-expense rule:** despesa filtra `flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0` — transferência (leg de investimento) nunca é despesa. **Fonte única:** `core/db/_sql.py::consumption_expense_clause(alias)`. Não aplicar a income/investment-leg/patrimônio (cláusulas diferentes). Front replica só a flag `is_revenue`. Gate: `tests/integration/test_golden_totals.py`.
- **Patrimônio:** `get_patrimonio_history()` = só conta corrente (`initial_balances + income − expenses`); investimentos entram no display via `current_balance`. **Não filtra por method**.
- **`is_revenue`:** `1` receita real, `0` self-transfer. **Sempre explícito** em `insert_transaction()`.
- **`counterpart='SELF'`** (auto-Pix/TED entre contas próprias): nem despesa/receita/investimento. Saída `method='transfer'`, entrada `is_revenue=0`, ambas `SELF`. Saldos preservados, fora de Despesas/Receitas e `investment_net`. Via `adapters._is_self_transfer` (`config.OWNER_SELF_KEYWORDS`).
- **Transferência interna:** `flow='expense', method='transfer', dest_account_id=<dest>` — excluída via `AND dest_account_id IS NULL`.
- **Investimento (fonte = transações, não `investment_movements`):** aplicação = `expense/transfer/dest NULL`; resgate = `income/is_revenue=0/dest NULL`. `free_balance = receitas − despesas − investment_net`. "+ Movimento" → `crud.register_investment_transfer` (leg na conta + ajusta `current_balance`; **não** escreve `investment_movements`, que causaria dupla contagem).
- **B3 = tabela verdade:** relatório B3 é a fonte autoritativa da tabela `investments` (Tesouro/CDB/NuInvest). `b3.load_b3_positions` **full-sync**: upsert por nome + `crud.prune_investments_except` apaga posição ausente do relatório (espelho fiel). **Read-only:** `PATCH /api/investments/<id>/balance` → **409** (ajuste = re-importar). `prune_investments_except([])` = no-op (relatório vazio nunca apaga tudo).
- **Só Caixinha Nubank derivada:** vive só no ledger (não vai p/ tabela `investments` nem B3). `analytics.get_ledger_savings_positions()` = `Σ(aplicações) − Σ(resgates)` por keyword (`rdb`/`caixinha`/`dinheiro guardado`, banco nubank), sem SELF. `/api/investments` anexa (`id=null, derived=true`). Só Caixinha pq é **RDB (não custodiada na B3)**. **Porquinho Inter NÃO é derivado** — é CDB custodiado na B3 → vem da tabela verdade; derivar contaria 2x (e dá negativo em pote drenado: derivação ignora rendimento). Pernas do Porquinho seguem como investimento (`_INVESTMENT_KEYWORDS` mantém `porquinho`/`cdb porq`). **Nunca usar keyword de corretora (NuInvest/Tesouro/Porquinho)** na derivação. **B3 vence empate de nome.**
- **Pagamento de fatura → Crédito:** saída de conta corrente com `fatura` na descrição (`adapters._is_fatura_payment`) → `method='credit'` (aba Crédito, não TED), via `_checking_expense_method`. Continua despesa real (`flow=expense`). **Stand-in** até fatura itemizada: então o pagamento vira liquidação (fora dos totais) e os itens viram as despesas `credit` alocadas ao período do extrato — senão pagamento+itens dobram a despesa.
- **Exclusão segura** (`crud.delete_transaction` + `ConfirmDeleteModal`): SELF apaga 2 legs; legs de investimento revertem `current_balance`.
- **Import reversível** (`crud.delete_batch`): cada confirm marca as linhas com um `import_batch_id` de sessão; `delete_batch` remove o lote inteiro. UI: toast "Desfazer" (5 s) pós-import; `DELETE /api/import/batch/<id>`.

---

## Dashboard API (resumo)

Escrita (validada no servidor): `POST /api/transactions` (despesa), `POST /api/incomes` (receita/transferência), `POST /api/investment-movements`, `PATCH /api/transactions/<id>` (category_id/display_name/is_third_party), `PATCH /api/budgets/<id>`, `DELETE /api/transactions/<id>`, `POST /api/transactions/restore`. Import: `POST /api/import/preview` (múltiplos `file` da mesma conta), `GET /api/import/staging/<batch_id>`, `PATCH /api/import/staging/<batch_id>/<row_id>` (edita preview → `amount_divergence`), `POST /api/import/confirm` (recebe/ecoa `import_batch_id`), `DELETE /api/import/batch/<id>` (reverte o lote).

Leitura: `/api/available` (herói), `/api/summary`, `/api/accounts`, `/api/investments`, `/api/monthly` (`?present=1` = só meses com dados), `/api/categories`, `/api/transactions`, `/api/recent-activity`, `/api/patrimonio-history`, `/api/daily-spend` (mês zero-filled), `/api/month-transactions` (inclui `is_revenue`), `/api/budgets`, `/api/categories-full`, `/api/pix-top`, `/api/expenses-by-method`, `/api/statement-coverage` (GET/POST cobertura), `/api/events` (SSE).

---

## Frontend — 3 telas

Navegação: **Visão do Mês** (`OverviewView`), **Histórico** (`HistoryView`), **Investimentos** (`InvestmentsView`). Atalhos `1`/`2`/`3`. Categorias vive em Configurações.

- **Dinheiro** (agora): herói **Disponível pra gastar** (`/api/available`); direita = ledger Patrimônio líquido. Sempre mês atual. Projeções advisory. Clicar conta → Histórico filtrado.
- **Histórico** (análise): meses com dados (`/api/monthly?present=1`), 4 métricas (Δ vs média), fluxo 6m (`DualLine`), por categoria, Top PIX, tabela filtrável (flow · método · categoria · conta · busca) + categorização inline. **Rede de segurança de importação:** banner + flag no strip avisam meses passados sem lançamentos (extrato esquecido) e cutucam mês atual vazio após dia 5 — `primitives.js::findMonthGaps`/`currentMonthMissing`/`fmtMonthGaps` (sobre a lista present); selo na Home reusa os helpers. Buraco = sem dados **E não coberto**: `statement_coverage`/`/api/statement-coverage` marca meses cobertos por import (front deriva período do **nome do arquivo** via `coverageFromFilename` + datas das linhas, grava `origin=import` no confirm, incl. arquivo vazio) ou por dismiss manual ("sem movimento" → `origin=manual`). Idempotente, UNIQUE(year,month).
- **Investimentos:** donut (`Donut`) + Σ `current_balance` + lista editável + "+ Movimento".

---

## Engineering Directives

- **Todo SQL via `core/database.py`** (facade) → `core/db/*` — sem SQL inline fora de `core/db/`. Fragmento da consumption clause em `core/db/_sql.py`; lógica pura sem SQL em `core/domain/`.
- **Type hints obrigatórias** — verificadas por mypy. Health Stack: `ruff` + `mypy` + `pytest` verdes antes de commitar (`pyproject.toml`, mypy estrito em `core/`). Enforçado pelo hook `.githooks/pre-commit` (`git config core.hooksPath .githooks`); bypass: `git commit --no-verify`.
- `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` no connect.
- Backup/restore nunca propagam exceção (logado + valor de retorno). `run_backup` é **tri-state** (`created|skipped|failed`) — o job sai ≠0 só em falha REAL (→ alerta via `OnFailure`).
- `main.py` bloqueia em foreground (`waitress.serve`) e sai ≠0 em ambiente inválido. Sobe via `./run.sh` (sem supervisor — auto-restart era systemd, agora pausado; rethink em T-C).
- **B3 ingestion:** `core/ingestion/b3.py` → `investments` (**full-sync**: upsert por nome + poda das ausentes; Renda Fixa = valor CURVA, Tesouro = Valor líquido). Memória (sem zip-slip), cap de tamanho, sem XXE. Ver "B3 = tabela verdade".

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

Runtime = **foreground via `./run.sh`** (deploy em rethink — T-C). Backup manual (`PYTHONPATH=backend .venv/bin/python -m jobs.backup`). Foreground:

```bash
source .venv/bin/activate.fish
python backend/main.py
# Dashboard at http://localhost:8080  (parar o serviço antes, ou outra DASHBOARD_PORT)
```
