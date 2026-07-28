import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementWithIds } from "./statementWithIds.ts";
import type { LedgerVocabulary } from "./types.ts";

const VOCAB: LedgerVocabulary = {
  investmentKeywords: ["aplicacao", "resgate", "reserva"],
  savings: { keywords: ["reserva"], excludeKeywords: ["corretora"], accountId: "conta-a" },
};

test("formato com identificador: parse, sinal e perna de poupança", () => {
  const csv = [
    "Data,Valor,Identificador,Descrição",
    "01/03/2026,-50.00,uuid-1,Compra PADARIA",
    "02/03/2026,-200.00,uuid-2,Aplicacao Reserva",
    "05/03/2026,1000.00,uuid-3,Transferencia recebida pelo Pix",
  ].join("\n");
  const p = parseStatementWithIds(csv, "extrato.csv", "conta-a", VOCAB);

  assert.equal(p.records.length, 3);

  const padaria = p.records[0];
  assert.equal(padaria.amountCents, 5000);
  assert.equal(padaria.flow, "expense");
  assert.equal(padaria.externalId, "uuid-1");
  assert.equal(padaria.accountId, "conta-a");

  const reserva = p.records[1];
  assert.equal(reserva.isSavingsLeg, true);
  assert.equal(reserva.method, "transfer");

  const pix = p.records[2];
  assert.equal(pix.flow, "income");
  assert.equal(pix.isRevenue, 1);
});

test("a conta de destino vem de fora do parser", () => {
  const csv = "Data,Valor,Identificador,Descrição\n01/03/2026,-50.00,uuid-1,Compra";
  assert.equal(parseStatementWithIds(csv, "e.csv", "outra-conta", VOCAB).records[0].accountId,
               "outra-conta");
});

test("perna de poupança só na conta configurada para ela", () => {
  const csv = "Data,Valor,Identificador,Descrição\n02/03/2026,-200.00,uuid-2,Aplicacao Reserva";
  const p = parseStatementWithIds(csv, "e.csv", "conta-b", VOCAB);
  assert.equal(p.records[0].isSavingsLeg, false, "conta-b não é a conta da poupança derivada");
  assert.equal(p.records[0].isInvestmentLeg, true, "mas continua sendo movimento de investimento");
});
