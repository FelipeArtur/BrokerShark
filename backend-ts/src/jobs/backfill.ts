/** Backfill v2: constrói data/brokershark-v2.db a partir do acervo de exports.
 *
 *  Uso: node src/jobs/backfill.ts "<dir do acervo>" [<db de saída>]
 *
 *  Pipeline: schema → seeds → extratos Nubank (dedup UUID) → extratos Inter
 *  (dedup por contagem + check de saldo corrente) → faturas Inter (itens +
 *  reconciliação do pagamento) → pareamento SELF → Caixinha (posição ledger)
 *  → relatórios B3 (posições + snapshots + soft-close) → verificação.
 *  Idempotente por reconstrução: o DB de saída é recriado do zero a cada run.
 */
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb, initSchema, restrictPermissions } from "../db/open.ts";
import { fmtCents } from "../domain/money.ts";
import { parseNubankExtrato } from "../ingest/nubankExtrato.ts";
import { parseInterExtrato, type InterParsed } from "../ingest/interExtrato.ts";
import { parseInterFatura } from "../ingest/interFatura.ts";
import { parseB3, type B3Report } from "../ingest/b3.ts";
import type { TxRecord } from "../ingest/types.ts";

const acervoDir = process.argv[2];
const dbPath = process.argv[3] ?? join(import.meta.dirname, "../../../data/brokershark-v2.db");
if (!acervoDir) {
  console.error('uso: node src/jobs/backfill.ts "<dir do acervo>" [<db>]');
  process.exit(1);
}

// ── coleta de arquivos ────────────────────────────────────────────────────────
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(acervoDir);
const nubankFiles = files.filter((f) => /NU_\d+_\d{2}[A-Z]{3}\d{4}.*\.csv$/i.test(basename(f))).sort();
const interFiles = files
  .filter((f) => /^Extrato-\d{2}-\d{2}-\d{4}-a-.*\.csv$/i.test(basename(f)))
  .sort((a, b) => interStart(a).localeCompare(interStart(b)));
const faturaFiles = files.filter((f) => /^fatura-inter-\d{4}-\d{2}\.csv$/i.test(basename(f))).sort();
const b3Files = files
  .filter((f) => /relatorio-consolidado-.*\.xlsx$/i.test(basename(f)))
  .map((f) => ({ f, ref: refDateSafe(f) }))
  .filter((x): x is { f: string; ref: string } => x.ref !== null)
  .sort((a, b) => a.ref.localeCompare(b.ref));

function interStart(f: string): string {
  const m = /Extrato-(\d{2})-(\d{2})-(\d{4})/.exec(basename(f))!;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function refDateSafe(f: string): string | null {
  try {
    // import estático abaixo; função importada de b3.ts
    return refDateFromFilename(basename(f));
  } catch {
    console.warn(`⚠ ignorando (ref_date indecifrável): ${basename(f)}`);
    return null;
  }
}
import { refDateFromFilename } from "../ingest/b3.ts";

// ── DB novo ───────────────────────────────────────────────────────────────────
for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });
const db: DatabaseSync = openDb(dbPath);
initSchema(db);

db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)").run("nu-db", "nubank", "checking", "Nubank Conta");
db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)").run("inter-db", "inter", "checking", "Inter Conta");
db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)").run("inter-cc", "inter", "credit_card", "Inter Cartão");

const EXPENSE_CATS = ["Alimentação", "Carro", "Jogos", "Lazer", "Atividade física",
  "Eletrônicos", "Educação", "Igreja", "Dízimo", "Outro", "Eventos / Terceiros"];
const INCOME_CATS = ["Salário", "Freela", "PIX recebido", "Transferência", "Outro"];
const catStmt = db.prepare("INSERT INTO categories (name, flow) VALUES (?,?)");
for (const c of EXPENSE_CATS) catStmt.run(c, "expense");
for (const c of INCOME_CATS) catStmt.run(c, "income");

const insTx = db.prepare(`
  INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, is_revenue,
     external_id, invoice_id, installment_seq, installment_total, bank_category, source_file)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING
`);

interface InsertStats { inserted: number; dup: number; skipped: number; signedSum: number }
const caixinhaTxIds: number[] = [];

function insertRecord(rec: TxRecord, stats: InsertStats): void {
  const r = insTx.run(
    rec.date, rec.flow, rec.method, rec.accountId, rec.amountCents, rec.description,
    rec.isRevenue, rec.externalId ?? null, null, null, null, null, rec.sourceFile,
  );
  if (r.changes === 0) { stats.dup++; return; }
  stats.inserted++;
  if (rec.isCaixinhaLeg) caixinhaTxIds.push(Number(r.lastInsertRowid));
}

// ── 1. Nubank ─────────────────────────────────────────────────────────────────
const nuStats: InsertStats = { inserted: 0, dup: 0, skipped: 0, signedSum: 0 };
for (const f of nubankFiles) {
  const parsed = parseNubankExtrato(readFileSync(f, "utf-8"), basename(f));
  nuStats.skipped += parsed.skipped.length;
  nuStats.signedSum += parsed.signedSumCents;
  for (const rec of parsed.records) insertRecord(rec, nuStats);
}

// ── 2. Inter (dedup por contagem de ocorrência; checks de saldo) ─────────────
const interStats: InsertStats = { inserted: 0, dup: 0, skipped: 0, signedSum: 0 };
const interWarnings: string[] = [];
const globalCount = new Map<string, number>();
let interOpening: number | undefined;
let interClosing: number | undefined;
let prevClosing: number | undefined;
for (const f of interFiles) {
  const parsed: InterParsed = parseInterExtrato(readFileSync(f, "utf-8"), basename(f));
  interStats.skipped += parsed.skipped.length;
  interWarnings.push(...parsed.warnings);
  if (interOpening === undefined) interOpening = parsed.openingBalanceCents;
  if (prevClosing !== undefined && parsed.openingBalanceCents !== undefined
      && prevClosing !== parsed.openingBalanceCents) {
    interWarnings.push(
      `descontinuidade entre arquivos em ${basename(f)}: fecho anterior ${fmtCents(prevClosing)} ≠ abertura ${fmtCents(parsed.openingBalanceCents)}`,
    );
  }
  prevClosing = parsed.closingBalanceCents ?? prevClosing;
  interClosing = parsed.closingBalanceCents ?? interClosing;

  const fileCount = new Map<string, number>();
  for (const rec of parsed.records) {
    const key = `${rec.date}|${rec.flow}|${rec.amountCents}|${rec.description}`;
    const seenInFile = (fileCount.get(key) ?? 0) + 1;
    fileCount.set(key, seenInFile);
    if (seenInFile <= (globalCount.get(key) ?? 0)) { interStats.dup++; continue; }
    insertRecord(rec, interStats);
    globalCount.set(key, seenInFile);
    interStats.signedSum += rec.flow === "income" ? rec.amountCents : -rec.amountCents;
  }
}
if (interOpening !== undefined) {
  db.prepare("UPDATE accounts SET initial_balance_cents = ? WHERE id = 'inter-db'").run(interOpening);
}

// ── 3. Faturas Inter (itens no inter-cc + reconciliação do pagamento) ────────
const insInvoice = db.prepare(
  "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES (?,?,?,?)",
);
const faturaReport: string[] = [];
for (const f of faturaFiles) {
  const fat = parseInterFatura(readFileSync(f, "utf-8"), basename(f));
  const invId = Number(insInvoice.run("inter-cc", fat.refMonth, fat.totalCents, basename(f)).lastInsertRowid);
  for (const it of fat.items) {
    insTx.run(
      it.date,
      it.amountCents >= 0 ? "expense" : "income",
      "credit", "inter-cc", Math.abs(it.amountCents), it.description,
      0, null, invId, it.installmentSeq ?? null, it.installmentTotal ?? null,
      it.bankCategory || null, basename(f),
    );
  }
  // Pagamento no extrato: valor EXATO do total limpo da fatura, janela de
  // −70/+35 dias do refMonth (nos dados reais o pagamento antecede o mês-rótulo
  // em ~1 mês: fatura-2026-02 de R$705,57 foi paga em 31/01). Fallback: nada —
  // pagamento sem fatura casada continua stand-in (despesa credit), regra v1.
  const refStart = `${fat.refMonth}-01`;
  const pay = db.prepare(`
    SELECT id, date, amount_cents FROM transactions
    WHERE account_id = 'inter-db' AND flow = 'expense'
      AND lower(description) LIKE '%fatura%' AND invoice_id IS NULL
      AND amount_cents = ?
      AND julianday(date) BETWEEN julianday(?) - 70 AND julianday(?) + 35
    ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1
  `).get(fat.totalCents, refStart, refStart, refStart) as
    { id: number; date: string; amount_cents: number } | undefined;
  if (pay) {
    db.prepare("UPDATE transactions SET is_settlement = 1, invoice_id = ?, method = 'credit' WHERE id = ?")
      .run(invId, pay.id);
    db.prepare("UPDATE invoices SET payment_tx_id = ? WHERE id = ?").run(pay.id, invId);
  }
  faturaReport.push(
    `  ${fat.refMonth}: ${fat.items.length} itens = ${fmtCents(fat.totalCents)}` +
    (fat.skipped.length ? ` (${fat.skipped.length} espelho(s) de pagamento ignorado(s))` : "") +
    "; " +
    (pay
      ? `pagamento casado ${pay.date} ${fmtCents(pay.amount_cents)} ✓ EXATO`
      : "⚠ sem pagamento de valor exato — itens entram, pagamento (se houver) fica stand-in"),
  );
}
// Pagamentos de fatura sem match exato DENTRO da cobertura das faturas importadas
// são liquidações parciais (rotativo/débito automático parcial) — o consumo deles
// já está itemizado nas faturas; mantê-los como despesa contaria em dobro.
// Fora da cobertura (ex.: fatura de junho não exportada) → stand-in, regra v1.
const cover = db.prepare(
  "SELECT MIN(ref_month) AS lo, MAX(ref_month) AS hi FROM invoices WHERE account_id = 'inter-cc'",
).get() as { lo: string | null; hi: string | null };
const strayPays = db.prepare(`
  SELECT id, date, amount_cents, description FROM transactions
  WHERE account_id = 'inter-db' AND flow='expense'
    AND lower(description) LIKE '%fatura%' AND invoice_id IS NULL ORDER BY date
`).all() as { id: number; date: string; amount_cents: number; description: string }[];
for (const s of strayPays) {
  const inCoverage = cover.lo !== null
    && s.date >= `${cover.lo}-01` && s.date <= `${cover.hi}-31`;
  if (inCoverage) {
    const inv = db.prepare(`
      SELECT id, ref_month FROM invoices WHERE account_id = 'inter-cc'
      ORDER BY ABS(julianday(ref_month || '-01') - julianday(?)) LIMIT 1
    `).get(s.date) as { id: number; ref_month: string };
    db.prepare("UPDATE transactions SET is_settlement = 1, invoice_id = ?, method = 'credit' WHERE id = ?")
      .run(inv.id, s.id);
    faturaReport.push(
      `  liquidação parcial → fatura ${inv.ref_month}: ${s.date} ${fmtCents(s.amount_cents)} ("${s.description.slice(0, 44)}")`,
    );
  } else {
    faturaReport.push(`  stand-in (fora da cobertura): ${s.date} ${fmtCents(s.amount_cents)} ("${s.description.slice(0, 44)}")`);
  }
}

// ── 4. Pareamento SELF (substitui OWNER_SELF_KEYWORDS) ───────────────────────
interface Leg { id: number; date: string; account_id: string; amount_cents: number; description: string }
const candidates = (flow: string) => db.prepare(`
  SELECT id, date, account_id, amount_cents, description FROM transactions
  WHERE flow = ? AND counterpart IS NULL AND invoice_id IS NULL AND is_settlement = 0
    AND method IN ('pix', 'ted') AND account_id IN ('nu-db', 'inter-db')
  ORDER BY date
`).all(flow) as unknown as Leg[];

const expenses = candidates("expense");
const incomes = candidates("income");
const usedIncome = new Set<number>();
const dayDiff = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const selfPairs: string[] = [];
for (const e of expenses) {
  let best: Leg | null = null;
  for (const i of incomes) {
    if (usedIncome.has(i.id) || i.account_id === e.account_id) continue;
    if (i.amount_cents !== e.amount_cents || dayDiff(e.date, i.date) > 3) continue;
    if (!best || dayDiff(e.date, i.date) < dayDiff(e.date, best.date)) best = i;
  }
  if (!best) continue;
  usedIncome.add(best.id);
  db.prepare(
    "UPDATE transactions SET counterpart='SELF', method='transfer', self_pair_tx_id=? WHERE id=?",
  ).run(best.id, e.id);
  db.prepare(
    "UPDATE transactions SET counterpart='SELF', is_revenue=0, self_pair_tx_id=? WHERE id=?",
  ).run(e.id, best.id);
  selfPairs.push(
    `  ${e.date} ${e.account_id}→${best.account_id} ${fmtCents(e.amount_cents)}  ("${e.description.slice(0, 48)}")`,
  );
}

// ── 5. Caixinha Nubank (posição ledger + snapshots mensais derivados) ────────
const caixinhaId = Number(db.prepare(`
  INSERT INTO investments (name, match_key, type, bank, source, group_name)
  VALUES ('Caixinha Nubank', 'ledger:caixinha-nubank', 'rdb', 'nubank', 'ledger', NULL)
`).run().lastInsertRowid);
let caixinhaBalance = 0;
if (caixinhaTxIds.length > 0) {
  const ph = caixinhaTxIds.map(() => "?").join(",");
  db.prepare(`UPDATE transactions SET investment_id = ? WHERE id IN (${ph})`)
    .run(caixinhaId, ...caixinhaTxIds);
  const legs = db.prepare(`
    SELECT date, flow, amount_cents FROM transactions
    WHERE investment_id = ? ORDER BY date
  `).all(caixinhaId) as unknown as { date: string; flow: string; amount_cents: number }[];
  const byMonth = new Map<string, number>();
  let running = 0;
  for (const l of legs) {
    running += l.flow === "expense" ? l.amount_cents : -l.amount_cents;
    byMonth.set(l.date.slice(0, 7), running); // último running do mês
  }
  const insSnap = db.prepare(`
    INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
    VALUES (?,?,?,'derived')
  `);
  for (const [month, bal] of byMonth) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const last = new Date(y, mo, 0).getDate();
    insSnap.run(caixinhaId, `${month}-${String(last).padStart(2, "0")}`, bal);
  }
  caixinhaBalance = running;
}

// ── 6. Relatórios B3 (posições + snapshots + soft-close) ─────────────────────
const upsertInv = db.prepare(`
  INSERT INTO investments (name, match_key, code, type, bank, indexer, maturity_date, group_name, source, opened_at)
  VALUES (?,?,?,?,?,?,?,?, 'b3', ?)
  ON CONFLICT (match_key) DO UPDATE SET
    name = excluded.name, indexer = COALESCE(excluded.indexer, indexer),
    maturity_date = COALESCE(excluded.maturity_date, maturity_date), closed_at = NULL
  RETURNING id
`);
const insB3Snap = db.prepare(`
  INSERT INTO position_snapshots
    (investment_id, ref_date, quantity, unit_price_cents, applied_cents, gross_cents, net_cents, source)
  VALUES (?,?,?,?,?,?,?, 'b3')
  ON CONFLICT (investment_id, ref_date, source) DO UPDATE SET
    quantity = excluded.quantity, net_cents = excluded.net_cents,
    applied_cents = excluded.applied_cents, gross_cents = excluded.gross_cents
`);
const kindOf = (sheet: string): string => {
  const s = sheet.toLowerCase();
  if (s.includes("tesouro")) return "tesouro";
  if (s.includes("renda fixa")) return "rf";
  return "rv";
};
const reportsByKind = new Map<string, string[]>();   // kind → refDates com a aba presente
const posSeen = new Map<number, { kind: string; dates: string[] }>();
const b3Log: string[] = [];
for (const { f } of b3Files) {
  const rep: B3Report = parseB3(readFileSync(f) as Buffer, basename(f));
  for (const sheet of rep.sheets) {
    const k = kindOf(sheet);
    reportsByKind.set(k, [...(reportsByKind.get(k) ?? []), rep.refDate]);
  }
  for (const p of rep.positions) {
    const group = p.type === "cdb" && p.bank === "inter" ? "Porquinho" : null;
    const row = upsertInv.get(
      p.name, p.matchKey, p.code, p.type, p.bank, p.indexer, p.maturityIso, group, rep.refDate,
    ) as { id: number };
    if (group) db.prepare("UPDATE investments SET group_name = ? WHERE id = ?").run(group, row.id);
    insB3Snap.run(row.id, rep.refDate, p.quantity, p.unitPriceCents, p.appliedCents, p.grossCents, p.netCents);
    const seen = posSeen.get(row.id) ?? { kind: kindOf(p.sheet), dates: [] };
    seen.dates.push(rep.refDate);
    posSeen.set(row.id, seen);
  }
  b3Log.push(`  ${rep.refDate} (${basename(f)}): ${rep.positions.length} posições [${rep.sheets.join(", ") || "sem abas"}]`);
}
// Soft-close por tipo de aba:
// - Tesouro/RV: o consolidado sempre lista o que existe — ausente de qualquer
//   relatório mais novo → fechada (MGLU3 some do anual-2024; Prefixado 2026 some
//   da aba Tesouro em jan/2026 ao vencer).
// - Renda Fixa (CDB Inter/Porquinho): a aba PISCA no consolidado — CDBs somem em
//   jan/fev/mar e maio de 2026 com o Porquinho vivo no extrato (aplicação de
//   30/04 nem aparece no relatório de abril; registro em custódia atrasa). Aba
//   RF ausente = SEM INFORMAÇÃO, não zero. Só fecha quando um relatório mais
//   novo COM aba RF presente deixa de listar a posição.
const newestReport = b3Files.at(-1)?.ref ?? "";
const closeInv = db.prepare("UPDATE investments SET closed_at = ? WHERE id = ?");
for (const [invId, seen] of posSeen) {
  const lastSeen = seen.dates.sort().at(-1)!;
  if (lastSeen >= newestReport) continue;
  if (seen.kind === "rf") {
    const laterWithSheet = (reportsByKind.get("rf") ?? []).some((d) => d > lastSeen);
    if (laterWithSheet) closeInv.run(lastSeen, invId);
  } else {
    closeInv.run(lastSeen, invId);
  }
}

// ── 7. Rules seed (documenta a classificação aplicada; editável na UI futura) ─
const insRule = db.prepare("INSERT INTO rules (matcher, action, value, priority) VALUES (?,?,?,?)");
for (const k of ["rdb", "nuinvest", "tesouro", "irrf", "cobrança de investimentos",
  "aplicação", "aplicacao", "resgate", "caixinha", "porquinho", "cdb porq"]) {
  insRule.run(k, "investment_leg", null, 100);
}
for (const k of ["rdb", "caixinha", "dinheiro guardado"]) insRule.run(k, "investment_leg", "Caixinha Nubank", 90);
insRule.run("fatura", "settlement", null, 100);

db.exec("INSERT INTO migration_log (name, ran_at) VALUES ('backfill-acervo-v2', datetime('now'))");
restrictPermissions(dbPath);

// ── 8. Verificação ────────────────────────────────────────────────────────────
const q = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
type Row = Record<string, number | string | null>;

console.log("═".repeat(70));
console.log("BACKFILL v2 —", dbPath);
console.log("═".repeat(70));
console.log(`\n■ Extratos Nubank: ${nubankFiles.length} arquivos → ${nuStats.inserted} tx (${nuStats.dup} dup UUID, ${nuStats.skipped} ignoradas)`);
console.log(`■ Extratos Inter:  ${interFiles.length} arquivos → ${interStats.inserted} tx (${interStats.dup} dup, ${interStats.skipped} ignoradas)`);
console.log(`■ Faturas Inter:   ${faturaFiles.length} arquivos`);
for (const l of faturaReport) console.log(l);
console.log(`■ Pareamento SELF: ${selfPairs.length} pares`);
for (const l of selfPairs) console.log(l);
if (interWarnings.length) {
  console.log(`\n⚠ Avisos Inter (${interWarnings.length}):`);
  for (const w of interWarnings) console.log("  " + w);
}

console.log("\n■ Saldo por conta (initial + receitas − despesas, ledger completo):");
for (const a of q<Row>(`
  SELECT a.id, a.initial_balance_cents AS init,
         COALESCE(SUM(CASE WHEN t.flow='income'  THEN t.amount_cents END),0) AS inc,
         COALESCE(SUM(CASE WHEN t.flow='expense' THEN t.amount_cents END),0) AS exp
  FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.is_settlement = 0
  WHERE a.type = 'checking' GROUP BY a.id
`)) {
  // liquidação de fatura É saída de caixa — soma à parte para o saldo real
  const settle = (q<Row>(
    "SELECT COALESCE(SUM(amount_cents),0) AS s FROM transactions WHERE account_id=? AND is_settlement=1",
    a.id,
  )[0]!.s as number);
  const bal = (a.init as number) + (a.inc as number) - (a.exp as number) - settle;
  console.log(`  ${a.id}: ${fmtCents(bal)}  (inicial ${fmtCents(a.init as number)}, liquidações de fatura ${fmtCents(settle)})`);
  if (a.id === "inter-db" && interClosing !== undefined) {
    const ok = bal === interClosing;
    console.log(`    check vs saldo do banco no último extrato: ${fmtCents(interClosing)} ${ok ? "✓ BATE" : "✗ NÃO BATE"}`);
  }
}

console.log("\n■ Investimentos:");
for (const inv of q<Row>(`
  SELECT i.id, i.name, i.type, i.bank, i.group_name, i.closed_at,
         (SELECT net_cents FROM position_snapshots s WHERE s.investment_id = i.id ORDER BY ref_date DESC LIMIT 1) AS last_net,
         (SELECT ref_date  FROM position_snapshots s WHERE s.investment_id = i.id ORDER BY ref_date DESC LIMIT 1) AS last_date,
         (SELECT COUNT(*)  FROM position_snapshots s WHERE s.investment_id = i.id) AS snaps
  FROM investments i ORDER BY i.closed_at IS NOT NULL, i.type, i.name
`)) {
  const flag = inv.closed_at ? `FECHADA ${inv.closed_at}` : "aberta";
  const grp = inv.group_name ? ` [${inv.group_name}]` : "";
  console.log(`  #${inv.id} ${inv.name}${grp} (${inv.type}/${inv.bank}) — ${flag}, ${inv.snaps} snapshots, último ${inv.last_date}: ${fmtCents((inv.last_net as number) ?? 0)}`);
}
console.log(`  Caixinha (derivada do ledger): ${fmtCents(caixinhaBalance)} em ${caixinhaTxIds.length} pernas`);
console.log("\n■ B3 processado:");
for (const l of b3Log) console.log(l);

const totals = q<Row>(`
  SELECT COUNT(*) AS n,
    SUM(CASE WHEN flow='income'  AND is_revenue=1 THEN amount_cents ELSE 0 END) AS receitas,
    SUM(CASE WHEN flow='expense' AND method != 'transfer' AND is_settlement=0
              AND is_third_party=0 AND dest_account_id IS NULL THEN amount_cents ELSE 0 END) AS despesas
  FROM transactions
`)[0]!;
console.log(`\n■ Ledger: ${totals.n} transações | receitas reais ${fmtCents(totals.receitas as number)} | despesas de consumo ${fmtCents(totals.despesas as number)}`);
db.close();
