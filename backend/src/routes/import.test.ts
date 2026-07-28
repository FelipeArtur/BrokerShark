import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAccount } from "./import.ts";
import { useTestConfig } from "../testing/fixtures.ts";

useTestConfig();

const EXTRATO_IDS = "Data,Valor,Identificador,Descrição\n2026-05-01,10.00,uuid,Mercado\n";
const EXTRATO_SALDO = "Data Lançamento;Histórico;Valor;Saldo\n01/05/2026;PIX;10,00;100,00\n";
const FATURA_ITEMIZADA = '"Data","Lançamento","Categoria","Tipo","Valor"\n"01/05/2026","Steam","Lazer","Parcela 1/3","31,00"\n';

test("detectAccount: fatura itemizada → conta de cartão", () => {
  assert.equal(detectAccount(FATURA_ITEMIZADA), "cartao-b");
});

test("detectAccount: extrato com identificador → conta-a", () => {
  assert.equal(detectAccount(EXTRATO_IDS), "conta-a");
});

test("detectAccount: extrato com saldo corrente → conta-b", () => {
  assert.equal(detectAccount(EXTRATO_SALDO), "conta-b");
});

test("detectAccount: fatura não colide com conta-b (sem 'data lançamento' junto)", () => {

  assert.notEqual(detectAccount(FATURA_ITEMIZADA), "conta-b");
});

test("detectAccount: formato desconhecido → null", () => {
  assert.equal(detectAccount("foo,bar\n1,2\n"), null);
});
