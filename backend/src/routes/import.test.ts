import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAccount } from "./import.ts";

const NUBANK = "Data,Valor,Identificador,Descrição\n2026-05-01,10.00,uuid,Mercado\n";
const INTER_EXTRATO = "Data Lançamento;Histórico;Valor;Saldo\n01/05/2026;PIX;10,00;100,00\n";
const INTER_FATURA = '"Data","Lançamento","Categoria","Tipo","Valor"\n"01/05/2026","Steam","Lazer","Parcela 1/3","31,00"\n';

test("detectAccount: fatura Inter → inter-cc", () => {
  assert.equal(detectAccount(INTER_FATURA), "inter-cc");
});

test("detectAccount: extrato Nubank → nu-db (sem regressão)", () => {
  assert.equal(detectAccount(NUBANK), "nu-db");
});

test("detectAccount: extrato Inter → inter-db (sem regressão)", () => {
  assert.equal(detectAccount(INTER_EXTRATO), "inter-db");
});

test("detectAccount: fatura não colide com inter-db (sem 'data lançamento' junto)", () => {
  // header da fatura tem 'lançamento' e 'data' separados por vírgula, nunca juntos
  assert.notEqual(detectAccount(INTER_FATURA), "inter-db");
});

test("detectAccount: formato desconhecido → null", () => {
  assert.equal(detectAccount("foo,bar\n1,2\n"), null);
});
