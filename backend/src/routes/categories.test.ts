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
import { deleteOrphanCategoryRules, categoryRoutes } from "./categories.ts";
import { useTestConfig } from "../testing/fixtures.ts";

useTestConfig();

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
  const hit = await dispatch(categoryRoutes(db), req, res, url.split("?")[0]);
  assert.ok(hit, `nenhuma rota casou com ${method} ${url}`);
  return { status, payload };
}

const novaCategoria = async (db: DatabaseSync, name: string, flow: string) =>
  (await call(db, "POST", "/api/categories", { name, flow })).payload.id as number;

const lancamento = (db: DatabaseSync, categoryId: number, flow = "expense") =>
  db.prepare(`INSERT INTO transactions (date, flow, method, account_id, amount_cents, description, category_id)
              VALUES ('2026-05-10', ?, 'pix', 'conta-a', 1000, 'teste', ?)`).run(flow, categoryId);

const contagem = (db: DatabaseSync, sql: string) =>
  (db.prepare(sql).get() as { n: number }).n;

// ── exclusão ─────────────────────────────────────────────────────────────────

test("categoria sem lançamento nenhum é excluída sem destino", async () => {
  const db = freshDb();
  const id = await novaCategoria(db, "Freela", "income");
  const out = await call(db, "DELETE", `/api/categories/${id}`, {});
  assert.equal(out.status, 200);
  assert.equal(contagem(db, "SELECT COUNT(*) n FROM categories"), 0);
});

test("sem destino, os lançamentos ficam sem categoria em vez de sumir", async () => {
  const db = freshDb();
  const id = await novaCategoria(db, "Salário", "income");
  lancamento(db, id, "income");
  const out = await call(db, "DELETE", `/api/categories/${id}`, {});
  assert.equal(out.status, 200);
  assert.equal(contagem(db, "SELECT COUNT(*) n FROM transactions"), 1, "o lançamento continua lá");
  assert.equal(contagem(db, "SELECT COUNT(*) n FROM transactions WHERE category_id IS NULL"), 1);
});

test("destino de outro fluxo é recusado — receita não vira despesa", async () => {
  const db = freshDb();
  const receita = await novaCategoria(db, "Salário", "income");
  const despesa = await novaCategoria(db, "Transporte", "expense");
  lancamento(db, receita, "income");

  const out = await call(db, "DELETE", `/api/categories/${receita}`, { reassign_to_id: despesa });
  assert.equal(out.status, 400);
  assert.match(out.payload.error, /despesa/);
  assert.equal(contagem(db, "SELECT COUNT(*) n FROM categories"), 2, "nada foi apagado");
  assert.equal(
    (db.prepare("SELECT category_id AS n FROM transactions").get() as any).n, receita,
    "o lançamento continua na categoria original",
  );
});

test("destino do mesmo fluxo leva os lançamentos junto", async () => {
  const db = freshDb();
  const de = await novaCategoria(db, "Freela", "income");
  const para = await novaCategoria(db, "Salário", "income");
  lancamento(db, de, "income");

  const out = await call(db, "DELETE", `/api/categories/${de}`, { reassign_to_id: para });
  assert.equal(out.status, 200);
  assert.equal((db.prepare("SELECT category_id AS n FROM transactions").get() as any).n, para);
});

test("id de destino zero ou negativo é recusado, não tratado como 'sem destino'", async () => {
  const db = freshDb();
  const id = await novaCategoria(db, "Outro", "income");
  for (const alvo of [0, -1]) {
    const out = await call(db, "DELETE", `/api/categories/${id}`, { reassign_to_id: alvo });
    assert.equal(out.status, 400, `reassign_to_id ${alvo} deveria falhar`);
  }
  assert.equal(contagem(db, "SELECT COUNT(*) n FROM categories"), 1, "a categoria continua lá");
});

test("categoria inexistente devolve 404", async () => {
  const out = await call(freshDb(), "DELETE", "/api/categories/999", {});
  assert.equal(out.status, 404);
});

test("deleteOrphanCategoryRules removes category rules pointing at a deleted category", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER)");
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('posto x','category','7',50,1)").run();
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('mercado y','category','9',50,1)").run();
  deleteOrphanCategoryRules(db, 7);
  const left = db.prepare("SELECT value FROM rules WHERE action='category'").all() as any[];
  assert.deepEqual(left.map(r => r.value), ["9"]);
});

test("deleteOrphanCategoryRules leaves non-category rules untouched", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER)");
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('rdb','investment_leg',NULL,100,1)").run();
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('posto x','category','7',50,1)").run();
  deleteOrphanCategoryRules(db, 7);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rules WHERE action='investment_leg'").get() as any).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rules WHERE action='category'").get() as any).n, 0);
});
