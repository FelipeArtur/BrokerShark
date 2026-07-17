/**
 * @file extratos.ts
 * @brief Fase de import dos extratos: Nubank (dedup UUID) e Inter (dedup por contagem).
 *
 * extratos.ts — importa extratos Nubank (dedup UUID) e Inter (dedup por
 * contagem de ocorrência + checks de continuidade do saldo corrente).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fmtCents } from "../../domain/money.ts";
import { parseNubankExtrato } from "../../ingest/nubankExtrato.ts";
import { parseInterExtrato, type InterParsed } from "../../ingest/interExtrato.ts";
import type { InsertStats, TxInserter } from "./txInsert.ts";
import { newStats } from "./txInsert.ts";

/**
 * @brief Importar todos os extratos Nubank, deduplicando por UUID.
 * @param ins inserter compartilhado da fase
 * @param files extratos Nubank em ordem cronológica
 * @return stats da fase; `signedSum` é a Σ assinada do ARQUIVO em centavos inteiros
 *         (inclui duplicatas — é a âncora de conferência do parse, não do inserido)
 * @throws Error se algum arquivo não for um extrato Nubank válido
 */
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

/** @brief Resultado do import Inter: stats, warnings e saldo final em centavos. */
export interface InterImport {
  stats: InsertStats;
  warnings: string[];
  /** saldo do banco no fim do último extrato — âncora da verificação final */
  closingCents?: number;
}

/**
 * @brief Importar os extratos Inter, deduplicando por contagem e checando continuidade.
 *
 * Grava também o `initial_balance_cents` da conta `inter-db`: o saldo de abertura do
 * PRIMEIRO extrato é a âncora de onde o saldo calculado parte — sem ele, o saldo da
 * conta ficaria deslocado por todo o histórico anterior ao acervo.
 *
 * Divergência de saldo ou descontinuidade entre arquivos NÃO aborta: vira warning
 * reportado na fase de verificação.
 *
 * @param db conexão do DB em construção
 * @param ins inserter compartilhado da fase
 * @param files extratos Inter em ORDEM cronológica (o dedup por contagem depende disso)
 * @return stats (`signedSum` em centavos inteiros, só do que foi inserido), warnings
 *         e `closingCents` = saldo do banco no fim do último extrato, em centavos
 * @throws Error se algum arquivo não for um extrato Inter válido
 */
export function importInter(db: DatabaseSync, ins: TxInserter, files: string[]): InterImport {
  const stats = newStats();
  const warnings: string[] = [];
  // Extrato Inter não tem id único; linhas idênticas legítimas existem (2 pix
  // iguais no dia). Dedup: por chave composta, um arquivo só re-insere além do
  // que TODOS os anteriores já cobriram (janelas de export se sobrepõem).
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
