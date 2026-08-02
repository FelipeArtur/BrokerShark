import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../domain/merchant.ts";

/**
 * @file    O que ainda vai SAIR da conta corrente neste mês-calendário.
 * @details Fonte única: o herói (`/api/available`) e o card (`/api/commitments`) leem
 *          daqui — a mesma lista, o mesmo total. Cada um com a sua consulta era o
 *          jeito garantido de o número grande e a lista que o explica divergirem.
 */

export type Recorrente = {
  transaction_id: number;
  label: string;
  flow: string;
  bank: string | null;
  /** Já caiu no mês? Existe lançamento com o mesmo núcleo de comerciante. */
  confirmed: boolean;
  /** Data REAL quando já caiu; `null` enquanto é previsão. */
  date: string | null;
  /** Dia declarado, do lançamento que originou a marca. */
  day: number;
  /** Valor real quando já caiu, declarado enquanto não. */
  amountCents: number;
  since: string;
  /** Id do lançamento real, pra quem precisa cruzar com as parcelas do mês. */
  realId: number | null;
};

const SQL_MARCAS = `
  SELECT t.id, t.date, t.description, t.display_name, t.amount_cents, t.flow, a.bank
  FROM recurring_marks rm
  JOIN transactions t ON t.id = rm.transaction_id
  LEFT JOIN accounts a ON a.id = t.account_id
  ORDER BY t.amount_cents DESC`;

const SQL_TX_DO_MES = `
  SELECT id, date, description, display_name, amount_cents
  FROM transactions WHERE date >= ? AND date <= ? ORDER BY date`;

const SQL_FATURAS = `
  SELECT COALESCE(SUM(total_cents), 0) AS c FROM invoices
  WHERE payment_tx_id IS NULL AND due_date IS NOT NULL
    AND strftime('%Y-%m', due_date) = ?`;

const rotulo = (r: { display_name?: string | null; description: string }) =>
  r.display_name ?? r.description;

/**
 * @brief   As recorrências declaradas que valem para o mês, já resolvidas.
 * @details Não valem para trás: o mês anterior ao lançamento que originou a marca não
 *          a teve, e afirmar o contrário inventaria passado.
 */
export function recorrentesDoMes(
  db: DatabaseSync, ym: string, start: string, end: string,
): Recorrente[] {
  const doMes = new Map<string, any>();
  for (const t of db.prepare(SQL_TX_DO_MES).all(start, end) as any[]) {
    const chave = normalizeMerchant(rotulo(t));
    if (chave && !doMes.has(chave)) doMes.set(chave, t);
  }

  return (db.prepare(SQL_MARCAS).all() as any[])
    .filter(r => String(r.date).slice(0, 7) <= ym)
    .map(r => {
      const real = doMes.get(normalizeMerchant(rotulo(r)));
      return {
        transaction_id: r.id,
        label: rotulo(r),
        flow: r.flow,
        bank: r.bank ?? null,
        confirmed: !!real,
        date: real ? real.date : null,
        day: Number(String(r.date).slice(8, 10)),
        amountCents: real ? real.amount_cents : r.amount_cents,
        since: String(r.date).slice(0, 7),
        realId: real ? real.id : null,
      };
    });
}

/**
 * @brief   Total comprometido do mês, em centavos.
 * @warning Parcela NÃO entra em separado: toda parcela é item de uma fatura, e somar as
 *          duas contaria o mesmo dinheiro duas vezes. Quem responde pelo cartão é a
 *          fatura em aberto. Recorrência que já caiu também não entra: o saldo da conta
 *          já a reflete.
 */
export function comprometidoDoMesCents(
  db: DatabaseSync, ym: string, start: string, end: string,
  recorrentes = recorrentesDoMes(db, ym, start, end),
): { totalCents: number; faturasCents: number; recorrentesCents: number } {
  const faturasCents = (db.prepare(SQL_FATURAS).get(ym) as { c: number }).c;
  const recorrentesCents = recorrentes
    .filter(r => r.flow === "expense" && !r.confirmed)
    .reduce((s, r) => s + r.amountCents, 0);
  return { totalCents: faturasCents + recorrentesCents, faturasCents, recorrentesCents };
}
