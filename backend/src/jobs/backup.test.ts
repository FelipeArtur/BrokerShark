import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
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
