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

  //> `VACUUM INTO` recusa arquivo existente e o nome carrega a data: grava em `.tmp`
  //> e renomeia (atômico), senão o catch-up do timer estoura no mesmo dia.
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
 * @brief   A config ao lado do snapshot, com a MESMA data no nome.
 * @details Sem ela o ledger restaura mas ninguém sabe que conta é qual.
 * @note    Falhar aqui não derruba o backup do ledger, mas avisa alto.
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
 * @brief   Mantém as `KEEP` DATAS mais recentes; apaga o par `.db` + config das demais.
 * @warning Poda por data, não por arquivo: contar arquivo cortaria a retenção pela metade.
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
 * @brief   Destino dos snapshots: argumento → config → `~/brokershark-backups`.
 * @warning O servidor usa a MESMA função. Divergir faz o painel jurar que não há backup.
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
