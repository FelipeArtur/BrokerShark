# BrokerShark v2 — Redesign (2026-07-09)

## Decisões de rumo (do dono)

- **Sem agregadores externos** (Pluggy/Belvo/Open Finance via terceiro) — resistência a conectar conta a serviço externo. Entrada de dados = **arquivos exportados dos apps**, 100% local.
- **Backend novo em TypeScript.** Frontend atual (React vendorizado, sem build) **fica como está** — o contrato da API deve ser preservado.
- **SQLite + estratégia de backup atual mantidos** (WAL, chmod 0600, snapshot mensal atômico no HDD).

## Viabilidade OFX (pesquisada 2026-07)

| Fonte | Formato disponível | Veredito |
|---|---|---|
| Nubank PF — extrato conta | App → PDF / **OFX** / CSV (chega por e-mail) | **OFX viável** |
| Nubank PF — fatura cartão | App → PDF / CSV (sem categoria); OFX só existia no site PF descontinuado | **CSV** |
| Inter — extrato conta | Internet Banking → **OFX** direto | **OFX viável** |
| Inter — fatura cartão | Super App → PDF / CSV; OFX removido | **CSV** |

**Conclusão:** OFX para extratos, CSV para faturas. Parsers CSV atuais (extrato Nu/Inter) viram caminho de **backfill** — o histórico já baixado em CSV continua importável.

### Por que OFX melhora o reconhecimento

- `FITID` = id único por transação → dedup **determinístico** também no Inter (hoje: contagem de ocorrência em `(conta, data, valor, descrição)` — frágil).
- `TRNTYPE` (PIX/TED/DEBIT/…) + `MEMO` estruturado → `method` deixa de ser adivinhado por keyword na descrição.

## Estratégia de classificação v2

1. **Method vem do OFX** (`TRNTYPE`), keyword só como fallback do CSV legado.
2. **Self-transfer por pareamento de pernas**: mesma quantia, contas do dono, janela ±3 dias, direções opostas → `counterpart='SELF'`. Substitui `OWNER_SELF_KEYWORDS` (frágil, quebra quando o banco muda a descrição).
3. **Rules engine editável**: tabela `rules` (matcher → categoria/flag/investimento, com prioridade), aplicada **suggest-only** como hoje; o índice aprendido do histórico continua. `_INVESTMENT_KEYWORDS` hardcoded vira seed de rules editável na UI.
4. **Fatura reconciliada (mata o stand-in)**: itens da fatura entram como despesas `credit` no mês da compra; o pagamento da fatura no extrato vira **liquidação** (fora dos totais), casado por valor + janela de vencimento. Resolve o "FUTURO — não implementado" do CLAUDE.md v1. Enquanto a fatura de um mês não for importada, o pagamento continua stand-in (comportamento atual preservado).
5. **Tesouro/B3 com histórico**: xlsx da B3 continua a fonte da verdade das posições, mas cada import grava `position_snapshots` (data, saldo) em vez de só sobrescrever — dá evolução e rendimento por posição. Derivação da Caixinha (RDB fora da B3) permanece, mas movida para rule configurável.

## Stack

- **Node LTS + TypeScript estrito** (`"strict": true`, sem `any`)
- **Hono** (HTTP + SSE nativo) — alternativa Fastify
- **better-sqlite3** (síncrono, perfeito p/ 1 usuário local) + **Drizzle ORM** (schema tipado, migrations)
- **Zod** — validação de payloads da API e das linhas parseadas
- **Vitest** — portar suíte (golden totals é o gate mais importante)
- **Dinheiro em CENTAVOS INTEIROS** — fim do float/REAL (foot-gun conhecido do v1)
- Runtime igual v1: foreground via `run.sh`, bind 127.0.0.1, guards Host/Origin/CSP portados

## Estrutura

```
backend-ts/
  src/
    config.ts          # único leitor de env
    db/                # schema.ts (Drizzle), crud.ts, analytics.ts, migrations/
    domain/            # puro: classification, rules engine, pareamento SELF, invariantes
    ingest/            # ofx.ts, csv-nubank.ts, csv-inter.ts, fatura-nubank.ts,
                       # fatura-inter.ts, b3.ts, dedup.ts, service.ts
    server/            # rotas (contrato idêntico ao v1!), sse.ts, hardening
    jobs/              # backup.ts, restore.ts
  tests/
```

## Schema v2 (mudanças sobre o v1)

- Todos os valores → `INTEGER` centavos (`amount_cents`)
- `invoices (id, account_id, ref_month, total_cents, due_date, payment_tx_id)` — fatura importada
- `transactions.invoice_id` (item de fatura) — pagamento com `invoice_id` casado sai dos totais
- `position_snapshots (investment_id, date, balance_cents, source)` — histórico B3
- `rules (id, matcher, match_field, action, value, priority, enabled)`
- `import_batch_id` / staging / undo de 5s: modelo v1 mantido
- `investment_movements` **não migra** (vazia por design no v1)

## Acervo real (inventariado 2026-07-09)

Fonte: `/mnt/dados/Arquivos/[01] - Pesssoal/Financeiro/Relatório das contas/`
(⚠ o `[01]` do caminho é classe de glob — sempre `glob.escape`/quote)

| Fonte | Cobertura | Formato | Observações |
|---|---|---|---|
| Nubank extrato | **nov/2020 → jun/2026, 69 arquivos, ~612 tx** | `Data,Valor,Identificador,Descrição` | Header **idêntico nos 6 anos** — backfill limpo com UUID dedup |
| Inter extrato | 2025 (anual) + jan–jun/2026 | preâmbulo 5 linhas; `Data Lançamento;Descrição;Valor;Saldo` | Coluna **Saldo** (running balance) hoje ignorada → usar como check de consistência no import |
| **Fatura Inter** | **nov/2025 → mai/2026, 7 meses** | `"Data","Lançamento","Categoria","Tipo","Valor"` (BOM, quoted) | **Categoria do banco** (14: RESTAURANTES, DROGARIA…) + `Tipo` com **parcelas** (`Parcela 1/3`…) |
| Fatura Nubank | **NÃO existe no acervo** | — | Gap: começar a exportar CSV da fatura pelo app |
| B3 anual | 2020–2025 (2020/21 **vazios**, sem abas) | xlsx | 2022 = aba **BDR** (NUBR33); 2023 = **Ações** (MGLU3) + Tesouro; 2025 = RF + Tesouro |
| B3 mensal | jan–mai/2026 | xlsx | RF aparece só em abril (churn de CDB); Tesouro sempre |

### Implicações no design (descobertas nos dados)

1. **`Valor Aplicado` (aba Tesouro) = custo direto do relatório** → rendimento total = `líquido − aplicado`, sem depender de fluxo casado. Snapshot ganha `applied_cents`.
2. **Porquinho Inter: cada aporte emite um CDB novo com código próprio** (abril: CDB4266TIEN + CDB426CCDAT, emissões 13/04 e 27/04) e resgates fazem posições sumirem em semanas. Consequências: `match_key` por **código** (não nome — nomes idênticos "CDB - BANCO INTER S/A"); soft-close obrigatório; e a UI precisa de **agrupamento** — cadastro ganha `group` (ex.: "Porquinho") para N CDBs churnando virarem uma linha só, com histórico agregado.
3. **Abas `Posição - Ações` e `Posição - BDR` existem no histórico** e o parser v1 as ignora em silêncio. v2 parseia: `Código de Negociação`, `Quantidade`, `Preço de Fechamento`, `Valor Atualizado`; `type = acao | bdr`; match_key por ticker.
4. **Fatura Inter traz categoria do banco** → seed de mapeamento categoria-banco → categoria-app (rules), e o campo `Tipo` traz parcelamento → transações de fatura ganham `installment_seq/installment_total`; parcela lançada na fatura do mês é despesa daquele mês (regime de caixa do cartão), sem inventar despesa futura.
5. **Linhas de encargo na fatura** (IOF, ENCARGOS ROTATIVO, categoria PAGAMENTOS) precisam de regra própria — são custo financeiro, não consumo de estabelecimento.
6. **`ref_date` parseável do nome do arquivo** nos 3 padrões reais: `NU_..._01MAI2026_31MAI2026`, `Extrato-01-05-2026-a-31-05-2026`, `relatorio-consolidado-mensal-2026-maio` — fallback de campo editável raramente será necessário.
7. **Relatório B3 sem nenhuma aba de posição é real** (2020/2021) — o guard "vazio = no-op" deve distinguir "xlsx válido sem posições" (ok, sem snapshot) de "parse quebrado" (erro).

## Investimentos v2 — estrutura

### Defeitos do v1 que esta estrutura corrige

1. `investments` guarda **só** `current_balance` — o relatório B3 traz quantidade, vencimento, código e indexador, e o parser v1 descarta tudo (chega a parsear `maturity` e não gravar).
2. Full-sync com **prune = DELETE**: título vencido/resgatado some com todo o passado.
3. Sem histórico → "evolução" e rendimento impossíveis de calcular.
4. Snapshot datado pelo momento do import, não pela data de referência do relatório.
5. Pernas de aporte/resgate (`method='transfer'`) não apontam para posição nenhuma — Caixinha derivada por keyword é o sintoma.

### Modelo: posição + snapshots + fluxos ligados

```
investments (cadastro da posição — nunca deletada)
  id            INTEGER PK
  name          TEXT      -- display, editável na UI
  match_key     TEXT UNIQUE -- normalização de (produto, código) p/ casar imports B3 entre meses
  code          TEXT      -- "CDB223KHK…" (Renda Fixa) | NULL
  type          TEXT      -- tesouro | cdb | rdb | lci | acao | bdr | fundo | outro
  bank          TEXT      -- custodiante (nubank | inter | outro)
  indexer       TEXT      -- selic | ipca | prefixado | cdi | NULL (parseado do nome: "Tesouro Selic 2029")
  rate_text     TEXT      -- taxa contratada como veio do relatório ("IPCA + 7,50%")
  maturity_date TEXT      -- ISO, da coluna Vencimento
  group_name    TEXT      -- agrupador visual ("Porquinho") p/ posições que churnam | NULL
  source        TEXT      -- 'b3' | 'ledger' | 'manual'
  opened_at     TEXT
  closed_at     TEXT      -- soft-close: sumiu do relatório = fechada, histórico preservado

position_snapshots (1 linha por posição por data de referência)
  id             INTEGER PK
  investment_id  INTEGER FK
  ref_date       TEXT     -- data de referência DO RELATÓRIO (não do upload)
  quantity       REAL     -- unidades (Tesouro fraciona; não é dinheiro, REAL ok)
  unit_price_cents INTEGER -- NULL se o relatório não der
  applied_cents  INTEGER  -- Valor Aplicado (custo, aba Tesouro) | NULL
  gross_cents    INTEGER  -- valor bruto/CURVA
  net_cents      INTEGER  -- valor líquido (o "saldo" oficial da posição)
  source         TEXT     -- 'b3' | 'derived' | 'manual'
  import_batch_id TEXT
  UNIQUE (investment_id, ref_date, source)

transactions.investment_id  -- FK nullable: perna transfer ligada à posição via rules
```

**Derivados, nunca colunas:** `current_balance` = `net_cents` do snapshot mais recente da posição aberta. Patrimônio de investimento = Σ desses. `investment_net`/`free_balance` continuam vindo **só** de `transactions` (invariante v1 intacta).

### Import B3 v2 (substitui o full-sync destrutivo)

1. Parse igual ao v1 **+** quantidade, código, vencimento, indexador/taxa extraídos do nome do produto.
2. `ref_date` do relatório: parseada do nome do arquivo/planilha; fallback = perguntar no preview do import (editável), nunca "agora".
3. Upsert por `match_key`; posição nova → cria cadastro. Grava snapshot `(investment_id, ref_date)` — re-import do mesmo mês sobrescreve o próprio snapshot (idempotente), nunca outro.
4. Posição ausente do relatório → `closed_at = ref_date` (**soft-close**, não DELETE). Reaparece? Reabre (`closed_at = NULL`).
5. Relatório vazio = erro de parse = no-op (guard v1 mantido).

### Fluxos (aportes/resgates) ligados à posição

- Perna `method='transfer'` ganha `investment_id` via **rules** no import (seed: `caixinha`→Caixinha, `porquinho|cdb porq`→Porquinho, `tesouro`→posição Tesouro se única).
- Transferência genérica pra corretora ("Transferência NuInvest") que não identifica o título: `investment_id = NULL` — continua contando em `investment_net` (invariante), aparece agrupada como "não alocado" na tela.
- UI permite atribuir/corrigir a posição de uma perna (PATCH), e a atribuição vira rule sugerida.

### Rendimento (agora possível)

```
rendimento(posição, t1→t2) = net(t2) − net(t1) − aportes(t1..t2] + resgates(t1..t2]
```

- Aportes/resgates = pernas com `investment_id` da posição na janela.
- Sem fluxo casado na janela: se `quantity` não mudou entre snapshots, Δvalor é rendimento puro (a quantidade guardada existe pra isso); se mudou, período marcado "com movimentação" em vez de inventar número.
- Import mensal do relatório B3 ⇒ série mensal de rendimento por posição, de graça.

### Caixinha Nubank (posição `source='ledger'`)

- Continua derivada (RDB fora da B3), mas vira **cadastro explícito** com `source='ledger'` — sai do regime de keyword mágica.
- Saldo corrente = Σ pernas com `investment_id` dela (aplicações − resgates), como no v1.
- A cada import de extrato, grava snapshot `source='derived'` na data da última transação → histórico.
- Limitação honesta mantida: derivação ignora rendimento do RDB (principal apenas). Correção = snapshot `source='manual'` pela UI (valor visto no app); snapshot manual mais recente vence o derivado no display.
- Porquinho Inter segue **só** B3 (CDB custodiado — derivar contaria em dobro; regra v1 preservada).

### O que a tela Investimentos ganha

- Evolução real por posição e agregada (snapshots, não interpolação)
- Rendimento mensal/12m por posição; % no período com aporte isolado do ganho
- Alocação por tipo **e por indexador** (donut atual só tem tipo)
- Linha do tempo de vencimentos (CDB/Tesouro) — `maturity_date` finalmente armazenado
- Posições fechadas consultáveis (histórico completo, soft-close)

### Migração v1 → v2 (investimentos)

- Cada linha de `investments` v1 → cadastro v2 + 1 snapshot seed (`ref_date` = data da migração, `source='manual'`, `net_cents = round(current_balance*100)`).
- `investment_movements` (vazia) descartada.
- Pernas `transfer` históricas: rules rodam retroativamente para preencher `investment_id` (Caixinha/Porquinho casam por keyword conhecida); o resto fica "não alocado" — corrigível na UI.

## Invariantes que NÃO mudam (portar com testes)

- Consumption-expense rule (helper único de cláusula)
- `is_revenue` explícito, `counterpart='SELF'` fora de despesa/receita
- Patrimônio = saldo corrente; investimento entra via posição
- B3 full-sync com prune protegido (relatório vazio = no-op)
- Import reversível em lote; backup tri-state atômico

## Migração

Script one-shot: lê o SQLite v1 → escreve schema v2 (float → centavos com arredondamento verificado; soma total antes = soma total depois, por conta e por mês). Ids e batches preservados. DB v1 fica intocado como fallback.

## Fases

> **Status 2026-07-09:** não existia DB v1 com dados reais (sem `.env`, sem `data/`, sem
> backups) — a "migração" virou **backfill direto do acervo**, executado e verificado:
> `backend-ts/src/jobs/backfill.ts` → `data/brokershark-v2.db` (901 tx, 48 snapshots,
> 7 faturas 100% reconciliadas por valor exato, 19 pares SELF, saldo Inter batendo
> centavo a centavo com o extrato do banco). Fases 1–3 abaixo cobertas pelo backfill;
> falta o servidor (fase 5) e o import incremental via web.
> Descoberta de dados: a fatura Inter contém o pagamento da fatura ANTERIOR como
> linha de crédito ("PAGAMENTO ON LINE") — é espelho da liquidação, nunca item; e o
> pagamento real antecede o mês-rótulo da fatura em ~1 mês (casar por VALOR EXATO,
> não por mês). Pagamento parcial (rotativo/débito automático parcial) dentro da
> cobertura importada = liquidação parcial, senão dobraria o consumo já itemizado.

1. Scaffold TS + schema v2 + script de migração (gate: golden totals batem com o v1)
2. Parser OFX (extrato Nu + Inter) + dedup FITID; CSV legado como backfill
3. Parser fatura CSV (Nu + Inter) + reconciliação pagamento↔fatura
4. Rules engine + pareamento SELF (aposenta OWNER_SELF_KEYWORDS)
5. Port dos endpoints de analytics — contrato idêntico, frontend intacto
6. B3 snapshots + port de backup/restore → aposentar backend Python
