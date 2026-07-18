/**
 * @file migrate.ts
 * @brief Runner de migrations forward-only: aplica SQL numerado uma vez por DB.
 *
 * Complementa schema.sql (CREATE ... IF NOT EXISTS): cobre o que o baseline
 * idempotente NÃO expressa — ALTER/rename/drop/data-fix. Ordem = nome do arquivo
 * (NNNN_slug.sql). Cada migration roda uma vez por DB (guarda em migration_log) e
 * dentro de uma transação: falha → ROLLBACK + throw (aborta o boot).
 *
 * Migrations NÃO devem conter BEGIN/COMMIT — o runner envelopa.
 */
import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

/**
 * @brief Aplicar as migrations pendentes em ordem lexicográfica de nome.
 * @param db conexão já com initSchema aplicado (migration_log precisa existir)
 * @param dir diretório de migrations (default ./migrations) — parametrizável p/ teste
 * @return nomes das migrations aplicadas nesta chamada, em ordem
 */
export function runMigrations(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (db.prepare("SELECT name FROM migration_log").all() as { name: string }[])
      .map((r) => r.name),
  );
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO migration_log(name, ran_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${file} falhou: ${(err as Error).message}`);
    }
    ran.push(file);
  }
  return ran;
}
