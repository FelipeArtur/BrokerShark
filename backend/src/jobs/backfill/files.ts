import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { refDateFromFilename } from "../../ingest/b3.ts";

export interface Acervo {
  nubank: string[];
  inter: string[];
  faturas: string[];
  b3: { f: string; ref: string }[];
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

function interStart(f: string): string {
  const m = /Extrato-(\d{2})-(\d{2})-(\d{4})/.exec(basename(f))!;
  return `${m[3]}-${m[2]}-${m[1]}`;
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
