/**
 * @file positions.ts
 * @brief Série mensal do total da carteira por carry-forward de snapshots esparsos.
 *
 * positions.ts — série mensal da carteira (puro, sem DB/IO).
 *
 * Snapshots são esparsos (relatório B3 pula meses); a posição de um investimento
 * vale até o próximo snapshot — carry-forward. Após o soft-close (closed_at),
 * a posição sai da soma (carregá-la inflaria a carteira com um ativo que já foi).
 */

/** @brief Snapshot de um investimento num mês, com o líquido em centavos inteiros. */
export type MonthlySnap = { investment_id: number; ym: string; net_cents: number };

/**
 * @brief Avançar um mês de referência, virando o ano em dezembro.
 * @param ym mês de referência "YYYY-MM"
 * @return o "YYYY-MM" seguinte
 */
function nextYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * @brief Montar a série mensal do total da carteira, com carry-forward e soft-close.
 *
 * @param snaps último snapshot de cada (investimento, mês), ordenado por ym;
 *              `net_cents` em centavos inteiros
 * @param closedYm investment_id → 'YYYY-MM' do soft-close (posição zera após esse mês)
 * @returns total da carteira por mês, contínuo do primeiro ao último mês com snapshot;
 *          `total_cents` em centavos inteiros. Lista vazia se não houver snapshot.
 */
export function monthlyPortfolioSeries(
  snaps: MonthlySnap[],
  closedYm: Map<number, string>,
): { ym: string; total_cents: number }[] {
  if (!snaps.length) return [];

  const byYm = new Map<string, MonthlySnap[]>();
  for (const s of snaps) {
    const list = byYm.get(s.ym) ?? [];
    list.push(s);
    byYm.set(s.ym, list);
  }

  const yms = [...byYm.keys()].sort();
  const last = new Map<number, number>();
  const out: { ym: string; total_cents: number }[] = [];

  for (let ym = yms[0]; ym <= yms[yms.length - 1]; ym = nextYm(ym)) {
    for (const s of byYm.get(ym) ?? []) last.set(s.investment_id, s.net_cents);
    let total = 0;
    for (const [id, cents] of last) {
      const closed = closedYm.get(id);
      if (closed && ym > closed) continue;
      total += cents;
    }
    out.push({ ym, total_cents: total });
  }
  return out;
}
