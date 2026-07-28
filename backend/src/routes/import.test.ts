import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAccount } from "./import.ts";
import { useTestConfig } from "../testing/fixtures.ts";

useTestConfig();

const NUBANK = "Data,Valor,Identificador,Descrição\n2026-05-01,10.00,uuid,Mercado\n";
const INTER_EXTRATO = "Data Lançamento;Histórico;Valor;Saldo\n01/05/2026;PIX;10,00;100,00\n";
const INTER_FATURA = '"Data","Lançamento","Categoria","Tipo","Valor"\n"01/05/2026","Steam","Lazer","Parcela 1/3","31,00"\n';

test("detectAccount: fatura Inter → cartao-b", () => {
  assert.equal(detectAccount(INTER_FATURA), "cartao-b");
});

test("detectAccount: extrato Nubank → conta-a (sem regressão)", () => {
  assert.equal(detectAccount(NUBANK), "conta-a");
});

test("detectAccount: extrato Inter → conta-b (sem regressão)", () => {
  assert.equal(detectAccount(INTER_EXTRATO), "conta-b");
});

test("detectAccount: fatura não colide com conta-b (sem 'data lançamento' junto)", () => {

  assert.notEqual(detectAccount(INTER_FATURA), "conta-b");
});

test("detectAccount: formato desconhecido → null", () => {
  assert.equal(detectAccount("foo,bar\n1,2\n"), null);
});
