import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openDb, initSchema, restrictPermissions } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { userOverlay } from "./backfill/guard.ts";
import { collectAcervo } from "./backfill/files.ts";
import { seedAccounts, seedRules } from "./backfill/seeds.ts";
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
  const found = userOverlay(existing);
  existing.close();
  if (found.length) {
    // Lista o que se perde, item a item: "dados da UI" não dá pra avaliar, e
    // um aviso que não dá pra avaliar é um aviso que se aprende a ignorar.
    console.error("Abortado: o DB tem dados que um rebuild apagaria e nenhum acervo recria:\n");
    for (const f of found) console.error(`  · ${f.count} ${f.label}`);
    console.error(
      "\nImporte os meses novos pela UI (import incremental) em vez de reconstruir.\n" +
      "Se realmente quiser jogar isso fora, rode de novo com --force.",
    );
    process.exit(1);
  }
}

const acervo = collectAcervo(acervoDir);

for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });
const db = openDb(dbPath);
initSchema(db);
runMigrations(db);

seedAccounts(db);
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
