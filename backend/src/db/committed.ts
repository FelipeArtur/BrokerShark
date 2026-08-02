import type { DatabaseSync } from "node:sqlite";
import { normalizeMerchant } from "../domain/merchant.ts";

/**
 * @file    O que ainda vai SAIR da conta corrente neste mês-calendário.
 * @details Fonte única: o herói (`/api/available`) e o card (`/api/commitments`) leem
 *          daqui, senão o número grande e a lista que o explica divergem.
 */

const SQL_FATURAS = `
  SELECT COALESCE(SUM(total_cents), 0) AS c FROM invoices
  WHERE payment_tx_id IS NULL AND due_date IS NOT NULL
    AND strftime('%Y-%m', due_date) = ?`;

const SQL_MARCAS = `
  SELECT t.id, t.date, t.description, t.display_name, t.amount_cents, t.flow
  FROM recurring_marks rm
  JOIN transactions t ON t.id = rm.transaction_id
  WHERE t.flow = 'expense'`;

const SQL_TX_DO_MES = `
  SELECT description, display_name FROM transactions
  WHERE date >= ? AND date <= ?`;

const rotulo = (r: { display_name?: string | null; description: string }) =>
  r.display_name ?? r.description;

/**
 * @brief   Recorrências declaradas que ainda não caíram no mês.
 * @details Já caiu = existe lançamento no mês com o mesmo núcleo de comerciante. Somar
 *          uma que já caiu descontaria duas vezes: o saldo da conta já a reflete.
 */
export function recorrentesPendentes(
  db: DatabaseSync, ym: string, start: string, end: string,
): { id: number; label: string; day: number; amountCents: number }[] {
  const doMes = new Set(
    (db.prepare(SQL_TX_DO_MES).all(start, end) as any[])
      .map(t => normalizeMerchant(rotulo(t)))
      .filter(Boolean),
  );
  return (db.prepare(SQL_MARCAS).all() as any[])
    // Não vale para trás: o mês anterior ao lançamento que a originou não a teve.
    .filter(r => String(r.date).slice(0, 7) <= ym)
    .filter(r => !doMes.has(normalizeMerchant(rotulo(r))))
    .map(r => ({
      id: r.id,
      label: rotulo(r),
      day: Number(String(r.date).slice(8, 10)),
      amountCents: r.amount_cents,
    }));
}

/**
 * @brief   Total comprometido do mês, em centavos.
 * @warning Parcela NÃO entra em separado: toda parcela é item de uma fatura, e somar as
 *          duas contaria o mesmo dinheiro duas vezes. Quem responde pelo cartão é a
 *          fatura em aberto.
 */
export function comprometidoDoMesCents(
  db: DatabaseSync, ym: string, start: string, end: string,
): { totalCents: number; faturasCents: number; recorrentesCents: number } {
  const faturasCents = (db.prepare(SQL_FATURAS).get(ym) as { c: number }).c;
  const recorrentesCents = recorrentesPendentes(db, ym, start, end)
    .reduce((s, r) => s + r.amountCents, 0);
  return { totalCents: faturasCents + recorrentesCents, faturasCents, recorrentesCents };
}
