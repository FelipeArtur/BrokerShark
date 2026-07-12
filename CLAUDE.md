# BrokerShark — Claude Reference Guide

> Histórico completo (roadmap, hashes, logs de decisão datados, revisões de segurança) vive no `git log`. Este arquivo guarda só o que é load-bearing para não quebrar a lógica financeira.

## gstack

Use the `/browse` skill from gstack for all web browsing. **Never** use `mcp__claude-in-chrome__*` tools. Skills disponíveis: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## AI Development Tools

Desenvolvido com **Claude Code CLI**. `CLAUDE.md` = fonte única da verdade. **Mudança permanente (schema/conta/invariante) → atualizar este arquivo.**

---

## Overview

Ferramenta **pessoal** de análise de dinheiro, 100% local (Linux, 1 usuário). Pergunta central: **"quanto eu posso gastar agora?"** — depois, para onde o dinheiro vai.

**v2 rewrite — TypeScript.** O backend Python/Flask foi removido (histórico preservado no git). O novo backend é TypeScript rodando sobre Node ≥ 26 (native type-stripping, sem build step). Ingestão (backfill) e servidor web (node:http + SSE, zero deps) prontos; **falta**: endpoints de import incremental via UI (`/api/import/*` — hoje respondem 404; usar backfill).

**O produto é a análise (web dashboard — tela única, sem abas):** faixa KPI fixa (**Disponível pra gastar** herói · **Patrimônio total** com Δ mensal · **Saldo livre do mês** · **Investido** com Δ) + grid de widgets (fluxo mês a mês clicável = seletor de mês global, contas, categorias, investimentos, top PIX, atividade). Detalhe abre em **drill-down overlay** (tecla 2 = tabela completa de transações; 3 = posições de investimento), nunca navegação. Seletor de mês global rege os widgets de fluxo; posição é sempre "agora"; default = mês mais recente COM dados. **Apoio (não é o centro):** import de extratos e posições B3.

> **North star:** fácil de alimentar + extremamente confiável. Dinheiro em **centavos inteiros** — sem floats no ledger.

**User profile:** 1 usuário, Nubank + Inter (conta corrente + cartão de crédito). Investimentos: Caixinha Nubank (RDB), Porquinho Inter (CDB via B3), Tesouro Direto, CDBs.

---

## Repository Structure

```
backend-ts/
  package.json          # deps: xlsx (única npm dep)
  src/
    db/
      schema.sql        # DDL v2 — fonte única do schema
      open.ts           # openDb/initSchema/restrictPermissions (node:sqlite builtin)
    domain/             # lógica PURA (sem DB/IO)
      money.ts          # parseMoneyCents (string→centavos inteiros), fmtCents, parseDateBR
      classify.ts       # isInvestment, isCaixinhaLeg, checkingExpenseMethod
      dates.ts          # currentMonth, monthRange, today
      positions.ts      # monthlyPortfolioSeries (carry-forward de snapshots)
    ingest/             # parsers dos exports (1 arquivo por formato)
      types.ts          # TxRecord, ParsedFile
      csv.ts            # parser CSV genérico
      nubankExtrato.ts  # extrato Nubank CSV (UUID dedup)
      interExtrato.ts   # extrato Inter CSV (running-balance check)
      interFatura.ts    # fatura Inter CSV (itens itemizados)
      b3.ts             # relatório consolidado B3 xlsx (posições + snapshots)
    http/               # infraestrutura HTTP (1 preocupação por arquivo)
      respond.ts        # json/error, readBody (limite 1MB, HttpError), query-string
      router.ts         # compilePath + dispatch
      sse.ts            # broadcaster /api/events + keepalive
      static.ts         # frontend estático (guarda de traversal, mapa /static/)
      security.ts       # host allowlist (anti DNS-rebinding) + headers (CSP etc.)
      validate.ts       # isIsoDate, isPositiveAmount, isIntId… (writes validam tudo)
    routes/             # handlers finos por domínio; SQL nomeado no topo
      accounts.ts       # /api/accounts, /api/available, /api/liquidity-history
      transactions.ts   # listagens, busca, PATCH/DELETE + undo, bulk, lançamento manual
      categories.ts     # categories-full, expense-categories(-full), POST/DELETE
      analytics.ts      # monthly, cashflow-statement, pix-top, uncategorized-merchants
      investments.ts    # carteira (abertas), evolução, movimento manual
    server.ts           # bootstrap: config → db → pipeline (host→headers→SSE→rotas→estático)
    jobs/
      backfill.ts       # orquestrador (1 tela): fases em jobs/backfill/
      backfill/         # files, seeds, txInsert, extratos, faturas, selfPairs,
                        # caixinha, b3Sync, verify — 1 fase por arquivo
frontend/
  index.html            # React 18 SPA (hyperscript puro, sem build step)
  js/                   # api.js · primitives.js (inclui Overlay de drill-down)
                        # view-dashboard.js (a tela única: KPIs + widgets)
                        # view-history.js (TxExplorer — drill de transações)
                        # view-investments.js (drill de investimentos)
                        # view-overview.js (só CategoriesPanel) · app.js (shell)
  css/                  # estilos
  fonts/                # Inter, JetBrains Mono — vendorizados (100% offline)
  img/                  # assets
```

---

## Architecture

```
Acervo local (CSV/xlsx exports de banco)
      ↓
backfill.ts — parse + INSERT (SQLite, centavos inteiros)
      ↓
data/brokershark-v2.db (WAL, 0600)
      ↓
server.ts (node:http, 127.0.0.1:8000) → React frontend (SSE /api/events)
```

### Key principles

- **SQLite é a fonte única.** `node:sqlite` builtin (zero deps nativas), WAL mode, `foreign_keys=ON`, `synchronous=NORMAL`.
- **Dinheiro = centavos inteiros.** `parseMoneyCents()` decompõe a string em inteiro+fração — jamais passa por float intermediário. `amount_cents`, `initial_balance_cents`, `net_cents`, etc.
- **Backfill por reconstrução.** O DB de saída é recriado do zero a cada run — idempotência sem lógica de migração incremental (para a fase de ingestão).
- **DB chmod 0600** — sem auth na app, perms de arquivo = fronteira at-rest (backfill E server aplicam; WAL/SHM incluídos).
- **Fronteiras do server local:** bind 127.0.0.1 + allowlist de Host (anti DNS-rebinding) + CSP self-only/nosniff/frame-deny + body cap 1MB + writes 100% validados server-side (data, FKs, whitelists de method/flow/operation).

### Invariantes financeiras (load-bearing — não quebrar)

- **Fatura itemizada (v2):** itens da fatura Inter são os gastos reais (`credit` no `inter-cc`). O pagamento da fatura no extrato é uma **liquidação** (`is_settlement=1`) — excluída dos totais de consumo. Sem isso, consumo contaria em dobro (itens + pagamento).
- **Reconciliação de fatura:** pagamento de valor EXATO do `total_cents` da fatura, janela −70/+35 dias do `ref_month`, casado por `invoice_id`. Pagamentos de fatura na cobertura das faturas importadas mas sem match exato são **liquidações parciais** (rotativo/débito automático).
- **Self-transfers por pareamento de pernas (v2):** saída pix/ted numa conta + entrada de mesmo valor em conta diferente dentro de ±3 dias = `counterpart='SELF'`. Sem keyword allow-list (diferença do v1). Pernas SELF: `self_pair_tx_id` cruzado. Fora de despesas, receitas e investimento.
- **Investimentos = posições + snapshots:** `position_snapshots` datados (quantity, applied/gross/net). Yield é computado, nunca chutado. Posições soft-close (`closed_at`) quando somem dos relatórios mais novos — nunca DELETE.
- **B3 = tabela verdade (posições de corretora).** Full-sync por `match_key` (ISIN/código/ticker). Soft-close por tipo de aba: **Tesouro/Ações/BDR** — o consolidado sempre lista o que existe; posição ausente de qualquer relatório mais novo → fechada. **Renda Fixa (CDB Inter)** — a aba PISCA no consolidado (CDBs do Porquinho vivos no extrato somem em jan/fev/mar/mai-2026; registro em custódia atrasa); aba RF ausente = sem informação, só fecha quando um relatório mais novo COM aba RF deixa de listar a posição. CDBs Inter = Porquinho (`group_name='Porquinho'`).
- **Caixinha Nubank = posição derivada do ledger.** RDB fora da B3. Saldo = `Σ(aplicações) − Σ(resgates)` das pernas `transfer` por keyword de poupança (`rdb`/`caixinha`/`dinheiro guardado`, banco Nubank). `source='ledger'`. Snapshots mensais derivados no backfill.
- **Porquinho Inter NÃO é derivado** — é CDB custodiado na B3 (derivá-lo contaria em dobro; a derivação ignora rendimento). Suas pernas continuam classificadas como investimento (`INVESTMENT_KEYWORDS` mantém `porquinho`/`cdb porq`).
- **Consumption-expense rule:** totais de despesa de consumo = `flow='expense' AND method != 'transfer' AND is_settlement=0 AND is_third_party=0 AND dest_account_id IS NULL`. Transferência (leg de investimento) **nunca** é despesa de consumo.
- **`is_revenue`** (Integer): `1` = receita real, `0` = self-transfer ou movimento de investimento. Controla totais de receita.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (Node ≥ 26, native type-stripping — sem build step) |
| Database | SQLite via `node:sqlite` (builtin, WAL, `foreign_keys=ON`, file mode 0600) |
| Parsing | own CSV parsers; `xlsx` for B3 reports (única npm dependency) |
| Frontend | React 18 + Chart.js + fontes Inter/JetBrains Mono, **tudo vendorizado, sem CDN** → 100% offline. **Sem build step** — hyperscript puro (`React.createElement`, nunca JSX); cada arquivo em IIFE. |
| Server | `node:http` + micro-router próprio + SSE (`/api/events`) — zero deps, bind 127.0.0.1, preserva o API contract v1 |

---

## Data Model (v2)

```sql
accounts (id TEXT PK, bank, type CHECK('checking'|'credit_card'), name, initial_balance_cents)
categories (id INTEGER PK, name, flow CHECK('expense'|'income'))
invoices (id INTEGER PK, account_id FK, ref_month 'YYYY-MM', total_cents,
          payment_tx_id, source_file, UNIQUE(account_id, ref_month))
investments (id INTEGER PK, name, match_key UNIQUE, code, type, bank, indexer,
             rate_text, maturity_date, group_name, source CHECK('b3'|'ledger'|'manual'),
             opened_at, closed_at)
position_snapshots (id, investment_id FK, ref_date, quantity, unit_price_cents,
                    applied_cents, gross_cents, net_cents,
                    source CHECK('b3'|'derived'|'manual'),
                    UNIQUE(investment_id, ref_date, source))
transactions (id, date, flow, method, account_id FK, amount_cents CHECK(>=0),
              description, category_id FK, dest_account_id FK, counterpart,
              is_revenue, is_settlement, is_third_party, external_id, display_name,
              original_amount_cents, import_batch_id, investment_id FK, invoice_id FK,
              installment_seq, installment_total, bank_category, self_pair_tx_id,
              source_file)
rules (id, matcher, match_field, action, value, priority, enabled)
migration_log (name TEXT PK, ran_at)
```

`method` CHECK: `pix | credit | ted | transfer | debit | salary | freelance | pix_received | other`.

### Diferenças-chave vs schema v1

- `amount_cents` (integer) em vez de `amount` (float).
- `invoices` + `invoice_id` em transactions → fatura itemizada.
- `position_snapshots` → histórico de posições datado (yield computado).
- `investment_id` em transactions → liga perna do extrato à posição.
- `self_pair_tx_id` → pareamento bidirecional das pernas SELF.
- `is_settlement` → marca liquidações de fatura (excluídas de consumo).
- `bank_category` → categoria dada pelo banco (faturas Inter).
- `rules` → documenta a classificação aplicada (editável na UI futura).

---

## Data Sources (all local files, no bank APIs)

| Source | Format | Parser |
|--------|--------|--------|
| Nubank statement | CSV (`Data,Valor,Identificador,Descrição`) | `nubankExtrato.ts` |
| Inter statement | CSV (semicolon, 5-line preamble, running-balance checked) | `interExtrato.ts` |
| Inter card invoice | CSV (bank category + installments) | `interFatura.ts` |
| B3 consolidated report | xlsx (Tesouro, Renda Fixa, Ações, BDR) | `b3.ts` |

---

## Backfill Pipeline

`node src/jobs/backfill.ts "<dir do acervo>" [<db>]`

Pipeline sequencial:
1. **Schema + seeds** → contas (`nu-db`, `inter-db`, `inter-cc`) + categorias
2. **Nubank** → dedup por `external_id` (UUID)
3. **Inter** → dedup por contagem de ocorrência em `(date, flow, amount, description)` + check de saldo corrente (running-balance)
4. **Faturas Inter** → itens no `inter-cc` + reconciliação do pagamento (valor exato, janela −70/+35d) + liquidações parciais
5. **Pareamento SELF** → pernas opostas, mesmo valor, ±3 dias, contas diferentes
6. **Caixinha** → posição ledger + snapshots mensais derivados
7. **B3** → upsert por `match_key` + snapshots + soft-close
8. **Rules seed** → documenta keywords de classificação
9. **Verificação** → saldo por conta, reconciliação Inter, resumo de investimentos

---

## Accounts

| Account | Type | Bank |
|---------|------|------|
| `nu-db` | Checking | Nubank |
| `inter-db` | Checking | Inter |
| `inter-cc` | Credit Card | Inter |

---

## Running Locally

```bash
cd backend-ts
npm install       # instala xlsx
node src/jobs/backfill.ts "<dir do acervo>"   # → data/brokershark-v2.db
npm start         # server em http://127.0.0.1:8000 (PORT ou --port N para mudar)
```

---

## Skill routing

Quando o pedido casa com uma skill, invoque-a via Skill tool (na dúvida, invoque). Produto/brainstorm → `/office-hours`; estratégia/escopo → `/plan-ceo-review`; arquitetura → `/plan-eng-review`; design → `/design-consultation`/`/design-review`; pipeline completo → `/autoplan`; bugs → `/investigate`; QA → `/qa`; review de diff → `/review`; ship/deploy → `/ship`/`/land-and-deploy`; salvar/retomar contexto → `/context-save`/`/context-restore`; spec → `/spec`.
