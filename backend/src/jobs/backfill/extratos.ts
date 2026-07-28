import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fmtCents } from "../../domain/money.ts";
import { parseStatementWithIds } from "../../ingest/statementWithIds.ts";
import { parseStatementWithBalance, type BalanceParsed } from "../../ingest/statementWithBalance.ts";
import type { InsertStats, TxInserter } from "./txInsert.ts";
import { newStats } from "./txInsert.ts";
import { ledgerVocabulary } from "../../config.ts";

/** Extratos do formato com identificador único, para a conta dada. */
export function importStatementsWithIds(
  ins: TxInserter, files: string[], accountId: string,
): InsertStats {
  const vocab = ledgerVocabulary(accountId);
  const stats = newStats();
  for (const f of files) {
    const parsed = parseStatementWithIds(readFileSync(f, "utf-8"), basename(f), accountId, vocab);
    stats.skipped += parsed.skipped.length;
    stats.signedSum += parsed.signedSumCents;
    for (const rec of parsed.records) ins.insert(rec, stats);
  }
  return stats;
}

export interface BalanceImport {
  stats: InsertStats;
  warnings: string[];

  closingCents?: number;
}

/** Extratos do formato com saldo corrente — o saldo é conferido linha a linha. */
export function importStatementsWithBalance(
  db: DatabaseSync, ins: TxInserter, files: string[], accountId: string,
): BalanceImport {
  const vocab = ledgerVocabulary(accountId);
  const stats = newStats();
  const warnings: string[] = [];

  const globalCount = new Map<string, number>();
  let opening: number | undefined;
  let closing: number | undefined;
  let prevClosing: number | undefined;

  for (const f of files) {
    const parsed: BalanceParsed = parseStatementWithBalance(
      readFileSync(f, "utf-8"), basename(f), accountId, vocab);
    stats.skipped += parsed.skipped.length;
    warnings.push(...parsed.warnings);
    if (opening === undefined) opening = parsed.openingBalanceCents;
    if (prevClosing !== undefined && parsed.openingBalanceCents !== undefined
        && prevClosing !== parsed.openingBalanceCents) {
      warnings.push(
        `descontinuidade entre arquivos em ${basename(f)}: fecho anterior ${fmtCents(prevClosing)} ≠ abertura ${fmtCents(parsed.openingBalanceCents)}`,
      );
    }
    prevClosing = parsed.closingBalanceCents ?? prevClosing;
    closing = parsed.closingBalanceCents ?? closing;

    const fileCount = new Map<string, number>();
    for (const rec of parsed.records) {
      const key = `${rec.date}|${rec.flow}|${rec.amountCents}|${rec.description}`;
      const seenInFile = (fileCount.get(key) ?? 0) + 1;
      fileCount.set(key, seenInFile);
      if (seenInFile <= (globalCount.get(key) ?? 0)) { stats.dup++; continue; }
      ins.insert(rec, stats);
      globalCount.set(key, seenInFile);
      stats.signedSum += rec.flow === "income" ? rec.amountCents : -rec.amountCents;
    }
  }
  if (opening !== undefined) {
    db.prepare("UPDATE accounts SET initial_balance_cents = ? WHERE id = ?").run(opening, accountId);
  }
  return { stats, warnings, closingCents: closing };
}
