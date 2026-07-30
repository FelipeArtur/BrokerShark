import { DatabaseSync } from "node:sqlite";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config, configPath } from "../config.ts";

const KEEP = 12;
const RE = /^brokershark-\d{4}-\d{2}-\d{2}\.db$/;

/** Sufixo da config que acompanha cada snapshot. Mesma data, mesmo par. */
const CONFIG_SUFFIX = ".config.json";

export function runBackup(dbPath: string, destDir: string, now: Date = new Date()): string {
  if (!existsSync(dbPath)) throw new Error(`DB não encontrado: ${dbPath}`);
  mkdirSync(destDir, { recursive: true });
  const stem = join(destDir, `brokershark-${now.toISOString().slice(0, 10)}`);
  const dest = `${stem}.db`;

  // `VACUUM INTO` RECUSA arquivo que já existe ("output file already exists"),
  // e o nome carrega a data — então rodar duas vezes no mesmo dia estourava. O
  // timer faz isso sozinho: com `Persistent=true`, uma máquina que estava
  // desligada na virada roda no boot, e se já houver backup daquele dia o job
  // falha inteiro. Grava em temporário e renomeia por cima.
  //
  // O rename é atômico dentro do mesmo filesystem: ou o snapshot antigo está
  // lá inteiro, ou o novo está — nunca meio arquivo. Queda no meio do VACUUM
  // deixa um `.tmp` órfão, não um `.db` corrompido com cara de backup bom.
  const tmp = `${dest}.tmp`;
  rmSync(tmp, { force: true });

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, dest);

  copyConfig(stem);
  prune(destDir);
  return dest;
}

/**
 * A config ao lado do snapshot, com a MESMA data no nome.
 *
 * O ledger sozinho não reconstrói a instalação: ele guarda os lançamentos, e a
 * config guarda quais contas existem, qual banco é qual, e as keywords que
 * classificam investimento. Enquanto `config/local.json` estava versionado, o
 * git era o backup dela sem ninguém perceber; desde que saiu, perder a máquina
 * significava restaurar um ledger que ninguém sabe ler.
 *
 * Falha aqui não derruba o backup do ledger — o snapshot já está gravado, e
 * perder a config é recuperável (dá pra redeclarar as contas na mão), perder o
 * ledger não é. Mas avisa alto, senão o backup passa a mentir por omissão.
 */
function copyConfig(stem: string): void {
  const dest = `${stem}${CONFIG_SUFFIX}`;
  try {
    const src = configPath();
    if (!existsSync(src)) return;
    const tmp = `${dest}.tmp`;
    rmSync(tmp, { force: true });
    copyFileSync(src, tmp);
    chmodSync(tmp, 0o600);
    renameSync(tmp, dest);
  } catch (err) {
    console.error(`AVISO: o ledger foi salvo, a config não (${dest}):`, err);
  }
}

/**
 * Mantém as `KEEP` datas mais recentes, e apaga o PAR inteiro das demais.
 *
 * Poda por data, não por arquivo: as datas saem dos `.db`, que são a âncora, e
 * a config de cada uma vai junto. Contar arquivo daria 12 entradas mesmo quando
 * são 6 pares, e a retenção real cairia pela metade sem ninguém notar.
 */
function prune(destDir: string): void {
  const dias = readdirSync(destDir).filter((f) => RE.test(f)).sort();
  for (const db of dias.slice(0, Math.max(0, dias.length - KEEP))) {
    const stem = db.slice(0, -".db".length);
    rmSync(join(destDir, db), { force: true });
    rmSync(join(destDir, `${stem}${CONFIG_SUFFIX}`), { force: true });
  }
}

export function backupStatus(
  destDir: string,
  now: Date = new Date(),
): { exists: boolean; name?: string; age_seconds?: number } {
  if (!existsSync(destDir)) return { exists: false };
  const backups = readdirSync(destDir).filter((f) => RE.test(f)).sort();
  if (backups.length === 0) return { exists: false };
  const name = backups[backups.length - 1];
  const day = name.slice("brokershark-".length, -".db".length);
  const ageMs = now.getTime() - new Date(`${day}T00:00:00Z`).getTime();
  return { exists: true, name, age_seconds: Math.max(0, Math.floor(ageMs / 1000)) };
}

/**
 * Destino dos snapshots: argumento → config → `~/brokershark-backups`.
 *
 * A MESMA ordem vale no servidor (`/api/backup-status`). Se os dois lados
 * divergirem, o painel jura que não há backup enquanto o timer grava feliz
 * noutro diretório.
 */
export function backupDir(explicit?: string): string {
  return explicit ?? config().backupDir ?? join(homedir(), "brokershark-backups");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dbPath = args[0] ?? join(import.meta.dirname, "../../data/brokershark-v2.db");
  const feito = runBackup(dbPath, backupDir(args[1]));
  console.log(`Backup: ${feito}`);
  console.log(`Config: ${feito.slice(0, -".db".length)}${CONFIG_SUFFIX}`);
}
