import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchant } from "./merchant.ts";

test("strips PIX/transfer prefixes, keeps the merchant core", () => {
  assert.equal(normalizeMerchant("Pix enviado: Cp :10573521-PIX Marketplace"), "pix marketplace");
  assert.equal(normalizeMerchant("Transferência enviada pelo Pix - IFOOD.COM AGENCIA"), "ifood.com agencia");
});

test("strips trailing city/UF, keeps the store name", () => {
  assert.equal(normalizeMerchant("POSTO SOL COSTA AZUL SALVADOR BRA"), "posto sol costa azul");
  assert.equal(normalizeMerchant("G BARBOSA 35 SALVADOR BRA"), "g barbosa 35");
});

test("result is always a substring of the lowercased input", () => {
  for (const d of ["Pix enviado: Cp :1-DECATHLON SALVADOR BRA", "MAMMA JAMMA SALVADOR BRA"]) {
    assert.ok(d.toLowerCase().includes(normalizeMerchant(d)), `"${normalizeMerchant(d)}" must be in "${d.toLowerCase()}"`);
  }
});

test("blank/degenerate input → empty string", () => {
  assert.equal(normalizeMerchant(""), "");
  assert.equal(normalizeMerchant("   "), "");
});
