// O caminho de ESCRITA do import (preview → editar staging → confirmar →
// reverter) é o único lugar onde a UI mexe no ledger. import.test.ts só cobria
// detectAccount; aqui o pipeline roda de ponta a ponta contra um DB real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts } from "../jobs/backfill/seeds.ts";
import { seedTestCategories, useTestConfig } from "../testing/fixtures.ts";
import { importRoutes } from "./import.ts";
import { auditLedger } from "../db/audit.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

useTestConfig();

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccounts(db);
  seedTestCategories(db);
  return db;
}

const BOUNDARY = "----bstest";

function multipartReq(url: string, fields: Record<string, string>, files: { name: string; content: string }[]) {
  const chunks: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }
  for (const f of files) {
    chunks.push(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\n` +
      `Content-Type: text/csv\r\n\r\n${f.content}\r\n`,
    );
  }
  chunks.push(`--${BOUNDARY}--\r\n`);
  const req = Readable.from([Buffer.from(chunks.join(""), "utf-8")]) as any;
  req.url = url;
  req.headers = { "content-type": `multipart/form-data; boundary=${BOUNDARY}` };
  req.params = {};
  return req;
}

function jsonReq(url: string, body: unknown, params: Record<string, string> = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body), "utf-8")]) as any;
  req.url = url;
  req.headers = { "content-type": "application/json" };
  req.params = params;
  return req;
}

function emptyReq(url: string, params: Record<string, string> = {}) {
  const req = Readable.from([]) as any;
  req.url = url;
  req.headers = {};
  req.params = params;
  return req;
}

type Captured = { status: number; body: any };

function capture(): { res: any; got: Captured } {
  const got: Captured = { status: 200, body: undefined };
  const res: any = {
    setHeader() {},
    writeHead(s: number) { got.status = s; },
    end(s: string) { got.body = s ? JSON.parse(s) : undefined; },
  };
  return { res, got };
}

async function call(db: DatabaseSync, method: string, path: string, req: any): Promise<Captured> {
  const route = importRoutes(db).find(r => r.method === method && r.pattern.test(path));
  assert.ok(route, `rota ${method} ${path} não encontrada`);
  const { res, got } = capture();
  await route!.handler(req, res);
  return got;
}

const EXTRATO_CSV = [
  "Data,Valor,Identificador,Descrição",
  "01/06/2026,-150.00,uuid-a,Compra no mercado",
  "02/06/2026,4200.00,uuid-b,Transferência recebida - Empresa",
  "03/06/2026,-89.90,uuid-c,Pix enviado: Farmácia",
].join("\n");

async function previewExtrato(db: DatabaseSync, csv = EXTRATO_CSV): Promise<Captured> {
  return call(db, "POST", "/api/import/preview",
    multipartReq("/api/import/preview", { account_id: "conta-a" }, [{ name: "nu.csv", content: csv }]));
}

test("preview lê o extrato e marca tudo como novo", async () => {
  const db = freshDb();
  const out = await previewExtrato(db);
  assert.equal(out.body.counts.new, 3);
  assert.equal(out.body.counts.duplicate, 0);
  assert.ok(out.body.batch_id);
  assert.equal(out.body.rows.length, 3);
});

test("preview não escreve nada no ledger", async () => {
  const db = freshDb();
  await previewExtrato(db);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n;
  assert.equal(n, 0, "staging é memória, não banco");
});

test("confirm insere as linhas novas com o lote gravado", async () => {
  const db = freshDb();
  const prev = await previewExtrato(db);
  const out = await call(db, "POST", "/api/import/confirm",
    jsonReq("/api/import/confirm", { batch_id: prev.body.batch_id, import_batch_id: "lote-1" }));

  assert.equal(out.body.inserted, 3);
  const rows = db.prepare("SELECT * FROM transactions ORDER BY date").all() as any[];
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.import_batch_id === "lote-1"));
  assert.equal(rows[0].amount_cents, 15000, "centavos inteiros, sem float");
  assert.equal(rows[1].flow, "income");
  assert.equal(rows[1].is_revenue, 1);
});

test("confirm respeita exclude_ids", async () => {
  const db = freshDb();
  const prev = await previewExtrato(db);
  const out = await call(db, "POST", "/api/import/confirm",
    jsonReq("/api/import/confirm", { batch_id: prev.body.batch_id, exclude_ids: [0, 2] }));
  assert.equal(out.body.inserted, 1);
});

test("segundo preview do mesmo arquivo marca tudo como duplicado", async () => {
  const db = freshDb();
  const first = await previewExtrato(db);
  await call(db, "POST", "/api/import/confirm", jsonReq("/api/import/confirm", { batch_id: first.body.batch_id }));

  const second = await previewExtrato(db);
  assert.equal(second.body.counts.duplicate, 3);
  assert.equal(second.body.counts.new, 0);
});

test("confirm de um lote todo duplicado não insere nada", async () => {
  const db = freshDb();
  const first = await previewExtrato(db);
  await call(db, "POST", "/api/import/confirm", jsonReq("/api/import/confirm", { batch_id: first.body.batch_id }));

  const second = await previewExtrato(db);
  const out = await call(db, "POST", "/api/import/confirm",
    jsonReq("/api/import/confirm", { batch_id: second.body.batch_id }));
  assert.equal(out.body.inserted, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n, 3);
});

test("edição de valor no staging chega no ledger e guarda o valor original", async () => {
  const db = freshDb();
  const prev = await previewExtrato(db);
  const batch = prev.body.batch_id;

  const patched = await call(db, "PATCH", `/api/import/staging/${batch}/0`,
    jsonReq(`/api/import/staging/${batch}/0`, { amount: 200 }, { batch, row: "0" }));
  assert.equal(patched.body.ok, true);

  await call(db, "POST", "/api/import/confirm", jsonReq("/api/import/confirm", { batch_id: batch }));
  const row = db.prepare("SELECT * FROM transactions WHERE external_id='uuid-a'").get() as any;
  assert.equal(row.amount_cents, 20000);
  assert.equal(row.original_amount_cents, 15000, "o valor do extrato fica registrado");
});

test("valor negativo no staging é recusado", async () => {
  const db = freshDb();
  const prev = await previewExtrato(db);
  const batch = prev.body.batch_id;
  const out = await call(db, "PATCH", `/api/import/staging/${batch}/0`,
    jsonReq(`/api/import/staging/${batch}/0`, { amount: -5 }, { batch, row: "0" }));
  assert.equal(out.status, 400);
});

test("apelido e categoria editados no staging chegam no ledger", async () => {
  const db = freshDb();
  const cat = db.prepare("SELECT id FROM categories WHERE flow='expense' LIMIT 1").get() as any;
  const prev = await previewExtrato(db);
  const batch = prev.body.batch_id;

  await call(db, "PATCH", `/api/import/staging/${batch}/0`,
    jsonReq(`/api/import/staging/${batch}/0`, { display_name: "Mercado da esquina", category_id: cat.id },
      { batch, row: "0" }));
  await call(db, "POST", "/api/import/confirm", jsonReq("/api/import/confirm", { batch_id: batch }));

  const row = db.prepare("SELECT * FROM transactions WHERE external_id='uuid-a'").get() as any;
  assert.equal(row.display_name, "Mercado da esquina");
  assert.equal(row.category_id, cat.id);
});

test("batch expirado devolve 404 em vez de escrever", async () => {
  const db = freshDb();
  const out = await call(db, "POST", "/api/import/confirm",
    jsonReq("/api/import/confirm", { batch_id: "não-existe" }));
  assert.equal(out.status, 404);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n, 0);
});

test("account_id fora da allowlist é recusado", async () => {
  const db = freshDb();
  const out = await call(db, "POST", "/api/import/preview",
    multipartReq("/api/import/preview", { account_id: "cartao-b" }, [{ name: "x.csv", content: EXTRATO_CSV }]));
  assert.equal(out.status, 400);
});

test("arquivo que não é extrato devolve erro legível, não 500", async () => {
  const db = freshDb();
  const out = await call(db, "POST", "/api/import/preview",
    multipartReq("/api/import/preview", { account_id: "conta-a" }, [{ name: "x.csv", content: "a,b\n1,2" }]));
  assert.equal(out.status, 400);
  //> A mensagem fala do FORMATO, não do banco: é o que dá pra conferir no arquivo.
  assert.match(String(out.body.error), /identificador|formato/i);
});

test("reverter o lote apaga exatamente o que ele inseriu", async () => {
  const db = freshDb();
  const prev = await previewExtrato(db);
  await call(db, "POST", "/api/import/confirm",
    jsonReq("/api/import/confirm", { batch_id: prev.body.batch_id, import_batch_id: "lote-x" }));

  const out = await call(db, "DELETE", "/api/import/batch/lote-x",
    emptyReq("/api/import/batch/lote-x", { id: "lote-x" }));
  assert.equal(out.body.deleted, 3);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as any).n, 0);
});

test("reverter lote inexistente devolve 404", async () => {
  const db = freshDb();
  const out = await call(db, "DELETE", "/api/import/batch/nada",
    emptyReq("/api/import/batch/nada", { id: "nada" }));
  assert.equal(out.status, 404);
});

test("reverter não toca em lançamentos de outro lote", async () => {
  const db = freshDb();
  const a = await previewExtrato(db);
  await call(db, "POST", "/api/import/confirm",
    jsonReq("/api/import/confirm", { batch_id: a.body.batch_id, import_batch_id: "lote-a" }));

  const outroCsv = ["Data,Valor,Identificador,Descrição", "10/06/2026,-10.00,uuid-z,Padaria"].join("\n");
  const b = await previewExtrato(db, outroCsv);
  await call(db, "POST", "/api/import/confirm",
    jsonReq("/api/import/confirm", { batch_id: b.body.batch_id, import_batch_id: "lote-b" }));

  await call(db, "DELETE", "/api/import/batch/lote-a", emptyReq("/api/import/batch/lote-a", { id: "lote-a" }));
  const rest = db.prepare("SELECT external_id FROM transactions").all() as any[];
  assert.deepEqual(rest.map(r => r.external_id), ["uuid-z"]);
});

test("import completo deixa o ledger sem violação de invariante", async () => {
  const db = freshDb();
  const prev = await previewExtrato(db);
  await call(db, "POST", "/api/import/confirm", jsonReq("/api/import/confirm", { batch_id: prev.body.batch_id }));
  assert.deepEqual(auditLedger(db), []);
});
