# Recorrências derivadas — design

**Data:** 2026-07-25
**Escopo:** detectar, a partir do ledger, gastos e receitas que se repetem mês a mês e mostrá-los na visão de futuro. Nada é declarado pelo usuário; nada vira linha no ledger.

## Por que

O `/api/commitments` de hoje só enxerga compromisso **duro**: fatura aberta (`payment_tx_id IS NULL`) e parcelas projetadas. No ledger real isso é quase nada — as 7 faturas estão pagas e sem `due_date`, então a série vive só de parcelas.

Medição sobre o ledger vivo (443 linhas de consumo, 255 de receita, 137 itens de fatura, 2020-11..2026-06) mostra que a recorrência existe, mas só aparece quando se olha a **corrida recente** de meses por comerciante em vez do histórico inteiro:

| sentido | comerciante | valor/mês | meses | cv | última |
|---|---|---|---|---|---|
| saída | `joao da silva …` | R$ 1.711,19 | 4 consecutivos | 0,23 | 2026-06 |
| entrada | `transferência recebida - servico n…` | R$ 3.850,00 | 9 consecutivos | 0,26 | 2026-04 |
| saída | `subway` | R$ 44,27 | 4 (gaps 1–2) | 0,32 | 2026-04 |

Agregar o histórico completo enterra essas corridas sob anos de movimento esporádico com a mesma pessoa — foi o que fez a primeira leitura concluir, errado, que recorrência de saída não existia. **A janela recente é o algoritmo.**

## Decisões

1. **Motor bidirecional.** Um detector só, agnóstico de sentido, roda sobre receita e despesa. Hoje o sinal forte está na entrada; conforme o histórico de fatura itemizada cresce, o lado despesa preenche sozinho sem código novo.
2. **Display-only.** Recorrência não entra no herói "Em Caixa" nem em `available_net`. O herói continua sendo dinheiro que existe agora menos o que vence no mês. Somar entrada prevista faria um salário atrasado virar estouro silencioso.
3. **Comprometido ≠ previsto.** O campo `series` de `/api/commitments` não muda: continua só compromisso duro. Recorrência entra como campo irmão `recurring`, renderizado numa camada visual distinta.
4. **Sentidos independentes.** Saída e entrada do mesmo comerciante são recorrências separadas, cada uma com sua própria corrida. Sem compensar líquido — compensar esconderia o fluxo bruto e poderia zerar uma saída viva contra uma entrada morta.
5. **Derivado, nunca declarado.** Coerente com Caixinha e Comprometido: nenhuma linha nova no ledger, nenhuma tabela nova, nenhum campo de entrada na UI.

## Domínio — `backend/src/domain/recurrence.ts`

Puro: sem DB, sem IO, sem relógio (`asOfMonth` é injetado).

```ts
type RecurrenceInput = { date: string; amountCents: number; flow: "expense" | "income"; merchant: string };

type Recurrence = {
  merchant: string;
  flow: "expense" | "income";
  monthlyCents: number;    // mediana da corrida recente
  cadenceMonths: number;   // mediana dos gaps da corrida
  occurrences: number;
  cv: number;
  firstMonth: string;
  lastMonth: string;
  staleMonths: number;     // meses entre lastMonth e asOfMonth
};

detectRecurrences(rows: RecurrenceInput[], asOfMonth: string): Recurrence[]
projectRecurrences(recs: Recurrence[], asOfMonth: string, horizon: number): ProjectedMonth[]
```

**Algoritmo do `detect`:**

1. Agrupa por `flow | merchant` (o chamador já normalizou via `normalizeMerchant`).
2. Dobra cada grupo para **um valor por mês** — a soma do mês. Duas cobranças no mesmo mês contam como uma recorrência de valor somado, não como cadência quinzenal.
3. Recorta a **corrida recente**: caminha do mês mais novo para trás enquanto o gap para o mês anterior for ≤ `maxGapMonths`. Meses antes da primeira quebra são descartados.
4. Aceita a corrida se: `length ≥ minMonths` **e** `staleMonths ≤ maxStaleMonths` **e** `cv ≤ maxCv`.
5. Emite `monthlyCents` = mediana da corrida (robusta a um mês fora da curva) e `cadenceMonths` = mediana dos gaps.

**Limiares** — exportados como `RECURRENCE_THRESHOLDS`, fixados por teste:

```
minMonths: 3   maxGapMonths: 2   maxCv: 0.35   maxStaleMonths: 2
```

Calibrados na medição: limiar estrito (`min=4, cv≤0.15, gap≤1`) devolve **zero** hits no ledger real; estes devolvem exatamente as três linhas da tabela acima e nenhum falso-positivo visível.

**`project`:** cada recorrência se repete a cada `cadenceMonths` a partir de `asOfMonth + 1` até o horizonte. Nada é projetado no mês corrente — o mês corrente já é medido pelo ledger, e projetar por cima contaria em dobro.

## Rota — `GET /api/commitments`

Ganha um campo; não perde nenhum.

```jsonc
{
  "open_invoices": [...],   // inalterado
  "series": [...],          // inalterado — compromisso DURO
  "recurring": {
    "items": [ /* Recurrence[], saída e entrada */ ],
    "expense_monthly": 175546,
    "income_monthly": 385000,
    "series": [ { "month": "2026-08", "label": "08/2026", "expense": 1755.46, "income": 3850.00 } ]
  }
}
```

Consulta limitada aos **últimos 18 meses** — nada mais velho pode passar no filtro de `staleMonths`, então varrer o histórico inteiro é trabalho jogado fora. Filtros SQL reusam as regras canônicas: consumo-despesa (`flow='expense' AND method != 'transfer' AND is_settlement=0 AND is_third_party=0 AND dest_account_id IS NULL`) e receita real (`flow='income' AND is_revenue=1 AND is_third_party=0`).

## Frontend — `ForwardWidget`

- Barra **sólida** = comprometido duro (fatura + parcelas), como hoje.
- Barra **dithered** empilhada por cima = saída recorrente prevista. O dither já é o vocabulário de "não é certo" no sistema visual.
- Rodapé em `--pos` = entrada recorrente prevista. Verde é receita e só receita.
- Clique no widget → `Overlay` listando cada recorrência detectada: comerciante, valor mensal, cadência, nº de ocorrências, mês da última.
- Widget vazio (nenhuma recorrência e nenhum compromisso) continua colapsando via `.widget-row--soft`.

## Testes

Domínio (`recurrence.test.ts`), todos determinísticos com `asOfMonth` fixo:

- corrida recente recortada corretamente quando há histórico antigo com buraco grande
- gap de 2 meses tolerado; gap de 3 quebra a corrida
- `cv` acima do limiar rejeita
- `staleMonths` acima do limiar rejeita (recorrência morta não projeta)
- menos de `minMonths` rejeita
- duas cobranças no mesmo mês viram um valor somado, não duas ocorrências
- mediana ignora um mês fora da curva
- entrada e saída do mesmo comerciante saem como itens separados
- entrada vazia → lista vazia
- `project` respeita cadência > 1 e não emite no mês corrente

## Fora de escopo

Regra editável pelo usuário, silenciar uma recorrência detectada, alerta de recorrência que sumiu, detecção de cadência semanal ou anual. Tudo isso só faz sentido depois que o detector provar que acerta nos dados reais.
