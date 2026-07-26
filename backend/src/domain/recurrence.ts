// Detecção de recorrência DERIVADA do ledger — nada é declarado, nada vira row.
//
// A ideia load-bearing é a CORRIDA RECENTE: um comerciante pode ter anos de
// movimento esporádico e, no fim, uma sequência viva de meses. Agregar o
// histórico inteiro enterra essa sequência (o cv explode e a recorrência some).
// Por isso o detector caminha do mês mais novo para trás e só considera os
// meses até a primeira quebra de cadência.
//
// Módulo PURO: sem DB, sem IO, sem relógio — `asOfMonth` é sempre injetado.

export type RecurrenceFlow = "expense" | "income";

export type RecurrenceInput = {
  date: string; // 'YYYY-MM-DD'
  amountCents: number;
  flow: RecurrenceFlow;
  merchant: string; // núcleo já normalizado pelo chamador (normalizeMerchant)
};

export type Recurrence = {
  merchant: string;
  flow: RecurrenceFlow;
  monthlyCents: number; // mediana da corrida — robusta a um mês fora da curva
  cadenceMonths: number; // mediana dos gaps da corrida
  occurrences: number; // meses na corrida (não linhas)
  cv: number; // coeficiente de variação da corrida
  firstMonth: string;
  lastMonth: string;
  staleMonths: number; // distância entre lastMonth e asOfMonth
};

export type RecurringMonth = { month: string; expenseCents: number; incomeCents: number };

// Calibrados contra o ledger real (spec datada de 2026-07-25 no vault de docs).
// Limiares mais estritos devolvem ZERO recorrências nos dados de verdade.
export const RECURRENCE_THRESHOLDS = {
  minMonths: 3,
  maxGapMonths: 2,
  maxCv: 0.35,
  maxStaleMonths: 2,
} as const;

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

function monthFromIndex(idx: number): string {
  const y = Math.floor((idx - 1) / 12);
  const m = idx - y * 12;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return Infinity;
  const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

export function detectRecurrences(rows: RecurrenceInput[], asOfMonth: string): Recurrence[] {
  const asOf = monthIndex(asOfMonth);
  const { minMonths, maxGapMonths, maxCv, maxStaleMonths } = RECURRENCE_THRESHOLDS;

  // flow|merchant → mês → total do mês. Duas cobranças no mesmo mês são UMA
  // ocorrência de valor somado; senão uma assinatura cobrada duas vezes viraria
  // cadência quinzenal fantasma.
  const groups = new Map<string, { merchant: string; flow: RecurrenceFlow; byMonth: Map<string, number> }>();
  for (const r of rows) {
    const merchant = String(r.merchant || "").trim();
    if (!merchant) continue;
    const key = `${r.flow}|${merchant}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { merchant, flow: r.flow, byMonth: new Map() }));
    const ym = String(r.date).slice(0, 7);
    g.byMonth.set(ym, (g.byMonth.get(ym) ?? 0) + r.amountCents);
  }

  const out: Recurrence[] = [];
  for (const g of groups.values()) {
    const months = [...g.byMonth.keys()].sort();
    if (months.length < minMonths) continue;

    // Recorta a corrida recente: do mês mais novo para trás, enquanto a cadência aguentar.
    let start = months.length - 1;
    while (start > 0 && monthIndex(months[start]) - monthIndex(months[start - 1]) <= maxGapMonths) start--;
    const run = months.slice(start);
    if (run.length < minMonths) continue;

    const lastMonth = run[run.length - 1];
    const staleMonths = asOf - monthIndex(lastMonth);
    if (staleMonths > maxStaleMonths) continue;

    const values = run.map(m => g.byMonth.get(m)!);
    const cv = coefficientOfVariation(values);
    if (!(cv <= maxCv)) continue;

    const monthlyCents = Math.round(median([...values].sort((a, b) => a - b)));
    if (monthlyCents <= 0) continue;

    const gaps: number[] = [];
    for (let i = 1; i < run.length; i++) gaps.push(monthIndex(run[i]) - monthIndex(run[i - 1]));
    const cadenceMonths = Math.max(1, Math.round(median([...gaps].sort((a, b) => a - b))));

    out.push({
      merchant: g.merchant,
      flow: g.flow,
      monthlyCents,
      cadenceMonths,
      occurrences: run.length,
      cv,
      firstMonth: run[0],
      lastMonth,
      staleMonths,
    });
  }

  return out.sort((a, b) => b.monthlyCents - a.monthlyCents || a.merchant.localeCompare(b.merchant));
}

// Projeta na janela [fromMonth, fromMonth + horizon - 1].
//
// Cada recorrência é ancorada no SEU último mês observado, não no mês corrente.
// Isso importa: um mês já observado nunca recebe projeção (senão o gasto real e
// o previsto contariam em dobro), mas um mês ainda não importado recebe — o
// ledger costuma estar algumas semanas atrás do calendário, e ancorar no mês
// corrente deixaria esse intervalo cego justamente onde a previsão serve.
export function projectRecurrences(recs: Recurrence[], fromMonth: string, horizon: number): RecurringMonth[] {
  const windowStart = monthIndex(fromMonth);
  const windowEnd = windowStart + horizon - 1;
  const byMonth = new Map<string, { expenseCents: number; incomeCents: number }>();

  for (const r of recs) {
    const anchor = monthIndex(r.lastMonth);
    for (let idx = anchor + r.cadenceMonths; idx <= windowEnd; idx += r.cadenceMonths) {
      if (idx < windowStart) continue;
      const month = monthFromIndex(idx);
      let cur = byMonth.get(month);
      if (!cur) byMonth.set(month, (cur = { expenseCents: 0, incomeCents: 0 }));
      if (r.flow === "expense") cur.expenseCents += r.monthlyCents;
      else cur.incomeCents += r.monthlyCents;
    }
  }

  return [...byMonth.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
