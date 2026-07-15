import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoneyCents, parseDateBR } from "./money.ts";

test("parseMoneyCents: formato BR (vírgula decimal, ponto de milhar)", () => {
  assert.equal(parseMoneyCents("1.234,56"), 123456);
  assert.equal(parseMoneyCents("-50,00"), -5000);
  assert.equal(parseMoneyCents("0,01"), 1);
});

test("parseMoneyCents: formato com ponto decimal (extrato Nubank)", () => {
  assert.equal(parseMoneyCents("-50.00"), -5000);
});

test("parseDateBR: DD/MM/YYYY → ISO", () => {
  assert.equal(parseDateBR("01/03/2026"), "2026-03-01");
  assert.equal(parseDateBR("31/12/2025"), "2025-12-31");
});
