import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { refDateFromFilename } from "../../ingest/b3.ts";
import { config, type AccountConfig } from "../../config.ts";

// Descoberta de arquivos no acervo.
//
// Que arquivo pertence a que conta é decisão da CONFIG (`filePattern`), não deste
// módulo: o nome que cada banco dá ao export é dele, muda quando ele quiser, e
// não é conhecimento de domínio. Aqui só se aplica o padrão e se ordena.

export interface AccountFiles {
  account: AccountConfig;
  files: string[];
}

export interface Acervo {
  statements: AccountFiles[];
  invoices: AccountFiles[];
  brokerReports: { f: string; ref: string }[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Ordena pela data que estiver no nome do arquivo, quando houver.
 *
 * Extrato com saldo corrente PRECISA entrar em ordem cronológica: a conferência
 * do saldo compara o fecho de um arquivo com a abertura do próximo, e fora de
 * ordem ela acusa descontinuidade que não existe. Sem data no nome, ordem
 * alfabética — que costuma ser a mesma coisa quando o nome começa com a data.
 */
function byDateInName(a: string, b: string): number {
  const key = (f: string) => {
    const m = /(\d{2})-(\d{2})-(\d{4})/.exec(basename(f));
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const iso = /(\d{4})-(\d{2})/.exec(basename(f));
    return iso ? iso[0] : basename(f);
  };
  return key(a).localeCompare(key(b));
}

function refDateSafe(f: string): string | null {
  try {
    return refDateFromFilename(basename(f));
  } catch {
    console.warn(`⚠ ignorando (ref_date indecifrável): ${basename(f)}`);
    return null;
  }
}

export function collectAcervo(dir: string): Acervo {
  const files = walk(dir);
  const c = config();

  const matching = (a: AccountConfig): string[] => {
    if (!a.filePattern) return [];
    const re = new RegExp(a.filePattern, "i");
    return files.filter(f => re.test(basename(f))).sort(byDateInName);
  };

  const brokerRe = new RegExp(c.brokerReportPattern ?? "relatorio-consolidado-.*\\.xlsx$", "i");

  return {
    statements: c.accounts
      .filter(a => a.type === "checking" && a.statementFormat)
      .map(a => ({ account: a, files: matching(a) }))
      .filter(x => x.files.length > 0),
    invoices: c.accounts
      .filter(a => a.type === "credit_card" && a.invoiceFormat)
      .map(a => ({ account: a, files: matching(a) }))
      .filter(x => x.files.length > 0),
    brokerReports: files
      .filter(f => brokerRe.test(basename(f)))
      .map(f => ({ f, ref: refDateSafe(f) }))
      .filter((x): x is { f: string; ref: string } => x.ref !== null)
      .sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}
