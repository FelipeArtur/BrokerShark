/**
 * @file caixinha.ts
 * @brief Caixinha Nubank: posição de investimento derivada das pernas do ledger.
 *
 * caixinha.ts — Caixinha Nubank: posição derivada do ledger (invariante).
 *
 *  RDB fora da B3. Saldo = Σ(aplicações) − Σ(resgates) das pernas de poupança;
 *  snapshots mensais 'derived' (último saldo corrente de cada mês).
 *  O Porquinho Inter NÃO passa por aqui — é CDB custodiado na B3.
 */
import type { DatabaseSync } from "node:sqlite";

/** @brief Posição da Caixinha derivada; `balanceCents` em centavos inteiros. */
export interface CaixinhaResult { investmentId: number; balanceCents: number; legs: number }

/**
 * @brief Criar a posição ledger da Caixinha e derivar seus snapshots mensais.
 *
 * Sinal das pernas (load-bearing): `expense` é APLICAÇÃO (dinheiro sai da conta e
 * entra na Caixinha) e SOMA ao saldo; `income` é resgate e SUBTRAI. Saldo =
 * Σ(aplicações) − Σ(resgates), sem rendimento — RDB fora da B3 não reporta yield.
 *
 * Um snapshot 'derived' por mês, com o ÚLTIMO saldo corrente do mês, datado no
 * último dia do mês.
 *
 * Assume DB recém-construído (sempre INSERT da posição). Para o import incremental,
 * use rederiveCaixinha.
 *
 * @param db conexão do DB em construção
 * @param caixinhaTxIds ids das pernas de poupança coletados pelo inserter
 * @return id da posição, saldo final em centavos inteiros e nº de pernas ligadas
 */
export function deriveCaixinha(db: DatabaseSync, caixinhaTxIds: number[]): CaixinhaResult {
  const investmentId = Number(db.prepare(`
    INSERT INTO investments (name, match_key, type, bank, source, group_name)
    VALUES ('Caixinha Nubank', 'ledger:caixinha-nubank', 'rdb', 'nubank', 'ledger', NULL)
  `).run().lastInsertRowid);

  if (!caixinhaTxIds.length) return { investmentId, balanceCents: 0, legs: 0 };

  const ph = caixinhaTxIds.map(() => "?").join(",");
  db.prepare(`UPDATE transactions SET investment_id = ? WHERE id IN (${ph})`)
    .run(investmentId, ...caixinhaTxIds);

  const legs = db.prepare(`
    SELECT date, flow, amount_cents FROM transactions
    WHERE investment_id = ? ORDER BY date
  `).all(investmentId) as unknown as { date: string; flow: string; amount_cents: number }[];

  const byMonth = new Map<string, number>();
  let running = 0;
  for (const l of legs) {
    running += l.flow === "expense" ? l.amount_cents : -l.amount_cents;
    byMonth.set(l.date.slice(0, 7), running); // último running do mês
  }

  const insSnap = db.prepare(`
    INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
    VALUES (?,?,?,'derived')
  `);
  for (const [month, bal] of byMonth) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const last = new Date(y, mo, 0).getDate();
    insSnap.run(investmentId, `${month}-${String(last).padStart(2, "0")}`, bal);
  }
  return { investmentId, balanceCents: running, legs: caixinhaTxIds.length };
}

/**
 * @brief Rederivar a Caixinha após um import incremental, sem duplicar nada.
 *
 * Versão idempotente p/ import incremental: acha (ou cria) a posição ledger,
 * liga as novas pernas e RECONSTRÓI os snapshots derivados a partir de TODAS
 * as pernas ligadas — nunca duplica a posição nem os snapshots.
 *
 * Só apaga os snapshots `source='derived'`: snapshots 'b3'/'manual' da mesma posição
 * não são desta derivação e sobrevivem. Mesmo sinal de deriveCaixinha (expense =
 * aplicação, soma).
 *
 * @param db conexão do DB
 * @param newLegIds ids das pernas recém-importadas a ligar (pode ser vazio: nesse
 *                  caso só reconstrói os snapshots das pernas já ligadas)
 * @return id da posição, saldo final em centavos inteiros e nº TOTAL de pernas ligadas
 */
export function rederiveCaixinha(db: DatabaseSync, newLegIds: number[]): CaixinhaResult {
  const found = db.prepare(
    "SELECT id FROM investments WHERE match_key = 'ledger:caixinha-nubank'",
  ).get() as { id: number } | undefined;
  const investmentId = found ? found.id : Number(db.prepare(`
    INSERT INTO investments (name, match_key, type, bank, source, group_name)
    VALUES ('Caixinha Nubank', 'ledger:caixinha-nubank', 'rdb', 'nubank', 'ledger', NULL)
  `).run().lastInsertRowid);

  if (newLegIds.length) {
    const ph = newLegIds.map(() => "?").join(",");
    db.prepare(`UPDATE transactions SET investment_id = ? WHERE id IN (${ph})`)
      .run(investmentId, ...newLegIds);
  }

  db.prepare("DELETE FROM position_snapshots WHERE investment_id = ? AND source = 'derived'")
    .run(investmentId);

  const legs = db.prepare(`
    SELECT date, flow, amount_cents FROM transactions
    WHERE investment_id = ? ORDER BY date
  `).all(investmentId) as unknown as { date: string; flow: string; amount_cents: number }[];

  const byMonth = new Map<string, number>();
  let running = 0;
  for (const l of legs) {
    running += l.flow === "expense" ? l.amount_cents : -l.amount_cents;
    byMonth.set(l.date.slice(0, 7), running);
  }
  const insSnap = db.prepare(`
    INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
    VALUES (?,?,?,'derived')
  `);
  for (const [month, bal] of byMonth) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const last = new Date(y, mo, 0).getDate();
    insSnap.run(investmentId, `${month}-${String(last).padStart(2, "0")}`, bal);
  }
  return { investmentId, balanceCents: running, legs: legs.length };
}
