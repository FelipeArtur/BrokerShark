import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvestment, isCaixinhaLeg, checkingExpenseMethod } from "./classify.ts";

test("isInvestment: keywords de investimento", () => {
  assert.equal(isInvestment("Aplicacao RDB"), true);
  assert.equal(isInvestment("Resgate Tesouro"), true);
  assert.equal(isInvestment("Compra PADARIA"), false);
});

test("isCaixinhaLeg: só Nubank, exclui corretora", () => {
  assert.equal(isCaixinhaLeg("Aplicacao RDB", "nubank"), true);
  assert.equal(isCaixinhaLeg("Aplicacao RDB", "inter"), false);      // banco errado
  assert.equal(isCaixinhaLeg("NuInvest Tesouro", "nubank"), false);  // corretora excluída
});

test("checkingExpenseMethod: método por descrição", () => {
  assert.equal(checkingExpenseMethod("PIX enviado para Maria"), "pix");
  assert.equal(checkingExpenseMethod("Pagamento de fatura"), "credit");
  assert.equal(checkingExpenseMethod("Compra no debito"), "debit");
});
