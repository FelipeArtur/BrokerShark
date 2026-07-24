import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEEP = 12;
const RE = /^brokershark-\d{4}-\d{2}-\d{2}\.db$/;

export function runBackup(dbPath: string, destDir: string, now: Date = new Date()): string {
  if (!existsSync(dbPath)) throw new Error(`DB não encontrado: ${dbPath}`);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `brokershark-${now.toISOString().slice(0, 10)}.db`);
  const db = new DatabaseSync(dbPath);

  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  db.close();
  chmodSync(dest, 0o600);
  prune(destDir);
  return dest;
}

function prune(destDir: string): void {
  const backups = readdirSync(destDir).filter((f) => RE.test(f)).sort();
  for (const f of backups.slice(0, Math.max(0, backups.length - KEEP))) {
    rmSync(join(destDir, f));
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

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dbPath = args[0] ?? join(import.meta.dirname, "../../data/brokershark-v2.db");
  const destDir = args[1] ?? join(homedir(), "brokershark-backups");
  console.log(`Backup: ${runBackup(dbPath, destDir)}`);
}
