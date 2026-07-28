// Fatura de cartão em CSV ITEMIZADO — um item por compra.
//
// O formato traz a categoria que o banco atribuiu e o número da parcela
// ("Parcela 2/6"), que é o que permite projetar compromisso futuro. Os itens
// são os gastos reais; o pagamento da fatura no extrato é liquidação.
//
import { parseCsv } from "./csv.ts";
import { parseMoneyCents, parseDateBR } from "../domain/money.ts";

export interface InvoiceItem {
  date: string;
  description: string;
  bankCategory: string;
  amountCents: number;
  installmentSeq?: number;
  installmentTotal?: number;
}

export interface ParsedFatura {
  refMonth: string;
  items: InvoiceItem[];
  totalCents: number;
  skipped: { line: string; reason: string }[];
}

export function parseInvoiceItemized(text: string, sourceFile: string): ParsedFatura {
  // O mês de referência vem do NOME do arquivo, e a única coisa exigida dele é
  // um `YYYY-MM`. Amarrar o padrão ao nome que um banco específico exporta
  // quebra qualquer conta cujo `filePattern` na config diga outra coisa —
  // inclusive o `fatura-YYYY-MM.csv` que o próprio default declara.
  const m = /(\d{4})-(0[1-9]|1[0-2])(?!\d)/.exec(sourceFile);
  if (!m) throw new Error(`${sourceFile}: nome do arquivo precisa conter o mês de referência (YYYY-MM)`);
  const refMonth = `${m[1]}-${m[2]}`;

  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const iData = header.indexOf("data");
  const iDesc = header.findIndex((h) => h.startsWith("lançamento") || h.startsWith("lancamento"));
  const iCat = header.indexOf("categoria");
  const iTipo = header.indexOf("tipo");
  const iVal = header.indexOf("valor");
  if (iData < 0 || iVal < 0) throw new Error(`${sourceFile}: header inesperado`);

  const out: ParsedFatura = { refMonth, items: [], totalCents: 0, skipped: [] };
  for (const r of rows.slice(1)) {
    let date: string, cents: number;
    try {
      date = parseDateBR(r[iData] ?? "");
      cents = parseMoneyCents(r[iVal] ?? "");
    } catch {
      out.skipped.push({ line: r.join(","), reason: "linha não reconhecida" });
      continue;
    }
    const desc = (r[iDesc] ?? "").split(/\s+/).join(" ").trim();

    if (cents < 0 && desc.toLowerCase().includes("pagamento")) {
      out.skipped.push({ line: r.join(","), reason: "espelho de pagamento (crédito)" });
      continue;
    }
    const tipo = (r[iTipo] ?? "").trim();
    const parc = /parcela\s+(\d+)\/(\d+)/i.exec(tipo);
    out.items.push({
      date,
      description: desc,
      bankCategory: (r[iCat] ?? "").trim(),
      amountCents: cents,
      installmentSeq: parc ? Number(parc[1]) : undefined,
      installmentTotal: parc ? Number(parc[2]) : undefined,
    });
    out.totalCents += cents;
  }
  return out;
}
