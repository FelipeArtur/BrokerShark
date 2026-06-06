# BrokerShark — Claude Reference Guide

> Histórico completo (roadmap, hashes, logs de decisão datados, revisões de segurança) vive no `git log`. Este arquivo guarda só o que é load-bearing para não quebrar a lógica financeira.

## gstack

Use the `/browse` skill from gstack for all web browsing. **Never** use `mcp__claude-in-chrome__*` tools. Skills disponíveis: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-review`, `/review`, `/ship`, `/land-and-deploy`, `/qa`, `/investigate`, `/autoplan`, `/spec`, `/context-save`, `/context-restore`, `/learn`, entre outras.

## AI Development Tools

Co-desenvolvido com **Claude Code CLI** e **Gemini CLI**. `CLAUDE.md` = fonte da verdade (Claude); `GEMINI.md` = guia conciso (Gemini); `.claude/commands/` = slash-commands. **Mudança permanente (categoria/conta/schema) → atualizar os dois arquivos.**

---

## Overview

BrokerShark é uma **ferramenta pessoal de análise de dinheiro**, 100% local (Linux, 1 usuário). Pergunta central: **"quanto eu posso gastar agora?"** — depois, para onde o dinheiro vai ao longo do tempo.

**O produto é a análise (web dashboard, `http://localhost:8080`):**
- **Dinheiro** (home) — herói **Disponível pra gastar** (liquidez = contas correntes − faturas em aberto) + faturas, "Este mês", contas, atividade e projeções.
- **Histórico / Análise** — timeline dos meses com lançamentos, métricas mensais, fluxo 6m, investimentos, por categoria, Top PIX, tabela filtrável.
- **Investimentos** — donut + posições editáveis + "+ Movimento".

**Apoio (não são o centro):** Telegram bot (**somente consulta + notificações** — nunca registra/edita), importação mensal de CSV pela web, chat de IA local (Ollama).

> **Regra de ouro:** todo registro e edição acontece **exclusivamente na web**. O Telegram lê e notifica — nunca escreve.

> **North star:** fácil de alimentar + extremamente confiável. Registro = **import de extratos/faturas em lote** (resumo editável antes de confirmar); correções na web = **alinhamento de valores**, não digitação manual. Re-import semanal do mês corrente só acrescenta a cauda nova (dedup).

**User profile:** 1 usuário, Nubank + Inter (CC + conta corrente). Débito **não é rotina** — defensivo: tolerar um `debit` avulso sem quebrar totais/breakdown. Investimentos: Caixinha Nubank, Porquinho Inter, Tesouro Direto, CDBs.

---

## Repository Structure

```
backend/
  main.py            # launcher — sobe bot + dashboard
  config.py          # único arquivo que chama os.getenv()
  bootstrap.py       # load_dotenv + config.validate + logging + DB path (reusado por jobs)
  core/
    database.py      # data layer — shim re-export → core/db/
    db/              # schema.py, crud.py, analytics.py, categories.py
    ingestion/       # adapters.py (parse), dedup.py (classify), service.py, b3.py
    events.py        # SSE pub/sub — notify() após escrita
    backup.py        # backup mensal (conn.backup WAL-safe, should_backup/run_backup/verify/restore)
  jobs/              # backup, weekly_report, monthly_closing (python -m, p/ systemd timers)
  integrations/ollama.py   # cliente HTTP puro (chat, chat_stream)
  dashboard/server.py      # Flask + Waitress (32 threads, SSE)
  bot/      application.py, constants.py, utils.py, reports.py, handlers/{commands,ai_chat}.py
frontend/
  js/  api.js, primitives.js, view-overview.js, view-history.js, view-investments.js, app.js
deploy/  systemd/*, brokershark.sh, README.md
tests/   test_database, test_ingestion, test_ai_chat, test_b3, test_backup, test_server_writes
```

---

## Architecture

### Data flow

```
User (web form / CSV import — ÚNICO caminho de escrita)
      ↓
core/database.py — INSERT (SQLite)
      ↓
core/events.notify() — SSE push ao browser (< 1s)

Telegram (read-only): ai_chat / comandos → SELECT → resposta
```

### Key principles

- **SQLite é a fonte única.** Sem write-back externo. Toda escrita pela web; Telegram é read-only.
- **A análise é o produto.** Telegram/import/IA são apoio.
- **AI Pierre-inspired:** tool calling, nunca fabrica dado (busca via tools antes de responder), Telegram only. **Todas as 7 tools são de leitura** — não existe `register_*`/`confirm`/`cancel`. Se pedirem registro, o prompt redireciona pra web.
- **Runtime (alvo):** **híbrido** — dashboard+bot **sob demanda** (launcher), jobs (backup/semanal/fechamento) como **systemd user timers** (`Persistent=true`, catch-up no boot). Sem daemon eterno; APScheduler aposentado. Notificações agendadas saem sempre (oneshot `bot.send_message`); Telegram só responde com o launcher aberto. Ativação pendente exige `loginctl enable-linger joao` (senão o catch-up de boot não dispara). Hoje: `main.py` ainda sobe tudo num processo.

### Invariantes financeiras (load-bearing — não quebrar)

- **Consumption-expense rule (canônica):** totais de despesa filtram `dest_account_id IS NULL AND method != 'transfer'` — uma transferência (leg de investimento ou pagamento de fatura) **nunca** é despesa. Aplicada por `get_monthly_summary`, `get_cashflow_statement`, `get_monthly_history_present`, `get_expenses_by_category`, `get_account_monthly_summary` e replicada no front (Histórico recebe `is_revenue` em `/api/month-transactions`). Garante que Despesas/Receitas batem em todas as telas.
- **CC anti-duplicação:** o **total da fatura** mora em `nu-db`/`inter-db` com `dest_account_id IN ('nu-cc','inter-cc')` (conta no patrimônio como saída real); as **compras individuais** moram em `nu-cc`/`inter-cc` com `dest_account_id IS NULL` (contam nos resumos de despesa). Nunca se sobrepõem. Linhas `amount <= 0` da fatura são excluídas no import. Simétrico p/ Nubank e Inter.
- **Patrimônio:** `get_patrimonio_history()` = só saldo de conta corrente (`initial_balances + income − expenses`). Movimentos de investimento são excluídos; o saldo de investimento entra no display via `investments.current_balance`. **Patrimônio NÃO filtra por method** (precisa contar o pagamento de fatura via `dest IN ('nu-cc','inter-cc')`).
- **`is_revenue`** (Integer em `transactions`): `1` p/ receita real, `0` p/ self-transfer. Controla totais de receita, resumos de conta e patrimônio. **Sempre passar explícito** em `insert_transaction()` — nunca confiar em default de migração.
- **`counterpart='SELF'`** (auto-Pix/TED entre contas próprias): nem despesa, nem receita, nem investimento. Saída → `flow='expense', method='transfer', counterpart='SELF'`; entrada → `flow='income', is_revenue=0, counterpart='SELF'`. Ambas visíveis (tag "transferência"), saldos preservados, fora de Despesas/Receitas e de `investment_net`. Classificado no import por `adapters._is_self_transfer` (allow-list `config.OWNER_SELF_KEYWORDS`).
- **Transferência interna:** `flow='expense', method='transfer', dest_account_id=<dest>` — excluída dos resumos via `AND dest_account_id IS NULL`.
- **Fluxo de investimento (fonte única = transações, não `investment_movements`, que está vazia):** aplicação = `expense/method='transfer'/dest NULL`; resgate = `income/is_revenue=0/dest NULL`. `free_balance = receitas − despesas − investment_net`. "+ Movimento" grava via `crud.register_investment_transfer` (leg na conta corrente do banco **+** ajusta `current_balance` atomicamente) — **não** escreve `investment_movements` (essa tabela é subtraída dos saldos e causaria dupla contagem).
- **Parcelamento:** compra parcelada no crédito é expandida em N lançamentos mensais por `crud.insert_expense` (1/N por ciclo, resto na última parcela, dia clampado). Insert manual sem `external_id` **levanta** `IntegrityError` (não retorna `-1` silenciosamente).
- **Exclusão segura** (`crud.delete_transaction`, confirmação prévia em `ConfirmDeleteModal`): pagamento de fatura nunca é excluível (`ValueError` → 409); excluir uma parcela apaga o grupo `(k/N)` inteiro; SELF apaga os dois legs; legs de investimento do modal revertem `current_balance`. `restore_transactions`/`POST /api/transactions/restore` existem como primitivo dormente (nenhuma UI aciona).
- **Import reversível** (`crud.delete_batch`, contraparte deliberada do guard por linha): cada confirm marca as linhas inseridas com um `import_batch_id` de sessão (gerado no cliente, compartilhado entre os confirms de um drop multi-conta). `delete_batch` remove o lote inteiro **incluindo a linha-total da fatura** — que o delete por linha recusa (409) e que o Histórico esconde (`dest IS NULL`), então sem isso a fatura seria irreversível e deixaria órfão de dupla contagem. Reverte `current_balance` de legs de investimento e devolve um payload p/ `restore_transactions`. UI: toast com "Desfazer" (janela de 5 s) após importar; `DELETE /api/import/batch/<id>`.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.14 (venv) — código usa 3.12+ |
| Bot | python-telegram-bot v21 |
| Database | SQLite (WAL mode) |
| Backup | local HDD copy (mensal) |
| Scheduler | **systemd user timers** (`Persistent=true`) via `backend/jobs/*` — APScheduler aposentado |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads, daemon thread) |
| Frontend | React 18 + Babel standalone (no build step), Chart.js |
| Real-time | SSE via `events.py` (no polling, < 1s) |
| HTTP client | httpx |
| Local LLM | Ollama `qwen2.5:7b` (ROCm, RX 6600M) |

---

## Data Model

```sql
accounts (id, bank, type, name, billing_day, due_day, initial_balance)   -- nu-cc, nu-db, inter-cc, inter-db
categories (id, name, flow)        -- flow: expense | income
transactions (id, date, flow, method, account_id, amount, installments,
              description, category_id, dest_account_id, counterpart,
              is_revenue, external_id, display_name, is_third_party, original_amount,
              import_batch_id)
              -- external_id: UUID Nubank, dedup | display_name: nome editável (UI)
              -- is_third_party: 1 = fora de todos os cálculos pessoais
              -- original_amount: valor parseado do extrato (auditoria de edição no preview)
              -- import_batch_id: tag de sessão de import (1 por "drop", pode abranger
              --   vários staging batches/contas) → import reversível em bloco via
              --   crud.delete_batch. NULL p/ entradas manuais (índice PARCIAL enxuto).
investments (id, name, type, bank, current_balance)
investment_movements (id, date, investment_id, operation, amount, description)
budgets (id, category_id, amount_limit)
```

`method` CHECK: `pix | credit | ted | transfer | debit | salary | freelance | pix_received | other` (os 4 últimos são subtipos de receita — sem eles, `INSERT OR IGNORE` descartava receitas em silêncio num DB novo). `is_third_party` é excluído de saldos e resumos.

---

## Web Import (ingestão mensal)

Upload pelo botão **"+ Importar"** (modal `ImportModal`: solta **vários arquivos** do mês → atribui a conta de cada um → preview agrupado por conta, **editável** → confirmar). Pipeline em `backend/core/ingestion/` — todo acesso a DB via `crud`/`analytics`.

- **Fontes:** `nu-db` (extrato Nubank, UUID dedup), `inter-db` (extrato Inter, 5-line preamble), `inter-cc` (fatura Inter). `nu-cc` (fatura Nubank) ainda não suportado (formato desconhecido).
- **Multi-arquivo:** o front manda todos os `file` da **mesma conta** num só POST (`preview_import_multi`) p/ dedup no conjunto combinado — um POST por arquivo reintroduziria dupes entre arquivos. Drop multi-conta = vários confirms compartilhando um `import_batch_id` (sessão), reversível como uma unidade.
- **Preview editável:** cada linha `new` pode ter amount/apelido ajustados inline (`PATCH /api/import/staging/<batch>/<row>`); divergência vs extrato vira `amount_divergence` (auditoria via `original_amount`).
- **Staging:** linhas vão p/ `import_staging` (status `new`/`duplicate`/`skipped`); `confirm` promove as `new` (marcando `import_batch_id`) e apaga o batch. Nada é escrito em `transactions` até confirmar.
- **Dedup:** Nubank por `external_id` (índice UNIQUE parcial + `INSERT OR IGNORE`); Inter por contagem de ocorrência em `(account, date, round(amount,2), description)` — re-upload cumulativo só adiciona a cauda nova.
- **Classificação no import:** investimentos (Aplicação RDB/NuInvest/Caixinha/Porquinho…) → `method='transfer', is_revenue=0`; pagamento de fatura → `method='transfer', dest_account_id=<bank>-cc`; auto-Pix/TED → `counterpart='SELF'`.
- **Categorização = 100% manual no Histórico:** importados entram com `category_id=NULL` → filtro "Sem categoria" + edição inline (`<select>` por linha → `PATCH /api/transactions/<id>`). Sem auto-categorização por regras.
- **B3 (xlsx):** `core/ingestion/b3.py` parseia posições do Relatório B3 → `investments` (upsert idempotente por nome; Renda Fixa = valor CURVA, Tesouro = Valor líquido). Lido em memória (sem zip-slip), cap de tamanho, openpyxl não resolve XXE.

---

## Dashboard API (resumo)

Escrita (toda validada no servidor): `POST /api/transactions` (despesa), `POST /api/incomes` (receita/transferência), `POST /api/investment-movements`, `PATCH /api/transactions/<id>` (category_id/display_name/is_third_party), `PATCH /api/budgets/<id>`, `DELETE /api/transactions/<id>` (409 p/ fatura), `POST /api/transactions/restore`. Import: `POST /api/import/preview` (aceita **múltiplos `file`** da mesma conta — dedup no conjunto combinado), `GET /api/import/staging/<batch_id>`, `PATCH /api/import/staging/<batch_id>/<row_id>` (edita amount/category_id/display_name no preview → `amount_divergence`), `POST /api/import/confirm` (recebe e ecoa `import_batch_id`), `DELETE /api/import/batch/<id>` (reverte o lote inteiro).

Leitura: `/api/available` (herói liquidez), `/api/summary`, `/api/accounts`, `/api/investments`, `/api/monthly` (`?present=1` = só meses com dados), `/api/categories`, `/api/faturas`, `/api/transactions`, `/api/recent-activity`, `/api/patrimonio-history`, `/api/daily-spend` (mês calendário zero-filled), `/api/month-transactions` (inclui `is_revenue` p/ o front replicar a consumption-rule), `/api/budgets`, `/api/categories-full`, `/api/pix-top`, `/api/expenses-by-method`, `/api/events` (SSE).

`/api/monthly` item: `{ label:"Mar/26", month:3, year:2026, income, expenses }` (`month`/`year` int em todas as variantes).

---

## Frontend — 3 telas

Navegação (`app.js` `SECTIONS`): **Visão do Mês** (`OverviewView`), **Histórico** (`HistoryView`), **Investimentos** (`InvestmentsView`). Atalhos `1`/`2`/`3`.

- **Dinheiro** = "como estou agora". Herói **Disponível pra gastar** (`/api/available`, contas − faturas) num pane-ledger; direita = ledger **Patrimônio líquido** (Contas + Investimentos − Faturas). Sempre mês atual. Projeções advisory (run-rate, rotuladas como estimativa). Clicar fatura/conta → Histórico filtrado pela conta.
- **Histórico** = "o que aconteceu". Seletor de meses com dados, 4 métricas (número + Δ vs média), gráfico fluxo 6m (`DualLine`), por categoria, Top PIX (lado a lado), tabela filtrável (flow · método · categoria · conta · busca) com categorização inline e filtro "Sem categoria".
- **Investimentos** — donut (`Donut`) + Σ `current_balance` + lista editável por posição + "+ Movimento" (`MovementModal`).
- **Configurações** (`TweaksPanel`): tema, atalho p/ Categorias (`CategoriesPanel`), restaurar padrões.
- **Charts** (`primitives.js`): só `DualLine` (Histórico) e `Donut` (Investimentos) — recebem dados reais da API, sem placeholder.

---

## Automated Jobs

Migrando p/ systemd user timers (`Persistent=true`). O período do relatório/fechamento deve ancorar na **data agendada** (não `datetime.now()`) p/ catch-up tardio não rotular a janela errada.

- **Backup mensal** (1º, 07:00): cópia WAL-safe (`conn.backup()`) p/ `/mnt/HDD_Arquivos/Backups/brokershark` se ainda não houve este mês (`should_backup`, mantém 12 arquivos). Falhas nunca propagam — `PermissionError`/`OSError` → `False` silencioso (HDD desmontado).
- **Relatório semanal** (seg, 08:00): despesas, receita, top categoria, reservas, vencimento de faturas.
- **Fechamento mensal** (1º, 08:00): breakdown completo do mês anterior.

---

## Development Guidelines

- **Type hints obrigatórias** em toda assinatura (verificadas por mypy).
- **Todo SQL via `core/database.py`** — sem SQL inline em outro lugar.
- **Bot nunca escreve direto no DB** — dado validado antes do INSERT.
- `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` no connect.
- Dashboard roda em daemon thread — nunca bloquear o event loop.
- **Auth check primeiro** em todo handler do Telegram (chat_id, fail-closed).
- **Health Stack (antes de commitar):** `ruff check backend tests` + `mypy` + `pytest` verdes. Config em `pyproject.toml` (ruff = E/F/B; mypy estrito em `core/`, relaxado nas bordas de framework em `dashboard.server`/`bot.handlers.*`).

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

> `LOCAL_BACKUP_DIR` é hardcoded em `config.py` (`/mnt/HDD_Arquivos/Backups/brokershark`).

---

## Running Locally

```bash
cp .env.example .env   # preencher credenciais
source .venv/bin/activate.fish
pip install -r requirements.txt
python backend/main.py
# Dashboard at http://localhost:8080
```

---

## Skill routing

Quando o pedido casa com uma skill, invoque-a via Skill tool (na dúvida, invoque). Produto/brainstorm → `/office-hours`; estratégia/escopo → `/plan-ceo-review`; arquitetura → `/plan-eng-review`; design → `/design-consultation`/`/design-review`; pipeline completo → `/autoplan`; bugs → `/investigate`; QA → `/qa`; review de diff → `/review`; ship/deploy → `/ship`/`/land-and-deploy`; salvar/retomar contexto → `/context-save`/`/context-restore`; spec → `/spec`.
