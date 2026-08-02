import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, qsInt } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { currentMonth, monthRange } from "../domain/dates.ts";
import { normalizeMerchant } from "../domain/merchant.ts";

// O que está comprometido no mês — e SÓ o que o ledger sabe de verdade.
//
// A versão anterior projetava doze meses à frente somando recorrência detectada
// sozinha do histórico. Num ledger sem fatura em aberto, o card inteiro era
// palpite: as parcelas reais não apareciam (a projeção só olhava fatura aberta)
// e o total vinha de um comerciante que o detector achou que ia se repetir.
// Mostrava o inventado e escondia o medido.
//
// Aqui há duas fontes, as duas ancoradas em dado:
//   PARCELA     — o banco escreveu "2 de 3" na fatura. É contrato, não previsão.
//   RECORRENTE  — você apontou um lançamento e disse que se repete. É declaração,
//                 não dedução.

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
      // Quantas ainda vêm depois desta. O banco declarou o total, então isto é
      // leitura do contrato — não uma aposta sobre o que você vai gastar.
      remaining: Math.max(0, (r.installment_total ?? 0) - (r.installment_seq ?? 0)),
    }));

    // Índice do mês por núcleo de comerciante, pra saber se a recorrência
    // declarada JÁ caiu. Sem ele o card mostraria "previsto" ao lado de um
    // lançamento que está logo abaixo, na tabela, já cobrado.
    const doMes = new Map<string, any>();
    for (const t of db.prepare(SQL_MONTH_TX).all(start, end) as any[]) {
      const chave = normalizeMerchant(rotulo(t));
      if (chave && !doMes.has(chave)) doMes.set(chave, t);
    }
    const jaContado = new Set(installments.map(i => i.transaction_id));

    const recurring = (db.prepare(SQL_MARKS).all() as any[])
      // Recorrência declarada não vale para trás: o mês anterior ao lançamento
      // que a originou não a teve, e afirmar o contrário inventaria passado.
      .filter(r => String(r.date).slice(0, 7) <= ym)
      .map(r => {
        const real = doMes.get(normalizeMerchant(rotulo(r)));
        return {
          transaction_id: r.id,
          label: rotulo(r),
          flow: r.flow,
          bank: r.bank ?? null,
          // Já caiu: valor e dia são os do lançamento de verdade. Ainda não:
          // repete o que você declarou, que é a única coisa que se pode afirmar.
          confirmed: !!real,
          date: real ? real.date : null,
          day: Number(String(r.date).slice(8, 10)),
          amount: (real ? real.amount_cents : r.amount_cents) / 100,
          since: String(r.date).slice(0, 7),
          duplicate_of_installment: real ? jaContado.has(real.id) : false,
        };
      });

    // Soma em CENTAVOS e divide uma vez só. Somando os reais já divididos,
    // 31,27 + 31,25 devolvia 62,519999999999996 — float no total de dinheiro é
    // exatamente o que o ledger inteiro existe pra não fazer.
    const saidaCents = (v: { flow: string; amount: number }) =>
      (v.flow === "expense" ? Math.round(v.amount * 100) : 0);
    const total_out = (
      installments.reduce((s, i) => s + saidaCents(i), 0) +
      recurring.filter(r => !r.duplicate_of_installment).reduce((s, r) => s + saidaCents(r), 0)
    ) / 100;

    json(res, { month: ym, installments, recurring, total_out });
  }

  return [{ method: "GET", ...compilePath("/api/commitments"), handler: getCommitments }];
}
