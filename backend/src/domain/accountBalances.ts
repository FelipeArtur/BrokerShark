// Saldo de conta corrente mês a mês, somado entre contas — com corte no
// encerramento.
//
// Somar tudo num acumulado único (como era antes) não sobrevive a uma conta
// encerrada: o saldo que ela carregava fica embutido no acumulado pra sempre,
// e a linha de patrimônio ganha um degrau que não existe no mundo. Por isso o
// saldo corre POR CONTA e só depois é somado.

export type AccountSeed = {
  id: string;
  initialCents: number;
  /** Mês do encerramento ('YYYY-MM'), ou null se a conta está aberta. */
  closedYm: string | null;
};

export type MonthlyDelta = { account_id: string; ym: string; deltaCents: number };

function nextYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * @brief   Série mensal do saldo somado das contas correntes.
 * @warning A conta contribui 0 a partir do mês do `closedYm`, INCLUSIVE: a série plota
 *          saldo de fim de mês, e conta encerrada não tem nenhum.
 * @note    Diferente de `monthlyPortfolioSeries`, que corta em `ym > closed` — lá o
 *          snapshot do mês do fechamento é medição real.
 */
export function monthlyCheckingSeries(
  accounts: AccountSeed[],
  deltas: MonthlyDelta[],
): { ym: string; total_cents: number }[] {
  if (!deltas.length) return [];

  const byYm = new Map<string, MonthlyDelta[]>();
  for (const d of deltas) {
    const list = byYm.get(d.ym) ?? [];
    list.push(d);
    byYm.set(d.ym, list);
  }

  const yms = [...byYm.keys()].sort();
  const running = new Map<string, number>(accounts.map(a => [a.id, a.initialCents]));
  const closed = new Map<string, string | null>(accounts.map(a => [a.id, a.closedYm]));
  const out: { ym: string; total_cents: number }[] = [];

  for (let ym = yms[0]; ym <= yms[yms.length - 1]; ym = nextYm(ym)) {
    //> O delta entra mesmo com a conta fechada; o corte é na leitura.
    for (const d of byYm.get(ym) ?? []) {
      running.set(d.account_id, (running.get(d.account_id) ?? 0) + d.deltaCents);
    }
    let total = 0;
    for (const [id, cents] of running) {
      const c = closed.get(id);
      if (c && ym >= c) continue;
      total += cents;
    }
    out.push({ ym, total_cents: total });
  }
  return out;
}
