import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fmtCents } from "../../domain/money.ts";
import { parseNubankExtrato } from "../../ingest/nubankExtrato.ts";
import { parseInterExtrato, type InterParsed } from "../../ingest/interExtrato.ts";
import type { InsertStats, TxInserter } from "./txInsert.ts";
import { newStats } from "./txInsert.ts";

export function importNubank(ins: TxInserter, files: string[]): InsertStats {
  const stats = newStats();
  for (const f of files) {
    const parsed = parseNubankExtrato(readFileSync(f, "utf-8"), basename(f));
    stats.skipped += parsed.skipped.length;
    stats.signedSum += parsed.signedSumCents;
    for (const rec of parsed.records) ins.insert(rec, stats);
  }
  return stats;
}

export interface InterImport {
  stats: InsertStats;
  warnings: string[];

  closingCents?: number;
}

export function importInter(db: DatabaseSync, ins: TxInserter, files: string[]): InterImport {
  const stats = newStats();
  const warnings: string[] = [];

  const globalCount = new Map<string, number>();
  let opening: number | undefined;
  let closing: number | undefined;
  let prevClosing: number | undefined;

  for (const f of files) {
    const parsed: InterParsed = parseInterExtrato(readFileSync(f, "utf-8"), basename(f));
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
    db.prepare("UPDATE accounts SET initial_balance_cents = ? WHERE id = 'inter-db'").run(opening);
  }
  return { stats, warnings, closingCents: closing };
}
