const { test } = require("node:test");
const assert = require("node:assert");
const B = require("./bank.js");

test("Nubank e Inter mantêm cor de identidade", () => {
  assert.equal(B.bankColor("nubank", "nu-db"), "var(--nubank)");
  assert.equal(B.bankColor("inter", "inter-db"), "var(--inter)");
  assert.equal(B.bankColor("inter", "inter-cc"), "var(--inter)");
});

test("banco novo NÃO herda a cor de nenhum dos dois", () => {
  for (const b of ["c6", "itau", "bradesco", "nomad"]) {
    const cor = B.bankColor(b, `${b}-db`);
    assert.notEqual(cor, "var(--inter)", `${b} pegou o laranja do Inter`);
    assert.notEqual(cor, "var(--nubank)", `${b} pegou o roxo do Nubank`);
    assert.match(cor, /^oklch\(/, `${b} → ${cor} não é cor do palette`);
  }
});

test("a cor de um banco novo é estável entre chamadas", () => {
  assert.equal(B.bankColor("c6", "c6-db"), B.bankColor("c6", "c6-db"));
});

test("banco novo NÃO é rotulado como Nubank nem Inter", () => {
  assert.equal(B.bankLabel("c6", "c6-db"), "C6");
  assert.equal(B.bankShortLabel("c6", "c6-db"), "C6");
  assert.equal(B.bankLabel("itau", "itau-db"), "Itau");
});

test("os dois bancos do dono são reconhecidos pelo id, mesmo sem bank", () => {
  assert.equal(B.bankLabel(null, "nu-db"), "Nubank");
  assert.equal(B.bankLabel(null, "inter-cc"), "Inter");
  assert.equal(B.bankShortLabel(null, "nu-db"), "Nu");
});

test("rótulo curto cabe na faixa de KPI", () => {
  for (const b of ["nubank", "inter", "c6", "bradesco", "santander"]) {
    assert.ok(B.bankShortLabel(b, `${b}-db`).length <= 6);
  }
});

test("sem banco e sem id o rótulo não vira 'undefined' na tela", () => {
  assert.equal(B.bankLabel(null, null), "Outros");
  assert.equal(B.bankLabel("", ""), "Outros");
});

test("bankLabel é a MESMA chave que a faceta e a tabela usam", () => {
  // O widget da fatura agrupa por bankLabel e a tabela filtra por bankLabel.
  // Se divergirem, clicar na faceta de um banco novo não filtra nada.
  const doWidget = B.bankLabel("c6", "c6-cc");
  const daTabela = B.bankLabel("c6", "c6-cc");
  assert.equal(doWidget, daTabela);
});
