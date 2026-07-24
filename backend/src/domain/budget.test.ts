import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBudget, isRefMonth, FIXED } from "./budget.ts";

const rows = [
  { category_id: 1, ref_month: FIXED, amount_cents: 120_000 },
  { category_id: 1, ref_month: "2026-12", amount_cents: 200_000 },
  { category_id: 2, ref_month: "2026-07", amount_cents: 50_000 },
];

test("resolveBudget: override do mês ganha do fixo", () => {
  assert.deepEqual(resolveBudget(rows, 1, "2026-12"), { amount_cents: 200_000, source: "month" });
});

test("resolveBudget: mês sem override herda o fixo", () => {
  assert.deepEqual(resolveBudget(rows, 1, "2026-07"), { amount_cents: 120_000, source: "fixed" });
});

test("resolveBudget: só override, sem fixo — outros meses ficam sem alvo", () => {
  assert.deepEqual(resolveBudget(rows, 2, "2026-07"), { amount_cents: 50_000, source: "month" });
  assert.equal(resolveBudget(rows, 2, "2026-08"), null);
});

test("resolveBudget: categoria sem alvo é null, não zero", () => {
  assert.equal(resolveBudget(rows, 99, "2026-07"), null);
});

test("resolveBudget: pedir o próprio fixo devolve o fixo", () => {
  assert.deepEqual(resolveBudget(rows, 1, FIXED), { amount_cents: 120_000, source: "fixed" });
});

test("isRefMonth: aceita '' (fixo) e YYYY-MM válido", () => {
  assert.ok(isRefMonth(FIXED));
  assert.ok(isRefMonth("2026-01"));
  assert.ok(isRefMonth("2026-12"));
});

test("isRefMonth: rejeita mês fora da faixa e lixo", () => {
  assert.ok(!isRefMonth("2026-13"));
  assert.ok(!isRefMonth("2026-00"));
  assert.ok(!isRefMonth("2026-1"));
  assert.ok(!isRefMonth("2026-07-01"));
  assert.ok(!isRefMonth(null));
  assert.ok(!isRefMonth(202607));
});
