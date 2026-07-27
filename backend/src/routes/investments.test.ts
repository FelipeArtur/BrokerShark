import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSchema } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccountsAndCategories } from "../jobs/backfill/seeds.ts";
import { dispatch } from "../http/router.ts";
import { investmentRoutes } from "./investments.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../db/migrations");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccountsAndCategories(db);
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

async function get(db: DatabaseSync, url: string): Promise<{ status: number; payload: any }> {
  const req = Readable.from([]) as any;
  req.method = "GET";
  req.url = url;
  req.headers = {};
  let status = 200;
  let payload: any;
  const res: any = {
    headersSent: false, setHeader() {},
    writeHead(s: number) { status = s; },
    end(s: string) { payload = s ? JSON.parse(s) : undefined; },
  };
  const hit = await dispatch(investmentRoutes(db), req, res, url.split("?")[0]);
  assert.ok(hit, `nenhuma rota casou com ${url}`);
  return { status, payload };
}

function position(db: DatabaseSync, cols: Record<string, unknown> = {}): number {
  const base: Record<string, unknown> = {
    name: "Tesouro IPCA+ 2029", match_key: "BR-TESOURO-1", type: "tesouro",
    bank: "b3", source: "b3",
  };
  const all = { ...base, ...cols };
  const keys = Object.keys(all);
  return Number(db.prepare(
    `INSERT INTO investments (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map(k => all[k] as never)).lastInsertRowid);
}

function snapshot(db: DatabaseSync, invId: number, refDate: string, applied: number, net: number) {
  db.prepare(`INSERT INTO position_snapshots
    (investment_id, ref_date, quantity, applied_cents, gross_cents, net_cents, source)
    VALUES (?,?,?,?,?,?, 'b3')`).run(invId, refDate, 1, applied, net, net);
}

test("detalhe traz a ficha da posição e os snapshots em ordem de data", async () => {
  const db = freshDb();
  const id = position(db, { indexer: "IPCA", rate_text: "IPCA+5,5%", maturity_date: "2029-05-15" });
  snapshot(db, id, "2026-03-31", 100_00, 105_00);
  snapshot(db, id, "2026-01-31", 100_00, 101_00);
  snapshot(db, id, "2026-02-28", 100_00, 103_00);

  const { status, payload } = await get(db, `/api/investments/${id}`);
  assert.equal(status, 200);
  assert.equal(payload.name, "Tesouro IPCA+ 2029");
  assert.equal(payload.indexer, "IPCA");
  assert.equal(payload.maturity_date, "2029-05-15");
  assert.deepEqual(payload.snapshots.map((s: any) => s.ref_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("rendimento é computado (net − aplicado), não guardado", async () => {
  const db = freshDb();
  const id = position(db);
  snapshot(db, id, "2026-03-31", 200_00, 230_00);

  const s = (await get(db, `/api/investments/${id}`)).payload.snapshots[0];
  assert.equal(s.applied, 200);
  assert.equal(s.net, 230);
  assert.equal(s.yield, 30);
  assert.equal(s.yield_pct, 15);
});

test("rendimento negativo aparece como negativo, não some", async () => {
  const db = freshDb();
  const id = position(db);
  snapshot(db, id, "2026-03-31", 100_00, 92_00);

  const s = (await get(db, `/api/investments/${id}`)).payload.snapshots[0];
  assert.equal(s.yield, -8);
  assert.equal(s.yield_pct, -8);
});

test("sem aplicado o rendimento é null, nunca zero", async () => {
  // Zero afirmaria "rendeu nada"; null diz "não dá pra saber". A Caixinha
  // derivada do ledger cai nesse caso — não há aplicado por snapshot.
  const db = freshDb();
  const id = position(db, { match_key: "LEDGER-CAIXINHA", source: "ledger" });
  db.prepare(`INSERT INTO position_snapshots
    (investment_id, ref_date, applied_cents, net_cents, source)
    VALUES (?, '2026-03-31', 0, 5000, 'derived')`).run(id);

  const s = (await get(db, `/api/investments/${id}`)).payload.snapshots[0];
  assert.equal(s.yield, null);
  assert.equal(s.yield_pct, null);
  assert.equal(s.net, 50);
});

test("posição sem snapshot devolve lista vazia, não 404", async () => {
  const db = freshDb();
  const id = position(db);
  const { status, payload } = await get(db, `/api/investments/${id}`);
  assert.equal(status, 200);
  assert.deepEqual(payload.snapshots, []);
});

test("posição fechada ainda abre — o histórico dela continua legível", async () => {
  const db = freshDb();
  const id = position(db, { closed_at: "2026-02-01" });
  snapshot(db, id, "2026-01-31", 100_00, 110_00);
  const { status, payload } = await get(db, `/api/investments/${id}`);
  assert.equal(status, 200);
  assert.equal(payload.closed_at, "2026-02-01");
  assert.equal(payload.snapshots.length, 1);
});

test("id inexistente é 404 e id inválido é 400", async () => {
  const db = freshDb();
  assert.equal((await get(db, "/api/investments/99999")).status, 404);
  assert.equal((await get(db, "/api/investments/abc")).status, 400);
  assert.equal((await get(db, "/api/investments/-1")).status, 400);
});

test("a listagem continua respondendo — a rota nova não a engoliu", async () => {
  const db = freshDb();
  const id = position(db);
  snapshot(db, id, "2026-03-31", 100_00, 105_00);
  const lista = (await get(db, "/api/investments")).payload;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].balance, 105);
});

test("a evolução continua respondendo — a rota nova não a engoliu", async () => {
  const db = freshDb();
  const id = position(db);
  snapshot(db, id, "2026-03-31", 100_00, 105_00);
  const { status } = await get(db, "/api/investment-evolution");
  assert.equal(status, 200);
});
