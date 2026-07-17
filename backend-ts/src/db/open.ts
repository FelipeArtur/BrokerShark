/**
 * @file open.ts
 * @brief Abertura do SQLite v2, carga do schema e travamento de permissões do arquivo.
 *
 * Abertura do SQLite v2 via node:sqlite (builtin — zero deps nativas).
 */
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @brief Abrir o banco aplicando os PRAGMAs obrigatórios do ledger.
 *
 * WAL + foreign_keys=ON + synchronous=NORMAL: `foreign_keys` é load-bearing — as FKs
 * de transactions (conta, categoria, fatura, investimento) só valem com ele ligado.
 *
 * @param path caminho do arquivo .db (criado se não existir)
 * @return conexão DatabaseSync já configurada
 */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA synchronous=NORMAL");
  return db;
}

/**
 * @brief Aplicar o DDL de schema.sql (fonte única do schema v2) no banco aberto.
 * @param db conexão alvo
 * @throws Error se schema.sql não puder ser lido ou o DDL falhar
 */
export function initSchema(db: DatabaseSync): void {
  db.exec(readFileSync(join(HERE, "schema.sql"), "utf-8"));
}

/**
 * @brief Restringir o .db e seus arquivos WAL/SHM a 0600.
 *
 * Ledger financeiro pessoal: arquivo 0600 (sem auth na app, perms = fronteira at-rest).
 * WAL e SHM entram junto — o conteúdo do ledger passa por eles.
 *
 * @param path caminho do .db; os sufixos "-wal" e "-shm" são tratados quando existem
 */
export function restrictPermissions(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = path + suffix;
    if (existsSync(p)) chmodSync(p, 0o600);
  }
}
