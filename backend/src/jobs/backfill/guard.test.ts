import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "../../db/open.ts";
import { runMigrations } from "../../db/migrate.ts";
import { seedAccounts, seedRules } from "./seeds.ts";
import { seedTestCategories, useTestConfig } from "../../testing/fixtures.ts";
import { userOverlay } from "./guard.ts";

useTestConfig();

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  runMigrations(db, MIGRATIONS_DIR);
  seedAccounts(db);
  seedTestCategories(db);
  return db;
}

const labels = (db: DatabaseSync) => userOverlay(db).map(f => f.label);

// ── o que o backfill pode apagar sem dó ─────────────────────────────────────

test("DB recém-semeado não tem nada da UI", () => {
  const db = freshDb();
  assert.equal(userOverlay(db).length, 0);
  assert.deepEqual(userOverlay(db), []);
});

test("as regras semeadas pelo backfill não contam como dado da UI", () => {
  //> Se as semeadas tropeçassem a guarda, todo rebuild abortaria.
  const db = freshDb();
  seedRules(db);
  assert.equal(userOverlay(db).length, 0);
});

// ── o que o backfill NÃO pode apagar ────────────────────────────────────────

test("transação importada pela UI é dado da UI", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, import_batch_id)
    VALUES ('2026-03-01','expense','pix','conta-a',1000,'x','sess-1')`).run();
  assert.ok(userOverlay(db).length > 0);
});

test("apelido editado pela UI é dado da UI", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, display_name)
    VALUES ('2026-03-01','expense','pix','conta-a',1000,'x','Almoço')`).run();
  assert.ok(userOverlay(db).length > 0);
});

test("conta criada pela UI é dado da UI", () => {
  //> Conta nova não deixa NENHUMA transação. A guarda antiga só olhava
  //> transactions, então um rebuild apagava a conta em silêncio.
  const db = freshDb();
  db.prepare(`INSERT INTO accounts (id, bank, type, name, opened_at)
    VALUES ('c6-db','c6','checking','C6 Conta','2026-07-26')`).run();
  assert.ok(userOverlay(db).length > 0, "conta criada pela UI passaria batido");
  assert.ok(labels(db).some(l => /conta/i.test(l)));
});

test("conta encerrada pela UI é dado da UI", () => {
  //> Encerrar é a informação mais cara de perder: sem closed_at, a conta morta
  //> volta a somar no disponível e o herói mente pra cima.
  const db = freshDb();
  db.prepare("UPDATE accounts SET closed_at='2026-07-01' WHERE id='conta-b'").run();
  assert.ok(userOverlay(db).length > 0, "encerramento passaria batido");
});

test("alvo de orçamento é dado da UI", () => {
  const db = freshDb();
  const cat = db.prepare("SELECT id FROM categories WHERE flow='expense' LIMIT 1").get() as { id: number };
  db.prepare("INSERT INTO category_budgets (category_id, ref_month, amount_cents) VALUES (?, '', 50000)").run(cat.id);
  assert.ok(userOverlay(db).length > 0, "alvo de gasto passaria batido");
});

test("regra de categoria aprendida é dado da UI", () => {
  //> Categorizar não deixa marca no lançamento: a marca é a regra aprendida.
  const db = freshDb();
  db.prepare(`INSERT INTO rules (matcher, action, value, priority, enabled)
    VALUES ('padaria', 'category', '3', 50, 1)`).run();
  assert.ok(userOverlay(db).length > 0, "categorização manual passaria batido");
});

// ── schema mais velho que a guarda ──────────────────────────────────────────

test("DB anterior à migration não estoura a guarda — a sonda é pulada", () => {
  //> A guarda roda ANTES das migrations: estourar num schema velho trocaria a
  //> proteção por um stack trace.
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);            // baseline, SEM as migrations
  seedAccounts(db);
  assert.doesNotThrow(() => userOverlay(db));
  assert.equal(userOverlay(db).length, 0);
});

test("sonda pulada por falta de coluna não vira falso positivo", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccounts(db);
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, import_batch_id)
    VALUES ('2026-03-01','expense','pix','conta-a',1000,'x','sess-1')`).run();
  //> A sonda de contas some (sem closed_at no baseline), mas a de lançamentos
  //> continua valendo — pular uma sonda não pode cegar as outras.
  assert.deepEqual(labels(db), ["lançamentos importados ou editados pela UI"]);
});

// ── a mensagem tem que dizer o que se perde ─────────────────────────────────

test("cada tipo de dado vira um achado próprio, com contagem", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO accounts (id, bank, type, name, opened_at)
    VALUES ('c6-db','c6','checking','C6 Conta','2026-07-26')`).run();
  db.prepare(`INSERT INTO rules (matcher, action, value, priority, enabled)
    VALUES ('padaria', 'category', '3', 50, 1)`).run();
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, import_batch_id)
    VALUES ('2026-03-01','expense','pix','conta-a',1000,'x','sess-1')`).run();

  const found = userOverlay(db);
  assert.equal(found.length, 3, `esperava 3 achados, veio ${JSON.stringify(labels(db))}`);
  for (const f of found) {
    assert.ok(f.count > 0, `${f.label} veio com contagem ${f.count}`);
    assert.ok(f.label.length > 0);
  }
});
