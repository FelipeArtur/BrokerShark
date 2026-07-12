/** txInsert.ts — INSERT compartilhado de transações (dedup por external_id). */
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { TxRecord } from "../../ingest/types.ts";

export interface InsertStats { inserted: number; dup: number; skipped: number; signedSum: number }

export const newStats = (): InsertStats => ({ inserted: 0, dup: 0, skipped: 0, signedSum: 0 });

export interface TxInserter {
  /** Statement cru — fases que inserem colunas extras (faturas) usam direto. */
  stmt: StatementSync;
  /** Insere um TxRecord de extrato; acumula stats e coleta pernas da Caixinha. */
  insert(rec: TxRecord, stats: InsertStats): void;
  /** ids das pernas de poupança Nubank — vira posição derivada na fase Caixinha. */
  caixinhaTxIds: number[];
}

export function makeTxInserter(db: DatabaseSync): TxInserter {
  const stmt = db.prepare(`
    INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue,
       external_id, invoice_id, installment_seq, installment_total, bank_category, source_file)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING
  `);
  const caixinhaTxIds: number[] = [];

  function insert(rec: TxRecord, stats: InsertStats): void {
    const r = stmt.run(
      rec.date, rec.flow, rec.method, rec.accountId, rec.amountCents, rec.description,
      rec.isRevenue, rec.externalId ?? null, null, null, null, null, rec.sourceFile,
    );
    if (r.changes === 0) { stats.dup++; return; }
    stats.inserted++;
    if (rec.isCaixinhaLeg) caixinhaTxIds.push(Number(r.lastInsertRowid));
  }

  return { stmt, insert, caixinhaTxIds };
}
