/**
 * @file backfill.ts
 * @brief Orquestrador do backfill: reconstrói o DB do acervo, fase a fase, e verifica.
 *
 * Backfill v2: constrói backend/data/brokershark-v2.db a partir do acervo de exports.
 *
 * Uso: node src/jobs/backfill.ts "<dir do acervo>" [<db de saída>] [--force]
 *
 * Idempotente por reconstrução: o DB de saída é recriado do zero a cada run.
 * Cada fase vive em jobs/backfill/<fase>.ts.
 *
 * A ORDEM das fases é load-bearing: extratos antes das faturas (a reconciliação do
 * pagamento precisa das pernas já inseridas); SELF depois de todos os extratos (o
 * par pode cruzar bancos); Caixinha depois do SELF (usa as pernas coletadas no
 * insert); B3 por último, pois é tabela-verdade independente do ledger.
 *
 * Script de entrada — executa no import; não exporta nada.
 */
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openDb, initSchema, restrictPermissions } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { hasUserOverlay } from "./backfill/guard.ts";
import { collectAcervo } from "./backfill/files.ts";
import { seedAccountsAndCategories, seedRules } from "./backfill/seeds.ts";
import { makeTxInserter } from "./backfill/txInsert.ts";
import { importNubank, importInter } from "./backfill/extratos.ts";
import { importFaturas } from "./backfill/faturas.ts";
import { pairSelfTransfers } from "./backfill/selfPairs.ts";
import { deriveCaixinha } from "./backfill/caixinha.ts";
import { syncB3 } from "./backfill/b3Sync.ts";
import { printReport } from "./backfill/verify.ts";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");
const acervoDir = positional[0];
const dbPath = positional[1] ?? join(import.meta.dirname, "../../data/brokershark-v2.db");
if (!acervoDir) {
  console.error('uso: node src/jobs/backfill.ts "<dir do acervo>" [<db>] [--force]');
  process.exit(1);
}

if (existsSync(dbPath) && !force) {
  const existing = openDb(dbPath);
  const overlay = hasUserOverlay(existing);
  existing.close();
  if (overlay) {
    console.error(
      "Abortado: o DB tem dados escritos pela UI (edições/lançamentos/importações).\n" +
      "Um rebuild apagaria tudo. Use --force para reconstruir mesmo assim,\n" +
      "ou importe novos meses pela UI (import incremental).",
    );
    process.exit(1);
  }
}

const acervo = collectAcervo(acervoDir);

for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });
const db = openDb(dbPath);
initSchema(db);
runMigrations(db);

seedAccountsAndCategories(db);
const ins = makeTxInserter(db);

const nuStats = importNubank(ins, acervo.nubank);
const inter = importInter(db, ins, acervo.inter);
const faturaReport = importFaturas(db, ins, acervo.faturas);
const selfPairs = pairSelfTransfers(db);
const caixinha = deriveCaixinha(db, ins.caixinhaTxIds);
const b3Log = syncB3(db, acervo.b3);
seedRules(db);

db.exec("INSERT INTO migration_log (name, ran_at) VALUES ('backfill-acervo-v2', datetime('now'))");
restrictPermissions(dbPath);

printReport(db, { dbPath, acervo, nuStats, inter, faturaReport, selfPairs, caixinha, b3Log });
db.close();
