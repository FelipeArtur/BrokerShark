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
- **Dinheiro** (home) — herói **Disponível pra gastar** (liquidez = saldo em conta) + "Este mês", contas, atividade e projeções.
- **Histórico / Análise** — timeline dos meses com lançamentos, métricas mensais, fluxo 6m, investimentos, por categoria, Top PIX, tabela filtrável.
- **Investimentos** — donut + posições editáveis + "+ Movimento".

**Apoio (não é o centro):** importação mensal de extratos (CSV) e posições B3 (xlsx) pela web.

> **Regra de ouro:** todo registro e edição acontece **exclusivamente na web**. Não existe outro caminho de escrita (Telegram bot e IA local foram removidos em 2026-06-11 — produto é web-only; diagnóstico/proposta Hermes arquivados no `git log`).

> **North star:** fácil de alimentar + extremamente confiável. Registro = **import de extratos em lote** (resumo editável antes de confirmar); correções na web = **alinhamento de valores**, não digitação manual. Re-import semanal do mês corrente só acrescenta a cauda nova (dedup).

**User profile:** 1 usuário, Nubank + Inter (conta corrente). Débito **não é rotina** — defensivo: tolerar um `debit` avulso sem quebrar totais/breakdown. Investimentos: Caixinha Nubank, Porquinho Inter, Tesouro Direto, CDBs.

---

## Repository Structure

```
backend/
  main.py            # entrypoint — bootstrap + serve do dashboard em foreground (./run.sh)
  config.py          # único arquivo que chama os.getenv()
  bootstrap.py       # load_dotenv + config.validate + logging + DB path (reusado por jobs)
  core/
    database.py      # data layer — shim re-export → core/db/
    db/              # schema.py, crud.py, analytics.py, categories.py
    ingestion/       # adapters.py (parse), dedup.py (classify), service.py, b3.py
    events.py        # SSE pub/sub — notify() após escrita
    backup.py        # snapshot mensal (conn.backup WAL-safe, run_backup tri-state/restore)
  jobs/backup.py     # entrypoint do timer (python -m, exit≠0 só em falha REAL)
  dashboard/server.py      # Flask + Waitress (32 threads, SSE)
frontend/
  js/  api.js, primitives.js, view-overview.js, view-history.js, view-investments.js, app.js
.githooks/  pre-commit (Health Stack gate — ligado via core.hooksPath .githooks)
         # deploy/ foi apagado 2026-06-23 — estratégia de runtime/restore em rethink (TODOS T-C)
tests/   test_database, test_ingestion, test_b3, test_backup, test_jobs, test_delete,
         test_import_batch, test_investments, test_server_writes
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
```

### Key principles

- **SQLite é a fonte única.** Sem write-back externo. Toda escrita pela web.
- **A análise é o produto.** Import é apoio.
- **Runtime: foreground (estratégia de deploy em rethink — ver TODOS T-C).** Dashboard roda em foreground via **`./run.sh`** (`main.py` bloqueia no `waitress.serve`, logs no terminal). Backup **manual**: `PYTHONPATH=backend .venv/bin/python -m jobs.backup`. **Restore: cópia manual do `.db` com o app parado** (o wrapper `restore.sh` foi apagado junto com `deploy/` em 2026-06-23; redesenho de restore seguro é P1 no TODO T-C). A lógica de baixo nível de restore sobrevive em `core/backup.py::restore_backup` (verificação + sidecar `.pre-restore`). O modelo antigo (systemd user units + linger + OnFailure alert) está no `git log` (commit `08db96c`~) caso o rethink decida ressuscitá-lo.
- **Segurança de rede:** bind em `127.0.0.1` + guard de Host/Origin em `server.py` (DNS-rebinding/CSRF) — a API não tem auth, então isso é load-bearing.

### Invariantes financeiras (load-bearing — não quebrar)

- **Consumption-expense rule (canônica):** totais de despesa filtram `dest_account_id IS NULL AND method != 'transfer'` — uma transferência (leg de investimento) **nunca** é despesa. Aplicada por `get_monthly_summary`, `get_cashflow_statement`, `get_monthly_history_present`, `get_expenses_by_category`, `get_account_monthly_summary` e replicada no front (Histórico recebe `is_revenue` em `/api/month-transactions`). Garante que Despesas/Receitas batem em todas as telas.
- **Patrimônio:** `get_patrimonio_history()` = só saldo de conta corrente (`initial_balances + income − expenses`). Movimentos de investimento são excluídos; o saldo de investimento entra no display via `investments.current_balance`. **Patrimônio NÃO filtra por method**.
- **`is_revenue`** (Integer em `transactions`): `1` p/ receita real, `0` p/ self-transfer. Controla totais de receita, resumos de conta e patrimônio. **Sempre passar explícito** em `insert_transaction()` — nunca confiar em default de migração.
- **`counterpart='SELF'`** (auto-Pix/TED entre contas próprias): nem despesa, nem receita, nem investimento. Saída → `flow='expense', method='transfer', counterpart='SELF'`; entrada → `flow='income', is_revenue=0, counterpart='SELF'`. Ambas visíveis (tag "transferência"), saldos preservados, fora de Despesas/Receitas e de `investment_net`. Classificado no import por `adapters._is_self_transfer` (allow-list `config.OWNER_SELF_KEYWORDS`).
- **Transferência interna:** `flow='expense', method='transfer', dest_account_id=<dest>` — excluída dos resumos via `AND dest_account_id IS NULL`.
- **Fluxo de investimento (fonte única = transações, não `investment_movements`, que está vazia):** aplicação = `expense/method='transfer'/dest NULL`; resgate = `income/is_revenue=0/dest NULL`. `free_balance = receitas − despesas − investment_net`. "+ Movimento" grava via `crud.register_investment_transfer` (leg na conta corrente do banco **+** ajusta `current_balance` atomicamente) — **não** escreve `investment_movements` (essa tabela é subtraída dos saldos e causaria dupla contagem).
- **B3 = tabela verdade (posições de corretora):** o relatório B3 é a fonte autoritativa de toda posição que passa pela tabela `investments` (Tesouro, CDB, NuInvest…). `b3.load_b3_positions` **full-sync**: upsert por nome + `crud.prune_investments_except(nomes_do_relatório)` apaga qualquer posição ausente do relatório (vencida/resgatada) — espelho fiel, sem saldo obsoleto. **Read-only:** `PATCH /api/investments/<id>/balance` retorna **409** (override manual seria clobberado no próximo import); ajuste = re-importar. `crud.update_investment_balance` sobrevive só como helper interno/testes. `prune_investments_except([])` é no-op (relatório vazio = falha de parse, nunca "apaga tudo"). Caixinha/Porquinho não estão na tabela → nunca são podadas.
- **Posição derivada do extrato (só Caixinha Nubank):** essa reserva vive **só** no ledger (nunca chega à tabela `investments` nem à B3), então `analytics.get_ledger_savings_positions()` a deriva = `Σ(aplicações) − Σ(resgates)` das pernas `transfer` por keyword de poupança (`rdb`/`caixinha`/`dinheiro guardado`, banco nubank), excluindo SELF/third-party. `/api/investments` anexa a derivada (`id=null, derived=true`); patrimônio passa a contar. **Só Caixinha porque é RDB (não custodiada na B3).** **Porquinho Inter NÃO é derivado** — é CDB custodiado na B3, então vem da tabela verdade (uma posição CDB Inter); derivá-lo contaria em dobro (e dá saldo negativo num pote drenado, pois a derivação é só fluxo de principal, ignora rendimento). Suas pernas `aplicação/resgate` continuam classificadas como investimento (`_INVESTMENT_KEYWORDS` mantém `porquinho`/`cdb porq`), alimentando `investment_net`/o valor B3. **Nunca incluir keyword de corretora (NuInvest/Tesouro/Porquinho)** na derivação. **B3 vence empate de nome:** `/api/investments` descarta derivada cujo `name` já existe como posição B3. Sem a derivação da Caixinha o saldo RDB some do patrimônio.
- **Exclusão segura** (`crud.delete_transaction`, confirmação prévia em `ConfirmDeleteModal`): SELF apaga os dois legs; legs de investimento do modal revertem `current_balance`. `restore_transactions`/`POST /api/transactions/restore` existem como primitivo dormente (nenhuma UI aciona).
- **Import reversível** (`crud.delete_batch`, contraparte deliberada do guard por linha): cada confirm marca as linhas inseridas com um `import_batch_id` de sessão (gerado no cliente, compartilhado entre os confirms de um drop multi-conta). `delete_batch` remove o lote inteiro. Reverte `current_balance` de legs de investimento e devolve um payload p/ `restore_transactions`. UI: toast com "Desfazer" (janela de 5 s) após importar; `DELETE /api/import/batch/<id>`.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.14 (venv) — código usa 3.12+ |
| Database | SQLite (WAL mode) |
| Backup | snapshot local mensal no HDD (retém 12), `conn.backup()` WAL-safe, refresh pós-import |
| Scheduler | **nenhum por ora** — deploy em rethink (TODOS T-C); backup rodado manual |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads, foreground via `./run.sh`) |
| Frontend | React 18 + Babel standalone (no build step), Chart.js |
| Real-time | SSE via `events.py` (no polling, < 1s) |

---

## Data Model

```sql
accounts (id, bank, type, name, initial_balance)   -- nu-db, inter-db
categories (id, name, flow)        -- flow: expense | income
transactions (id, date, flow, method, account_id, amount,
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

- **Fontes:** `nu-db` (extrato Nubank, UUID dedup), `inter-db` (extrato Inter, 5-line preamble).
- **Multi-arquivo:** o front manda todos os `file` da **mesma conta** num só POST (`preview_import_multi`) p/ dedup no conjunto combinado — um POST por arquivo reintroduziria dupes entre arquivos. Drop multi-conta = vários confirms compartilhando um `import_batch_id` (sessão), reversível como uma unidade.
- **Preview editável:** cada linha `new` pode ter amount/apelido ajustados inline (`PATCH /api/import/staging/<batch>/<row>`); divergência vs extrato vira `amount_divergence` (auditoria via `original_amount`).
- **Staging:** linhas vão p/ `import_staging` (status `new`/`duplicate`/`skipped`); `confirm` promove as `new` (marcando `import_batch_id`) e apaga o batch. Nada é escrito em `transactions` até confirmar.
- **Dedup:** Nubank por `external_id` (índice UNIQUE parcial + `INSERT OR IGNORE`); Inter por contagem de ocorrência em `(account, date, round(amount,2), description)` — re-upload cumulativo só adiciona a cauda nova.
- **Classificação no import:** investimentos (Aplicação RDB/NuInvest/Caixinha/Porquinho…) → `method='transfer', is_revenue=0`; auto-Pix/TED → `counterpart='SELF'`; **pagamento de fatura** (saída de conta corrente com `fatura` na descrição, `adapters._is_fatura_payment`) → `method='credit'` (aparece na aba **Crédito**, não TED). Ambos os parsers passam saída de conta corrente por `_checking_expense_method` (fatura→credit, pix→pix, débito→debit, resto→ted). **Stand-in:** o pagamento da fatura continua sendo despesa real (`flow=expense`, não `transfer`) **enquanto** não há tratamento de fatura itemizada — ver invariante de reconciliação futura.
- **Reconciliação de fatura (FUTURO — não implementado):** quando a fatura itemizada do cartão for importada, o **pagamento** da fatura deixa de ser despesa (vira liquidação, fora dos totais) e os **itens** viram as despesas reais `credit`, alocadas ao mês correto pelo período do extrato (casar valor da fatura com a soma dos itens). Sem isso, contar pagamento **+** itens dobraria a despesa. Até lá, o pagamento `credit` é o proxy.
- **Categorização = 100% manual no Histórico:** importados entram com `category_id=NULL` → filtro "Sem categoria" + edição inline (`<select>` por linha → `PATCH /api/transactions/<id>`). Sem auto-categorização por regras.
- **B3 (xlsx):** `core/ingestion/b3.py` parseia posições do Relatório B3 → `investments` (**full-sync**: upsert por nome + poda das ausentes; Renda Fixa = valor CURVA, Tesouro = Valor líquido). Lido em memória (sem zip-slip), cap de tamanho, openpyxl não resolve XXE. Ver invariante "B3 = tabela verdade".

---

## Dashboard API (resumo)

Escrita (toda validada no servidor): `POST /api/transactions` (despesa), `POST /api/incomes` (receita/transferência), `POST /api/investment-movements`, `PATCH /api/transactions/<id>` (category_id/display_name/is_third_party), `PATCH /api/budgets/<id>`, `DELETE /api/transactions/<id>`, `POST /api/transactions/restore`. (`PATCH /api/investments/<id>/balance` existe mas é **locked → 409**: B3 é a verdade.) Import: `POST /api/import/preview` (aceita **múltiplos `file`** da mesma conta — dedup no conjunto combinado), `GET /api/import/staging/<batch_id>`, `PATCH /api/import/staging/<batch_id>/<row_id>` (edita amount/category_id/display_name no preview → `amount_divergence`), `POST /api/import/confirm` (recebe e ecoa `import_batch_id`), `DELETE /api/import/batch/<id>` (reverte o lote inteiro).

Leitura: `/api/available` (herói liquidez), `/api/summary`, `/api/accounts`, `/api/investments`, `/api/monthly` (`?present=1` = só meses com dados), `/api/categories`, `/api/transactions`, `/api/recent-activity`, `/api/patrimonio-history`, `/api/daily-spend` (mês calendário zero-filled), `/api/month-transactions` (inclui `is_revenue` p/ o front replicar a consumption-rule), `/api/budgets`, `/api/categories-full`, `/api/pix-top`, `/api/expenses-by-method`, `/api/events` (SSE).

`/api/monthly` item: `{ label:"Mar/26", month:3, year:2026, income, expenses }` (`month`/`year` int em todas as variantes).

---

## Frontend — 3 telas

Navegação (`app.js` `SECTIONS`): **Visão do Mês** (`OverviewView`), **Histórico** (`HistoryView`), **Investimentos** (`InvestmentsView`). Atalhos `1`/`2`/`3`.

- **Dinheiro** = "como estou agora". Herói **Disponível pra gastar** (`/api/available`, saldos em conta) num pane-ledger; direita = ledger **Patrimônio líquido** (Contas + Investimentos). Sempre mês atual. Projeções advisory (run-rate, rotuladas como estimativa). Clicar numa **conta corrente** → Histórico filtrado pela conta.
- **Histórico** = "o que aconteceu". Seletor de meses com dados, 4 métricas (número + Δ vs média), gráfico fluxo 6m (`DualLine`), por categoria, Top PIX (lado a lado), tabela filtrável (flow · método · categoria · conta · busca) com categorização inline e filtro "Sem categoria".
- **Investimentos** — donut (`Donut`) + Σ `current_balance` + lista editável por posição + "+ Movimento" (`MovementModal`).
- **Configurações** (`TweaksPanel`): tema, atalho p/ Categorias (`CategoriesPanel`), restaurar padrões.
- **Charts** (`primitives.js`): só `DualLine` (Histórico) e `Donut` (Investimentos) — recebem dados reais da API, sem placeholder.

---

## Automated Jobs

Um único job: **backup local mensal** (`core/backup.py`, entrypoint `jobs/backup.py`, timer diário 07h `Persistent=true`). Tier diário removido em 2026-06-12 por decisão do dono — **mensal-apenas**.

- **1 arquivo por mês** em `/mnt/HDD_Arquivos/Backups/brokershark` (`brokershark_YYYY-MM.db`, retém 12). Glob estrito — prune nunca conta/apaga arquivos estranhos (incl. snapshots diários legados `YYYY-MM-DD.db`). Keyed em **ausência do arquivo** (não em "hoje é dia 1º") → catch-up tardio ainda gera o snapshot do mês.
- **`run_backup` é tri-state** (`created|skipped|failed`): o entrypoint sai ≠0 só em falha REAL (visível em `systemctl --user --failed` + alerta de desktop via `OnFailure=brokershark-backup-alert.service`); skip do mesmo mês não alarma. Booleano não distingue os dois — foi assim que falhas ficaram silenciosas no passado.
- **Checagem diária = retry:** `Persistent=true` repõe execuções **perdidas** (PC desligado), nunca execuções **falhadas** — HDD desmontado na virada do mês é coberto na manhã seguinte.
- **Escrita atômica:** `.tmp` + integrity-check + `os.replace` — snapshot falho nunca destrói o último bom.
- **Pós-import:** confirmar/desfazer um import refresca o **snapshot do mês** em background (`request_post_import_snapshot` → `refresh_monthly_snapshot`, single-flight) — o arquivo do mês corrente nunca fica mais de um import atrás e termina o mês como fechamento.
- **Restore:** o wrapper `deploy/restore.sh` foi apagado (2026-06-23). Por ora = parar o `./run.sh` → cópia manual do `.db`, ou chamar `core/backup.py::restore_backup` (verificação + sidecar `.pre-restore`) **com o dashboard parado** — nunca com o app escrevendo (corrompe). Redesenho de restore seguro operacional = P1 no TODO T-C.

---

## Development Guidelines

- **Type hints obrigatórias** em toda assinatura (verificadas por mypy).
- **Todo SQL via `core/database.py`** — sem SQL inline em outro lugar.
- `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` no connect.
- `main.py` **bloqueia em foreground** (`waitress.serve`) e sai ≠0 em ambiente inválido. Hoje sobe via `./run.sh` (sem supervisor — se cair, sobe na mão; auto-restart era o systemd, agora pausado/apagado — ver TODOS T-C).
- **Health Stack (antes de commitar):** `ruff check backend tests` + `mypy` + `pytest` verdes. Config em `pyproject.toml` (ruff = E/F/B; mypy estrito em `core/`, relaxado na borda de framework em `dashboard.server`). **Enforçado** por hook versionado `.githooks/pre-commit` (ligado via `git config core.hooksPath .githooks`) — bloqueia o commit se algo estiver vermelho. Bypass pontual: `git commit --no-verify`. (Existe porque o pivot checking-only chegou a commitar um `POST /api/transactions` que dava 500 sem rodar o stack — `c2c467a`.)

---

## Configuration (`.env`)

```env
DB_PATH=/home/SEU_USUARIO/brokershark/data/brokershark.db   # ABSOLUTO — relativo depende do cwd
DASHBOARD_PORT=8080
OWNER_SELF_KEYWORDS=seu nome completo,fragmento-cpf         # detecta auto-Pix/TED (SELF)
```

> `LOCAL_BACKUP_DIR` (`/mnt/HDD_Arquivos/Backups/brokershark`) e a retenção (12 mensais) são hardcoded em `config.py`. `validate()` fail-fasta em `DB_PATH` inutilizável (resolvido p/ absoluto e logado).

---

## Running Locally

Runtime atual = **foreground via `./run.sh`** (a estratégia always-on/systemd está em rethink — ver TODOS T-C). Backup roda manual (`PYTHONPATH=backend .venv/bin/python -m jobs.backup`). Rodar em foreground:

```bash
cp .env.example .env   # preencher DB_PATH (absoluto)
source .venv/bin/activate.fish
pip install -r requirements.txt
python backend/main.py
# Dashboard at http://localhost:8080  (parar o serviço antes, ou usar outra DASHBOARD_PORT)
```

---

## Skill routing

Quando o pedido casa com uma skill, invoque-a via Skill tool (na dúvida, invoque). Produto/brainstorm → `/office-hours`; estratégia/escopo → `/plan-ceo-review`; arquitetura → `/plan-eng-review`; design → `/design-consultation`/`/design-review`; pipeline completo → `/autoplan`; bugs → `/investigate`; QA → `/qa`; review de diff → `/review`; ship/deploy → `/ship`/`/land-and-deploy`; salvar/retomar contexto → `/context-save`/`/context-restore`; spec → `/spec`.
