/**
 * @file reconcile.ts
 * @brief Reconciliação exato-total do pagamento de fatura (invariante central v2).
 *
 * Helper COMPARTILHADO entre o backfill (jobs/backfill/faturas.ts) e o import
 * incremental da UI (routes/import.ts). Sem ele no caminho da UI, o pagamento da
 * fatura conta DUAS vezes: uma vez nos itens itemizados, outra na perna de
 * pagamento do extrato (regra consumo-despesa não exclui `is_settlement=0`). Ver
 * C1 em `.scratch/future-commitments/spec.md`.
 *
 * Escopo: SÓ pagamento de valor EXATO do total da fatura (M7 — rotativo/parcial
 * não é reconciliado aqui de propósito).
 */
import type { DatabaseSync } from "node:sqlite";

/** @brief Fatura a reconciliar: id + mês-rótulo + total assinado em centavos. */
export interface InvoiceToReconcile {
  invoiceId: number;
  refMonth: string; // 'YYYY-MM'
  totalCents: number;
}

/** @brief Perna de pagamento casada (para relatório). */
export interface MatchedPayment {
  id: number;
  date: string;
  amountCents: number;
}

/** @brief Resultado da reconciliação: casou ou não. */
export interface ReconcileResult {
  matched: boolean;
  payment?: MatchedPayment;
}

/**
 * @brief Casar o pagamento EXATO de uma fatura no extrato `inter-db` e marcá-lo
 *        como liquidação (`is_settlement=1`), excluindo-o do consumo.
 *
 * Procura no `inter-db` uma perna `expense`, descrição contendo "fatura", ainda
 * não casada (`invoice_id IS NULL`), de valor EXATO igual ao total, na janela
 * −70/+35 dias do refMonth (o pagamento antecede o mês-rótulo em ~1 mês), a mais
 * próxima do início do refMonth. Se achar: marca `is_settlement=1`, liga
 * `invoice_id`, força `method='credit'`, e a fatura aponta de volta em
 * `payment_tx_id`.
 *
 * @param db conexão do DB
 * @param inv fatura a reconciliar
 * @return `{ matched, payment? }`
 */
export function reconcileInvoicePayment(db: DatabaseSync, inv: InvoiceToReconcile): ReconcileResult {
  const refStart = `${inv.refMonth}-01`;
  const pay = db.prepare(`
    SELECT id, date, amount_cents FROM transactions
    WHERE account_id = 'inter-db' AND flow = 'expense'
      AND lower(description) LIKE '%fatura%' AND invoice_id IS NULL
      AND amount_cents = ?
      AND julianday(date) BETWEEN julianday(?) - 70 AND julianday(?) + 35
    ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1
  `).get(inv.totalCents, refStart, refStart, refStart) as
    { id: number; date: string; amount_cents: number } | undefined;

  if (!pay) return { matched: false };

  db.prepare("UPDATE transactions SET is_settlement = 1, invoice_id = ?, method = 'credit' WHERE id = ?")
    .run(inv.invoiceId, pay.id);
  db.prepare("UPDATE invoices SET payment_tx_id = ? WHERE id = ?").run(pay.id, inv.invoiceId);

  return { matched: true, payment: { id: pay.id, date: pay.date, amountCents: pay.amount_cents } };
}

/**
 * @brief Reconciliar TODAS as faturas abertas (`payment_tx_id IS NULL`) contra
 *        pernas de pagamento disponíveis.
 *
 * Chamada no confirm do import incremental (routes/import.ts) quando o lote é do
 * `inter-db`: assim que o extrato com o pagamento entra, a fatura aberta importada
 * pela UI (H2) é liquidada e para de double-contar (C1). No-op quando não há
 * fatura aberta (o caso normal hoje, antes de H2).
 *
 * @param db conexão do DB
 * @return quantas faturas foram casadas
 */
export function reconcileOpenInvoices(db: DatabaseSync): number {
  const open = db.prepare(
    "SELECT id, ref_month, total_cents FROM invoices WHERE account_id = 'inter-cc' AND payment_tx_id IS NULL",
  ).all() as { id: number; ref_month: string; total_cents: number }[];

  let matched = 0;
  for (const inv of open) {
    const r = reconcileInvoicePayment(db, {
      invoiceId: inv.id, refMonth: inv.ref_month, totalCents: inv.total_cents,
    });
    if (r.matched) matched++;
  }
  return matched;
}
