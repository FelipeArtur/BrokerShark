/**
 * @file tx-group.test.js
 * @brief Testes do agrupamento da tabela: espécie vira grupo próprio, conversão
 *        centavos→reais na fronteira, alvo, Δ e escala local ao grupo.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const G = require("./tx-group.js");
const M = require("./money.js");

/**
 * @brief Monta uma transação de teste (despesa PIX de R$ 100 em "Mercado").
 * @param o campos que sobrescrevem o padrão (`amount` em REAIS)
 * @return objeto transação pronto pra buildGroups
 */
const tx = (o) => Object.assign(
  { id: 1, flow: "expense", method: "pix", amount: 100, category_id: 1, category: "Mercado",
    is_revenue: 0, is_settlement: 0, is_third_party: 0 },
  o,
);

// budget_cents/prev_spent_cents chegam em CENTAVOS (é o que o endpoint manda).
const cats = new Map([
  [1, { name: "Mercado", flow: "expense", budget_cents: 120000, budget_source: "fixed", prev_spent_cents: 100000 }],
  [2, { name: "Salario", flow: "income" }],
  [3, { name: "Lazer", flow: "expense", budget_cents: null, budget_source: null, prev_spent_cents: 0 }],
]);

test("agrupa despesa/receita por categoria", () => {
  const gs = G.buildGroups([
    tx({ id: 1, amount: 100 }), tx({ id: 2, amount: 50 }),
    tx({ id: 3, flow: "income", is_revenue: 1, category_id: 2, category: "Salario", amount: 5000 }),
  ], cats);
  const mercado = gs.find(g => g.label === "Mercado");
  assert.equal(mercado.count, 2);
  assert.equal(mercado.total, 150);
  assert.equal(gs.find(g => g.label === "Salario").total, 5000);
});

test("receita e despesa SEM categoria não somam no mesmo grupo", () => {
  // Regressão pega na tela: ambas caíam em `cat:0` e o total virava
  // receita+despesa num número só, exibido com sinal de saída ("Sem categoria
  // −R$ 6.276,15" quando a despesa real era R$ 2.076,15). Categoria tem flow
  // próprio, então só o caso SEM categoria precisa da espécie na chave.
  const gs = G.buildGroups([
    tx({ id: 1, flow: "expense", category_id: null, category: null, amount: 2076.15 }),
    tx({ id: 2, flow: "income", is_revenue: 1, category_id: null, category: null, amount: 4200 }),
  ], cats);
  const desp = gs.find(g => g.label === G.UNCATEGORIZED);
  const rec = gs.find(g => g.label === G.UNCATEGORIZED_INCOME);
  assert.equal(desp.total, 2076.15);
  assert.equal(desp.kind, M.KIND.EXPENSE);
  assert.equal(rec.total, 4200);
  assert.equal(rec.kind, M.KIND.REVENUE);
  assert.notEqual(desp.key, rec.key);
});

test("net: transferência cancela as duas pernas — não mostra o dobro", () => {
  // Regressão pega na tela: 4 pernas SELF de R$ 1.000 (2 transferências de ida e
  // volta) exibiam "Transferências −R$ 4.000,00", como se R$ 4.000 tivessem saído.
  // O dinheiro só mudou de conta: o líquido é zero.
  const legs = [
    tx({ id: 1, flow: "expense", method: "transfer", counterpart: "SELF", category_id: null, amount: 1000 }),
    tx({ id: 2, flow: "income", method: "pix", counterpart: "SELF", category_id: null, amount: 1000 }),
    tx({ id: 3, flow: "expense", method: "transfer", counterpart: "SELF", category_id: null, amount: 1000 }),
    tx({ id: 4, flow: "income", method: "pix", counterpart: "SELF", category_id: null, amount: 1000 }),
  ];
  const g = G.buildGroups(legs, cats).find(x => x.kind === M.KIND.TRANSFER);
  assert.equal(g.count, 4);
  assert.equal(g.total, 4000, "total ainda soma tudo (é o bruto)");
  assert.equal(g.net, 0, "líquido é zero — nada saiu do seu bolso");
});

test("net: investimento é aplicação menos resgate, e bate com o rodapé", () => {
  const gs = G.buildGroups([
    tx({ id: 1, flow: "expense", method: "transfer", category_id: null, amount: 1000 }),  // aplicação
    tx({ id: 2, flow: "income", method: "transfer", is_revenue: 0, category_id: null, amount: 4000 }), // resgate
  ], cats);
  const g = gs.find(x => x.kind === M.KIND.INVEST);
  assert.equal(g.net, -3000, "resgatou 3k a mais do que aplicou");
  assert.equal(g.total, 5000, "bruto movimentado");
});

test("net: em grupo de categoria, |net| == total (mesma direção)", () => {
  const g = G.buildGroups([tx({ amount: 100 }), tx({ id: 2, amount: 50 })], cats)[0];
  assert.equal(Math.abs(g.net), g.total);
});

test("categorizada: o id sozinho basta na chave (categoria já tem flow)", () => {
  assert.equal(G.groupKeyOf(tx({ category_id: 7 })), "cat:7");
  assert.equal(G.groupKeyOf(tx({ category_id: null, flow: "expense" })), "none:expense");
  assert.equal(G.groupKeyOf(tx({ category_id: null, flow: "income", is_revenue: 1 })), "none:revenue");
});

test("espécie sem categoria NÃO cai em 'Sem categoria' — vira grupo próprio", () => {
  // O ponto todo: "Sem categoria" tem que significar só trabalho pendente.
  const gs = G.buildGroups([
    tx({ id: 1, category_id: null, category: null }),            // gasto sem categoria
    tx({ id: 2, method: "transfer", category_id: null }),        // investimento
    tx({ id: 3, counterpart: "SELF", method: "transfer", category_id: null }), // transferência
    tx({ id: 4, is_settlement: 1, category_id: null }),          // liquidação
    tx({ id: 5, is_third_party: 1, category_id: null }),         // terceiros
  ], cats);
  const semCat = gs.find(g => g.label === G.UNCATEGORIZED);
  assert.equal(semCat.count, 1, "só o gasto de verdade fica em Sem categoria");
  assert.ok(gs.find(g => g.kind === M.KIND.INVEST));
  assert.ok(gs.find(g => g.kind === M.KIND.TRANSFER));
  assert.ok(gs.find(g => g.kind === M.KIND.SETTLEMENT));
  assert.ok(gs.find(g => g.kind === M.KIND.THIRD_PARTY));
});

test("categorias primeiro (por total desc), espécies no fim", () => {
  const gs = G.buildGroups([
    tx({ id: 1, method: "transfer", category_id: null, amount: 99999 }),  // invest gigante
    tx({ id: 2, amount: 100, category_id: 1, category: "Mercado" }),
    tx({ id: 3, amount: 500, category_id: 3, category: "Lazer" }),
  ], cats);
  assert.deepEqual(gs.map(g => g.label), ["Lazer", "Mercado", "Investimentos"]);
});

test("alvo em centavos vira reais uma vez, na fronteira", () => {
  const gs = G.buildGroups([tx({ amount: 150 })], cats);
  const g = gs[0];
  assert.equal(g.budget, 1200);      // 120000 centavos → R$ 1.200
  assert.equal(g.prevSpent, 1000);   // 100000 centavos → R$ 1.000
  assert.equal(g.budgetSource, "fixed");
});

test("categoria de receita nunca ganha alvo", () => {
  const gs = G.buildGroups([
    tx({ flow: "income", is_revenue: 1, category_id: 2, category: "Salario", amount: 5000 }),
  ], cats);
  assert.equal(gs[0].budget, null);
});

test("categoria sem alvo é null, não zero", () => {
  const gs = G.buildGroups([tx({ category_id: 3, category: "Lazer", amount: 80 })], cats);
  assert.equal(gs[0].budget, null);
});

test("groupDelta: fração vs. mês anterior; sem base é null", () => {
  const gs = G.buildGroups([tx({ amount: 1500 })], cats);
  assert.equal(G.groupDelta(gs[0]), 0.5);  // 1500 vs 1000 = +50%
  assert.equal(G.groupDelta({ prevSpent: 0, total: 500 }), null);
  assert.equal(G.groupDelta({ prevSpent: null, total: 500 }), null);
});

test("budgetState: faixas neutro/atenção/estouro, sem verde", () => {
  assert.equal(G.budgetState(500, 1200).color, "var(--fg-2)");
  assert.equal(G.budgetState(1000, 1200).color, "var(--warn)");  // 83%
  assert.equal(G.budgetState(1500, 1200).color, "var(--neg)");   // 125%
  assert.equal(G.budgetState(1500, null), null);
  assert.equal(G.budgetState(1500, 0), null);
});

test("scaleFor: respeita piso e teto, cresce com a fatia", () => {
  assert.equal(G.scaleFor(0, 1000), G.SCALE_MIN);
  assert.equal(G.scaleFor(1000, 1000), G.SCALE_MAX);
  assert.equal(G.scaleFor(500, 0), G.SCALE_MIN);       // sem base não escala
  const mid = G.scaleFor(500, 1000);
  assert.ok(mid > G.SCALE_MIN && mid < G.SCALE_MAX);
  assert.equal(G.scaleFor(9999, 1000), G.SCALE_MAX);   // fatia > 1 não estoura o teto
});

test("escala é local ao grupo — aluguel não achata o café de outro grupo", () => {
  const gs = G.buildGroups([
    tx({ id: 1, category_id: 1, category: "Mercado", amount: 100 }),
    tx({ id: 2, category_id: 3, category: "Lazer", amount: 100000 }),
  ], cats);
  const mercado = gs.find(g => g.label === "Mercado");
  assert.equal(G.scaleFor(100, mercado.maxAmount), G.SCALE_MAX);
});
