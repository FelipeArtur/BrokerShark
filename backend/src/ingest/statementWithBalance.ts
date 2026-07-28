// Extrato em CSV com SALDO CORRENTE por linha.
//
// O nome descreve o formato: cada lançamento traz o saldo depois dele, e o
// parser confere linha a linha se o saldo anterior mais o valor dá o saldo
// declarado. Quando não dá, o arquivo está fora de ordem cronológica ou
// incompleto — e o parser avisa em vez de importar número que não fecha.
// Qual conta recebe é decisão da config, não deste arquivo.

import { parseCsv } from "./csv.ts";
import { parseMoneyCents, parseDateBR } from "../domain/money.ts";
import * as classify from "../domain/classify.ts";
import type { ParsedFile, TxRecord, LedgerVocabulary } from "./types.ts";

export interface BalanceParsed extends ParsedFile {

  openingBalanceCents?: number;
  closingBalanceCents?: number;
  firstDate?: string;
}

export function parseStatementWithBalance(
  text: string, sourceFile: string, accountId: string, vocab: LedgerVocabulary,
): BalanceParsed {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.toLowerCase().includes("data lançamento"));
  if (headerIdx < 0) throw new Error(`${sourceFile}: não parece extrato Inter`);
  const rows = parseCsv(lines.slice(headerIdx + 1).join("\n"), ";");

  const out: BalanceParsed = { records: [], skipped: [], signedSumCents: 0, warnings: [] };
  let prevSaldo: number | undefined;
  for (const r of rows) {
    if (r.length < 3 || !(r[0] ?? "").trim()) continue;
    const desc = (r[1] ?? "").split(/\s+/).join(" ").trim();
    let iso: string, cents: number;
    try {
      iso = parseDateBR(r[0]!);
      cents = parseMoneyCents(r[2]!);
    } catch {
      out.skipped.push({ line: r.join(";"), reason: "linha não reconhecida" });
      continue;
    }

    let saldo: number | undefined;
    try { saldo = r[3] !== undefined ? parseMoneyCents(r[3]) : undefined; } catch { saldo = undefined; }
    if (saldo !== undefined) {
      if (prevSaldo === undefined) {
        out.openingBalanceCents = saldo - cents;
        out.firstDate = iso;
      } else if (prevSaldo + cents !== saldo) {
        out.warnings.push(
          `${sourceFile} ${iso}: saldo não bate (${prevSaldo} + ${cents} ≠ ${saldo}) em "${desc}"`,
        );
      }
      prevSaldo = saldo;
      out.closingBalanceCents = saldo;
    }
    out.signedSumCents += cents;
    const investment = classify.isInvestment(desc, vocab.investmentKeywords);
    const rec: TxRecord = {
      date: iso,
      amountCents: Math.abs(cents),
      description: desc,
      accountId,
      flow: cents >= 0 ? "income" : "expense",
      method: "ted",
      isRevenue: 0,
      isInvestmentLeg: investment,
      isSavingsLeg: classify.isDerivedSavingsLeg(desc, accountId, vocab.savings),
      sourceFile,
    };
    if (investment) {
      rec.method = "transfer";
      rec.note = "movimento de investimento";
    } else if (cents >= 0) {
      rec.isRevenue = 1;
      rec.method = classify.incomeMethod(desc);
    } else {
      rec.method = classify.checkingExpenseMethod(desc);
    }
    out.records.push(rec);
  }
  return out;
}
