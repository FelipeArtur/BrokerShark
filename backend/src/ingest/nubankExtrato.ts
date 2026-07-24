import { parseCsv } from "./csv.ts";
import { parseMoneyCents, parseDateBR } from "../domain/money.ts";
import * as classify from "../domain/classify.ts";
import type { ParsedFile, TxRecord } from "./types.ts";

export function parseNubankExtrato(text: string, sourceFile: string): ParsedFile {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  if (!header.includes("identificador") || !header.includes("valor")) {
    throw new Error(`${sourceFile}: não parece extrato Nubank`);
  }
  const col = (name: string) => header.indexOf(name);
  const iDate = col("data"), iVal = col("valor"), iId = col("identificador");
  const iDesc = header.findIndex((h) => h.startsWith("descri"));

  const out: ParsedFile = { records: [], skipped: [], signedSumCents: 0, warnings: [] };
  for (const r of rows.slice(1)) {
    const desc = (r[iDesc] ?? "").split(/\s+/).join(" ").trim();
    const ext = (r[iId] ?? "").trim() || undefined;
    let iso: string, cents: number;
    try {
      iso = parseDateBR(r[iDate] ?? "");
      cents = parseMoneyCents(r[iVal] ?? "");
    } catch {
      out.skipped.push({ line: r.join(","), reason: "linha não reconhecida" });
      continue;
    }
    out.signedSumCents += cents;
    const investment = classify.isInvestment(desc);
    const rec: TxRecord = {
      date: iso,
      amountCents: Math.abs(cents),
      description: desc,
      accountId: "nu-db",
      externalId: ext,
      flow: cents >= 0 ? "income" : "expense",
      method: "ted",
      isRevenue: 0,
      isInvestmentLeg: investment,
      isCaixinhaLeg: classify.isCaixinhaLeg(desc, "nubank"),
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
