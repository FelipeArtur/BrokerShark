import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_CHECK_COUNT, auditLedger } from "../db/audit.ts";
import { pendingMigrations } from "../db/migrate.ts";
import { reviewInvestments } from "./backfill/investReview.ts";
import { fmtCents } from "../domain/money.ts";

// Confere as invariantes financeiras contra o DB VIVO, sem reconstruir nada.
// O backfill só valida o que ele mesmo acabou de escrever; este roda em cima do
// banco do dia a dia, que muda pelo import da UI.
//
//   node src/jobs/audit.ts [<db>]
//
// Sai com 1 se alguma invariante quebrou — dá pra pendurar num timer.

const dbPath = process.argv.slice(2).find(a => !a.startsWith("--"))
  ?? join(import.meta.dirname, "../../data/brokershark-v2.db");

if (!existsSync(dbPath)) {
  console.error(`DB não encontrado: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

console.log("AUDITORIA —", dbPath);

// Um check pode consultar coluna que só existe depois de uma migration. Como
// aqui o DB é read-only, não dá pra aplicá-la — e rodar assim mesmo estouraria
// com "SQL logic error", que não conta nada. Aviso e saio.
const pending = pendingMigrations(db);
if (pending.length) {
  console.error(`  ✗ ${pending.length} migration(s) pendente(s): ${pending.join(", ")}`);
  console.error("    Suba o server (npm start) ou rode o backfill uma vez pra aplicar, depois audite.");
  db.close();
  process.exit(1);
}

const violations = auditLedger(db);
const invRev = reviewInvestments(db);
const problems = violations.length + invRev.violations.length;

if (violations.length === 0) {
  console.log(`  ✓ ledger: ${AUDIT_CHECK_COUNT} invariantes intactas`);
} else {
  for (const v of violations) console.error(`  ✗ ${v.check} (${v.count}): ${v.message}`);
}

if (invRev.violations.length === 0) {
  console.log("  ✓ investimentos: invariantes intactas");
} else {
  for (const v of invRev.violations) console.error(`  ✗ investimentos: ${v}`);
}

console.log(`\n  posições abertas: ${fmtCents(invRev.panorama.totalCents)}`);

db.close();

if (problems > 0) {
  console.error(`\n${problems} violação(ões) — algum total da tela está mentindo.`);
  process.exit(1);
}
