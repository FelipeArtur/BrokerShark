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

/** O card é do MÊS: sem mês na query ele responde pelo corrente. */
function getCommitments(db: DatabaseSync, ym?: string): any {
  const route = commitmentRoutes(db).find(r => r.method === "GET")!;
  let payload: any;
  const res: any = { setHeader() {}, end(s: string) { payload = JSON.parse(s); }, writeHead() {} };
  const qs = ym ? `?year=${ym.slice(0, 4)}&month=${Number(ym.slice(5, 7))}` : "";
  route.handler({ url: `/api/commitments${qs}`, params: {} } as any, res);
  return payload;
}

function parcela(
  db: DatabaseSync, date: string, amountCents: number, seq: number, total: number, desc = "Steam",
): number {
  return Number(db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, installment_seq, installment_total, import_batch_id)
    VALUES (?, 'expense', 'credit', 'cartao-b', ?, ?, ?, ?, 'sess-1')`)
    .run(date, amountCents, desc, seq, total).lastInsertRowid);
}

function lancamento(
  db: DatabaseSync, date: string, amountCents: number, desc: string, flow = "expense",
): number {
  return Number(db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description)
    VALUES (?, ?, 'pix', 'conta-a', ?, ?)`)
    .run(date, flow, amountCents, desc).lastInsertRowid);
}

const marcarRecorrente = (db: DatabaseSync, id: number) =>
  db.prepare("INSERT INTO recurring_marks (transaction_id) VALUES (?)").run(id);

// ── parcelas ────────────────────────────────────────────────────────────────

test("parcela do mês aparece com a posição que o banco declarou", () => {
  const db = freshDb();
  parcela(db, "2026-04-11", 14000, 2, 3, "LUBRIPREMIUM");
  const out = getCommitments(db, "2026-04");

  assert.equal(out.installments.length, 1);
  const p = out.installments[0];
  assert.equal(p.amount, 140);
  assert.equal(p.seq, 2);
  assert.equal(p.total, 3);
  assert.equal(p.remaining, 1, "de 3, já caíram 2, falta 1");
});

test("parcela de outro mês não entra — o card é do mês selecionado", () => {
  const db = freshDb();
  parcela(db, "2026-04-11", 14000, 2, 3);
  assert.equal(getCommitments(db, "2026-05").installments.length, 0);
  assert.equal(getCommitments(db, "2026-04").installments.length, 1);
});

test("compra à vista não é parcela", () => {
  const db = freshDb();
  lancamento(db, "2026-04-10", 5000, "Padaria");
  assert.equal(getCommitments(db, "2026-04").installments.length, 0);
});

test("última parcela não deixa resto", () => {
  const db = freshDb();
  parcela(db, "2026-04-11", 14000, 3, 3);
  assert.equal(getCommitments(db, "2026-04").installments[0].remaining, 0);
});

// ── recorrência DECLARADA ───────────────────────────────────────────────────

test("nada é recorrente sem você declarar", () => {
  const db = freshDb();
  //> Três meses idênticos: o detector antigo chamaria de recorrência. Sem marca, não.
  for (const d of ["2026-02-10", "2026-03-10", "2026-04-10"]) lancamento(db, d, 120000, "Aluguel");
  assert.equal(getCommitments(db, "2026-05").recurring.length, 0);
});

test("declarada, repete nos meses seguintes com o dia e o valor do lançamento", () => {
  const db = freshDb();
  marcarRecorrente(db, lancamento(db, "2026-04-10", 120000, "Aluguel"));
  const r = getCommitments(db, "2026-06").recurring;

  assert.equal(r.length, 1);
  assert.equal(r[0].amount, 1200);
  assert.equal(r[0].day, 10);
  assert.equal(r[0].confirmed, false, "junho não tem o lançamento, então é previsto");
  assert.equal(r[0].since, "2026-04");
});

test("não vale para trás: mês anterior ao lançamento não a teve", () => {
  const db = freshDb();
  marcarRecorrente(db, lancamento(db, "2026-04-10", 120000, "Aluguel"));
  assert.equal(getCommitments(db, "2026-03").recurring.length, 0);
  assert.equal(getCommitments(db, "2026-04").recurring.length, 1);
});

test("mês em que já caiu usa o valor e a data reais, não os declarados", () => {
  const db = freshDb();
  marcarRecorrente(db, lancamento(db, "2026-04-10", 120000, "Aluguel"));
  lancamento(db, "2026-05-12", 125000, "Aluguel");

  const r = getCommitments(db, "2026-05").recurring[0];
  assert.equal(r.confirmed, true);
  assert.equal(r.amount, 1250, "o reajuste real manda, não o valor da declaração");
  assert.equal(r.date, "2026-05-12");
});

test("desmarcar tira do card", () => {
  const db = freshDb();
  const id = lancamento(db, "2026-04-10", 120000, "Aluguel");
  marcarRecorrente(db, id);
  assert.equal(getCommitments(db, "2026-06").recurring.length, 1);
  db.prepare("DELETE FROM recurring_marks WHERE transaction_id = ?").run(id);
  assert.equal(getCommitments(db, "2026-06").recurring.length, 0);
});

test("apagar o lançamento leva a marca junto", () => {
  const db = freshDb();
  const id = lancamento(db, "2026-04-10", 120000, "Aluguel");
  marcarRecorrente(db, id);
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM recurring_marks").get() as any).n, 0,
    "sem CASCADE a marca viraria órfã apontando pra um id morto",
  );
});

// ── total ───────────────────────────────────────────────────────────────────

test("o total é o que ainda VAI sair, não o que já saiu", () => {
  const db = freshDb();
  //> O aluguel já caiu em abril: o saldo da conta já o reflete, então somá-lo
  //> descontaria duas vezes. Salário é entrada, nunca compromisso.
  marcarRecorrente(db, lancamento(db, "2026-04-10", 120000, "Aluguel"));
  marcarRecorrente(db, lancamento(db, "2026-04-05", 400000, "Salário", "income"));

  const out = getCommitments(db, "2026-04");
  assert.equal(out.total_out, 0);
  assert.equal(out.recurring.length, 2, "mas as duas continuam visíveis na lista");
});

test("recorrente que ainda não caiu no mês entra no total", () => {
  const db = freshDb();
  marcarRecorrente(db, lancamento(db, "2026-04-10", 120000, "Aluguel"));
  const out = getCommitments(db, "2026-06");
  assert.equal(out.total_out, 1200);
  assert.equal(out.total_recurring, 1200);
  assert.equal(out.total_invoices, 0);
});

test("parcela aparece na lista mas NÃO soma — é item de fatura", () => {
  const db = freshDb();
  //> Toda parcela tem `invoice_id`. Quem responde pelo cartão é a fatura em aberto;
  //> somar a parcela em separado contaria o mesmo dinheiro duas vezes.
  parcela(db, "2026-04-11", 14000, 2, 3);
  const out = getCommitments(db, "2026-04");
  assert.equal(out.installments.length, 1, "visível");
  assert.equal(out.total_out, 0, "mas não somada");
});

test("fatura aberta vencendo no mês é o que responde pelo cartão", () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('cartao-b','2026-04','2026-04-20',18000,'ui')",
  ).run();
  const out = getCommitments(db, "2026-04");
  assert.equal(out.total_invoices, 180);
  assert.equal(out.total_out, 180);
});

test("fatura já paga não compromete nada", () => {
  const db = freshDb();
  const pag = lancamento(db, "2026-04-20", 18000, "Pagamento fatura");
  db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file, payment_tx_id) VALUES ('cartao-b','2026-04','2026-04-20',18000,'ui',?)",
  ).run(pag);
  assert.equal(getCommitments(db, "2026-04").total_out, 0);
});

test("mês vazio devolve listas vazias e total zero", () => {
  const out = getCommitments(freshDb(), "2026-04");
  assert.deepEqual(out.installments, []);
  assert.deepEqual(out.recurring, []);
  assert.equal(out.total_out, 0);
  assert.equal(out.month, "2026-04");
});

test("o total não acumula erro de float", () => {
  const db = freshDb();
  //> 31,27 + 31,25 somados como reais dão 62,519999999999996. A soma roda em centavos.
  marcarRecorrente(db, lancamento(db, "2026-01-05", 3127, "Steam"));
  marcarRecorrente(db, lancamento(db, "2026-01-06", 3125, "Spotify"));
  assert.equal(getCommitments(db, "2026-02").total_out, 62.52);
});
