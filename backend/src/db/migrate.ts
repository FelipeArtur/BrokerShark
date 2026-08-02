import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

/**
 * @brief   Migrations no disco que ainda não rodaram neste DB.
 * @details Quem abre readOnly não pode aplicá-las, e consultar coluna que a pendente
 *          criaria estoura com "SQL logic error" sem explicação.
 */
export function pendingMigrations(db: DatabaseSync, dir: string = MIGRATIONS_DIR): string[] {
  const applied = new Set(
    (db.prepare("SELECT name FROM migration_log").all() as { name: string }[])
      .map((r) => r.name),
  );
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();
}

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
