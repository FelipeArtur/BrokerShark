import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNubankExtrato } from "./nubankExtrato.ts";

test("Nubank: parse, sinal e classificação de perna Caixinha", () => {
  const csv = [
    "Data,Valor,Identificador,Descrição",
    "01/03/2026,-50.00,uuid-1,Compra PADARIA",
    "02/03/2026,-200.00,uuid-2,Aplicacao RDB",
    "05/03/2026,1000.00,uuid-3,Transferencia recebida pelo Pix",
  ].join("\n");
  const p = parseNubankExtrato(csv, "nu.csv");

  assert.equal(p.records.length, 3);

  const padaria = p.records[0];
  assert.equal(padaria.amountCents, 5000);
  assert.equal(padaria.flow, "expense");
  assert.equal(padaria.externalId, "uuid-1");

  const rdb = p.records[1];
  assert.equal(rdb.isCaixinhaLeg, true);
  assert.equal(rdb.method, "transfer");

  const pix = p.records[2];
  assert.equal(pix.flow, "income");
  assert.equal(pix.isRevenue, 1);
});
