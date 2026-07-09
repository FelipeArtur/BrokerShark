/** Relatório consolidado B3 (.xlsx) → posições + snapshot.
 *  Abas reais no acervo: Posição - Tesouro Direto | Renda Fixa | Ações | BDR.
 *  Valores vêm como string com decimal em PONTO ("188.02") ou número; "-" = ausente. */
import * as XLSX from "xlsx";

export interface B3Position {
  name: string;
  matchKey: string;
  code: string | null;
  type: string;              // tesouro|cdb|lci|acao|bdr|...
  bank: string;
  indexer: string | null;
  maturityIso: string | null;
  quantity: number | null;
  unitPriceCents: number | null;
  appliedCents: number | null;
  grossCents: number | null;
  netCents: number;
  sheet: string;
}

export interface B3Report {
  refDate: string;           // ISO, derivada do nome do arquivo
  positions: B3Position[];
  sheets: string[];          // abas de posição presentes (p/ heurística de soft-close)
}

const MONTHS: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", março: "03", abril: "04",
  maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09",
  outubro: "10", novembro: "11", dezembro: "12",
};

export function refDateFromFilename(file: string): string {
  let m = /anual-(\d{4})/.exec(file);
  if (m) return `${m[1]}-12-31`;
  m = /mensal-(\d{4})-([a-zç]+)/i.exec(file);
  if (m) {
    const mm = MONTHS[m[2]!.toLowerCase()];
    if (mm) {
      const last = new Date(Number(m[1]), Number(mm), 0).getDate();
      return `${m[1]}-${mm}-${String(last).padStart(2, "0")}`;
    }
  }
  throw new Error(`não consegui derivar ref_date de: ${file}`);
}

function cellNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/R\$|\s/g, "");
  if (!s || s === "-") return null;
  let t = s;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const toCents = (n: number | null): number | null =>
  n === null ? null : Math.round(n * 100);

function cellStr(v: unknown): string {
  return String(v ?? "").trim();
}

function bankFrom(inst: string): string {
  const s = inst.toLowerCase();
  if (s.includes("inter")) return "inter";
  if (s.includes("nu")) return "nubank";
  return "outro";
}

function indexerFrom(raw: string): string | null {
  const s = raw.toLowerCase();
  if (!s || s === "-") return null;
  if (s.includes("ipca")) return "ipca";
  if (s.includes("selic")) return "selic";
  if (s.includes("cdi")) return "cdi";
  if (s.includes("pre") || s.includes("pré")) return "prefixado";
  return s;
}

function brToIso(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

type Row = Record<string, unknown>;

function sheetRows(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
}

const isTotalRow = (product: string) => !product || product.toLowerCase().startsWith("total");

export function parseB3(buf: Buffer, filename: string): B3Report {
  const wb = XLSX.read(buf, { type: "buffer" });
  const report: B3Report = { refDate: refDateFromFilename(filename), positions: [], sheets: [] };
  for (const name of wb.SheetNames) {
    const low = name.toLowerCase();
    const ws = wb.Sheets[name]!;
    if (low.includes("tesouro")) {
      report.sheets.push(name);
      for (const r of sheetRows(ws)) {
        const product = cellStr(r["Produto"]);
        if (isTotalRow(product)) continue;
        const net = cellNum(r["Valor líquido"]) ?? cellNum(r["Valor Atualizado"]);
        if (net === null) continue;
        const isin = cellStr(r["Código ISIN"]) || null;
        report.positions.push({
          name: product,
          matchKey: isin ?? `tesouro:${product.toLowerCase()}`,
          code: isin,
          type: "tesouro",
          bank: bankFrom(cellStr(r["Instituição"])),
          indexer: indexerFrom(cellStr(r["Indexador"])),
          maturityIso: brToIso(cellStr(r["Vencimento"])),
          quantity: cellNum(r["Quantidade"]),
          unitPriceCents: null,
          appliedCents: toCents(cellNum(r["Valor Aplicado"])),
          grossCents: toCents(cellNum(r["Valor bruto"])),
          netCents: toCents(net)!,
          sheet: name,
        });
      }
    } else if (low.includes("renda fixa")) {
      report.sheets.push(name);
      for (const r of sheetRows(ws)) {
        const product = cellStr(r["Produto"]);
        if (isTotalRow(product)) continue;
        // CDBs do Inter não expõem MTM — CURVA é o valor canônico (regra v1 mantida)
        const value = cellNum(r["Valor Atualizado CURVA"]) ?? cellNum(r["Valor Atualizado MTM"]);
        if (value === null) continue;
        const code = cellStr(r["Código"]) || null;
        const firstTok = product.toLowerCase().split(/[\s-]+/)[0] ?? "renda_fixa";
        report.positions.push({
          name: code ? `${product} (${code})` : product,
          matchKey: code ?? `rf:${product.toLowerCase()}`,
          code,
          type: /^[a-zç]+$/.test(firstTok) ? firstTok : "renda_fixa",
          bank: bankFrom(cellStr(r["Instituição"])),
          indexer: indexerFrom(cellStr(r["Indexador"])),
          maturityIso: brToIso(cellStr(r["Vencimento"])),
          quantity: cellNum(r["Quantidade"]),
          unitPriceCents: toCents(cellNum(r["Preço Atualizado CURVA"]) ?? cellNum(r["Preço Atualizado MTM"])),
          appliedCents: null,
          grossCents: toCents(cellNum(r["Valor Atualizado CURVA"])),
          netCents: toCents(value)!,
          sheet: name,
        });
      }
    } else if (low.includes("ações") || low.includes("acoes") || low.includes("bdr")) {
      report.sheets.push(name);
      const type = low.includes("bdr") ? "bdr" : "acao";
      for (const r of sheetRows(ws)) {
        const product = cellStr(r["Produto"]);
        if (isTotalRow(product)) continue;
        const value = cellNum(r["Valor Atualizado"]);
        if (value === null) continue;
        const ticker = cellStr(r["Código de Negociação"]) || null;
        report.positions.push({
          name: product,
          matchKey: ticker ?? `${type}:${product.toLowerCase()}`,
          code: ticker,
          type,
          bank: bankFrom(cellStr(r["Instituição"])),
          indexer: null,
          maturityIso: null,
          quantity: cellNum(r["Quantidade"]),
          unitPriceCents: toCents(cellNum(r["Preço de Fechamento"])),
          appliedCents: null,
          grossCents: null,
          netCents: toCents(value)!,
          sheet: name,
        });
      }
    }
  }
  return report;
}
