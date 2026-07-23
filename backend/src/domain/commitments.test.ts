import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, projectInstallments } from "./commitments.ts";

test("addMonths: soma dentro do ano", () => {
  assert.equal(addMonths("2026-07", 3), "2026-10");
});

test("addMonths: vira o ano", () => {
  assert.equal(addMonths("2026-11", 3), "2027-02");
});

test("addMonths: k=0 é o próprio mês", () => {
  assert.equal(addMonths("2026-07", 0), "2026-07");
});

test("projectInstallments: 2/5 projeta 3 parcelas futuras (08..10)", () => {
  const out = projectInstallments([
    { description: "Steam", refMonth: "2026-07", amountCents: 1000, installmentSeq: 2, installmentTotal: 5 },
  ]);
  assert.deepEqual(out, [
    { month: "2026-08", amountCents: 1000, count: 1 },
    { month: "2026-09", amountCents: 1000, count: 1 },
    { month: "2026-10", amountCents: 1000, count: 1 },
  ]);
});

test("projectInstallments: parcela final (5/5) não projeta nada", () => {
  const out = projectInstallments([
    { description: "X", refMonth: "2026-07", amountCents: 500, installmentSeq: 5, installmentTotal: 5 },
  ]);
  assert.deepEqual(out, []);
});

test("projectInstallments: dois itens no mesmo mês futuro somam e contam", () => {
  const out = projectInstallments([
    { description: "A", refMonth: "2026-07", amountCents: 1000, installmentSeq: 1, installmentTotal: 2 },
    { description: "B", refMonth: "2026-07", amountCents: 300, installmentSeq: 1, installmentTotal: 2 },
  ]);
  assert.deepEqual(out, [{ month: "2026-08", amountCents: 1300, count: 2 }]);
});

test("projectInstallments: entrada vazia → []", () => {
  assert.deepEqual(projectInstallments([]), []);
});
