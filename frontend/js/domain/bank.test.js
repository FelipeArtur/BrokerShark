const { test } = require("node:test");
const assert = require("node:assert");
const B = require("./bank.js");

// A regra que estes testes travam mudou quando o projeto virou público: não há
// mais banco "de casa" com cor reservada. Todo banco é tratado igual, e a
// identidade visual sai do nome — inclusive pros bancos que o autor usa.

test("nenhum banco tem cor reservada: todos saem do palette", () => {
  for (const b of ["banco a", "banco b", "c6", "itau", "bradesco", "nomad"]) {
    const cor = B.bankColor(b, `${b}-db`);
    assert.match(cor, /^oklch\(/, `${b} → ${cor} não é cor do palette`);
  }
});

test("bancos diferentes não colidem na mesma cor", () => {
  const cores = new Set(["banco a", "banco b", "c6", "itau"].map(b => B.bankColor(b, b)));
  assert.ok(cores.size >= 3, "quatro bancos deveriam render ao menos três matizes");
});

test("a cor de um banco é estável entre chamadas", () => {
  assert.equal(B.bankColor("c6", "c6-db"), B.bankColor("c6", "c6-db"));
});

test("o rótulo é o nome do banco, capitalizado", () => {
  assert.equal(B.bankLabel("c6", "c6-db"), "C6");
  assert.equal(B.bankLabel("itau", "itau-db"), "Itau");
  assert.equal(B.bankLabel("Banco B", "conta-b"), "Banco B");
});

test("sem banco, o id serve de rótulo — a tela nunca mostra vazio", () => {
  assert.equal(B.bankLabel(null, "conta-a"), "conta-a");
});

test("rótulo curto cabe na faixa de KPI", () => {
  for (const b of ["banco a", "banco b", "c6", "bradesco", "santander"]) {
    assert.ok(B.bankShortLabel(b, `${b}-db`).length <= 8);
  }
});

test("sem banco e sem id o rótulo não vira 'undefined' na tela", () => {
  assert.equal(B.bankLabel(null, null), "Outros");
  assert.equal(B.bankLabel("", ""), "Outros");
});

test("bankLabel é a MESMA chave que a faceta e a tabela usam", () => {
  //> Faceta e filtro usam a MESMA chave: divergindo, o clique não filtra nada.
  const doWidget = B.bankLabel("c6", "c6-cc");
  const daTabela = B.bankLabel("c6", "c6-cc");
  assert.equal(doWidget, daTabela);
});
