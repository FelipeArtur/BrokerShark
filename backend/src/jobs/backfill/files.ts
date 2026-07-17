/**
 * @file files.ts
 * @brief Descoberta e classificação dos arquivos do acervo por padrão de nome.
 *
 * files.ts — descoberta e classificação dos arquivos do acervo.
 */
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { refDateFromFilename } from "../../ingest/b3.ts";

/** @brief Arquivos do acervo agrupados por formato, já em ordem cronológica. */
export interface Acervo {
  nubank: string[];                      // extratos NU_*.csv (ordem cronológica)
  inter: string[];                       // Extrato-DD-MM-YYYY-a-*.csv
  faturas: string[];                     // fatura-inter-YYYY-MM.csv
  b3: { f: string; ref: string }[];      // relatorio-consolidado-*.xlsx + ref_date
}

/**
 * @brief Listar recursivamente todos os arquivos sob um diretório.
 * @param dir diretório raiz do acervo
 * @return caminhos de todos os arquivos, em qualquer ordem
 * @throws Error se o diretório não puder ser lido
 */
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
 * @brief Extrair a data inicial de um extrato Inter do nome do arquivo, como ISO.
 *
 * Ordenar os extratos Inter cronologicamente é load-bearing: o dedup por contagem
 * e a continuidade de saldo dependem de processar os arquivos em ordem.
 *
 * @param f caminho do extrato; o nome precisa casar "Extrato-DD-MM-YYYY"
 * @return data inicial "YYYY-MM-DD" (ordenável lexicograficamente)
 */
function interStart(f: string): string {
  const m = /Extrato-(\d{2})-(\d{2})-(\d{4})/.exec(basename(f))!;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * @brief Derivar a ref_date de um relatório B3 sem lançar, avisando no console.
 * @param f caminho do relatório
 * @return a ref_date ISO, ou `null` quando o nome é indecifrável (arquivo ignorado)
 */
function refDateSafe(f: string): string | null {
  try {
    return refDateFromFilename(basename(f));
  } catch {
    console.warn(`⚠ ignorando (ref_date indecifrável): ${basename(f)}`);
    return null;
  }
}

/**
 * @brief Varrer o acervo e agrupar os arquivos por formato, em ordem cronológica.
 * @param dir diretório raiz do acervo (varrido recursivamente)
 * @return o Acervo; relatórios B3 sem ref_date decifrável ficam de fora
 */
export function collectAcervo(dir: string): Acervo {
  const files = walk(dir);
  return {
    nubank: files.filter((f) => /NU_\d+_\d{2}[A-Z]{3}\d{4}.*\.csv$/i.test(basename(f))).sort(),
    inter: files
      .filter((f) => /^Extrato-\d{2}-\d{2}-\d{4}-a-.*\.csv$/i.test(basename(f)))
      .sort((a, b) => interStart(a).localeCompare(interStart(b))),
    faturas: files.filter((f) => /^fatura-inter-\d{4}-\d{2}\.csv$/i.test(basename(f))).sort(),
    b3: files
      .filter((f) => /relatorio-consolidado-.*\.xlsx$/i.test(basename(f)))
      .map((f) => ({ f, ref: refDateSafe(f) }))
      .filter((x): x is { f: string; ref: string } => x.ref !== null)
      .sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}
