import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { commitmentRoutes } from "./commitments.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useTestConfig } from "../testing/fixtures.ts";

useTestConfig();

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccounts(db);
  return db;
}

function getCommitments(db: DatabaseSync): any {
  const route = commitmentRoutes(db).find(r => r.method === "GET")!;
  let payload: any;
  const res: any = { setHeader() {}, end(s: string) { payload = JSON.parse(s); }, writeHead() {} };
  route.handler({ url: "/api/commitments", params: {} } as any, res);
  return payload;
}

function openInvoice(db: DatabaseSync, refMonth: string, dueDate: string | null, totalCents: number): number {
  return Number(db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('cartao-b', ?, ?, ?, 'ui')",
  ).run(refMonth, dueDate, totalCents).lastInsertRowid);
}

function installmentItem(db: DatabaseSync, invoiceId: number, date: string, amountCents: number, seq: number, total: number) {
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, invoice_id, installment_seq, installment_total, import_batch_id)
    VALUES (?, 'expense', 'credit', 'cartao-b', ?, 'Steam', ?, ?, ?, 'sess-1')`)
    .run(date, amountCents, invoiceId, seq, total);
}

test("commitments: fatura aberta entra na série pelo mês do vencimento", () => {
  const db = freshDb();

  const now = new Date();
  const dd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
  openInvoice(db, "2026-07", dd, 50000);
  const out = getCommitments(db);
  assert.equal(out.open_invoices.length, 1);
  assert.equal(out.open_invoices[0].total, 500);
  const hit = out.series.find((s: any) => s.month === dd.slice(0, 7));
  assert.ok(hit, "mês do vencimento presente na série");
  assert.equal(hit.invoice, 500);
});

test("commitments: itens parcelados projetam meses futuros", () => {
  const db = freshDb();
  const inv = openInvoice(db, "2026-07", null, 1000);
  installmentItem(db, inv, "2026-07-10", 1000, 2, 5);
  const out = getCommitments(db);
  const projMonths = out.series.filter((s: any) => s.projected > 0);

  const totalProjected = out.series.reduce((n: number, s: any) => n + s.projected, 0);
  assert.ok(totalProjected >= 0);
  assert.ok(projMonths.every((s: any) => s.projected > 0));
});

test("commitments: fatura sem due_date não entra na série (mas lista em open_invoices)", () => {
  const db = freshDb();
  openInvoice(db, "2026-07", null, 30000);
  const out = getCommitments(db);
  assert.equal(out.open_invoices.length, 1);
  assert.ok(out.series.every((s: any) => s.invoice === 0));
});

test("commitments: DB vazio → série vazia", () => {
  const db = freshDb();
  const out = getCommitments(db);
  assert.deepEqual(out.open_invoices, []);
  assert.deepEqual(out.series, []);
  assert.deepEqual(out.recurring.items, []);
  assert.deepEqual(out.recurring.series, []);
  assert.equal(out.recurring.expense_monthly, 0);
  assert.equal(out.recurring.income_monthly, 0);
});

// ---- recurring ----

function ym(offsetMonths: number): string {
  const now = new Date();
  const idx = now.getFullYear() * 12 + now.getMonth() + offsetMonths;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function checkingExpense(db: DatabaseSync, date: string, amountCents: number, description: string) {
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, is_revenue, is_settlement, is_third_party)
    VALUES (?, 'expense', 'pix', 'conta-a', ?, ?, 0, 0, 0)`).run(date, amountCents, description);
}

function checkingIncome(db: DatabaseSync, date: string, amountCents: number, description: string) {
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, is_revenue, is_settlement, is_third_party)
    VALUES (?, 'income', 'ted', 'conta-a', ?, ?, 1, 0, 0)`).run(date, amountCents, description);
}

test("recurring: três meses de saída estável viram recorrência projetada", () => {
  const db = freshDb();
  for (const k of [-2, -1, 0]) checkingExpense(db, `${ym(k)}-10`, 171119, "Aluguel Fulano");

  const out = getCommitments(db);
  assert.equal(out.recurring.items.length, 1);
  assert.equal(out.recurring.items[0].flow, "expense");
  assert.equal(out.recurring.items[0].monthly, 1711.19);
  assert.equal(out.recurring.expense_monthly, 1711.19);
  assert.ok(out.recurring.series.length > 0);
  assert.equal(out.recurring.series[0].month, ym(1), "projeção começa no mês seguinte");
  assert.equal(out.recurring.series[0].expense, 1711.19);
});

test("recurring: receita recorrente vai pra banda de entrada, não some com a saída", () => {
  const db = freshDb();
  for (const k of [-2, -1, 0]) {
    checkingExpense(db, `${ym(k)}-10`, 100000, "Aluguel Fulano");
    checkingIncome(db, `${ym(k)}-05`, 385000, "Transferência recebida - empresa exemplo");
  }

  const out = getCommitments(db);
  assert.equal(out.recurring.expense_monthly, 1000);
  assert.equal(out.recurring.income_monthly, 3850);
  assert.equal(out.recurring.series[0].expense, 1000);
  assert.equal(out.recurring.series[0].income, 3850);
});

test("recurring: liquidação de fatura não conta como recorrência de consumo", () => {
  const db = freshDb();
  for (const k of [-2, -1, 0]) {
    db.prepare(`INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue, is_settlement, is_third_party)
      VALUES (?, 'expense', 'credit', 'conta-b', 100000, 'Pagamento de fatura', 0, 1, 0)`).run(`${ym(k)}-10`);
  }
  const out = getCommitments(db);
  assert.deepEqual(out.recurring.items, []);
});

test("recurring: terceiro não conta como recorrência", () => {
  const db = freshDb();
  for (const k of [-2, -1, 0]) {
    db.prepare(`INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue, is_settlement, is_third_party)
      VALUES (?, 'expense', 'pix', 'conta-a', 50000, 'Compra do vizinho', 0, 0, 1)`).run(`${ym(k)}-10`);
  }
  const out = getCommitments(db);
  assert.deepEqual(out.recurring.items, []);
});

test("recurring: perna de investimento (transfer) não conta como recorrência", () => {
  const db = freshDb();
  for (const k of [-2, -1, 0]) {
    db.prepare(`INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue, is_settlement, is_third_party)
      VALUES (?, 'expense', 'transfer', 'conta-a', 80000, 'Aplicação RDB', 0, 0, 0)`).run(`${ym(k)}-10`);
  }
  const out = getCommitments(db);
  assert.deepEqual(out.recurring.items, []);
});

// ---- maturities ----

function position(db: DatabaseSync, name: string, maturityDate: string | null, netCents: number, closedAt: string | null = null): number {
  const id = Number(db.prepare(
    `INSERT INTO investments (name, match_key, type, bank, maturity_date, source, closed_at)
     VALUES (?, ?, 'cdb', 'Inter', ?, 'b3', ?)`,
  ).run(name, name, maturityDate, closedAt).lastInsertRowid);
  db.prepare(
    `INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source)
     VALUES (?, '2026-06-30', ?, 'b3')`,
  ).run(id, netCents);
  return id;
}

test("maturities: posição aberta com vencimento entra na lista com o valor do último snapshot", () => {
  const db = freshDb();
  position(db, "CDB Inter 2028", "2028-04-03", 21648);

  const out = getCommitments(db);
  assert.equal(out.maturities.length, 1);
  assert.equal(out.maturities[0].name, "CDB Inter 2028");
  assert.equal(out.maturities[0].maturity_date, "2028-04-03");
  assert.equal(out.maturities[0].value, 216.48);
});

test("maturities: posição fechada não vence", () => {
  const db = freshDb();
  position(db, "CDB resgatado", "2028-04-03", 21648, "2026-05-01");
  assert.deepEqual(getCommitments(db).maturities, []);
});

test("maturities: posição sem data de vencimento fica de fora", () => {
  const db = freshDb();
  position(db, "Caixinha", null, 900000);
  assert.deepEqual(getCommitments(db).maturities, []);
});

test("maturities: vencimento passado não é evento futuro", () => {
  const db = freshDb();
  position(db, "Tesouro 2020", "2020-01-01", 10000);
  assert.deepEqual(getCommitments(db).maturities, []);
});

test("maturities: ordenadas da mais próxima pra mais distante", () => {
  const db = freshDb();
  position(db, "longe", "2029-05-15", 17985);
  position(db, "perto", "2028-04-03", 21648);
  assert.deepEqual(getCommitments(db).maturities.map((m: any) => m.name), ["perto", "longe"]);
});

test("maturities: vencimento fora da janela de 12 meses NÃO entra na série", () => {
  const db = freshDb();
  position(db, "CDB 2028", "2028-04-03", 21648);
  const out = getCommitments(db);
  assert.equal(out.maturities.length, 1, "continua listado");
  assert.ok(out.series.every((s: any) => !s.maturity), "mas não vira barra");
});

test("maturities: vencimento dentro da janela entra na série como entrada", () => {
  const db = freshDb();
  const due = ym(3);
  position(db, "CDB curto", `${due}-15`, 50000);

  const out = getCommitments(db);
  const hit = out.series.find((s: any) => s.month === due);
  assert.ok(hit, "mês do vencimento presente na série");
  assert.equal(hit.maturity, 500);
  assert.equal(hit.total, 0, "vencimento é entrada — não infla o comprometido");
});

test("recurring: série dura (fatura/parcela) não é contaminada pela recorrência", () => {
  const db = freshDb();
  for (const k of [-2, -1, 0]) checkingExpense(db, `${ym(k)}-10`, 171119, "Aluguel Fulano");
  const out = getCommitments(db);
  assert.ok(out.series.every((s: any) => s.total === s.invoice + s.projected),
    "series continua sendo só compromisso duro");
});
