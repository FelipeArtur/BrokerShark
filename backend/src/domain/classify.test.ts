import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvestment, isDerivedSavingsLeg, checkingExpenseMethod } from "./classify.ts";

const KEYWORDS = ["aplicação", "aplicacao", "resgate", "tesouro", "cdb", "reserva"];

const SAVINGS = {
  keywords: ["reserva", "dinheiro guardado"],
  excludeKeywords: ["corretora", "tesouro"],
  accountId: "conta-a",
};

test("isInvestment: casa pelas keywords que vieram da config", () => {
  assert.equal(isInvestment("Aplicacao em CDB", KEYWORDS), true);
  assert.equal(isInvestment("Resgate Tesouro", KEYWORDS), true);
  assert.equal(isInvestment("Compra PADARIA", KEYWORDS), false);
});

test("isInvestment: sem keyword nenhuma, nada é investimento", () => {
  assert.equal(isInvestment("Aplicacao em CDB", []), false);
});

test("poupança derivada: só na conta configurada", () => {
  assert.equal(isDerivedSavingsLeg("Aplicação Reserva", "conta-a", SAVINGS), true);
  assert.equal(isDerivedSavingsLeg("Aplicação Reserva", "conta-b", SAVINGS), false);
});

test("poupança derivada: keyword de exclusão vence a de inclusão", () => {
  // Sem isso, o resgate de um título custodiado entraria na posição derivada E
  // na posição real da corretora — o mesmo dinheiro contado duas vezes.
  assert.equal(isDerivedSavingsLeg("Resgate Tesouro reserva", "conta-a", SAVINGS), false);
  assert.equal(isDerivedSavingsLeg("Reserva via corretora", "conta-a", SAVINGS), false);
});

test("poupança derivada: sem regra configurada, nada é perna", () => {
  assert.equal(isDerivedSavingsLeg("Aplicação Reserva", "conta-a", undefined), false);
});

test("checkingExpenseMethod: método por descrição", () => {
  assert.equal(checkingExpenseMethod("PIX enviado para Maria"), "pix");
  assert.equal(checkingExpenseMethod("Pagamento de fatura"), "credit");
  assert.equal(checkingExpenseMethod("Compra no debito"), "debit");
  assert.equal(checkingExpenseMethod("Transferência enviada"), "ted");
});
