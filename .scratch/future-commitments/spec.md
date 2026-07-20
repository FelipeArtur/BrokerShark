<!-- /autoplan restore point: /home/felipe/.gstack/projects/FelipeArtur-BrokerShark/main-autoplan-restore-20260720-014606.md -->
# Visão de futuro — compromissos derivados

> Rescoped 2026-07-20 após CEO review (premissa-chave falsa: fatura aberta não
> tinha caminho de ingestão). Agora DOIS projetos sequenciais. Grilling original
> em `main-autoplan-restore-*.md`.

## Por que dois projetos

Committed ≈ **fatura de cartão aberta**. Hoje não existe forma de trazer uma
fatura aberta pro DB: `import.ts` só aceita extratos + B3; `faturas.ts` (backfill)
só ingere faturas históricas **já pagas**. DB vivo = **0 faturas abertas**. O maior
número do "Comprometido" não tem produtor. Logo: construir a ingestão primeiro,
o widget depois (trivial em cima).

Dado real medido: projeção de parcelas = **5 parcelas, R$337,21** no total. Sem a
fatura aberta, "Comprometido" seria ~R$0 na maioria dos meses. P1 é o que dá vida.

---

# PROJETO 1 (pré-requisito) — Import de fatura aberta pela UI

O trabalho de verdade. Sem ele, P2 mostra zero.

## Ingestão — ✅ P1 COMPLETO (backend + frontend + e2e)

> Backend: migration `0001` (due_date) · `detectAccount` inter-cc · `db/faturaImport.ts`
> (`insertOpenFatura` upsert+dedup+estorno [H2/H3] · `pruneEmptyOpenInvoices` [H4]) ·
> endpoints `POST /api/import/fatura[/preview]` · `deleteBatch` limpa órfã.
> Frontend: `import.js` reconhece fatura (3º tipo), card com itens + campo due_date
> dd/mm/aaaa; `api.js` client fns. 113 testes verdes + teste e2e C1+H2 (consumo 3→2).
> Smoke real: detect→preview→confirm via multipart OK (fatura aberta, due_date, itens).
> **P1 FECHADO.** Próximo: P2 (KPI Comprometido + widget forward).

> Eng review: NÃO é "um ramo que chama o parser". É um **import kind paralelo** —
> staging/confirm hoje são moldados em `TxRecord` (`import.ts:34`), e `FaturaItem`
> (`interFatura.ts:12`) carrega `bankCategory`/`installmentSeq,Total`/amount **assinado**
> que o `TxRecord` não tem. Preview/confirm próprios + criação de invoice.

- **Novo kind** em `import.ts` — `detectAccount` ganha ramo `inter-cc` (sniff: tem
  `valor`+`categoria`+`tipo`, sem `identificador`); preview/confirm próprios (não
  threadar `if inter-cc` nos codepaths de extrato). Parser reusa `ingest/interFatura.ts`.
- **Fatura ABERTA**: cria `invoice` com `payment_tx_id IS NULL`. Backfill nunca
  produz isso (só faturas pagas). Estado novo no DB vivo.
- **Itens**: entram como `credit` no `inter-cc` com `invoice_id`, `installment_seq/total`,
  `bank_category`, `import_batch_id`. Insert de fatura ≠ insert de extrato (colunas novas).
- **Estornos (M8)**: item negativo → `flow='income', method='credit', is_revenue=0`
  (mapa de `faturas.ts:50`). Preservar o sinal pela staging senão vira verde/receita errado.

## C1 (CRÍTICO) — Reconciliação no caminho incremental — ✅ IMPLEMENTADO

> Feito: `db/reconcile.ts` (`reconcileInvoicePayment` + `reconcileOpenInvoices`) +
> `db/reconcile.test.ts` (6 testes, inclui anti-double-count). `faturas.ts` refatorado
> pro helper (DRY). Wired em `import.ts` confirm (`batch.accountId==='inter-db'`,
> no-op até H2). 99 testes verdes. Falta só H2 pra produzir a fatura aberta.

> Sem isso, o pagamento da fatura conta DUAS vezes. Reconciliação hoje só existe
> em `jobs/backfill/faturas.ts:56` — roda só no backfill. O confirm da UI
> (`import.ts:354`) só faz rederiveCaixinha + pairSelfTransfers. Nenhuma reconciliação.

- Extrair o matcher de `faturas.ts:59-72` (valor exato, janela −70/+35d, `is_settlement=1`
  + `invoice_id` + `method='credit'` + back-fill `payment_tx_id`) pra um helper
  compartilhado em `domain/` (hoje lê arquivo do disco — não reusável). Backfill E
  UI chamam o mesmo helper (DRY).
- No confirm da UI, quando o lote é `inter-db`: rodar o matcher contra invoices abertas
  (`payment_tx_id IS NULL`). Assim, quando o extrato com o pagamento entra, a perna casa,
  vira liquidação, e `payment_tx_id` deixa de ser NULL.

## H3 — Dedup + upsert de invoice

- **Invoice**: `UNIQUE(account_id, ref_month)` (`schema.sql:41`) → reimportar fatura
  aberta (que CRESCE semana a semana) deve **UPSERT**, não INSERT (backfill dá INSERT cru).
- **Itens**: dedup **por contagem** (padrão já provado em `import.ts:226`), NÃO booleano —
  fatura não tem UUID e merchant/valor/data repetem legítimo. Chave:
  `(date, description, amount_assinado, installment_seq, installment_total)` escopada ao `invoice_id`.

## H4 — Revert limpa a invoice

- `deleteBatch` (`import.ts:380`) só apaga transactions; não conhece `invoices`.
  Reverter import de fatura aberta deixaria invoice órfã (fantasma que P2 lê como
  compromisso vivo). Fix: na mesma transação, apagar a invoice aberta que ficou sem
  itens (`payment_tx_id IS NULL` e zero itens).

## Vencimento

- Coluna nova `invoices.due_date` (**migration** `0001_*.sql` — primeira do repo).
  `ALTER TABLE invoices ADD COLUMN due_date TEXT;` nullable, sem BEGIN/COMMIT (runner
  envelopa). **M6:** NÃO adicionar `due_date` ao DDL de `invoices` no `schema.sql` —
  baseline congela; senão DB novo dá "duplicate column" e quebra o boot. Validar no
  confirm com `isIsoDate` (`validate.ts:21`) — writes 100% validados (L10).
- Preenchida **no import da fatura aberta** (campo no confirm da UI). Histórico pago
  fica NULL. **UI-only — morre no `--force` (ver M5), não é durável.**
- "Vencimento muda por mês" resolvido: é por-fatura, digitado a cada import.

## Guarda / rebuild (M5 — corrigido)

> A guarda NÃO preserva nada — só faz o backfill **abortar** (`guard.ts:24`,
> `backfill.ts:46`). A afirmação original "due_date sobrevive rebuild" é FALSA.

- Sem `--force`: backfill aborta se há dado da UI (`import_batch_id`). Fatura aberta entra
  nesse gatilho (verificar que a invoice órfã não escapa — ver H4).
- Com `--force`: `rmSync` do DB (`backfill.ts:59`) + rebuild dos exports históricos.
  Faturas históricas nascem `due_date NULL` (backfill não tem fonte de vencimento).
  **Logo: fatura aberta + due_date são UI-only e MORREM no `--force`.** Documentar
  honesto; reimportar a fatura aberta depois de todo rebuild forçado.

## M7 — Pagamento parcial (rotativo) — DECIDIDO: exato-total só

Rotativo/pagamento parcial nunca casa o valor-exato → `payment_tx_id` fica NULL e o
pagamento double-conta (mesmo mecanismo do C1). Backfill trata como "liquidação parcial"
(`faturas.ts:89`). **Decisão (gate 2026-07-20):** P1 reconcilia **só exato-total**
(pagamento em dia cheio) — casa com o comportamento real (7/7 faturas pagas exato).
**Rotativo documentado como não-suportado em P1.** Risco aceito: se um mês revolver,
aquele mês double-conta em silêncio. Portar a branch parcial fica pra fase futura.

## Testes (Section 3 — gap)

- Teste de integração load-bearing: importar fatura aberta pela UI → importar extrato
  com o pagamento → asserir que consumo NÃO dobra e `payment_tx_id` deixa de ser NULL.
  Espelha os checks de invariante do backfill (`verify.ts`).
- Reimport da mesma fatura aberta (upsert, sem duplicar itens).
- Revert do lote → invoice não fica órfã.
- Estorno na fatura aberta → não vira receita verde.

## Contrato de API (P1)

- `import.ts`: `detect`/`preview`/confirm passam a aceitar fatura `inter-cc`.
- Sem endpoint novo em P1 — reusa `/api/import/*`.

---

# PROJETO 2 (em cima de P1) — KPI "Comprometido" + visão de futuro

Trivial depois que P1 existe. Só constrói quando P1 estiver mergeado.

## Comprometido (derivado)

- **Fatura aberta** = `invoices` com `payment_tx_id IS NULL` (produzida por P1).
- **Parcelas futuras** — projetadas VIRTUAIS (`installment_total − installment_seq`
  × valor), nunca inseridas. Fatura real toma o lugar depois. Recalcula no rebuild.

## Herói "Em Caixa (Disponível Agora)" — híbrido

> Nota: label real no front é "Em Caixa (Disponível Agora)" (`dashboard.js:125`),
> não "Disponível pra gastar".

- Abate só o que **vence no mês-calendário real** (via `due_date`, hoje real).
- Comprometido futuro fica na visão, fora do herói.
- Livre negativo = **vermelho honesto** (cor de alerta, não verde — verde é só receita).
- `getAvailable` hoje retorna `available === checking_total`; adicionar campo
  `committed_this_month` + `available_net` é **aditivo, não quebra o bruto**.

## Apresentação

- KPI **"Comprometido"** na faixa; herói mostra líquido.
- Widget forward reusando `pixel-bars.js` — precisa **variante "projetada"** (hoje
  `slot{month,data,prev}`, orientada a fato). Barras fantasma, dinâmico teto 12 meses,
  display-only, clique → overlay cronograma.

## Contrato de API (P2)

- Novo `GET /api/commitments` — saídas futuras (fatura aberta + parcelas projetadas).
- `GET /api/available` ganha `committed_this_month` + `available_net`.

---

## Alternativas registradas (CEO review, não escolhidas)

- **Recorrências derivadas** (PIX/TED mensal ~constante, mesmo counterpart = aluguel/
  assinatura) — mesma pureza "sem digitar", surfa dinheiro real (centenas/mês) vs R$337.
  Não escolhida agora; forte candidata a fase futura.
- **CDB maturity como evento forward** — maior evento de caixa datado real do usuário;
  hoje fica no widget de investimentos. Reconsiderar.

## Invariantes preservadas

- Ledger = só fato importado (projeção P2 é virtual, nunca row).
- SELF / liquidação / consumo-despesa intactas.
- Verde = só receita.

---

## GSTACK REVIEW REPORT

**Pipeline:** /autoplan · CEO → Design → Eng · dual voices [subagent-only, codex unavailable] · 2026-07-20

### Consensus (both voices agreed)
- CEO: premise false (open fatura no ingestion path), feature ~R$337/R$0 on real data → **rescoped to P1+P2**.
- Eng: P1 under-scoped; **C1 critical double-count**, H2/H3/H4 high, M5 false invariant.

### Decision Audit Trail
| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | CEO | Rescope into P1 (ingestion) + P2 (widget) | User Challenge | — | User chose "fix ingestion first" at premise gate |
| 2 | Eng | Extract reconcile into shared domain helper (C1) | Mechanical | DRY | One matcher, backfill+UI share it |
| 3 | Eng | Fatura = parallel import kind, not a branch (H2) | Mechanical | Explicit | TxRecord can't carry invoice/installment |
| 4 | Eng | Invoice upsert + count-based item dedup (H3) | Mechanical | Completeness | UNIQUE collision + no UUID |
| 5 | Eng | deleteBatch cleans orphan invoice (H4) | Mechanical | Completeness | Phantom commitment on revert |
| 6 | Eng | Document due_date/open-fatura ephemeral on --force (M5) | Mechanical | Explicit | Guard aborts, doesn't preserve |
| 7 | Eng | Migration owns due_date; schema.sql frozen (M6) | Mechanical | Explicit | Baseline discipline |
| 8 | Eng | Rotativo/partial-payment handling | **TASTE** | — | Surface at gate |

### Open taste decision
- **M7:** partial-payment (rotativo) reconciliation in P1, or exact-total-only + documented limitation.
