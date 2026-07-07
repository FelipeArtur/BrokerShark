# BrokerShark — Claude Reference Guide

> Histórico completo (roadmap, hashes, logs de decisão datados, revisões de segurança) vive no `git log`. Este arquivo guarda só o que é load-bearing para não quebrar a lógica financeira.

## gstack

Use the `/browse` skill from gstack for all web browsing. **Never** use `mcp__claude-in-chrome__*` tools. Skills disponíveis: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## AI Development Tools

Desenvolvido com **Claude Code CLI**. `CLAUDE.md` = fonte única da verdade. **Mudança permanente (categoria/conta/schema) → atualizar este arquivo.** (GEMINI.md/Gemini CLI e TODOS.md removidos em 2026-07-07 — histórico no `git log`.)

---

## Overview

Ferramenta **pessoal** de análise de dinheiro, 100% local (Linux, 1 usuário). Pergunta central: **"quanto eu posso gastar agora?"** — depois, para onde o dinheiro vai.

**O produto é a análise (web dashboard, `http://localhost:8080`), 3 telas:** **Dinheiro** (herói "Disponível pra gastar" = saldo em conta), **Histórico** (timeline mensal, métricas, por categoria, tabela filtrável), **Investimentos** (donut + posições). **Apoio (não é o centro):** import mensal de extratos (CSV) e posições B3 (xlsx) pela web.

> **Regra de ouro:** todo registro e edição acontece **exclusivamente na web** — não existe outro caminho de escrita (Telegram bot e IA local removidos 2026-06-11).

> **North star:** fácil de alimentar + extremamente confiável. Registro = import de extratos em lote (preview editável antes de confirmar); correções = alinhamento de valores, não digitação manual. Re-import semanal do mês corrente só acrescenta a cauda nova (dedup).

**User profile:** 1 usuário, Nubank + Inter (conta corrente). Débito não é rotina — tolerar um `debit` avulso sem quebrar totais. Investimentos: Caixinha Nubank, Porquinho Inter, Tesouro Direto, CDBs.

---

## Repository Structure

```
backend/
  main.py            # entrypoint — bootstrap + serve em foreground (./run.sh)
  config.py          # único arquivo que chama os.getenv()
  bootstrap.py       # load_dotenv + config.validate + logging (reusado por jobs)
  core/
    database.py      # data layer — facade público (re-export → core/db/)
    db/              # schema.py (conn-factory seam), crud.py, analytics.py, categories.py, _sql.py (consumption clause)
    domain/          # classification.py — PURO (sem DB/IO): rotulagem + sugestão de categoria
    ingestion/       # adapters.py (parse), dedup.py, service.py, b3.py
    events.py        # SSE pub/sub — notify() após escrita
    backup.py        # snapshot mensal (conn.backup WAL-safe, run_backup tri-state, restore)
  jobs/              # backup.py, restore.py (entrypoints python -m; exit≠0 só em falha real)
  dashboard/server.py  # Flask + Waitress (12 threads, SSE)
frontend/
  js/  api.js, primitives.js, view-overview.js, view-history.js, view-investments.js, app.js
.githooks/  pre-commit (Health Stack gate — ligado via core.hooksPath .githooks)
tests/   conftest.py (raiz, fixture db compartilhada); unit/ (puro, ~0.04s); integration/ (DB/Flask/backup)
```

---

## Architecture

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
- **Runtime: foreground, resource-minimal (decisão 2026-06-24).** Sobe via **`./run.sh`** (`--open` abre o browser quando a porta responde); `main.py` bloqueia no `waitress.serve`; parar = Ctrl+C. ~0% CPU ocioso, ~43 MB RSS, zero parado. **Sem serviço always-on nem scheduler, conscientemente** — o dono quer consumo mínimo. Backup amarrado a **abrir o app** (ver Backup); restore seguro = `python -m jobs.restore`. O modelo systemd antigo está no `git log` (`08db96c`~). Cortes de escopo 2026-06-26 (auto-shutdown, statement_coverage, budgets, refresh pós-import): `git log`.
- **Segurança de rede (load-bearing — a API não tem auth):** bind `127.0.0.1` + guard Host/Origin em `server.py` (DNS-rebinding/CSRF); rejeita `Sec-Fetch-Site: cross-site`; headers `nosniff`/`X-Frame-Options DENY`/`Permissions-Policy`/no-store em `/api/`; **CSP toda `'self'`** (libs e fontes vendorizadas, sem CDN, sem `unsafe-eval`; `base-uri`/`form-action 'self'`); **DB chmod 0600** no `init_db` (sem auth, perms de arquivo = fronteira at-rest); upload cap 8MB, B3 16MB comprimido / **200MB descomprimido** (anti zip-bomb, in-memory, openpyxl sem XXE); `bulk_categorize` dedupe + cap 10k + chunk ≤900 (limite de vars do SQLite). SQL 100% parametrizado (f-strings só p/ fragmentos estáticos de cláusula). Gate: `tests/integration/test_hardening.py`.

### Invariantes financeiras (load-bearing — não quebrar)

- **Consumption-expense rule (canônica):** totais de despesa filtram `flow='expense' AND dest_account_id IS NULL AND method != 'transfer' AND COALESCE(is_third_party,0)=0` — uma transferência (leg de investimento) **nunca** é despesa. **Fonte única:** `core/db/_sql.py::consumption_expense_clause(alias)` (joins usam `t.`, single-table não). Os ~15 sites em `analytics.py` chamam o helper; o front replica só a flag `is_revenue`, não o WHERE. **Não aplicar o helper** a income (`is_revenue=1`), legs de investimento (`method='transfer'`) nem patrimônio (`dest_account_id IS NULL` **sem** filtro de method) — cláusulas diferentes. Gate: `tests/integration/test_golden_totals.py`.
- **Patrimônio:** `get_patrimonio_history()` = só saldo de conta corrente (`initial_balances + income − expenses`). Movimentos de investimento excluídos; saldo de investimento entra no display via `investments.current_balance`. **Patrimônio NÃO filtra por method.**
- **`is_revenue`** (Integer): `1` = receita real, `0` = self-transfer. Controla totais de receita, resumos de conta e patrimônio. **Sempre passar explícito** em `insert_transaction()` — nunca confiar em default de migração.
- **`counterpart='SELF'`** (auto-Pix/TED entre contas próprias): nem despesa, nem receita, nem investimento. Saída → `flow='expense', method='transfer', counterpart='SELF'`; entrada → `flow='income', is_revenue=0, counterpart='SELF'`. Visíveis (tag "transferência"), saldos preservados, fora de Despesas/Receitas e de `investment_net`. Classificado no import por `adapters._is_self_transfer` (allow-list `config.OWNER_SELF_KEYWORDS`).
- **Transferência interna:** `flow='expense', method='transfer', dest_account_id=<dest>` — excluída dos resumos via `AND dest_account_id IS NULL`.
- **Fluxo de investimento (fonte única = transações; `investment_movements` está vazia):** aplicação = `expense/method='transfer'/dest NULL`; resgate = `income/is_revenue=0/dest NULL`. `free_balance = receitas − despesas − investment_net`. "+ Movimento" grava via `crud.register_investment_transfer` (leg na conta corrente **+** ajusta `current_balance` atomicamente) — **não** escreve `investment_movements` (é subtraída dos saldos → dupla contagem).
- **B3 = tabela verdade (posições de corretora):** o relatório B3 é a fonte autoritativa da tabela `investments` (Tesouro, CDB, NuInvest…). `b3.load_b3_positions` **full-sync**: upsert por nome + `crud.prune_investments_except(nomes_do_relatório)` — espelho fiel, sem saldo obsoleto. **Read-only:** sem endpoint de escrita de saldo (override manual seria clobberado no próximo import); ajuste = re-importar. `prune_investments_except([])` é no-op (relatório vazio = falha de parse, nunca "apaga tudo"). Caixinha/Porquinho não estão na tabela → nunca são podadas.
- **Posição derivada do extrato (só Caixinha Nubank):** reserva que vive **só** no ledger (nunca chega a `investments`/B3). `analytics.get_ledger_savings_positions()` deriva = `Σ(aplicações) − Σ(resgates)` das pernas `transfer` por keyword de poupança (`rdb`/`caixinha`/`dinheiro guardado`, banco nubank), excluindo SELF/third-party. `/api/investments` anexa a derivada (`id=null, derived=true`); patrimônio conta. **Só Caixinha porque é RDB (não custodiada na B3).** **Porquinho Inter NÃO é derivado** — é CDB custodiado na B3 (derivá-lo contaria em dobro; a derivação ignora rendimento e fica negativa num pote drenado). Suas pernas continuam classificadas como investimento (`_INVESTMENT_KEYWORDS` mantém `porquinho`/`cdb porq`). **Nunca incluir keyword de corretora (NuInvest/Tesouro/Porquinho)** na derivação. **B3 vence empate de nome:** derivada cujo `name` já existe como posição B3 é descartada. Sem a derivação da Caixinha o saldo RDB some do patrimônio.
- **Exclusão segura** (`crud.delete_transaction`, confirmação em `ConfirmDeleteModal`): SELF apaga os dois legs; legs de investimento revertem `current_balance`. `restore_transactions`/`POST /api/transactions/restore` = primitivo dormente (nenhuma UI aciona).
- **Import reversível** (`crud.delete_batch`): cada confirm marca as linhas com um `import_batch_id` de sessão (gerado no cliente, compartilhado entre confirms de um drop multi-conta). `delete_batch` remove o lote inteiro, reverte `current_balance` de legs de investimento e devolve payload p/ `restore_transactions`. UI: toast "Desfazer" (5 s); `DELETE /api/import/batch/<id>`.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | Python 3.14 (venv) — código usa 3.12+ |
| Database | SQLite (WAL, `foreign_keys=ON`) |
| Backup | snapshot mensal no HDD (retém 12), `conn.backup()` WAL-safe, backup-on-open |
| Dashboard | Flask 3.1 + Waitress 3.0 (`DASHBOARD_THREADS`=12, foreground via `./run.sh`) |
| Frontend | React 18 + Chart.js + fontes Inter/JetBrains Mono, **tudo vendorizado, sem CDN** → 100% offline. **Sem build step/Babel** — hyperscript puro (`React.createElement`, nunca JSX); cada arquivo em IIFE. |
| Real-time | SSE via `events.py` (sem polling, < 1s) |

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
              -- import_batch_id: tag de sessão de import (1 por "drop") → reversível em
              --   bloco via crud.delete_batch. NULL p/ entradas manuais (índice PARCIAL).
investments (id, name, type, bank, current_balance)
investment_movements (id, date, investment_id, operation, amount, description)
              -- VAZIA por design (write-path real = transações). Mantida só como
              -- subtração defensiva (no-op) nos saldos. Sem leitura/escrita viva.
```

`method` CHECK: `pix | credit | ted | transfer | debit | salary | freelance | pix_received | other` (os 4 últimos são subtipos de receita — sem eles, `INSERT OR IGNORE` descartava receitas em silêncio num DB novo). `is_third_party` é excluído de saldos e resumos.

---

## Web Import (ingestão mensal)

Botão **"+ Importar"** (`ImportModal`: solta vários arquivos → atribui conta → preview por conta, editável → confirmar). Pipeline em `backend/core/ingestion/`; DB só via `crud`/`analytics`.

- **Fontes:** `nu-db` (Nubank, UUID dedup), `inter-db` (Inter, 5-line preamble).
- **Multi-arquivo:** arquivos da **mesma conta** vão num só POST (`preview_import_multi`) p/ dedup no conjunto combinado. Drop multi-conta = vários confirms compartilhando `import_batch_id`, reversível como unidade.
- **Staging:** linhas em `import_staging` (`new`/`duplicate`/`skipped`); `confirm` promove as `new` e apaga o batch. Nada toca `transactions` até confirmar. Preview editável: `PATCH /api/import/staging/<batch>/<row>` (amount/apelido; divergência vs extrato → `amount_divergence`, auditoria via `original_amount`).
- **Dedup:** Nubank por `external_id` (UNIQUE parcial + `INSERT OR IGNORE`); Inter por contagem de ocorrência em `(account, date, round(amount,2), description)` — re-upload cumulativo só adiciona a cauda nova.
- **Classificação no import:** investimentos → `method='transfer', is_revenue=0`; auto-Pix/TED → `counterpart='SELF'`; **pagamento de fatura** (saída com `fatura` na descrição, `adapters._is_fatura_payment`) → `method='credit'`. Saídas de conta corrente passam por `_checking_expense_method` (fatura→credit, pix→pix, débito→debit, resto→ted). **Stand-in:** pagamento de fatura é despesa real (`flow=expense`) **enquanto** não há fatura itemizada.
- **Reconciliação de fatura (FUTURO — não implementado):** com a fatura itemizada, o pagamento vira liquidação (fora dos totais) e os itens viram as despesas `credit` do mês correto (casar valor da fatura com a soma dos itens). Sem isso, pagamento **+** itens dobraria a despesa.
- **Categorização = manual, sugestão suggest-only:** importados entram `category_id=NULL`. Índice aprendido do histórico: `analytics.get_categorized_history()` → `domain.classification.build_category_index()` = `(flow, merchant_key) → categoria` (mais frequente, desempate pela mais recente); só linhas `is_categorizable` (mirror da consumption/revenue-rule — transfer/SELF/investimento nunca). **Nunca auto-escrever** a sugestão; ela é gravada só quando o usuário age. Três superfícies: (1) preview de import — `<select>` pré-selecionado, gravado no confirm (`test_import_suggestions.py`); (2) painel **"Categorizar em lote"** no Histórico — agrupa por `merchant_key` (`get_uncategorized_merchants(year, month)`, escopado ao mês na tela), 1 escolha grava todas as ocorrências via `crud.bulk_categorize` (`test_bulk_categorize.py`); (3) tabela do Histórico — linha sem categoria mostra chip clicável `✓ Sugerida?` (campos `suggested_category_*` em `/api/month-transactions`), 1 clique aplica via PATCH (`test_month_suggestions.py`).
- **B3 (xlsx):** `b3.py` parseia Relatório B3 → `investments` (full-sync; Renda Fixa = valor CURVA, Tesouro = Valor líquido). In-memory, cap de tamanho. Ver invariante "B3 = tabela verdade".

---

## Dashboard API (resumo)

Escrita (validada no servidor): `POST /api/transactions` (despesa), `POST /api/incomes`, `POST /api/investment-movements` (via `register_investment_transfer`), `PATCH /api/transactions/<id>` (category_id/display_name/is_third_party), `DELETE /api/transactions/<id>`, `POST /api/transactions/restore`, `POST /api/transactions/categorize-bulk` (`{ids, category_id}`). Import: `POST /api/import/preview` (múltiplos `file` da mesma conta), `GET/PATCH /api/import/staging/...`, `POST /api/import/confirm` (ecoa `import_batch_id`), `DELETE /api/import/batch/<id>`. (Sem endpoint de escrita de saldo de investimento: B3 é a verdade.)

Leitura: `/api/available`, `/api/summary`, `/api/accounts`, `/api/investments`, `/api/investment-evolution`, `/api/monthly` (`?present=1`; item = `{label:"Mar/26", month, year, income, expenses}`), `/api/categories`, `/api/categories-full`, `/api/transactions`, `/api/recent-activity`, `/api/patrimonio-history`, `/api/liquidity-history`, `/api/daily-spend`, `/api/month-transactions` (inclui `is_revenue` + `suggested_category_*` p/ linhas sem categoria), `/api/pix-top`, `/api/expenses-by-method`, `/api/backup-status`, `/api/uncategorized-merchants`, `/api/events` (SSE).

---

## Frontend — 3 telas

Navegação (`app.js` `SECTIONS`): **Visão do Mês**, **Histórico**, **Investimentos** — atalhos `1`/`2`/`3`.

- **Dinheiro** = "como estou agora". Herói **Disponível pra gastar** (`/api/available`) + ledger Patrimônio líquido. Sempre mês atual; projeções advisory (run-rate). Clicar numa conta corrente → Histórico filtrado.
- **Histórico** = "o que aconteceu". Seletor de meses, 4 métricas (Δ vs média), fluxo 6m (`DualLine`), por categoria, Top PIX, tabela filtrável (flow · método · categoria · conta · busca) com categorização inline, chip de sugestão e filtro "Sem categoria".
- **Investimentos** — donut (`Donut`) + Σ `current_balance` + posições + "+ Movimento" (`MovementModal`).
- **Configurações** (`TweaksPanel`): tema, Categorias (`CategoriesPanel`), restaurar padrões.
- **Charts** (`primitives.js`): Chart.js = `DualLine`/`Donut`; Home usa `Sparkline`/`TrendLine` SVG inline. Todos com dados reais da API, sem placeholder.

---

## Backup & Restore

Um único job (`core/backup.py`; entrypoints `jobs/backup.py`, `jobs/restore.py`). **Mensal-apenas** (decisão 2026-06-12): 1 arquivo/mês em `/mnt/HDD_Arquivos/Backups/brokershark` (`brokershark_YYYY-MM.db`, retém 12). Glob estrito — prune nunca toca arquivos estranhos. Keyed em **ausência do arquivo** (não "hoje é dia 1º") → catch-up tardio ainda gera o snapshot.

- **Backup-on-open (sem scheduler — 2026-06-24):** `run_dashboard` dispara `backup.request_startup_snapshot()` no boot → thread daemon roda `_snapshot_if_stale`: refresca o snapshot do mês **só se** a live DB mudou (compara `snap.mtime` vs maior mtime entre `.db` e `-wal`) e poda. Re-abrir sem editar = no-op (não gira o HDD). Off-thread → HDD nunca bloqueia o serve; exceção é logada, nunca derruba o dashboard. **⚠ Sharp edge:** o gate é mtime + filename por mês — bootar com um DB_PATH diferente/mais novo **sobrescreve** o backup do mês. Nunca bootar contra o BACKUP_DIR real com DB de teste.
- **`run_backup` tri-state** (`created|skipped|failed`): entrypoint sai ≠0 só em falha REAL; skip do mesmo mês não alarma. (Booleano não distinguia — falhas já ficaram silenciosas no passado.)
- **Escrita atômica:** `.tmp` + integrity-check + `os.replace` — snapshot falho nunca destrói o último bom. `_sweep_stale_tmps` no boot varre `.tmp` órfãos (guard de idade 60s).
- **Indicador de frescor:** `GET /api/backup-status` → `{exists, name, age_seconds}`. Rodapé mostra "backup hoje/há Nd" e **alarma** stale (>7d) ou ausente (HDD desmontado) — falha silenciosa fica visível. Gate: `tests/integration/test_backup.py`.
- **Restore seguro:** `PYTHONPATH=backend .venv/bin/python -m jobs.restore` (`--list`/`--latest`/caminho/picker; confirma; falha fechada sem TTY salvo `--yes`). Guard fail-closed: recusa com o dashboard servindo na porta (restaurar sob o writer vivo corrompe). Miolo `core/backup.py::restore_backup`: verify + sidecar `.pre-restore` (undo) + swap atômico. Fluxo: Ctrl+C no `./run.sh` → restore → `./run.sh`.
- Avulso manual: `PYTHONPATH=backend .venv/bin/python -m jobs.backup`.

---

## Development Guidelines

- **Type hints obrigatórias** em toda assinatura (mypy).
- **Todo SQL via `core/database.py`** (facade) → `core/db/*` — sem SQL inline fora de `core/db/`. Fragmentos compartilhados em `core/db/_sql.py`. Lógica pura sem SQL em `core/domain/`.
- `PRAGMA journal_mode=WAL` + `PRAGMA foreign_keys=ON` no connect.
- **Health Stack (antes de commitar):** `ruff check backend tests` + `mypy backend` + `pytest` verdes. Config em `pyproject.toml` (ruff E/F/B; mypy estrito em `core/`, relaxado em `dashboard.server`). **Enforçado** pelo hook `.githooks/pre-commit` (`git config core.hooksPath .githooks`); bypass pontual `git commit --no-verify`. (Existe porque um pivot já commitou endpoint 500 sem rodar o stack — `c2c467a`.)

---

## Configuration (`.env`)

```env
DB_PATH=/home/SEU_USUARIO/brokershark/data/brokershark.db   # ABSOLUTO — relativo depende do cwd
DASHBOARD_PORT=8080
OWNER_SELF_KEYWORDS=seu nome completo,fragmento-cpf         # detecta auto-Pix/TED (SELF)
```

> `LOCAL_BACKUP_DIR` e retenção (12) hardcoded em `config.py`. `validate()` fail-fasta em `DB_PATH` inutilizável.

---

## Running Locally

```bash
cp .env.example .env       # preencher DB_PATH (absoluto)
python -m venv .venv && source .venv/bin/activate.fish
pip install -r requirements.txt
./run.sh                   # ou ./run.sh --open (abre o browser)
# Dashboard: http://localhost:8080 — Ctrl+C para parar
```

---

## Skill routing

Quando o pedido casa com uma skill, invoque-a via Skill tool (na dúvida, invoque). Produto/brainstorm → `/office-hours`; estratégia/escopo → `/plan-ceo-review`; arquitetura → `/plan-eng-review`; design → `/design-consultation`/`/design-review`; pipeline completo → `/autoplan`; bugs → `/investigate`; QA → `/qa`; review de diff → `/review`; ship/deploy → `/ship`/`/land-and-deploy`; salvar/retomar contexto → `/context-save`/`/context-restore`; spec → `/spec`.
