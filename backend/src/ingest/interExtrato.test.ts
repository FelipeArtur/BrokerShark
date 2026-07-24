import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInterExtrato } from "./interExtrato.ts";

test("Inter: preâmbulo, ponto-e-vírgula, saldo de abertura derivado", () => {
  const csv = [
    "Extrato Conta", ";;;", ";;;", ";;;",
    "Data Lançamento;Descrição;Valor;Saldo",
    "03/03/2026;PIX ENVIADO MARIA;-30,00;970,00",
  ].join("\n");
  const p = parseInterExtrato(csv, "inter.csv");

  assert.equal(p.records.length, 1);
  const r = p.records[0];
  assert.equal(r.amountCents, 3000);
  assert.equal(r.flow, "expense");
  assert.equal(r.accountId, "inter-db");

  assert.equal(p.openingBalanceCents, 100000);
});
