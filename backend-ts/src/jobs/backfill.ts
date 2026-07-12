/** Backfill v2: constrói data/brokershark-v2.db a partir do acervo de exports.
 *
 *  Uso: node src/jobs/backfill.ts "<dir do acervo>" [<db de saída>]
 *
 *  Idempotente por reconstrução: o DB de saída é recriado do zero a cada run.
 *  Cada fase vive em jobs/backfill/<fase>.ts.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openDb, initSchema, restrictPermissions } from "../db/open.ts";
import { collectAcervo } from "./backfill/files.ts";
import { seedAccountsAndCategories, seedRules } from "./backfill/seeds.ts";
import { makeTxInserter } from "./backfill/txInsert.ts";
import { importNubank, importInter } from "./backfill/extratos.ts";
import { importFaturas } from "./backfill/faturas.ts";
import { pairSelfTransfers } from "./backfill/selfPairs.ts";
import { deriveCaixinha } from "./backfill/caixinha.ts";
import { syncB3 } from "./backfill/b3Sync.ts";
import { printReport } from "./backfill/verify.ts";

const acervoDir = process.argv[2];
const dbPath = process.argv[3] ?? join(import.meta.dirname, "../../../data/brokershark-v2.db");
if (!acervoDir) {
  console.error('uso: node src/jobs/backfill.ts "<dir do acervo>" [<db>]');
  process.exit(1);
}

const acervo = collectAcervo(acervoDir);

for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });
const db = openDb(dbPath);
initSchema(db);

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
