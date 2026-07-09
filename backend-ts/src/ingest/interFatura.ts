/** Fatura Inter: `"Data","Lançamento","Categoria","Tipo","Valor"` (BOM, quoted).
 *  Categoria = do banco (seed de classificação); Tipo carrega parcelas ("Parcela 2/3"). */
import { parseCsv } from "./csv.ts";
import { parseMoneyCents, parseDateBR } from "../domain/money.ts";

export interface FaturaItem {
  date: string;               // data da compra
  description: string;
  bankCategory: string;
  amountCents: number;        // assinado: positivo = despesa, negativo = estorno/crédito
  installmentSeq?: number;
  installmentTotal?: number;
}

export interface ParsedFatura {
  refMonth: string;           // 'YYYY-MM' do nome do arquivo
  items: FaturaItem[];
  totalCents: number;         // soma assinada
  skipped: { line: string; reason: string }[];
}

export function parseInterFatura(text: string, sourceFile: string): ParsedFatura {
  const m = /fatura-inter-(\d{4})-(\d{2})/.exec(sourceFile);
  if (!m) throw new Error(`${sourceFile}: nome não bate fatura-inter-YYYY-MM`);
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
    // Linha de crédito "PAGAMENTO ON LINE"/débito automático = espelho do pagamento
    // da fatura ANTERIOR dentro do CSV — não é item de consumo; a liquidação real
    // é a perna do extrato. Mantê-la dobraria a representação do pagamento.
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
