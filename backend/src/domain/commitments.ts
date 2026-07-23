/**
 * @file commitments.ts
 * @brief Projeção PURA de compromissos futuros — parcelas restantes viram meses
 *        virtuais. Sem DB/IO. Nunca vira row no ledger (só visão de futuro).
 */

/** Item parcelado ancorado no mês da fatura aberta onde ele aparece. */
export type InstallmentRow = {
  description: string;
  refMonth: string;        // 'YYYY-MM' da fatura aberta onde a parcela atual está
  amountCents: number;     // valor de UMA parcela, em centavos
  installmentSeq: number;  // parcela atual (ex.: 2 de 2/5)
  installmentTotal: number;
};

/** Compromisso agregado de um mês futuro. */
export type ProjectedMonth = { month: string; amountCents: number; count: number };

/**
 * @brief Somar meses a um 'YYYY-MM' (aritmética pura, vira o ano sozinho).
 * @param refMonth mês de referência 'YYYY-MM'
 * @param k quantos meses somar (0 = o próprio mês)
 * @return novo 'YYYY-MM'
 */
export function addMonths(refMonth: string, k: number): string {
  const y = Number(refMonth.slice(0, 4));
  const m = Number(refMonth.slice(5, 7));
  const total = y * 12 + (m - 1) + k;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/**
 * @brief Projetar as parcelas restantes de cada item em meses futuros.
 *
 * Cada item da fatura ABERTA carrega sua parcela atual (`installmentSeq`). As
 * parcelas `seq+1..total` ainda não estão em fatura nenhuma — são projetadas
 * VIRTUAIS, uma por mês a partir de `refMonth+1`. Nada é inserido no ledger.
 *
 * @param rows itens parcelados da(s) fatura(s) aberta(s) com `seq < total`
 * @return meses com {amountCents somado, count}, ordenados crescente
 */
export function projectInstallments(rows: InstallmentRow[]): ProjectedMonth[] {
  const byMonth = new Map<string, { amountCents: number; count: number }>();
  for (const r of rows) {
    const remaining = r.installmentTotal - r.installmentSeq;
    for (let j = 1; j <= remaining; j++) {
      const month = addMonths(r.refMonth, j);
      const cur = byMonth.get(month) ?? { amountCents: 0, count: 0 };
      cur.amountCents += r.amountCents;
      cur.count += 1;
      byMonth.set(month, cur);
    }
  }
  return [...byMonth.entries()]
    .map(([month, v]) => ({ month, amountCents: v.amountCents, count: v.count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
