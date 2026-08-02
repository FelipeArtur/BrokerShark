import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, qsInt } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { currentMonth, monthRange } from "../domain/dates.ts";
import { comprometidoDoMesCents, recorrentesDoMes } from "../db/committed.ts";

/**
 * @file    O comprometido do mês — e SÓ o que o ledger sabe de verdade.
 * @details PARCELA: o banco escreveu "2 de 3", é contrato. RECORRENTE: você apontou
 *          um lançamento, é declaração. Nada é deduzido do histórico.
 */

const SQL_INSTALLMENTS = `
  SELECT t.id, t.date, t.description, t.display_name, t.amount_cents, t.flow,
         t.installment_seq, t.installment_total, a.bank
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  WHERE t.date >= ? AND t.date <= ? AND t.installment_total IS NOT NULL
  ORDER BY t.date`;

const rotulo = (r: { display_name?: string | null; description: string }) =>
  r.display_name ?? r.description;

export function commitmentRoutes(db: DatabaseSync): Route[] {

  function getCommitments(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);
    const ym = `${year}-${String(month).padStart(2, "0")}`;

    const installments = (db.prepare(SQL_INSTALLMENTS).all(start, end) as any[]).map(r => ({
      transaction_id: r.id,
      date: r.date,
      label: rotulo(r),
      description: r.description,
      amount: r.amount_cents / 100,
      flow: r.flow,
      bank: r.bank ?? null,
      seq: r.installment_seq,
      total: r.installment_total,
      remaining: Math.max(0, (r.installment_total ?? 0) - (r.installment_seq ?? 0)),
    }));

    //> A lista e o total saem da MESMA leitura: passar `recorrentes` adiante impede
    //> que a lista exibida e o número que ela explica venham de consultas diferentes.
    const recorrentes = recorrentesDoMes(db, ym, start, end);
    const cmt = comprometidoDoMesCents(db, ym, start, end, recorrentes);

    const jaContado = new Set(installments.map(i => i.transaction_id));
    const recurring = recorrentes.map(r => ({
      transaction_id: r.transaction_id,
      label: r.label,
      flow: r.flow,
      bank: r.bank,
      confirmed: r.confirmed,
      date: r.date,
      day: r.day,
      amount: r.amountCents / 100,
      since: r.since,
      duplicate_of_installment: r.realId != null && jaContado.has(r.realId),
    }));

    json(res, {
      month: ym,
      installments,
      recurring,
      total_out: cmt.totalCents / 100,
      total_invoices: cmt.faturasCents / 100,
      total_recurring: cmt.recorrentesCents / 100,
    });
  }

  return [{ method: "GET", ...compilePath("/api/commitments"), handler: getCommitments }];
}
