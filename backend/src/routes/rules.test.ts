import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts, seedRules } from "../jobs/backfill/seeds.ts";
import { seedTestCategories, useTestConfig } from "../testing/fixtures.ts";
import { dispatch } from "../http/router.ts";
import { ruleRoutes } from "./rules.ts";
import { learnCategoryRule } from "./transactions.ts";

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
    headersSent: false, setHeader() {},
    writeHead(s: number) { status = s; },
    end(s: string) { payload = s ? JSON.parse(s) : undefined; },
  };
  const hit = await dispatch(ruleRoutes(db), req, res, url.split("?")[0]);
  assert.ok(hit, `nenhuma rota casou com ${method} ${url}`);
  return { status, payload };
}

const catId = (db: DatabaseSync, name: string): number =>
  (db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number }).id;

const tx = (db: DatabaseSync, desc: string) =>
  db.prepare(`INSERT INTO transactions (date, flow, method, account_id, amount_cents, description)
              VALUES ('2026-06-10','expense','pix','conta-a',1000,?)`).run(desc);

// ── listagem ────────────────────────────────────────────────────────────────

test("lista vazia quando nada foi categorizado ainda", async () => {
  assert.deepEqual((await call(freshDb(), "GET", "/api/rules")).payload, []);
});

test("as regras semeadas pelo backfill NÃO aparecem", async () => {
  // investment_leg/settlement documentam a classificação que já aconteceu;
  // nada as lê em tempo de execução, então editá-las não mudaria nada e a tela
  // prometeria um efeito que não existe.
  const db = freshDb();
  seedRules(db);
  assert.deepEqual((await call(db, "GET", "/api/rules")).payload, []);
});

test("categorizar um lançamento faz a regra aparecer, com a categoria resolvida", async () => {
  const db = freshDb();
  const alim = catId(db, "Alimentação");
  learnCategoryRule(db, "PADARIA DO ZE LTDA", alim);

  const [r] = (await call(db, "GET", "/api/rules")).payload;
  assert.equal(r.category_id, alim);
  assert.equal(r.category_name, "Alimentação");
  assert.equal(r.enabled, 1);
  assert.equal(r.orphan, false);
});

test("a lista conta quantos lançamentos SEM categoria a regra ainda pegaria", async () => {
  // É o número que deixa julgar se a regra é boa: uma regra larga demais
  // aparece prestes a marcar meio ledger.
  const db = freshDb();
  learnCategoryRule(db, "PADARIA DO ZE", catId(db, "Alimentação"));
  tx(db, "PADARIA DO ZE - COMPRA");
  tx(db, "PADARIA DO ZE LTDA");
  tx(db, "POSTO IPIRANGA");

  const [r] = (await call(db, "GET", "/api/rules")).payload;
  assert.equal(r.pending_matches, 2);
});

test("regra órfã aparece marcada, não some", async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO rules (matcher, action, value, priority, enabled)
              VALUES ('fantasma', 'category', '99999', 50, 1)`).run();
  const [r] = (await call(db, "GET", "/api/rules")).payload;
  assert.equal(r.orphan, true);
  assert.equal(r.category_name, null);
});

// ── corrigir ────────────────────────────────────────────────────────────────

test("trocar a categoria da regra muda o que ela passa a sugerir", async () => {
  const db = freshDb();
  learnCategoryRule(db, "UBER", catId(db, "Alimentação"));   // errado
  const [antes] = (await call(db, "GET", "/api/rules")).payload;

  const transp = catId(db, "Transporte");
  const r = await call(db, "PATCH", `/api/rules/${antes.id}`, { category_id: transp });
  assert.equal(r.status, 200);

  const [depois] = (await call(db, "GET", "/api/rules")).payload;
  assert.equal(depois.category_name, "Transporte");
});

test("desligar a regra tira ela da sugestão sem apagá-la", async () => {
  const db = freshDb();
  learnCategoryRule(db, "UBER", catId(db, "Transporte"));
  const [r] = (await call(db, "GET", "/api/rules")).payload;

  await call(db, "PATCH", `/api/rules/${r.id}`, { enabled: 0 });
  const lista = (await call(db, "GET", "/api/rules")).payload;
  assert.equal(lista.length, 1, "a regra continua listada");
  assert.equal(lista[0].enabled, 0);

  const t = (await call(db, "POST", "/api/rules/test", { description: "UBER TRIP 123" })).payload;
  assert.equal(t.rule_id, null, "regra desligada não pode sugerir");
});

test("religar volta a sugerir", async () => {
  const db = freshDb();
  learnCategoryRule(db, "UBER", catId(db, "Transporte"));
  const [r] = (await call(db, "GET", "/api/rules")).payload;
  await call(db, "PATCH", `/api/rules/${r.id}`, { enabled: 0 });
  await call(db, "PATCH", `/api/rules/${r.id}`, { enabled: 1 });
  const t = (await call(db, "POST", "/api/rules/test", { description: "UBER TRIP" })).payload;
  assert.equal(t.rule_id, r.id);
});

test("apagar a regra NÃO descategoriza o que já foi categorizado", async () => {
  // O que já foi categorizado é decisão tomada; desfazer em massa seria uma
  // surpresa cara. Some só a sugestão daqui pra frente.
  const db = freshDb();
  const alim = catId(db, "Alimentação");
  learnCategoryRule(db, "PADARIA", alim);
  db.prepare(`INSERT INTO transactions (date, flow, method, account_id, amount_cents, description, category_id)
              VALUES ('2026-06-10','expense','pix','conta-a',1000,'PADARIA DO ZE',?)`).run(alim);

  const [r] = (await call(db, "GET", "/api/rules")).payload;
  assert.equal((await call(db, "DELETE", `/api/rules/${r.id}`)).status, 200);

  assert.deepEqual((await call(db, "GET", "/api/rules")).payload, []);
  const still = db.prepare("SELECT category_id FROM transactions WHERE description='PADARIA DO ZE'").get() as any;
  assert.equal(still.category_id, alim, "o lançamento continua categorizado");
});

// ── guardas ─────────────────────────────────────────────────────────────────

test("categoria inexistente é recusada", async () => {
  const db = freshDb();
  learnCategoryRule(db, "UBER", catId(db, "Transporte"));
  const [r] = (await call(db, "GET", "/api/rules")).payload;
  assert.equal((await call(db, "PATCH", `/api/rules/${r.id}`, { category_id: 99999 })).status, 400);
  assert.equal((await call(db, "PATCH", `/api/rules/${r.id}`, { category_id: "x" })).status, 400);
});

test("enabled só aceita 0 ou 1", async () => {
  const db = freshDb();
  learnCategoryRule(db, "UBER", catId(db, "Transporte"));
  const [r] = (await call(db, "GET", "/api/rules")).payload;
  for (const v of [true, 2, "1", null]) {
    assert.equal((await call(db, "PATCH", `/api/rules/${r.id}`, { enabled: v })).status, 400);
  }
});

test("PATCH sem campo nenhum é recusado", async () => {
  const db = freshDb();
  learnCategoryRule(db, "UBER", catId(db, "Transporte"));
  const [r] = (await call(db, "GET", "/api/rules")).payload;
  assert.equal((await call(db, "PATCH", `/api/rules/${r.id}`, {})).status, 400);
});

test("regra semeada não é editável nem apagável por estas rotas", async () => {
  const db = freshDb();
  seedRules(db);
  const seeded = db.prepare("SELECT id FROM rules WHERE action='investment_leg' LIMIT 1").get() as { id: number };
  assert.equal((await call(db, "PATCH", `/api/rules/${seeded.id}`, { enabled: 0 })).status, 404);
  assert.equal((await call(db, "DELETE", `/api/rules/${seeded.id}`)).status, 404);
  assert.ok(db.prepare("SELECT 1 FROM rules WHERE id=?").get(seeded.id), "continua no DB");
});

test("id inexistente ou inválido não escreve nada", async () => {
  const db = freshDb();
  assert.equal((await call(db, "PATCH", "/api/rules/99999", { enabled: 0 })).status, 404);
  assert.equal((await call(db, "DELETE", "/api/rules/abc")).status, 404);
});

// ── espelho da sugestão ─────────────────────────────────────────────────────

test("test explica qual regra casaria e por qual núcleo de comerciante", async () => {
  const db = freshDb();
  const alim = catId(db, "Alimentação");
  learnCategoryRule(db, "PADARIA DO ZE LTDA", alim);
  const t = (await call(db, "POST", "/api/rules/test", { description: "Pix enviado: PADARIA DO ZE LTDA" })).payload;
  assert.equal(t.category_id, alim);
  assert.ok(t.matcher);
  assert.ok(t.merchant_core);
});

test("test sem casar devolve null, não erro", async () => {
  const t = (await call(freshDb(), "POST", "/api/rules/test", { description: "NADA A VER" })).payload;
  assert.equal(t.rule_id, null);
  assert.equal(t.category_id, null);
});

test("test exige description", async () => {
  assert.equal((await call(freshDb(), "POST", "/api/rules/test", { description: "  " })).status, 400);
  assert.equal((await call(freshDb(), "POST", "/api/rules/test", {})).status, 400);
});
