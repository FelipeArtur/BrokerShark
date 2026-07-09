/** Extrato Inter: preâmbulo 5 linhas; `Data Lançamento;Descrição;Valor;Saldo`.
 *  A coluna Saldo (running balance) valida a consistência do arquivo — v1 a ignorava. */
import { parseCsv } from "./csv.ts";
import { parseMoneyCents, parseDateBR } from "../domain/money.ts";
import * as classify from "../domain/classify.ts";
import type { ParsedFile, TxRecord } from "./types.ts";

export interface InterParsed extends ParsedFile {
  /** saldo ANTES da primeira linha do arquivo (derivado: primeiro saldo − primeiro valor) */
  openingBalanceCents?: number;
  closingBalanceCents?: number;
  firstDate?: string;
}

export function parseInterExtrato(text: string, sourceFile: string): InterParsed {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.toLowerCase().includes("data lançamento"));
  if (headerIdx < 0) throw new Error(`${sourceFile}: não parece extrato Inter`);
  const rows = parseCsv(lines.slice(headerIdx + 1).join("\n"), ";");

  const out: InterParsed = { records: [], skipped: [], signedSumCents: 0, warnings: [] };
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
    // check de consistência via running balance
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
    const investment = classify.isInvestment(desc);
    const rec: TxRecord = {
      date: iso,
      amountCents: Math.abs(cents),
      description: desc,
      accountId: "inter-db",
      flow: cents >= 0 ? "income" : "expense",
      method: "ted",
      isRevenue: 0,
      isInvestmentLeg: investment,
      isCaixinhaLeg: false,
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
