/**
 * @file investReview.ts
 * @brief Invariantes de investimento (violação aborta o backfill) + panorama de alocação.
 *
 * investReview.ts — review da estratégia de investimentos na fase verify.
 * Duas partes: invariantes (violação → backfill aborta) + panorama de alocação.
 */
import type { DatabaseSync } from "node:sqlite";

/** @brief Panorama de alocação das posições abertas; valores em centavos inteiros. */
export interface InvestPanorama {
  totalCents: number;
  byType: { type: string; cents: number; pct: number }[];
  topConcentration: { name: string; pct: number } | null;
  bySource: { source: string; count: number }[];
}
/** @brief Resultado do review: violações encontradas + panorama de alocação. */
export interface InvestReview { violations: string[]; panorama: InvestPanorama }

/**
 * @brief Checar as invariantes de investimento e montar o panorama de alocação.
 *
 * Quatro invariantes, cada uma protegendo um erro de contagem conhecido:
 *  1. só a Caixinha é posição derivada — outra `source='ledger'` significaria que
 *     algo virou derivado indevidamente (o Porquinho é B3; derivá-lo dobraria);
 *  2. o snapshot derivado mais recente da Caixinha bate com a Σ das pernas
 *     (expense = aplicação soma, income = resgate subtrai);
 *  3. posição aberta sem snapshot — some da carteira sem deixar rastro;
 *  4. snapshot com net negativo — posição não deve valer menos que zero.
 *
 * Função PURA de efeito: só lê. Quem aborta é printReport (verify.ts).
 *
 * @param db conexão do DB a auditar
 * @return violações em texto (vazio = carteira sã) e o panorama, com `totalCents`
 *         e `cents` em centavos inteiros e `pct` em % com 1 casa
 */
export function reviewInvestments(db: DatabaseSync): InvestReview {
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
  const get = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as T | undefined;
  const violations: string[] = [];

  // Invariante 1: só a Caixinha é posição derivada (Porquinho é B3, não derivado)
  for (const r of all<{ name: string }>(
    "SELECT name FROM investments WHERE source='ledger' AND match_key != 'ledger:caixinha-nubank'",
  )) violations.push(`posição ledger inesperada "${r.name}" — só a Caixinha deve ser derivada (Porquinho é B3)`);

  // Invariante 2: a Caixinha reconcilia com a soma das pernas
  const cx = get<{ id: number }>("SELECT id FROM investments WHERE match_key='ledger:caixinha-nubank'");
  if (cx) {
    const legs = get<{ s: number }>(
      "SELECT COALESCE(SUM(CASE WHEN flow='expense' THEN amount_cents ELSE -amount_cents END),0) AS s FROM transactions WHERE investment_id=?",
      cx.id,
    )!.s;
    const snap = get<{ net_cents: number }>(
      "SELECT net_cents FROM position_snapshots WHERE investment_id=? AND source='derived' ORDER BY ref_date DESC LIMIT 1",
      cx.id,
    );
    if (snap && snap.net_cents !== legs)
      violations.push(`Caixinha não reconcilia: snapshot ${snap.net_cents} ≠ Σ pernas ${legs}`);
  }

  // Invariante 3: posição aberta sem nenhum snapshot
  for (const r of all<{ name: string }>(
    "SELECT i.name FROM investments i LEFT JOIN position_snapshots ps ON ps.investment_id=i.id WHERE i.closed_at IS NULL AND ps.id IS NULL",
  )) violations.push(`posição aberta "${r.name}" sem nenhum snapshot`);

  // Invariante 4: snapshot com net negativo
  for (const r of all<{ name: string; net_cents: number }>(
    "SELECT i.name, ps.net_cents FROM position_snapshots ps JOIN investments i ON i.id=ps.investment_id WHERE ps.net_cents < 0",
  )) violations.push(`net negativo em "${r.name}": ${r.net_cents}`);

  // Panorama de alocação — posições abertas, último snapshot de cada
  const open = all<{ type: string; name: string; net: number | null }>(`
    SELECT i.type, i.name,
      (SELECT net_cents FROM position_snapshots s WHERE s.investment_id=i.id ORDER BY ref_date DESC LIMIT 1) AS net
    FROM investments i WHERE i.closed_at IS NULL
  `);
  const totalCents = open.reduce((s, r) => s + (r.net ?? 0), 0);
  const pct = (c: number) => (totalCents > 0 ? Math.round((c / totalCents) * 1000) / 10 : 0);
  const byTypeMap = new Map<string, number>();
  for (const r of open) byTypeMap.set(r.type, (byTypeMap.get(r.type) ?? 0) + (r.net ?? 0));
  const byType = [...byTypeMap].map(([type, cents]) => ({ type, cents, pct: pct(cents) }))
    .sort((a, b) => b.cents - a.cents);
  const top = open.filter((r) => r.net != null).sort((a, b) => b.net! - a.net!)[0];
  const topConcentration = top && totalCents > 0 ? { name: top.name, pct: pct(top.net!) } : null;
  const bySource = all<{ source: string; count: number }>(
    "SELECT source, COUNT(*) AS count FROM investments WHERE closed_at IS NULL GROUP BY source",
  );

  return { violations, panorama: { totalCents, byType, topConcentration, bySource } };
}
