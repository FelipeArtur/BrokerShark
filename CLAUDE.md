# BrokerShark — Claude Reference Guide

> Histórico completo (roadmap, hashes, logs de decisão datados, revisões de segurança) vive no `git log`. Este arquivo guarda só o que é load-bearing para não quebrar a lógica financeira.

> **Este arquivo mora na raiz de propósito** — é auto-carregado em toda sessão. Movê-lo pra uma subpasta (ou pro vault) o tiraria do contexto padrão e as invariantes financeiras abaixo deixariam de ser lidas.
>
> **A documentação de apoio NÃO mora mais no repo** — mora no vault Obsidian, em `~/Documents/Rede de projetos/Pessoal/BrokerShark/` (não é auto-carregada; leia sob demanda pelo caminho absoluto):
> `BrokerShark.md` (índice — comece por aqui) · `Produto.md` (usuário/escopo) · `Design System.md` (tokens/sistema visual) · `Specs/` e `Planos/` (datados) · `Arquivo/` (superados).
> O `CLAUDE.md` que aparece lá é symlink para **este** arquivo. No repo ficam só `README.md` (porta de entrada humana) e este guia.
>
> **Doc novo de spec/plano/auditoria nasce no vault, nunca em `docs/`** — o repo não tem mais `docs/`.

## gstack

Use the `/browse` skill from gstack for all web browsing. **Never** use `mcp__claude-in-chrome__*` tools. Skills disponíveis: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## AI Development Tools

Desenvolvido com **Claude Code CLI**. `CLAUDE.md` = fonte única da verdade. **Mudança permanente (schema/conta/invariante) → atualizar este arquivo.**

---

## Configuração vs. código

**O que é de quem usa mora em `config/`, nunca no código.** Conta (id, banco,
tipo, nome), qual formato de arquivo cada uma exporta, o padrão de nome no
acervo, as keywords de investimento, a poupança derivada e os rótulos de grupo de
posição: tudo em `config/default.json` (genérico, versionado) ou
`config/local.json` (o seu, ignorado pelo git; `BROKERSHARK_CONFIG` aponta pra
outro caminho). `src/config.ts` carrega, valida e oferece os recortes prontos
(`checkingAccounts()`, `primaryCard()`, `ledgerVocabulary()`, `groupNameFor()`).

**Parser é sobre FORMATO, não sobre banco.** `statementWithIds` lê extrato com
identificador único por linha; `statementWithBalance` lê extrato com saldo
corrente conferível; `invoiceItemized` lê fatura item a item. Qual conta recebe
qual arquivo é decisão da config. Instituição nova que exporte um formato
conhecido não precisa de código — precisa de uma entrada em `accounts`.

**Teste nunca lê a config do disco:** `useTestConfig()` (em `src/testing/`) fixa
a config do processo. Sem isso, alguém criar um `config/local.json` quebraria
metade da suíte por motivo nenhum.

## O repositório é PÚBLICO

Desde 2026-07-27 o repo é vitrine de portfólio no GitHub. Duas consequências que valem
mais que qualquer preferência de estilo:

- **Nada de banco, conta ou produto financeiro real no código.** O default é
  genérico ("Banco A", "conta-a", "Reserva"). O que é seu vive em
  `config/local.json`, fora do repositório público.
- **Nenhum dado real entra em arquivo versionado. Nunca.** Nem em teste, nem em fixture,
  nem em comentário, nem em mensagem de commit. Nome de pessoa, CPF (mesmo mascarado),
  agência, conta, CNPJ de empregador, comerciante real — tudo fictício, e obviamente
  fictício ("joao da silva", "banco exemplo", "•••.000.000-••"). O histórico já foi
  reescrito uma vez pra tirar dado de terceiro que vazou por fixture de teste; a segunda
  vez custa o mesmo e a exposição é irreversível. `data/` e `backups/` seguem fora do VCS.
- **README.md é a vitrine, em inglês**; `README.pt-BR.md` é o espelho em português.
  Código, comentários, commits e este arquivo continuam em português. Mudança que altere
  o que o README afirma (rodar, testar, stack, invariante) atualiza os dois.

`LICENSE` é proprietária de portfólio: ler, rodar e estudar é livre; usar em produto ou
redistribuir exige permissão escrita.

## Overview

Ferramenta **pessoal** de análise de dinheiro, 100% local (Linux, 1 usuário). Pergunta central: **"quanto eu posso gastar agora?"** — depois, para onde o dinheiro vai.

**v2 rewrite — TypeScript.** O backend Python/Flask foi removido (histórico preservado no git). O novo backend é TypeScript rodando sobre Node ≥ 26 (native type-stripping, sem build step). Ingestão (backfill) e servidor web (node:http + SSE, zero deps) prontos. **Import incremental via UI** (`/api/import/*`) implementado: extratos (CSV, os dois formatos), fatura (CSV) e relatório de corretora (xlsx) com preview/dedup/staging editável/confirm/reverter-lote; pós-insert re-pareia SELF e rederiva a poupança. **Tudo entra pela UI — nada exige backfill.** O backfill existe pra reconstruir do acervo, não pra alimentar o dia a dia.

**Entrega é dashboard web no navegador, e só.** Não há app desktop nem empacotamento — houve um wrapper WebKitGTK em `desktop/`, removido em 2026-07-26 por decisão do dono. Não reintroduzir: um segundo jeito de rodar é um segundo ciclo de vida de processo pra manter em pé, e o navegador já resolve.

**O produto é a análise (web dashboard — tela única, sem abas):** faixa KPI fixa (**Disponível pra gastar** herói · **Patrimônio total** com Δ mensal · **Saldo livre do mês** · **Investido** com Δ) + grid de widgets (visão geral do mês, fluxo mês a mês clicável = seletor de mês global, contas, categorias, investimentos, fatura do cartão, visão de futuro). Detalhe abre em **drill-down overlay**, nunca navegação. Seletor de mês global rege os widgets de fluxo; posição é sempre "agora"; default = mês mais recente COM dados. **Apoio (não é o centro):** import de extratos e posições B3.

**Navegação é por mouse.** Não há hotkey global — teclado serve só pra Esc (fecha modal/overlay), Tab (focus trap) e Enter (submit de form). Adicionar tecla muda que mexe na tela é regressão.

> **North star:** fácil de alimentar + extremamente confiável. Dinheiro em **centavos inteiros** — sem floats no ledger.

**Perfil de uso:** 1 usuário, duas contas correntes e um cartão de crédito, declarados em `config/`. Investimentos: uma poupança derivada do ledger (sem custódia em corretora) mais posições de renda fixa e tesouro vindas do relatório da corretora. Quem são os bancos é config, não código.

---

## Repository Structure

```
.github/
  workflows/ci.yml       # Node 26 → npm ci → npm test → demo + auditoria de invariantes
  assets/                # prints do README (gerados da DEMO, nunca do ledger real)
LICENSE                  # proprietária de portfólio (ler/estudar livre; usar, não)
README.md                # vitrine, em inglês · README.pt-BR.md — espelho em português
backend/
  data/                  # brokershark-v2.db + demo.db (SQLite, 0600, NUNCA versionados)
  package.json          # deps: xlsx (única npm dep); npm test = node:test (co-locado src/**/*.test.ts)
  src/
    db/
      schema.sql        # DDL v2 — baseline idempotente (CREATE IF NOT EXISTS)
      open.ts           # openDb/initSchema/restrictPermissions (node:sqlite builtin)
      migrate.ts        # runMigrations — forward-only sobre migration_log (boot: server + backfill)
      migrations/       # NNNN_slug.sql numerados; ALTER/rename/drop/data-fix (sem BEGIN/COMMIT)
      reconcile.ts      # reconciliação de pagamento de fatura (valor exato + liquidações parciais)
      audit.ts          # auditLedger — invariantes documentadas viradas em consulta (backfill + CLI)
      faturaImport.ts   # insert de fatura aberta (itens + due_date)
      ledgerSql.ts      # consumptionExpense()/realIncome()/investmentOut()/investmentIn() —
                        # as regras de total em SQL, numa fonte só (alias da tabela é parâmetro)
    config.ts           # a config do ledger: contas, formatos, keywords, grupos
    domain/             # lógica PURA (sem DB/IO)
      money.ts          # parseMoneyCents (string→centavos inteiros), fmtCents, parseDateBR
      classify.ts       # isInvestment/isDerivedSavingsLeg (vocabulário vem por parâmetro)
      dates.ts          # currentMonth, monthRange, prevRefMonth, today
      budget.ts         # resolveBudget (override do mês → alvo fixo), isRefMonth
      positions.ts      # monthlyPortfolioSeries (carry-forward de snapshots)
      accountBalances.ts# monthlyCheckingSeries — saldo POR CONTA, com corte no encerramento
      merchant.ts       # normalizeMerchant — núcleo do comerciante, matcher das regras de categoria
      commitments.ts    # projeção pura de parcelas/compromissos (visão de futuro)
      recurrence.ts     # detecção de recorrência (corrida recente por comerciante+sentido)
    ingest/             # parsers dos exports (1 arquivo por formato)
      types.ts          # TxRecord, ParsedFile
      csv.ts            # parser CSV genérico
      statementWithIds.ts     # extrato CSV com identificador único (dedup exata)
      statementWithBalance.ts # extrato CSV com saldo corrente (conferido linha a linha)
      invoiceItemized.ts      # fatura CSV item a item (categoria do banco + parcelas)
      b3.ts                   # relatório consolidado de corretora xlsx (posições + snapshots)
    http/               # infraestrutura HTTP (1 preocupação por arquivo)
      respond.ts        # json/error, readBody (limite 1MB, HttpError), query-string
      router.ts         # compilePath + dispatch
      sse.ts            # broadcaster /api/events + keepalive
      static.ts         # frontend estático (guarda de traversal, mapa /static/)
      security.ts       # host + Origin allowlist (anti DNS-rebinding + anti-CSRF) + headers (CSP etc.)
      multipart.ts      # parser multipart/form-data (upload do import; cap 20MB / 64 partes)
      validate.ts       # isIsoDate, isPositiveAmount, isIntId… (writes validam tudo)
    testing/            # fixtures de TESTE (categorias genéricas) — nunca importado por produção
    routes/             # handlers finos por domínio; SQL nomeado no topo
      accounts.ts       # /api/accounts (GET/POST/PATCH/DELETE), /api/available,
                        # /api/liquidity-history + openCheckingIds (allowlist do import)
      transactions.ts   # month-transactions (com sugestão), PATCH/DELETE + undo, bulk
      categories.ts     # categories-full (alvo+gasto+Δ), expense-categories,
                        # POST/PATCH/DELETE + PUT/DELETE /api/category-budget
      analytics.ts      # monthly, cashflow-statement, uncategorized-merchants
      investments.ts    # carteira (abertas), evolução, detalhe da posição
                        # (/api/investments/:id — ficha + snapshots, rendimento COMPUTADO)
      import.ts         # /api/import/* — detect/preview/staging/confirm/batch + B3 (upload incremental)
      commitments.ts    # /api/commitments — visão de futuro derivada (duro + recorrente)
      rules.ts          # /api/rules — regras APRENDIDAS: listar/corrigir/desligar/apagar
                        # (+ /api/rules/test, espelho do que a sugestão faria)
    server.ts           # bootstrap: config → db → initSchema → pipeline
                        # (host→headers→Origin→SSE→rotas→estático)
    jobs/
      seedDemo.ts       # ledger SINTÉTICO determinístico (npm run demo) — passa pelos
                        # mesmos módulos do backfill e se audita no fim; é o que faz o
                        # projeto rodar sem acervo e a fonte dos prints do README
      backfill.ts       # orquestrador (1 tela): fases em jobs/backfill/ (aborta se DB tem overlay da UI; --force)
      backfill/         # files (padrões da config), seeds (contas; NUNCA categorias), txInsert,
                        # extratos, faturas, selfPairs, derivedSavings,
                        # b3Sync, guard (userOverlay: 4 sondas do que a UI escreveu),
                        # investReview, verify — 1 fase por arquivo
      backup.ts         # backup mensal: snapshot VACUUM INTO datado (retém 12, 0600) + backupStatus + CLI
      audit.ts          # CLI read-only: db/audit.ts + investReview sobre o DB vivo (exit 1 se violou)
  systemd/              # brokershark-backup.{service,timer} — user timer mensal do backup
frontend/
  index.html            # React 18 SPA (hyperscript puro, sem build step)
  js/
    domain/             # regra PURA e testada — espelha backend/src/domain
                        # money.js — ESPÉCIES de dinheiro (moneyKind/KIND_COLOR/fmtParts) — testada
                        # tx-group.js — agrupamento da tabela (buildGroups/scaleFor/budgetState) — testada
                        # filter.js — lógica pura filtro facetado (applyFilter/toggleFacet/searchMatch) — testada
                        # palette.js — cor estável por nome, quantizada a 8 matizes — testada
                        # bars.js — quais barras um mês desenha (fantasma do mês anterior) — testada
                        # month-nav.js — salto de 12 meses sobre série esparsa — testada
                        # bank.js — cor e rótulo de banco (cor estável derivada do
                        # nome; nenhum banco tem cor reservada) — testada
                        # bulk.js — suggestionPlan (decisão do "aplicar todas") — testada
                        # forward.js — merge duro+previsto, escala, rótulo do comerciante — testada
    core/               # api.js (fetch + contrato) · juice.js — engine feedback SILENCIOSO
                        # (coin/boot/pop/shake); sem áudio — respeita prefers-reduced-motion — testada
    ui/                 # primitives.js (Overlay de drill-down, Money, TxRow) · icons.js
                        # pixel-bars.js — barras dithered fluxo mês a mês (clique→seletor global) + compare toggle
    screens/            # app.js (shell)
                        # dashboard.js (a tela única: KPIs + widgets facetados)
                        # history.js (TxTableWidget — a planilha, agrupada por categoria)
    overlays/           # abre por cima da tela única — Modal ou Overlay (drill-down tela cheia), mesma ideia
                        # transaction.js (editor de lançamento) · import.js (import via UI)
                        # bulk.js — categorização em lote por comerciante
                        # categories.js — CategoriesPanel (abas Categorias | Regras)
                        # accounts.js — AccountsPanel (criar/renomear/encerrar/reabrir)
                        # investments.js — InvestmentPanel (ficha + histórico de medições)
    vendor/             # react, react-dom, chart — vendorizados (inalterado)
  css/                  # estilos; pixel.css — estrutural (bordas duras, sombras degrau, scanlines CRT, dither, keyframes)
                        # pixel-ui.css — vocabulário de componente (.px-row/.px-field/.px-btn/.px-seg/.px-swatch/.px-chip…)
  fonts/                # Silkscreen, Departure Mono — vendorizados (100% offline); só essas duas
  img/                  # assets
```

---

## Architecture

```
Acervo local (CSV/xlsx exports de banco)
      ↓
backfill.ts — parse + INSERT (SQLite, centavos inteiros)
      ↓
backend/data/brokershark-v2.db (WAL, 0600)
      ↓
server.ts (node:http, 127.0.0.1:8000) → React frontend (SSE /api/events)
```

### Key principles

- **SQLite é a fonte única.** `node:sqlite` builtin (zero deps nativas), WAL mode, `foreign_keys=ON`, `synchronous=NORMAL`.
- **Schema no boot = baseline idempotente + migrations forward-only.** `schema.sql` é todo `CREATE ... IF NOT EXISTS` (baseline: **tabela nova nasce sozinha num DB vivo**, sem rebuild, no-op quando já existe). Logo após `initSchema`, `db/migrate.ts` roda `runMigrations` (server E backfill): aplica os `.sql` numerados de `db/migrations/` uma vez por DB, registrando em `migration_log`, cada um numa transação (falha → ROLLBACK + throw, aborta o boot). Migrations cobrem o que o baseline NÃO expressa — `ALTER`/rename/drop/data-fix; **não contêm `BEGIN`/`COMMIT`** (o runner envelopa). **Disciplina de baseline:** quando uma migration altera uma tabela, o DDL dela em `schema.sql` congela (o baseline reflete só o estado de criação; a migration leva daí pra frente). Tabela nova independente ainda pode entrar direto no `schema.sql`. Aditivo simples → prefira tabela nova; só use migration pra transformar o que já existe.
- **Dinheiro = centavos inteiros.** `parseMoneyCents()` decompõe a string em inteiro+fração — jamais passa por float intermediário. `amount_cents`, `initial_balance_cents`, `net_cents`, etc.
- **Backfill por reconstrução (guardado).** O DB é recriado do zero a cada run. **Guarda anti-perda-de-dados** (`jobs/backfill/guard.ts`): `userOverlay` roda **4 sondas** por tudo que a UI escreve e nenhum acervo recria — lançamentos (`import_batch_id`/`display_name`/`is_third_party`), **contas criadas ou encerradas** (`opened_at`/`closed_at`; o seed não preenche nenhuma das duas), **alvos de gasto** (`category_budgets`) e **regras aprendidas** (`rules.action='category'`; o seed só grava `investment_leg`/`settlement`). Aborta listando o que se perderia, item a item — a menos de `--force`.
  - **Sonda nova declara `table` e `needs`.** A guarda roda ANTES das migrations, sobre o DB que já estava lá, então pode encontrar schema mais velho que ela; sonda cuja coluna não existe é pulada em vez de estourar. Pular está certo: sem a coluna, o dado não pode existir.
  - Categoria criada pela UI e **nunca usada** ainda escapa da guarda: o seed não cria categoria nenhuma, mas a migration `0002` cria as macro num ledger que já tinha categorias, então "existe categoria" não prova origem. Na prática toda categoria criada acaba usada, e o uso cai na sonda de regras.
  - Meses novos entram pelo **import incremental via UI**, não por rebuild.
- **DB chmod 0600** — sem auth na app, perms de arquivo = fronteira at-rest (backfill E server aplicam; WAL/SHM incluídos).
- **Fronteiras do server local:** bind 127.0.0.1 + allowlist de **Host** (anti DNS-rebinding) + allowlist de **Origin** nos métodos != GET/HEAD (anti-CSRF — `readBody` ignora Content-Type, então todo write exige Origin localhost) + CSP self-only/nosniff/frame-deny + body cap 1MB (upload multipart 20MB / 64 partes) + writes 100% validados server-side (data, FKs, whitelists de method/flow/operation).

### Invariantes financeiras (load-bearing — não quebrar)

- **Fatura itemizada (v2):** os itens da fatura são os gastos reais (`credit`, na conta do cartão). O pagamento da fatura no extrato é uma **liquidação** (`is_settlement=1`) — excluída dos totais de consumo. Sem isso, consumo contaria em dobro (itens + pagamento).
- **Reconciliação de fatura:** pagamento de valor EXATO do `total_cents` da fatura, janela −70/+35 dias do `ref_month`, casado por `invoice_id`. Pagamentos de fatura na cobertura das faturas importadas mas sem match exato são **liquidações parciais** (rotativo/débito automático).
- **Self-transfers por pareamento de pernas (v2):** saída pix/ted numa conta + entrada de mesmo valor em conta diferente dentro de ±3 dias = `counterpart='SELF'`. Sem keyword allow-list (diferença do v1). Pernas SELF: `self_pair_tx_id` cruzado. Fora de despesas, receitas e investimento.
  - **SELF é DERIVADO, nunca declarado.** `selfPairs.ts` reescreve a perna de saída pra `method='transfer'` — é disso que a regra consumo-despesa depende pra excluí-la (a regra não olha `counterpart`). Por isso **não existe rota que crie lançamento avulso**: uma perna SELF declarada pelo cliente nasceria sem `self_pair_tx_id` e seria contada como gasto. Linha nova entra só por import (que passa pelo re-pareamento). Se um dia voltar um `POST /api/transactions`, ele **tem** que recusar `counterpart='SELF'`.
  - Verificado no ledger: 19 pernas de saída (`expense`/`transfer`) + 19 de entrada (`income`/`pix`, `is_revenue=0`). Os dois lados são excluídos por campos diferentes.
- **Investimentos = posições + snapshots:** `position_snapshots` datados (quantity, applied/gross/net). Yield é computado, nunca chutado. Posições soft-close (`closed_at`) quando somem dos relatórios mais novos — nunca DELETE.
- **B3 = tabela verdade (posições de corretora).** Full-sync por `match_key` (ISIN/código/ticker). Soft-close por tipo de aba: **Tesouro/Ações/BDR** — o consolidado sempre lista o que existe; posição ausente de qualquer relatório mais novo → fechada. **Renda Fixa** — a aba PISCA no consolidado (posições vivas somem de um mês e voltam no outro; o registro em custódia atrasa); aba RF ausente = sem informação, só fecha quando um relatório mais novo COM aba RF deixa de listar a posição. O rótulo de grupo (`group_name`) sai de `positionGroups` na config.
- **Poupança derivada = posição que o ledger calcula.** É a reserva SEM custódia em corretora: nenhum relatório a lista, então o saldo é `Σ(aplicações) − Σ(resgates)` das pernas `transfer` que casam as keywords de `derivedSavings`, na conta que a config indicar. `source='ledger'`, `match_key='ledger:derived-savings'`. Snapshots mensais derivados no backfill.
- **Comprometido é DERIVADO** — fatura aberta (`payment_tx_id IS NULL`) + parcelas projetadas virtuais; nunca vira row; `available_net = available − committed_this_month` (só fatura vencendo no mês-calendário via `due_date`).
- **Posição custodiada NÃO é derivada** — ela entra pelo relatório da corretora, e derivá-la do extrato contaria o mesmo dinheiro duas vezes (além de ignorar o rendimento). É pra isso que serve `derivedSavings.excludeKeywords`: as pernas continuam classificadas como investimento, mas ficam fora da posição derivada.
- **Consumption-expense rule:** totais de despesa de consumo = `flow='expense' AND method != 'transfer' AND is_settlement=0 AND is_third_party=0 AND dest_account_id IS NULL`. Transferência (leg de investimento) **nunca** é despesa de consumo. Receita real = `flow='income' AND is_revenue=1 AND is_third_party=0` — os dois lados excluem terceiros. **Em SQL as duas regras têm uma fonte só: `db/ledgerSql.ts` (`consumptionExpense()` / `realIncome()`, alias da tabela como parâmetro).** Consulta nova que some dinheiro importa de lá; reescrever a condição à mão faz totais divergirem entre widgets sem quebrar teste nenhum.
- **Perna de investimento ≠ perna SELF.** Aplicação = `flow='expense' AND method='transfer' AND self_pair_tx_id IS NULL AND dest_account_id IS NULL AND is_settlement=0`; resgate = `flow='income' AND is_revenue=0 AND method='transfer' AND self_pair_tx_id IS NULL`. **A exclusão do `self_pair_tx_id` é load-bearing:** `selfPairs` reescreve a perna SELF de saída pra `method='transfer'` (a marca da aplicação) e zera o `is_revenue` da de entrada (a marca do resgate) — sem excluí-la, mandar dinheiro da conta A pra B vira "aplicou" e o *saldo livre do mês* encolhe sozinho. Fonte única em `db/ledgerSql.ts` (`investmentOut()` / `investmentIn()`), ao lado das outras duas regras.
- **`is_revenue`** (Integer): `1` = receita real, `0` = self-transfer ou movimento de investimento. Controla totais de receita.
- **Espécies de dinheiro (front):** `money.js` → `moneyKind()` é a ÚNICA regra do frontend e devolve exatamente uma de seis espécies por linha: `settlement` · `transfer` · `invest` · `third_party` · `revenue` · `expense`. **A ordem de precedência é load-bearing** (liquidação antes de despesa senão o consumo dobra; SELF antes de investimento senão transferência vira aplicação — o backend faz o mesmo recorte em `investmentOut()`/`investmentIn()`, e foi o front acertando enquanto o back errava que denunciou o furo). Equivale à regra consumo-despesa acima em toda linha alcançável — há teste combinatório que falha se divergir. Cor por espécie em `KIND_COLOR`; **verde é receita e só receita** (nunca reusar pra "dentro do alvo").
- **Recorrência é DERIVADA e display-only.** `domain/recurrence.ts` recorta a **corrida recente** de meses por `flow|comerciante` (histórico inteiro enterra corrida viva sob anos de esporádico) e aceita ≥3 meses, `cv ≤ 0.35`, gap ≤ 2, parada ≤ 2 meses; valor = mediana. **Não entra no herói nem em `available_net`** — herói é dinheiro que existe, e somar entrada prevista faria salário atrasado virar estouro silencioso. `/api/commitments` mantém `series` como compromisso DURO; recorrência vive no campo irmão `recurring`. A projeção ancora no último mês **observado** de cada recorrência, não no mês corrente: mês já medido pelo ledger nunca recebe previsão (dobraria), mas o intervalo entre o fim dos dados e hoje recebe.
- **Ledger novo nasce SEM categoria.** `seedAccounts` semeia só as três contas; nenhuma categoria. Taxonomia de gasto é decisão de quem usa — as seis macro que este projeto carregou dizem respeito à vida do dono, não ao domínio, e semeá-las num repo público empurraria essa vida pro ledger de qualquer pessoa. Consequências práticas: (a) a migration `0002_macro_categories` só materializa as macro se **já existir categoria de despesa** no banco (`EXISTS`), o que a torna no-op completo num DB fresh e mantém a consolidação do ledger antigo; (b) lançamento importado nasce sem categoria, estado que a UI já sabe mostrar ("Sem categoria", contador de pendentes) e resolver em lote; (c) teste que precisa de categoria usa `src/testing/fixtures.ts`, nunca o seed.
- **Alvo de gasto:** `resolveBudget` (`domain/budget.ts`) → override do mês ?? alvo fixo ?? **null**. Categoria sem alvo é `null`, **nunca zero** — zero faria tudo nascer 100% estourado. Só categoria de despesa tem alvo.
- **Conta encerrada: `closed_at` afeta POSIÇÃO, nunca HISTÓRICO.** Soft-close, como `investments` — **nunca DELETE**. A regra em duas leituras:
  - *"quanto eu tenho agora"* (`available`, `checking_total`, patrimônio, saldo do card, allowlist do import) soma **só contas abertas**, e o saldo de uma conta encerrada é **zero por definição** — nunca o último saldo que o extrato deixou. Sem isso, encerrar sem transferência de saída (saque em espécie, ou só parar de importar) deixaria o herói mentindo pra cima pra sempre.
  - *"o que aconteceu"* (fluxo mês a mês, categorias, receita/despesa, tabela) ignora `closed_at` por completo — o dinheiro se moveu de verdade, na época.
  - **Série de liquidez corre POR CONTA** (`domain/accountBalances.ts`), não num acumulado global: a conta contribui 0 a partir do mês do `closed_at` (**inclusive** — o que a série plota é saldo de fim de mês, e conta encerrada não tem nenhum). Diferente de propósito de `monthlyPortfolioSeries`, que corta em `ym > closed` porque lá o snapshot do mês do fechamento é medição real.
  - **Só encerra quem está quite** — a regra do banco vale aqui pelo mesmo motivo: encerrar zera o saldo da conta na posição, então dívida pendurada nesse instante vira dinheiro a pagar que sumiu do "disponível". `PATCH` recusa (409) **cartão com fatura em aberto** (`payment_tx_id IS NULL`) e **conta corrente com saldo negativo**. No cartão o saldo é sempre negativo por desenho (são os itens da fatura), então lá quem responde pela dívida é a fatura, nunca o saldo. Reabrir (`closed_at: null`) nunca esbarra nisso. Check espelho na auditoria: `conta-encerrada-com-divida`.
  - **`DELETE /api/accounts/:id` recusa (409) conta com qualquer lançamento** — é a garantia mecânica de que "tirar conta" nunca vira "perder histórico". Só serve pra desfazer conta criada por engano.
  - `PATCH` recusa `closed_at` anterior ao último lançamento; a auditoria tem o check espelho (`lancamento-pos-encerramento`).
- **Nenhum banco tem identidade reservada.** Cor e rótulo saem de `frontend/js/domain/bank.js`: a cor é hash estável do nome, o rótulo é o nome. `month-transactions` devolve `bank` junto do lançamento — sem esse campo o chip cairia no id cru da conta. `bankLabel` é a MESMA chave usada pela faceta do widget de fatura e pelo filtro da tabela — se divergirem, clicar na faceta de um banco novo não filtra nada.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (Node ≥ 26, native type-stripping — sem build step) |
| Database | SQLite via `node:sqlite` (builtin, WAL, `foreign_keys=ON`, file mode 0600) |
| Parsing | own CSV parsers; `xlsx` for B3 reports (única npm dependency) |
| Frontend | React 18 (pixel-art / 8-bit, Balatro-CRT palette, tema único) + fontes Silkscreen (headings/labels) + Departure Mono (números/body), ambas vendorizadas offline. Só essas duas — cobrem Latin-1/acentos PT, então não há camada de fallback webfont (stack termina em system-ui/ui-monospace). **Widgets = facetas clicáveis** (categoria/conta/banco), busca sempre visível, recategorização inline. **Sem build step** — hyperscript puro (`React.createElement`, nunca JSX); cada arquivo em IIFE. |
| Server | `node:http` + micro-router próprio + SSE (`/api/events`) — zero deps, bind 127.0.0.1, preserva o API contract v1 |

---

## Data Model (v2)

```sql
accounts (id TEXT PK, bank, type CHECK('checking'|'credit_card'), name, initial_balance_cents,
          opened_at TEXT, closed_at TEXT)
          -- closed_at = soft-close. Afeta POSIÇÃO (disponível, patrimônio,
          -- destino de import), nunca HISTÓRICO.
categories (id INTEGER PK, name, flow CHECK('expense'|'income'))
category_budgets (category_id FK ON DELETE CASCADE, ref_month TEXT DEFAULT '',
                  amount_cents CHECK(>=0), PK(category_id, ref_month))
                  -- ref_month='' = alvo fixo; 'YYYY-MM' = override do mês.
                  -- '' e não NULL: NULLs são distintos num UNIQUE do SQLite,
                  -- então PK com NULL deixaria dois alvos fixos na mesma categoria.
invoices (id INTEGER PK, account_id FK, ref_month 'YYYY-MM', total_cents,
          payment_tx_id, source_file, due_date TEXT, UNIQUE(account_id, ref_month))
investments (id INTEGER PK, name, match_key UNIQUE, code, type, bank, indexer,
             rate_text, maturity_date, group_name, source CHECK('b3'|'ledger'|'manual'),
             opened_at, closed_at)
position_snapshots (id, investment_id FK, ref_date, quantity, unit_price_cents,
                    applied_cents, gross_cents, net_cents,
                    source CHECK('b3'|'derived'|'manual'), import_batch_id TEXT,
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
- `bank_category` → categoria que o próprio banco atribuiu (vem na fatura).
- `rules` → documenta a classificação aplicada; consultada para **sugestão de categoria** (month-transactions/import). As **aprendidas** (`action='category'`) são editáveis pela aba Regras (`/api/rules`); as semeadas pelo backfill (`investment_leg`/`settlement`) não — nada as lê em execução, então editá-las prometeria um efeito que não existe (as rotas dão 404).

---

## Data Sources (all local files, no bank APIs)

| Source | Format | Parser |
|--------|--------|--------|
| Extrato com identificador | CSV (`Data,Valor,Identificador,Descrição`) | `statementWithIds.ts` |
| Extrato com saldo corrente | CSV (ponto-e-vírgula, preâmbulo, saldo conferido) | `statementWithBalance.ts` |
| Fatura de cartão | CSV (categoria do banco + parcelas) | `invoiceItemized.ts` |
| Relatório de corretora | xlsx (Tesouro, Renda Fixa, Ações, BDR) | `b3.ts` |

---

## Backfill Pipeline

`node src/jobs/backfill.ts "<dir do acervo>" [<db>] [--force]`

> Aborta se o DB existente tiver dados escritos pela UI (guarda anti-perda; ver Key principles). `--force` reconstrói mesmo assim.

Pipeline sequencial:
1. **Schema + seeds** → só as contas declaradas em `config/`. **Categoria não é semeada** — ver a invariante abaixo
2. **Extratos com identificador** → dedup exata por `external_id`
3. **Extratos com saldo corrente** → dedup por contagem de ocorrência em `(date, flow, amount, description)` + conferência do saldo declarado
4. **Faturas** → itens na conta do cartão + reconciliação do pagamento na conta que o paga (valor exato, janela −70/+35d) + liquidações parciais
5. **Pareamento SELF** → pernas opostas, mesmo valor, ±3 dias, contas diferentes
6. **Poupança derivada** → posição ledger + snapshots mensais derivados
7. **Relatório da corretora** → upsert por `match_key` + snapshots + soft-close
8. **Rules seed** → documenta keywords de classificação
9. **Verificação** → saldo por conta, conferência contra o saldo declarado no extrato, resumo de investimentos, **invariantes** (regra consumo-despesa / liquidação) + **review de investimentos** (`investReview.ts`: invariantes que abortam — nenhuma posição de corretora derivada do ledger, poupança derivada reconcilia com Σ pernas, posição aberta sem snapshot, net negativo — + panorama de alocação)

---

## Accounts

| Account | Type | Bank |
|---------|------|------|
| `conta-a` | Checking | Banco A |
| `conta-b` | Checking | Banco B |
| `cartao-b` | Credit Card | Banco B |

São as contas do `config/default.json` — exemplo genérico. O `config/local.json` de cada instalação declara as de verdade.

---

## Running Locally

```bash
cd backend
npm install       # instala xlsx
npm run demo      # ledger sintético em data/demo.db (24 meses, determinístico, se audita)
node src/jobs/backfill.ts "<dir do acervo>"   # → backend/data/brokershark-v2.db (--force p/ reconstruir sobre DB com dados da UI)
npm start         # server em http://127.0.0.1:8000 (PORT ou --port N para mudar)
npm start -- data/demo.db                     # sobe o painel sobre a demo
npm test          # rede node:test — backend (src/**/*.test.ts, co-locado) + frontend
                  # (../frontend/js/**/*.test.js: domain/, core/juice — money, tx-group, filter, juice)
npm run audit     # confere as invariantes contra o DB VIVO (read-only, sem rebuild); sai 1 se quebrou
```

---

## Skill routing

Quando o pedido casa com uma skill, invoque-a via Skill tool (na dúvida, invoque). Produto/brainstorm → `/office-hours`; estratégia/escopo → `/plan-ceo-review`; arquitetura → `/plan-eng-review`; design → `/design-consultation`/`/design-review`; pipeline completo → `/autoplan`; bugs → `/investigate`; QA → `/qa`; review de diff → `/review`; ship/deploy → `/ship`/`/land-and-deploy`; salvar/retomar contexto → `/context-save`/`/context-restore`; spec → `/spec`.
