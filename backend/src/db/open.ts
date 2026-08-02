import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA synchronous=NORMAL");
  return db;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(readFileSync(join(HERE, "schema.sql"), "utf-8"));
}

export function restrictPermissions(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = path + suffix;
    if (existsSync(p)) chmodSync(p, 0o600);
  }
}

/**
 * @brief   O caminho do DB nos argumentos, ou `undefined` pro padrão de quem chama.
 * @details A guarda pula o NÚMERO depois de `--port`; sem a flag, `indexOf` dá −1 e
 *          ela descartava o índice 0, que é onde o caminho vem.
 * @warning Errar aqui serve o ledger de PRODUÇÃO em silêncio, com a tela normal.
 */
export function pickDbPath(args: string[]): string | undefined {
  const portIdx = args.indexOf("--port");
  const valorDaPorta = portIdx >= 0 ? portIdx + 1 : -1;
  return args.find((a, i) => !a.startsWith("--") && i !== valorDaPorta);
}
