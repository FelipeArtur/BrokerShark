import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyCheckingSeries } from "./accountBalances.ts";
import type { AccountSeed, MonthlyDelta } from "./accountBalances.ts";

const open = (id: string, initialCents = 0): AccountSeed => ({ id, initialCents, closedYm: null });
const shut = (id: string, closedYm: string, initialCents = 0): AccountSeed =>
  ({ id, initialCents, closedYm });
const d = (account_id: string, ym: string, deltaCents: number): MonthlyDelta =>
  ({ account_id, ym, deltaCents });

const values = (s: { ym: string; total_cents: number }[]) => s.map(p => p.total_cents);

test("sem movimento não há série", () => {
  assert.deepEqual(monthlyCheckingSeries([open("conta-a")], []), []);
});

test("saldo inicial entra desde o primeiro mês", () => {
  const s = monthlyCheckingSeries([open("conta-a", 10_000)], [d("conta-a", "2026-01", 500)]);
  assert.deepEqual(s, [{ ym: "2026-01", total_cents: 10_500 }]);
});

test("o saldo é acumulado, não o delta do mês", () => {
  const s = monthlyCheckingSeries(
    [open("conta-a")],
    [d("conta-a", "2026-01", 1000), d("conta-a", "2026-02", 200), d("conta-a", "2026-03", -500)],
  );
  assert.deepEqual(values(s), [1000, 1200, 700]);
});

test("mês sem movimento nenhum não abre buraco na série", () => {
  const s = monthlyCheckingSeries([open("conta-a")], [d("conta-a", "2026-01", 1000), d("conta-a", "2026-04", 100)]);
  assert.deepEqual(s.map(p => p.ym), ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(values(s), [1000, 1000, 1000, 1100]);
});

test("a série atravessa a virada do ano", () => {
  const s = monthlyCheckingSeries([open("conta-a")], [d("conta-a", "2026-11", 100), d("conta-a", "2027-02", 100)]);
  assert.deepEqual(s.map(p => p.ym), ["2026-11", "2026-12", "2027-01", "2027-02"]);
});

test("contas somam", () => {
  const s = monthlyCheckingSeries(
    [open("conta-a", 1000), open("conta-b", 2000)],
    [d("conta-a", "2026-01", 100), d("conta-b", "2026-01", 50)],
  );
  assert.deepEqual(values(s), [3150]);
});

test("conta encerrada sai da soma no mês do encerramento — inclusive", () => {
  const s = monthlyCheckingSeries(
    [open("conta-a"), shut("conta-b", "2026-03")],
    [
      d("conta-a", "2026-01", 1000), d("conta-b", "2026-01", 500),
      d("conta-a", "2026-02", 0),
      d("conta-a", "2026-04", 0),
    ],
  );
  assert.deepEqual(values(s), [1500, 1500, 1000, 1000]);
});

test("o histórico ANTES do encerramento continua contando a conta morta", () => {
  const s = monthlyCheckingSeries(
    [shut("conta-b", "2026-03", 800)],
    [d("conta-b", "2026-01", 200), d("conta-b", "2026-04", 0)],
  );
  assert.deepEqual(values(s), [1000, 1000, 0, 0]);
});

test("encerrar sem transferência de saída não deixa saldo fantasma", () => {
  //> Jeito certo: o dinheiro sai antes de fechar e continua seu, na conta-a.
  const comTransferencia = monthlyCheckingSeries(
    [open("conta-a"), shut("conta-b", "2026-03")],
    [
      d("conta-b", "2026-01", 500),
      d("conta-a", "2026-02", 500), d("conta-b", "2026-02", -500),
      d("conta-a", "2026-03", 0),
    ],
  );
  assert.deepEqual(values(comTransferencia), [500, 500, 500]);

  //> Jeito torto: saca em espécie e para de importar. É esse saldo fantasma que o
  //> corte mata.
  const semTransferencia = monthlyCheckingSeries(
    [open("conta-a"), shut("conta-b", "2026-03")],
    [d("conta-b", "2026-01", 500), d("conta-a", "2026-03", 0)],
  );
  assert.deepEqual(values(semTransferencia), [500, 500, 0]);
});

test("conta aberta depois entra sem alterar o passado", () => {
  const s = monthlyCheckingSeries(
    [open("conta-a"), open("novo")],
    [d("conta-a", "2026-01", 1000), d("novo", "2026-03", 700)],
  );
  assert.deepEqual(values(s), [1000, 1000, 1700]);
});
