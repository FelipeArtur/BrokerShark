import { test } from "node:test";
import assert from "node:assert/strict";
import { monthRange, prevRefMonth } from "./dates.ts";

test("monthRange: primeiro e último dia ISO", () => {
  assert.deepEqual(monthRange(2, 2026), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(monthRange(12, 2025), { start: "2025-12-01", end: "2025-12-31" });
});

test("prevRefMonth: mês anterior, virando o ano em janeiro", () => {
  assert.equal(prevRefMonth("2026-07"), "2026-06");
  assert.equal(prevRefMonth("2026-01"), "2025-12");
  assert.equal(prevRefMonth("2026-10"), "2026-09");
});
