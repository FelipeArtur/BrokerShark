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

**Apoio (não é o centro):** importação mensal de extratos/faturas (CSV) e posições B3 (xlsx) pela web.

> **Regra de ouro:** todo registro e edição acontece **exclusivamente na web**. Não existe outro caminho de escrita (Telegram bot e IA local foram removidos em 2026-06-11 — produto é web-only; diagnóstico/proposta Hermes arquivados no `git log`).

> **North star:** fácil de alimentar + extremamente confiável. Registro = **import de extratos/faturas em lote** (resumo editável antes de confirmar); correções na web = **alinhamento de valores**, não digitação manual. Re-import semanal do mês corrente só acrescenta a cauda nova (dedup).

**User profile:** 1 usuário, Nubank + Inter (CC + conta corrente). Débito **não é rotina** — defensivo: tolerar um `debit` avulso sem quebrar totais/breakdown. Investimentos: Caixinha Nubank, Porquinho Inter, Tesouro Direto, CDBs.

---

## Repository Structure

```
backend/
  main.py            # entrypoint — bootstrap + serve do dashboard em foreground (systemd)
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
deploy/  systemd/* (dashboard.service, backup.{service,timer}, backup-alert.service),
         brokershark.sh (atalho de browser), restore.sh, README.md
tests/   test_database, test_ingestion, test_b3, test_backup, test_jobs, test_delete,
         test_faturas, test_import_batch, test_investments, test_server_writes
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
- **Runtime: always-on** — dashboard como **serviço systemd de usuário** (`brokershark-dashboard.service`, `Restart=on-failure`, `main.py` bloqueia no `waitress.serve`, loga em stdout/journald) + backup como **timer** (`brokershark-backup.timer`, checagem diária 07h, `Persistent=true`). Exige `loginctl enable-linger joao` (sem linger, units de usuário não sobem no boot nem sobrevivem ao logout). `deploy/brokershark.sh` é só atalho de browser; restore via `deploy/restore.sh` (para o serviço antes — restore com o app escrevendo corrompe). Detalhes em `deploy/README.md`.
- **Segurança de rede:** bind em `127.0.0.1` + guard de Host/Origin em `server.py` (DNS-rebinding/CSRF) — a API não tem auth, então isso é load-bearing.

### Invariantes financeiras (load-bearing — não quebrar)

- **Consumption-expense rule (canônica):** totais de despesa filtram `dest_account_id IS NULL AND method != 'transfer'` — uma transferência (leg de investimento ou pagamento de fatura) **nunca** é despesa. Aplicada por `get_monthly_summary`, `get_cashflow_statement`, `get_monthly_history_present`, `get_expenses_by_category`, `get_account_monthly_summary` e replicada no front (Histórico recebe `is_revenue` em `/api/month-transactions`). Garante que Despesas/Receitas batem em todas as telas.
- **CC anti-duplicação:** o **total da fatura** mora em `nu-db`/`inter-db` com `dest_account_id IN ('nu-cc','inter-cc')` (conta no patrimônio como saída real); as **compras individuais** moram em `nu-cc`/`inter-cc` com `dest_account_id IS NULL` (contam nos resumos de despesa). Nunca se sobrepõem. Linhas `amount <= 0` da fatura são excluídas no import. Simétrico p/ Nubank e Inter.
- **Fatura aberta = agrupamento do banco, não janela por data** (`get_credit_card_billing_info`): uma janela por `billing_day` não reproduz a fatura real (recorrentes/parcelas; compras do mesmo dia caem em faturas diferentes; o vencimento muda no tempo). Import correto = **fatura mensal** (um arquivo = uma fatura): o **vencimento** informado no modal marca **todas** as linhas daquele arquivo com o mesmo `fatura_due` (= a fatura do banco, **com as parcelas do mês**) via override em `crud.confirm_staging_batch`. ⚠️ O relatório **unificado/multi-mês** do Inter **não** reproduz as faturas: ele colapsa compras parceladas em **valor cheio na data da compra** (tudo "Compra à vista", sem linhas de parcela), então as parcelas que o banco cobra no mês corrente somem da fatura aberta. Sem vencimento → fallback que **estima** `fatura_due` pela data (`billing.vencimento_for_date`) — aproximado, só p/ dados sem parcelamento. A fatura ABERTA = soma das compras do **próximo vencimento** (= total do banco), `last_total` = vencimento anterior. Sem `fatura_due` (entradas manuais, histórico não-marcado) → **fallback** para a janela por `billing_day`. Faturas fechadas continuam sendo as linhas-total reais importadas. Bug corrigido à parte: `due_date` no mês do fechamento quando `due_day > billing_day`. **Pertença editável (não janela por data):** o modal de fatura (tela Dinheiro) lista compras **membros** (tagueadas com aquele `fatura_due`) + **candidatas** (compras do cartão sem tag dentro do **ciclo real** da fatura: dia seguinte ao fechamento anterior → fechamento, ancorado no `billing_day` via `billing.billing_cycle_for_due` — ex.: Inter fecha dia 18, vence 25, então a fatura de 25/06 = compras 19/05→18/06) com checkbox; marcar/desmarcar grava `fatura_due` via `PATCH /api/transactions/<id>` (guard server-side: só perna de compra de cartão — `*-cc`, `dest IS NULL`, `flow='expense'`; linha-total/pagamento nunca recebe tag). Totais de despesa/receita **ignoram** `fatura_due` → taguear não duplica despesa, só move a compra pro total da fatura (afeta "disponível"). O Histórico pivota p/ **modo-fatura** (`FaturaHistoryView`) ao clicar num cartão: lista as faturas por **vencimento efetivo** (`get_account_faturas` agrupa cada compra pela tag `fatura_due`, ou — sem tag — pelo ciclo da data via `billing.vencimento_for_date`, inverso de `billing.billing_cycle_for_due`), então a fatura aberta/ainda-não-importada também aparece e o total do ciclo bate com o fallback de janela da home. Seletor por vencimento + total/compras do ciclo (membros tagueados + candidatas sem-tag-no-ciclo), no lugar do mês-calendário.
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
| Database | SQLite (WAL mode) |
| Backup | snapshot local mensal no HDD (retém 12), `conn.backup()` WAL-safe, refresh pós-import |
| Scheduler | **systemd user units** (`Persistent=true`) — dashboard.service + backup.timer |
| Dashboard API | Flask 3.1 + Waitress 3.0 (32 threads, foreground/systemd) |
| Frontend | React 18 + Babel standalone (no build step), Chart.js |
| Real-time | SSE via `events.py` (no polling, < 1s) |

---

## Data Model

```sql
accounts (id, bank, type, name, billing_day, due_day, initial_balance)   -- nu-cc, nu-db, inter-cc, inter-db
categories (id, name, flow)        -- flow: expense | income
transactions (id, date, flow, method, account_id, amount, installments,
              description, category_id, dest_account_id, counterpart,
              is_revenue, external_id, display_name, is_third_party, original_amount,
              import_batch_id, fatura_due)
              -- external_id: UUID Nubank, dedup | display_name: nome editável (UI)
              -- is_third_party: 1 = fora de todos os cálculos pessoais
              -- original_amount: valor parseado do extrato (auditoria de edição no preview)
              -- import_batch_id: tag de sessão de import (1 por "drop", pode abranger
              --   vários staging batches/contas) → import reversível em bloco via
              --   crud.delete_batch. NULL p/ entradas manuais (índice PARCIAL enxuto).
              -- fatura_due: vencimento da fatura de cartão, capturado no import (modal),
              --   marca cada compra → fatura ABERTA = soma das compras do próximo
              --   vencimento (agrupamento do banco, não janela por data). NULL = sem tag.
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
- **Classificação no import:** investimentos (Aplicação RDB/NuInvest/Caixinha/Porquinho…) → `method='transfer', is_revenue=0`; pagamento de fatura → `method='transfer', dest_account_id=<bank>-cc`; auto-Pix/TED → `counterpart='SELF'`; **compra de cartão → `fatura_due` = vencimento informado no import** (arquivo = fatura do mês, parcelas inclusas); sem vencimento, estimado pela data (`billing.vencimento_for_date`, aproximado).
- **Categorização = 100% manual no Histórico:** importados entram com `category_id=NULL` → filtro "Sem categoria" + edição inline (`<select>` por linha → `PATCH /api/transactions/<id>`). Sem auto-categorização por regras.
- **B3 (xlsx):** `core/ingestion/b3.py` parseia posições do Relatório B3 → `investments` (upsert idempotente por nome; Renda Fixa = valor CURVA, Tesouro = Valor líquido). Lido em memória (sem zip-slip), cap de tamanho, openpyxl não resolve XXE.

---

## Dashboard API (resumo)

Escrita (toda validada no servidor): `POST /api/transactions` (despesa), `POST /api/incomes` (receita/transferência), `POST /api/investment-movements`, `PATCH /api/transactions/<id>` (category_id/display_name/is_third_party/**fatura_due** — pertença de fatura; `fatura_due` só em perna de compra de cartão, senão 400), `PATCH /api/budgets/<id>`, `DELETE /api/transactions/<id>` (409 p/ fatura), `POST /api/transactions/restore`. Import: `POST /api/import/preview` (aceita **múltiplos `file`** da mesma conta — dedup no conjunto combinado), `GET /api/import/staging/<batch_id>`, `PATCH /api/import/staging/<batch_id>/<row_id>` (edita amount/category_id/display_name no preview → `amount_divergence`), `POST /api/import/confirm` (recebe e ecoa `import_batch_id`), `DELETE /api/import/batch/<id>` (reverte o lote inteiro).

Leitura: `/api/available` (herói liquidez), `/api/summary`, `/api/accounts`, `/api/investments`, `/api/monthly` (`?present=1` = só meses com dados), `/api/categories`, `/api/faturas` (inclui `due_iso`), `/api/account-faturas` (faturas do cartão por vencimento — modo-fatura), `/api/fatura` (members + candidates editáveis de uma fatura), `/api/transactions`, `/api/recent-activity`, `/api/patrimonio-history`, `/api/daily-spend` (mês calendário zero-filled), `/api/month-transactions` (inclui `is_revenue` p/ o front replicar a consumption-rule), `/api/budgets`, `/api/categories-full`, `/api/pix-top`, `/api/expenses-by-method`, `/api/events` (SSE).

`/api/monthly` item: `{ label:"Mar/26", month:3, year:2026, income, expenses }` (`month`/`year` int em todas as variantes).

---

## Frontend — 3 telas

Navegação (`app.js` `SECTIONS`): **Visão do Mês** (`OverviewView`), **Histórico** (`HistoryView`), **Investimentos** (`InvestmentsView`). Atalhos `1`/`2`/`3`.

- **Dinheiro** = "como estou agora". Herói **Disponível pra gastar** (`/api/available`, contas − faturas) num pane-ledger; direita = ledger **Patrimônio líquido** (Contas + Investimentos − Faturas). Sempre mês atual. Projeções advisory (run-rate, rotuladas como estimativa). Clicar numa **fatura** abre o modal editável (checklist members/candidates → marca/desmarca a pertença) com "Ver no histórico" (→ modo-fatura); clicar numa **conta corrente** → Histórico filtrado pela conta.
- **Histórico** = "o que aconteceu". Seletor de meses com dados, 4 métricas (número + Δ vs média), gráfico fluxo 6m (`DualLine`), por categoria, Top PIX (lado a lado), tabela filtrável (flow · método · categoria · conta · busca) com categorização inline e filtro "Sem categoria". **Modo-fatura** (`FaturaHistoryView`): ao clicar num cartão de crédito (via "Ver no histórico" do modal de fatura ou drill-down `-cc`), troca o seletor de meses por seletor de **faturas (por vencimento)** e mostra total/vs-anterior/compras da fatura — coeso com a tela Dinheiro. "Ver por mês" volta.
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
- **Restore:** `deploy/restore.sh` (para o serviço, restaura com verificação + sidecar `.pre-restore`, religa). Nunca chamar `restore_backup` com o dashboard no ar.

---

## Development Guidelines

- **Type hints obrigatórias** em toda assinatura (verificadas por mypy).
- **Todo SQL via `core/database.py`** — sem SQL inline em outro lugar.
- `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` no connect.
- `main.py` **bloqueia em foreground** (`waitress.serve`) e sai ≠0 em ambiente inválido — é o systemd (`Restart=on-failure`) que reage, não o processo.
- **Health Stack (antes de commitar):** `ruff check backend tests` + `mypy` + `pytest` verdes. Config em `pyproject.toml` (ruff = E/F/B; mypy estrito em `core/`, relaxado na borda de framework em `dashboard.server`).

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

Produção local = systemd (ver `deploy/README.md`): `brokershark-dashboard.service` sempre ativo + `brokershark-backup.timer`. Para desenvolvimento, rodar em foreground:

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
