import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackup, backupStatus } from "./backup.ts";

test("runBackup: gera cópia datada válida com as tabelas", () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"));
  const src = join(dir, "src.db");
  const s = new DatabaseSync(src);
  s.exec("CREATE TABLE t (x); INSERT INTO t VALUES (42);");
  s.close();
  const out = runBackup(src, join(dir, "backups"), new Date("2026-07-18T12:00:00Z"));
  assert.ok(out.endsWith("brokershark-2026-07-18.db"));
  const copy = new DatabaseSync(out, { readOnly: true });
  assert.equal((copy.prepare("SELECT x FROM t").get() as { x: number }).x, 42);
  copy.close();
  rmSync(dir, { recursive: true });
});

test("runBackup: retém só as 12 mais recentes", () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"));
  const src = join(dir, "src.db");
  const s = new DatabaseSync(src);
  s.exec("CREATE TABLE t (x)");
  s.close();
  const destDir = join(dir, "backups");
  mkdirSync(destDir, { recursive: true });
  for (let i = 1; i <= 12; i++) {
    writeFileSync(join(destDir, `brokershark-2025-01-${String(i).padStart(2, "0")}.db`), "");
  }
  runBackup(src, destDir, new Date("2026-07-18T12:00:00Z"));
  const left = readdirSync(destDir).filter((f) => f.endsWith(".db")).sort();
  assert.equal(left.length, 12);
  assert.equal(left[left.length - 1], "brokershark-2026-07-18.db");
  assert.ok(!left.includes("brokershark-2025-01-01.db"));
  rmSync(dir, { recursive: true });
});

test("backupStatus: sem dir → exists false", () => {
  assert.deepEqual(backupStatus(join(tmpdir(), "nao-existe-xyz-123")), { exists: false });
});

test("backupStatus: pega o mais recente e calcula idade em segundos", () => {
  const dir = mkdtempSync(join(tmpdir(), "bs-"));
  writeFileSync(join(dir, "brokershark-2026-07-10.db"), "");
  writeFileSync(join(dir, "brokershark-2026-07-15.db"), "");
  const st = backupStatus(dir, new Date("2026-07-18T00:00:00Z"));
  assert.deepEqual(st, { exists: true, name: "brokershark-2026-07-15.db", age_seconds: 3 * 86400 });
  rmSync(dir, { recursive: true });
});

test("rodar duas vezes no mesmo dia sobrescreve em vez de estourar", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bs-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = join(dir, "origem.db");
  const db = new DatabaseSync(src);
  db.exec("CREATE TABLE t (n INTEGER)");
  db.exec("INSERT INTO t VALUES (1)");
  db.close();

  const dia = new Date("2026-07-30T12:00:00Z");
  const um = runBackup(src, join(dir, "dest"), dia);

  // O ledger muda entre um disparo e outro; o segundo backup do dia tem que
  // refletir isso, não falhar com "output file already exists".
  const db2 = new DatabaseSync(src);
  db2.exec("INSERT INTO t VALUES (2)");
  db2.close();

  const dois = runBackup(src, join(dir, "dest"), dia);
  assert.equal(dois, um, "mesmo dia, mesmo nome de arquivo");

  const lido = new DatabaseSync(dois, { readOnly: true });
  const { n } = lido.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
  lido.close();
  assert.equal(n, 2, "o segundo backup tinha que trazer a linha nova");

  assert.equal(existsSync(`${dois}.tmp`), false, "o temporário não pode sobrar");
});

test("a config vai junto do snapshot, com a mesma data e 0600", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bs-cfg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // O backup copia a config REAL em uso, e é `BROKERSHARK_CONFIG` quem manda —
  // usar um caminho adivinhado salvaria a config errada sem avisar.
  const cfg = join(dir, "minha.json");
  writeFileSync(cfg, JSON.stringify({
    accounts: [{ id: "c1", bank: "Banco X", type: "checking", name: "Conta X" }],
    investmentKeywords: [],
  }));
  const antes = process.env.BROKERSHARK_CONFIG;
  process.env.BROKERSHARK_CONFIG = cfg;
  t.after(() => {
    if (antes === undefined) delete process.env.BROKERSHARK_CONFIG;
    else process.env.BROKERSHARK_CONFIG = antes;
  });

  const src = join(dir, "origem.db");
  const db = new DatabaseSync(src);
  db.exec("CREATE TABLE t (n INTEGER)");
  db.close();

  const dest = join(dir, "dest");
  const feito = runBackup(src, dest, new Date("2026-07-30T12:00:00Z"));
  const cfgBk = `${feito.slice(0, -".db".length)}.config.json`;

  assert.equal(existsSync(cfgBk), true, "a config tinha que estar ao lado do .db");
  assert.equal(JSON.parse(readFileSync(cfgBk, "utf8")).accounts[0].id, "c1");
  assert.equal(statSync(cfgBk).mode & 0o777, 0o600, "config carrega dado de banco: 0600");
  assert.equal(existsSync(`${cfgBk}.tmp`), false, "o temporário não pode sobrar");
});

test("a poda leva o PAR inteiro, e conta datas em vez de arquivos", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bs-poda-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dest = join(dir, "dest");
  mkdirSync(dest, { recursive: true });

  // 14 pares antigos. Contando ARQUIVO seriam 28 entradas e a poda deixaria 12
  // arquivos, ou seja 6 dias — metade da retenção, sem ninguém notar.
  for (let d = 1; d <= 14; d++) {
    const dia = `2025-01-${String(d).padStart(2, "0")}`;
    writeFileSync(join(dest, `brokershark-${dia}.db`), "x");
    writeFileSync(join(dest, `brokershark-${dia}.config.json`), "{}");
  }

  const src = join(dir, "origem.db");
  const db = new DatabaseSync(src);
  db.exec("CREATE TABLE t (n INTEGER)");
  db.close();
  runBackup(src, dest, new Date("2026-07-30T12:00:00Z"));

  const dbs = readdirSync(dest).filter(f => f.endsWith(".db"));
  const cfgs = readdirSync(dest).filter(f => f.endsWith(".config.json"));
  assert.equal(dbs.length, 12, "12 datas retidas, não 12 arquivos");
  assert.equal(cfgs.length, 12, "cada .db retido mantém a config dele");
  assert.equal(existsSync(join(dest, "brokershark-2025-01-01.db")), false);
  assert.equal(existsSync(join(dest, "brokershark-2025-01-01.config.json")), false,
    "a config do dia podado tinha que sair junto");
});
