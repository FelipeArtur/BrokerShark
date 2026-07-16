/**
 * @file filter.test.js
 * @brief Testes do filtro facetado: OR dentro da faceta, AND entre facetas,
 *        busca por substring e contagem de facetas ativas.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("./filter.js");

/**
 * @brief Monta uma transação normalizada de teste.
 * @param o campos que sobrescrevem o padrão (despesa PIX, Mercado, Nubank)
 * @return objeto no formato que matchesFilter espera
 */
const tx = (o) => Object.assign({ flow: "expense", method: "pix", category: "Mercado", bank: "Nubank", label: "zaffari supermercado" }, o);

test("emptyFilter matches everything", () => {
  const f = F.emptyFilter();
  assert.equal(F.matchesFilter(tx(), f), true);
  assert.equal(F.facetCount(f), 0);
});

test("toggleFacet adds then removes a category", () => {
  let f = F.emptyFilter();
  f = F.toggleFacet(f, "categories", "Mercado");
  assert.equal(f.categories.has("Mercado"), true);
  assert.equal(F.matchesFilter(tx({ category: "Mercado" }), f), true);
  assert.equal(F.matchesFilter(tx({ category: "Transporte" }), f), false);
  f = F.toggleFacet(f, "categories", "Mercado");
  assert.equal(f.categories.has("Mercado"), false);
});

test("OR within a kind, AND across kinds", () => {
  let f = F.emptyFilter();
  f = F.toggleFacet(f, "categories", "Mercado");
  f = F.toggleFacet(f, "categories", "Transporte");
  f = F.toggleFacet(f, "banks", "Nubank");
  assert.equal(F.matchesFilter(tx({ category: "Transporte", bank: "Nubank" }), f), true);
  assert.equal(F.matchesFilter(tx({ category: "Mercado", bank: "Inter" }), f), false); // bank fails
  assert.equal(F.matchesFilter(tx({ category: "Lazer", bank: "Nubank" }), f), false);  // cat fails
});

test("flow and method narrow", () => {
  let f = Object.assign(F.emptyFilter(), { flow: "income", method: "pix" });
  assert.equal(F.matchesFilter(tx({ flow: "income", method: "pix" }), f), true);
  assert.equal(F.matchesFilter(tx({ flow: "expense", method: "pix" }), f), false);
});

test("searchMatch is case-insensitive substring; empty ⇒ true", () => {
  assert.equal(F.searchMatch("Zaffari Supermercado", "zaffari"), true);
  assert.equal(F.searchMatch("Zaffari", "nubank"), false);
  assert.equal(F.searchMatch("anything", ""), true);
});

test("facetCount counts every active dimension", () => {
  let f = F.emptyFilter();
  f = F.toggleFacet(f, "categories", "Mercado");
  f = Object.assign(f, { flow: "expense", search: "za" });
  assert.equal(F.facetCount(f), 3);
});
