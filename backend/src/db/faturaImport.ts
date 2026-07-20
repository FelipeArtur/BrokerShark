/**
 * @file faturaImport.ts
 * @brief Ingestão de fatura Inter ABERTA pela UI (H2 de future-commitments).
 *
 * Diferente do backfill (`jobs/backfill/faturas.ts`), que só ingere faturas
 * históricas JÁ PAGAS: aqui a fatura entra ABERTA (`payment_tx_id IS NULL`) e o
 * pagamento é reconciliado depois, quando o extrato com a perna chega
 * (`db/reconcile.ts`, C1). Os itens são gasto real (`credit` no `inter-cc`),
 * byte-idênticos aos do backfill + `import_batch_id` (reverter-lote).
 *
 * Upsert por `(inter-cc, ref_month)` — a fatura aberta CRESCE semana a semana, então
 * reimportar deve mesclar, não duplicar. Itens deduplicam POR CONTAGEM (fatura não
 * tem UUID; merchant/valor/data repetem legítimo).
 */
import type { DatabaseSync } from "node:sqlite";
import type { FaturaItem } from "../ingest/interFatura.ts";

/** @brief Parâmetros do import de uma fatura aberta. */
export interface OpenFaturaParams {
  refMonth: string;            // 'YYYY-MM'
  dueDate: string | null;      // ISO ou null
  items: FaturaItem[];
  sourceFile: string;
  importBatchId: string;
}

/** @brief Resultado: invoice + quantos itens entraram vs deduplicados. */
export interface OpenFaturaResult {
  invoiceId: number;
  inserted: number;
  duplicate: number;
  totalCents: number;
}

/**
 * @brief Inserir/mesclar uma fatura Inter aberta e seus itens no `inter-cc`.
 *
 * @param db conexão do DB
 * @param p parâmetros da fatura
 * @return invoice id + contagem de itens inseridos/duplicados + total assinado
 * @throws Error se a fatura desse ref_month já estiver paga/reconciliada
 */
export function insertOpenFatura(db: DatabaseSync, p: OpenFaturaParams): OpenFaturaResult {
  const totalCents = p.items.reduce((s, it) => s + it.amountCents, 0);

  // Upsert da invoice — só faturas ABERTAS podem ser mescladas.
  const existing = db.prepare(
    "SELECT id, payment_tx_id FROM invoices WHERE account_id = 'inter-cc' AND ref_month = ?",
  ).get(p.refMonth) as { id: number; payment_tx_id: number | null } | undefined;

  let invoiceId: number;
  if (existing) {
    if (existing.payment_tx_id != null) {
      throw new Error(`fatura ${p.refMonth} já está paga/reconciliada — não dá pra reabrir`);
    }
    invoiceId = existing.id;
    db.prepare("UPDATE invoices SET total_cents = ?, due_date = ?, source_file = ? WHERE id = ?")
      .run(totalCents, p.dueDate, p.sourceFile, invoiceId);
  } else {
    invoiceId = Number(
      db.prepare(
        "INSERT INTO invoices (account_id, ref_month, total_cents, source_file, due_date) VALUES ('inter-cc', ?, ?, ?, ?)",
      ).run(p.refMonth, totalCents, p.sourceFile, p.dueDate).lastInsertRowid,
    );
  }

  // Dedup por CONTAGEM, escopado ao invoice_id — igual ao dedup do extrato Inter.
  const countStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE invoice_id = ? AND date = ? AND description = ? AND amount_cents = ? AND flow = ?
      AND IFNULL(installment_seq, -1) = ? AND IFNULL(installment_total, -1) = ?
  `);
  const ins = db.prepare(`
    INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue,
       invoice_id, installment_seq, installment_total, bank_category, source_file, import_batch_id)
    VALUES (?, ?, 'credit', 'inter-cc', ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `);

  const seen = new Map<string, number>();
  let inserted = 0;
  let duplicate = 0;
  for (const it of p.items) {
    const flow = it.amountCents >= 0 ? "expense" : "income"; // estorno = income (is_revenue=0)
    const amt = Math.abs(it.amountCents);
    const seq = it.installmentSeq ?? null;
    const tot = it.installmentTotal ?? null;
    const key = `${it.date}|${it.description}|${amt}|${flow}|${seq}|${tot}`;
    if (!seen.has(key)) {
      const n = (countStmt.get(invoiceId, it.date, it.description, amt, flow, seq ?? -1, tot ?? -1) as { n: number }).n;
      seen.set(key, n);
    }
    const remaining = seen.get(key)!;
    if (remaining > 0) { duplicate++; seen.set(key, remaining - 1); continue; }
    ins.run(it.date, flow, amt, it.description, invoiceId, seq, tot, it.bankCategory || null, p.sourceFile, p.importBatchId);
    inserted++;
  }

  return { invoiceId, inserted, duplicate, totalCents };
}

/**
 * @brief Apagar faturas ABERTAS que ficaram sem itens (H4).
 *
 * Chamada no revert de um lote (routes/import.ts `deleteBatch`): reverter o import
 * de uma fatura aberta apaga os itens, mas a invoice ficaria órfã — um compromisso
 * fantasma que o "Comprometido" (P2) leria como vivo. Só apaga invoice ABERTA
 * (`payment_tx_id IS NULL`) e sem nenhum item restante; fatura paga ou com itens
 * fica intacta.
 *
 * @param db conexão do DB
 * @param invoiceIds ids candidatos (dos itens revertidos)
 * @return quantas invoices foram apagadas
 */
export function pruneEmptyOpenInvoices(db: DatabaseSync, invoiceIds: number[]): number {
  const del = db.prepare(`
    DELETE FROM invoices
    WHERE id = ? AND payment_tx_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM transactions WHERE invoice_id = invoices.id)
  `);
  let pruned = 0;
  for (const id of new Set(invoiceIds)) {
    if (id == null) continue;
    pruned += del.run(id).changes as number;
  }
  return pruned;
}
