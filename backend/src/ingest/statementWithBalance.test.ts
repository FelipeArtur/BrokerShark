import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatementWithBalance } from "./statementWithBalance.ts";
import type { LedgerVocabulary } from "./types.ts";

const VOCAB: LedgerVocabulary = { investmentKeywords: ["aplicacao", "resgate"] };

test("formato com saldo corrente: preâmbulo, ponto-e-vírgula, abertura derivada", () => {
  const csv = [
    "Extrato Conta", ";;;", ";;;", ";;;",
    "Data Lançamento;Descrição;Valor;Saldo",
    "03/03/2026;PIX ENVIADO MARIA;-30,00;970,00",
  ].join("\n");
  const p = parseStatementWithBalance(csv, "extrato.csv", "conta-b", VOCAB);

  assert.equal(p.records.length, 1);
  const r = p.records[0];
  assert.equal(r.amountCents, 3000);
  assert.equal(r.flow, "expense");
  assert.equal(r.accountId, "conta-b");

  // O saldo de abertura é DERIVADO: saldo declarado menos o valor da linha.
  assert.equal(p.openingBalanceCents, 100000);
});
