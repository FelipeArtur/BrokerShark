/**
 * @file b3.ts
 * @brief Parser do relatório consolidado B3 (.xlsx) → posições + snapshot datado.
 *
 * Relatório consolidado B3 (.xlsx) → posições + snapshot.
 * Abas reais no acervo: Posição - Tesouro Direto | Renda Fixa | Ações | BDR.
 * Valores vêm como string com decimal em PONTO ("188.02") ou número; "-" = ausente.
 */
import * as XLSX from "xlsx";

/** @brief Posição lida de uma aba do relatório; valores *Cents em centavos inteiros. */
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

/**
 * @brief Relatório parseado: data de referência, posições e abas presentes.
 *
 * `sheets` é load-bearing: a aba Renda Fixa PISCA no consolidado, e sua ausência
 * significa "sem informação", não "posição fechada" (ver b3Sync.ts).
 */
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

/**
 * @brief Derivar a data de referência do snapshot a partir do nome do arquivo.
 *
 * A data vem do NOME, não do conteúdo: relatório "anual-YYYY" ancora em 31/12;
 * "mensal-YYYY-<mês>" ancora no último dia daquele mês.
 *
 * @param file nome do arquivo do relatório
 * @return data de referência ISO "YYYY-MM-DD"
 * @throws Error se o nome não casar nenhum dos dois padrões
 */
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

/**
 * @brief Ler uma célula numérica do xlsx, tolerando texto, "R$" e "-".
 * @param v valor cru da célula (número ou string)
 * @return o número em REAIS (ainda não convertido para centavos), ou `null` quando
 *         a célula é vazia, "-" ou não-numérica
 */
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

/**
 * @brief Converter reais (float do xlsx) em centavos inteiros.
 *
 * Único ponto do sistema onde dinheiro passa por float: o xlsx já entrega número
 * binário, então arredondar aqui é o mais fiel possível à célula original.
 *
 * @param n valor em reais, ou `null`
 * @return valor em centavos inteiros, ou `null` se a entrada for `null`
 */
const toCents = (n: number | null): number | null =>
  n === null ? null : Math.round(n * 100);

/**
 * @brief Ler uma célula como texto trimado.
 * @param v valor cru da célula
 * @return o texto trimado; "" quando a célula é nula
 */
function cellStr(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * @brief Deduzir o banco a partir do nome da instituição custodiante.
 * @param inst nome da instituição na planilha
 * @return "inter", "nubank" ou "outro"
 */
function bankFrom(inst: string): string {
  const s = inst.toLowerCase();
  if (s.includes("inter")) return "inter";
  if (s.includes("nu")) return "nubank";
  return "outro";
}

/**
 * @brief Normalizar o indexador do papel para um rótulo canônico.
 * @param raw texto do indexador na planilha
 * @return "ipca", "selic", "cdi", "prefixado", o texto em minúsculas quando não
 *         reconhecido, ou `null` se vazio/"-"
 */
function indexerFrom(raw: string): string | null {
  const s = raw.toLowerCase();
  if (!s || s === "-") return null;
  if (s.includes("ipca")) return "ipca";
  if (s.includes("selic")) return "selic";
  if (s.includes("cdi")) return "cdi";
  if (s.includes("pre") || s.includes("pré")) return "prefixado";
  return s;
}

/**
 * @brief Converter data "DD/MM/YYYY" da planilha em ISO, sem lançar.
 *
 * Variante tolerante de parseDateBR: célula de vencimento pode vir vazia ou "-",
 * e isso é ausência legítima, não erro de arquivo.
 *
 * @param raw texto da célula de data
 * @return data ISO "YYYY-MM-DD", ou `null` se não casar o formato
 */
function brToIso(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** @brief Linha de planilha indexada pelo nome da coluna. */
type Row = Record<string, unknown>;

/**
 * @brief Converter uma aba em linhas indexadas por coluna.
 * @param ws worksheet do xlsx
 * @return as linhas, com célula ausente valendo `null`
 */
function sheetRows(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
}

/**
 * @brief Dizer se a linha é rodapé de total (não é posição).
 *
 * Linha de total somaria de novo o que já foi contado — nunca vira posição.
 *
 * @param product conteúdo da coluna "Produto"
 * @return true se o produto for vazio ou começar com "total"
 */
const isTotalRow = (product: string) => !product || product.toLowerCase().startsWith("total");

/**
 * @brief Parsear o relatório consolidado B3 em posições datadas.
 *
 * Cada aba tem sua coluna canônica de valor: Tesouro usa "Valor líquido" (com
 * fallback "Valor Atualizado"); Renda Fixa usa CURVA (ver comentário no corpo);
 * Ações/BDR usam "Valor Atualizado". Linha sem valor é ignorada.
 *
 * @param buf conteúdo binário do .xlsx
 * @param filename nome do arquivo — é dele que sai a `refDate`
 * @return relatório com posições (valores em centavos inteiros) e as abas de
 *         posição presentes
 * @throws Error se a `refDate` não puder ser derivada do nome do arquivo
 */
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
