/**
 * @file txInsert.ts
 * @brief INSERT compartilhado de transações, com dedup por external_id.
 *
 * txInsert.ts — INSERT compartilhado de transações (dedup por external_id).
 */
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { TxRecord } from "../../ingest/types.ts";

/** @brief Contadores de uma fase de import; `signedSum` em centavos inteiros. */
export interface InsertStats { inserted: number; dup: number; skipped: number; signedSum: number }

/**
 * @brief Criar um contador de import zerado.
 * @return InsertStats com todos os campos em 0
 */
export const newStats = (): InsertStats => ({ inserted: 0, dup: 0, skipped: 0, signedSum: 0 });

/** @brief Inserter de transações compartilhado pelas fases do backfill. */
export interface TxInserter {
  /** Statement cru — fases que inserem colunas extras (faturas) usam direto. */
  stmt: StatementSync;
  /** Insere um TxRecord de extrato; acumula stats e coleta pernas da Caixinha. */
  insert(rec: TxRecord, stats: InsertStats): void;
  /** ids das pernas de poupança Nubank — vira posição derivada na fase Caixinha. */
  caixinhaTxIds: number[];
}

/**
 * @brief Criar o inserter de transações ligado a esta conexão.
 *
 * O dedup é feito pelo próprio SQLite: ON CONFLICT (external_id) DO NOTHING. Só o
 * Nubank tem UUID — o Inter chega aqui já deduplicado por contagem (ver extratos.ts).
 *
 * @param db conexão do DB em construção
 * @return TxInserter com o statement cru, o `insert` e a coleta de pernas da Caixinha
 */
export function makeTxInserter(db: DatabaseSync): TxInserter {
  const stmt = db.prepare(`
    INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue,
       external_id, invoice_id, installment_seq, installment_total, bank_category, source_file)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING
  `);
  const caixinhaTxIds: number[] = [];

  /**
   * @brief Inserir um TxRecord de extrato, contabilizando dup e pernas da Caixinha.
   *
   * Um conflito de external_id não é erro: os exports se sobrepõem no tempo. A linha
   * vira `dup` e o id NÃO entra em caixinhaTxIds — contá-la duas vezes inflaria a
   * posição derivada.
   *
   * @param rec registro já normalizado; `amountCents` em centavos inteiros positivos
   * @param stats contador desta fase, mutado in-place
   */
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
