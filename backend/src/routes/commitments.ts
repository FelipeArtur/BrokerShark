import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, qsInt } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { currentMonth, monthRange } from "../domain/dates.ts";
import { normalizeMerchant } from "../domain/merchant.ts";
import { comprometidoDoMesCents } from "../db/committed.ts";

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

const SQL_MARKS = `
  SELECT t.id, t.date, t.description, t.display_name, t.amount_cents, t.flow, a.bank
  FROM recurring_marks rm
  JOIN transactions t ON t.id = rm.transaction_id
  LEFT JOIN accounts a ON a.id = t.account_id
  ORDER BY t.amount_cents DESC`;

const SQL_MONTH_TX = `
  SELECT id, date, description, display_name, amount_cents, flow
  FROM transactions
  WHERE date >= ? AND date <= ?
  ORDER BY date`;

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

    //> Pra saber se a declarada JÁ caiu: senão diz "previsto" sobre linha já cobrada.
    const doMes = new Map<string, any>();
    for (const t of db.prepare(SQL_MONTH_TX).all(start, end) as any[]) {
      const chave = normalizeMerchant(rotulo(t));
      if (chave && !doMes.has(chave)) doMes.set(chave, t);
    }
    const jaContado = new Set(installments.map(i => i.transaction_id));

    const recurring = (db.prepare(SQL_MARKS).all() as any[])
      //> Não vale para trás: afirmar o contrário inventaria passado.
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
          amount: (real ? real.amount_cents : r.amount_cents) / 100,
          since: String(r.date).slice(0, 7),
          duplicate_of_installment: real ? jaContado.has(real.id) : false,
        };
      });

    //> O total sai da MESMA fonte que o herói (`db/committed.ts`): a lista abaixo
    //> explica o número grande, e explicar com uma conta própria era o jeito garantido
    //> de os dois discordarem. Parcela aparece na lista mas não soma: é item de fatura,
    //> e a fatura já responde por ela.
    const cmt = comprometidoDoMesCents(db, ym, start, end);

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
