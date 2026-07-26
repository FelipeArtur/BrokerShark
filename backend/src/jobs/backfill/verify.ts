import type { DatabaseSync } from "node:sqlite";
import { fmtCents } from "../../domain/money.ts";
import type { Acervo } from "./files.ts";
import type { InsertStats } from "./txInsert.ts";
import type { InterImport } from "./extratos.ts";
import type { CaixinhaResult } from "./caixinha.ts";
import { reviewInvestments } from "./investReview.ts";
import { AUDIT_CHECK_COUNT, auditLedger } from "../../db/audit.ts";
import { consumptionExpense, realIncome } from "../../db/ledgerSql.ts";

export interface BackfillReport {
  dbPath: string;
  acervo: Acervo;
  nuStats: InsertStats;
  inter: InterImport;
  faturaReport: string[];
  selfPairs: string[];
  caixinha: CaixinhaResult;
  b3Log: string[];
}

export function printReport(db: DatabaseSync, r: BackfillReport): void {
  const q = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
  type Row = Record<string, number | string | null>;

  console.log("═".repeat(70));
  console.log("BACKFILL v2 —", r.dbPath);
  console.log("═".repeat(70));
  console.log(`\n■ Extratos Nubank: ${r.acervo.nubank.length} arquivos → ${r.nuStats.inserted} tx (${r.nuStats.dup} dup UUID, ${r.nuStats.skipped} ignoradas)`);
  console.log(`■ Extratos Inter:  ${r.acervo.inter.length} arquivos → ${r.inter.stats.inserted} tx (${r.inter.stats.dup} dup, ${r.inter.stats.skipped} ignoradas)`);
  console.log(`■ Faturas Inter:   ${r.acervo.faturas.length} arquivos`);
  for (const l of r.faturaReport) console.log(l);
  console.log(`■ Pareamento SELF: ${r.selfPairs.length} pares`);
  for (const l of r.selfPairs) console.log(l);
  if (r.inter.warnings.length) {
    console.log(`\n⚠ Avisos Inter (${r.inter.warnings.length}):`);
    for (const w of r.inter.warnings) console.log("  " + w);
  }

  console.log("\n■ Saldo por conta (initial + receitas − despesas, ledger completo):");
  for (const a of q<Row>(`
    SELECT a.id, a.initial_balance_cents AS init,
           COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount_cents END),0) AS inc,
           COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount_cents END),0) AS exp
    FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.is_settlement = 0
    WHERE a.type = 'checking' GROUP BY a.id
  `)) {

    const settle = (q<Row>(
      "SELECT COALESCE(SUM(amount_cents),0) AS s FROM transactions WHERE account_id=? AND is_settlement=1",
      a.id,
    )[0]!.s as number);
    const bal = (a.init as number) + (a.inc as number) - (a.exp as number) - settle;
    console.log(`  ${a.id}: ${fmtCents(bal)}  (inicial ${fmtCents(a.init as number)}, liquidações de fatura ${fmtCents(settle)})`);
    if (a.id === "inter-db" && r.inter.closingCents !== undefined) {
      const ok = bal === r.inter.closingCents;
      console.log(`    check vs saldo do banco no último extrato: ${fmtCents(r.inter.closingCents)} ${ok ? "✓ BATE" : "✗ NÃO BATE"}`);
    }
  }

  console.log("\n■ Investimentos:");
  for (const inv of q<Row>(`
    SELECT i.id, i.name, i.type, i.bank, i.group_name, i.closed_at,
           (SELECT net_cents FROM position_snapshots s WHERE s.investment_id = i.id ORDER BY ref_date DESC LIMIT 1) AS last_net,
           (SELECT ref_date  FROM position_snapshots s WHERE s.investment_id = i.id ORDER BY ref_date DESC LIMIT 1) AS last_date,
           (SELECT COUNT(*)  FROM position_snapshots s WHERE s.investment_id = i.id) AS snaps
    FROM investments i ORDER BY i.closed_at IS NOT NULL, i.type, i.name
  `)) {
    const flag = inv.closed_at ? `FECHADA ${inv.closed_at}` : "aberta";
    const grp = inv.group_name ? ` [${inv.group_name}]` : "";
    console.log(`  #${inv.id} ${inv.name}${grp} (${inv.type}/${inv.bank}) — ${flag}, ${inv.snaps} snapshots, último ${inv.last_date}: ${fmtCents((inv.last_net as number) ?? 0)}`);
  }
  console.log(`  Caixinha (derivada do ledger): ${fmtCents(r.caixinha.balanceCents)} em ${r.caixinha.legs} pernas`);
  console.log("\n■ B3 processado:");
  for (const l of r.b3Log) console.log(l);

  const totals = q<Row>(`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN ${realIncome()} THEN amount_cents ELSE 0 END) AS receitas,
      SUM(CASE WHEN ${consumptionExpense()} THEN amount_cents ELSE 0 END) AS despesas
    FROM transactions
  `)[0]!;
  console.log(`\n■ Ledger: ${totals.n} transações | receitas reais ${fmtCents(totals.receitas as number)} | despesas de consumo ${fmtCents(totals.despesas as number)}`);

  console.log("\n■ Validação de Invariantes:");
  const violations = auditLedger(db);
  if (violations.length) {
    for (const v of violations) console.error(`  [ERRO] ${v.check} (${v.count}): ${v.message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${AUDIT_CHECK_COUNT} invariantes do ledger intactas`);
  }

  const invRev = reviewInvestments(db);
  console.log("\n■ Estratégia de investimentos:");
  console.log(`  Total investido (posições abertas): ${fmtCents(invRev.panorama.totalCents)}`);
  for (const t of invRev.panorama.byType) console.log(`    ${t.type}: ${fmtCents(t.cents)} (${t.pct}%)`);
  if (invRev.panorama.topConcentration)
    console.log(`  Maior concentração: ${invRev.panorama.topConcentration.name} (${invRev.panorama.topConcentration.pct}%)`);
  console.log(`  Posições por fonte: ${invRev.panorama.bySource.map((s) => `${s.source}=${s.count}`).join(", ")}`);
  if (invRev.violations.length) {
    console.error(`  [ERRO] ${invRev.violations.length} violação(ões) de invariante de investimento:`);
    for (const v of invRev.violations) console.error("    - " + v);
    process.exit(1);
  } else {
    console.log("  ✓ Invariantes de investimento intactas");
  }
}
