import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { dispatch } from "../http/router.ts";
import { accountRoutes } from "./accounts.ts";
import { auditLedger } from "../db/audit.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccounts(db);
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

// Vai pelo `dispatch` de verdade em vez de escolher o handler pelo índice do
// array: rota nova não pode quebrar o casamento das antigas.
async function call(
  db: DatabaseSync, method: string, url: string, body?: unknown,
): Promise<{ status: number; payload: any }> {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as any;
  req.method = method;
  req.url = url;
  req.headers = { "content-type": "application/json" };

  let status = 200;
  let payload: any;
  const res: any = {
    headersSent: false,
    setHeader() {},
    writeHead(s: number) { status = s; },
    end(s: string) { payload = s ? JSON.parse(s) : undefined; },
  };
  const path = url.split("?")[0];
  const hit = await dispatch(accountRoutes(db), req, res, path);
  assert.ok(hit, `nenhuma rota casou com ${method} ${path}`);
  return { status, payload };
}

const tx = (db: DatabaseSync, accountId: string, date: string, cents: number, flow = "expense") =>
  db.prepare(`INSERT INTO transactions (date, flow, method, account_id, amount_cents, description)
              VALUES (?, ?, 'pix', ?, ?, 'teste')`).run(date, flow, accountId, cents);

// ── posição vs. histórico ────────────────────────────────────────────────────

test("available: sem fatura aberta → net == bruto, committed 0", async () => {
  const out = (await call(freshDb(), "GET", "/api/available")).payload;
  assert.equal(out.committed_this_month, 0);
  assert.equal(out.available_net, out.available);
});

test("available: fatura aberta vencendo este mês abate no net", async () => {
  const db = freshDb();
  const now = new Date();
  const dd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
  db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('inter-cc','2026-07',?,10000,'ui')",
  ).run(dd);
  const out = (await call(db, "GET", "/api/available")).payload;
  assert.equal(out.committed_this_month, 100);
  assert.equal(out.available_net, out.available - 100);
});

test("available: fatura sem due_date não abate", async () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO invoices (account_id, ref_month, due_date, total_cents, source_file) VALUES ('inter-cc','2026-07',NULL,10000,'ui')",
  ).run();
  const out = (await call(db, "GET", "/api/available")).payload;
  assert.equal(out.committed_this_month, 0);
  assert.equal(out.available_net, out.available);
});

test("encerrar conta tira o saldo dela do disponível", async () => {
  const db = freshDb();
  tx(db, "nu-db", "2026-01-10", 30000, "income");
  tx(db, "inter-db", "2026-01-10", 50000, "income");
  assert.equal((await call(db, "GET", "/api/available")).payload.available, 800);

  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-02-01" });
  assert.equal((await call(db, "GET", "/api/available")).payload.available, 300);
});

test("encerrar conta NÃO apaga o histórico dela", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-01-10", 50000, "income");
  tx(db, "inter-db", "2026-01-20", 1200);
  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-02-01" });

  const n = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id='inter-db'")
    .get() as { n: number }).n;
  assert.equal(n, 2, "os lançamentos continuam no ledger");
  const acc = db.prepare("SELECT closed_at FROM accounts WHERE id='inter-db'").get() as any;
  assert.equal(acc.closed_at, "2026-02-01", "a conta continua existindo, só que encerrada");
});

test("conta encerrada some da listagem, mas volta com ?closed=1 valendo zero", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-01-10", 50000, "income");
  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-02-01" });

  const abertas = (await call(db, "GET", "/api/accounts")).payload;
  assert.equal(abertas.find((a: any) => a.id === "inter-db"), undefined);

  const todas = (await call(db, "GET", "/api/accounts?closed=1")).payload;
  const inter = todas.find((a: any) => a.id === "inter-db");
  assert.equal(inter.closed_at, "2026-02-01");
  assert.equal(inter.balance, 0, "conta encerrada não guarda dinheiro");
});

test("reabrir devolve a conta ao disponível", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-01-10", 50000, "income");
  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-02-01" });
  assert.equal((await call(db, "GET", "/api/available")).payload.available, 0);

  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: null });
  assert.equal((await call(db, "GET", "/api/available")).payload.available, 500);
});

test("liquidez: a conta encerrada conta no passado e some no mês do fim", async () => {
  const db = freshDb();
  tx(db, "nu-db", "2026-01-10", 10000, "income");
  tx(db, "inter-db", "2026-01-15", 40000, "income");
  tx(db, "nu-db", "2026-03-10", 0, "income");
  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-03-01" });

  const serie = (await call(db, "GET", "/api/liquidity-history")).payload;
  assert.deepEqual(serie.map((p: any) => p.label), ["01/2026", "02/2026", "03/2026"]);
  assert.deepEqual(serie.map((p: any) => p.value), [500, 500, 100]);
});

// ── guardas ─────────────────────────────────────────────────────────────────

test("encerrar antes do último lançamento é recusado", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-05-20", 1000);
  const r = await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-03-01" });
  assert.equal(r.status, 409);
  assert.match(r.payload.error, /2026-05-20/);
  assert.deepEqual(auditLedger(db), [], "e o ledger nunca chega a violar a invariante");
});

test("a auditoria acusa lançamento posterior ao encerramento", async () => {
  const db = freshDb();
  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-03-01" });
  // Entra por baixo da rota, como um backfill mal datado entraria.
  tx(db, "inter-db", "2026-05-20", 1000);
  assert.ok(auditLedger(db).some(v => v.check === "lancamento-pos-encerramento"));
});

// ── encerrar exige estar quite (como no banco) ──────────────────────────────

const openInvoice = (db: DatabaseSync, refMonth: string, cents: number) =>
  db.prepare(
    `INSERT INTO invoices (account_id, ref_month, total_cents, source_file)
     VALUES ('inter-cc', ?, ?, 'ui')`,
  ).run(refMonth, cents);

test("encerrar cartão com fatura em aberto é recusado", async () => {
  const db = freshDb();
  openInvoice(db, "2026-06", 45000);
  const r = await call(db, "PATCH", "/api/accounts/inter-cc", { closed_at: "2026-07-01" });
  assert.equal(r.status, 409);
  assert.match(r.payload.error, /fatura em aberto/);
  assert.match(r.payload.error, /2026-06/);
  assert.equal(
    (db.prepare("SELECT closed_at FROM accounts WHERE id='inter-cc'").get() as any).closed_at, null,
  );
});

test("cartão com a fatura já paga encerra normalmente", async () => {
  const db = freshDb();
  openInvoice(db, "2026-06", 45000);
  const pay = tx(db, "inter-db", "2026-06-10", 45000);
  db.prepare("UPDATE invoices SET payment_tx_id = ? WHERE ref_month = '2026-06'")
    .run(pay.lastInsertRowid as number);
  const r = await call(db, "PATCH", "/api/accounts/inter-cc", { closed_at: "2026-07-01" });
  assert.equal(r.status, 200);
});

test("encerrar conta corrente no vermelho é recusado", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-05-20", 30000);          // sem entrada: saldo −300,00
  const r = await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-06-01" });
  assert.equal(r.status, 409);
  assert.match(r.payload.error, /saldo devedor/);
});

test("conta corrente zerada encerra — sacar tudo em espécie é encerramento válido", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-05-01", 30000, "income");
  tx(db, "inter-db", "2026-05-20", 30000);
  const r = await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-06-01" });
  assert.equal(r.status, 200);
});

test("reabrir conta nunca esbarra na dívida", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-05-01", 30000, "income");
  await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: "2026-06-01" });
  tx(db, "inter-db", "2026-05-02", 90000);          // entra por baixo e deixa o saldo negativo
  const r = await call(db, "PATCH", "/api/accounts/inter-db", { closed_at: null });
  assert.equal(r.status, 200);
});

test("a auditoria acusa conta encerrada com dívida que entrou por baixo da rota", async () => {
  const db = freshDb();
  await call(db, "PATCH", "/api/accounts/inter-cc", { closed_at: "2026-07-01" });
  openInvoice(db, "2026-06", 45000);
  assert.ok(auditLedger(db).some(v => v.check === "conta-encerrada-com-divida"));
});

test("cartão encerrado e quitado não acusa na auditoria", async () => {
  const db = freshDb();
  await call(db, "PATCH", "/api/accounts/inter-cc", { closed_at: "2026-07-01" });
  // Itens de fatura deixam o saldo do cartão negativo por desenho — e isso não
  // pode virar violação, senão todo cartão encerrado acusaria.
  tx(db, "inter-cc", "2026-06-05", 45000);
  assert.deepEqual(auditLedger(db).filter(v => v.check === "conta-encerrada-com-divida"), []);
});

test("apagar conta com histórico é recusado — encerre em vez de apagar", async () => {
  const db = freshDb();
  tx(db, "inter-db", "2026-01-10", 1000);
  const r = await call(db, "DELETE", "/api/accounts/inter-db");
  assert.equal(r.status, 409);
  assert.match(r.payload.error, /encerre em vez de apagar/);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n, 1,
  );
});

test("apagar conta sem nenhum lançamento é permitido (desfazer engano)", async () => {
  const db = freshDb();
  await call(db, "POST", "/api/accounts", { id: "engano", bank: "x", type: "checking", name: "Engano" });
  const r = await call(db, "DELETE", "/api/accounts/engano");
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT id FROM accounts WHERE id='engano'").get(), undefined);
});

// ── criar ───────────────────────────────────────────────────────────────────

test("conta nova entra no disponível com o saldo inicial", async () => {
  const db = freshDb();
  const antes = (await call(db, "GET", "/api/available")).payload.available;
  const r = await call(db, "POST", "/api/accounts", {
    id: "c6-db", bank: "c6", type: "checking", name: "C6 Conta",
    initial_balance_cents: 25000, opened_at: "2026-07-01",
  });
  assert.equal(r.status, 201);
  assert.equal((await call(db, "GET", "/api/available")).payload.available, antes + 250);
});

test("cartão de crédito novo não entra no disponível", async () => {
  const db = freshDb();
  const antes = (await call(db, "GET", "/api/available")).payload.available;
  await call(db, "POST", "/api/accounts", {
    id: "c6-cc", bank: "c6", type: "credit_card", name: "C6 Cartão",
    initial_balance_cents: 25000,
  });
  assert.equal((await call(db, "GET", "/api/available")).payload.available, antes);
});

test("id duplicado é recusado com 409, não sobrescreve", async () => {
  const db = freshDb();
  const r = await call(db, "POST", "/api/accounts", {
    id: "nu-db", bank: "outro", type: "checking", name: "Sequestro",
  });
  assert.equal(r.status, 409);
  const acc = db.prepare("SELECT bank FROM accounts WHERE id='nu-db'").get() as any;
  assert.equal(acc.bank, "nubank");
});

test("id, type e name são validados", async () => {
  const db = freshDb();
  const ok = { id: "valida", bank: "x", type: "checking", name: "N" };
  for (const bad of [
    { ...ok, id: "MAIÚSCULA" },
    { ...ok, id: "com espaço" },
    { ...ok, id: "a" },
    { ...ok, type: "poupanca" },
    { ...ok, name: "" },
    { ...ok, initial_balance_cents: 12.5 },
    { ...ok, opened_at: "01/07/2026" },
  ]) {
    const r = await call(db, "POST", "/api/accounts", bad);
    assert.equal(r.status, 400, `deveria recusar ${JSON.stringify(bad)}`);
  }
});

test("renomear não mexe em saldo nem em histórico", async () => {
  const db = freshDb();
  tx(db, "nu-db", "2026-01-10", 30000, "income");
  const antes = (await call(db, "GET", "/api/available")).payload.available;
  await call(db, "PATCH", "/api/accounts/nu-db", { name: "Nubank Principal" });
  const lista = (await call(db, "GET", "/api/accounts")).payload;
  assert.equal(lista.find((a: any) => a.id === "nu-db").name, "Nubank Principal");
  assert.equal((await call(db, "GET", "/api/available")).payload.available, antes);
});

test("conta inexistente devolve 404 em PATCH e DELETE", async () => {
  const db = freshDb();
  assert.equal((await call(db, "PATCH", "/api/accounts/fantasma", { name: "x" })).status, 404);
  assert.equal((await call(db, "DELETE", "/api/accounts/fantasma")).status, 404);
});
