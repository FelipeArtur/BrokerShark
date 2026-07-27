const { test } = require("node:test");
const assert = require("node:assert");
const B = require("./bars.js");

const slot = (income, expenses, prev) => ({
  data: { income, expenses },
  prev: prev ? { income: prev[0], expenses: prev[1] } : null,
});

const keys = (specs) => specs.map(s => s.key);

test("sem comparar são só as duas barras do mês", () => {
  assert.deepEqual(keys(B.barSpecs(slot(100, 50, [80, 40]), 100, false)), ["i", "e"]);
});

test("comparar acrescenta fantasma de receita E de despesa", () => {
  const specs = B.barSpecs(slot(100, 50, [80, 40]), 100, true);
  assert.deepEqual(keys(specs), ["i", "gi", "e", "ge"]);
  assert.equal(specs.filter(s => s.ghost).length, 2);
});

test("cada fantasma vem logo depois da barra que ele compara", () => {
  // Ordem é load-bearing: fantasma solto no fim encosta na barra errada e a
  // leitura inverte (o gasto do mês passado parecendo receita).
  const specs = B.barSpecs(slot(100, 50, [80, 40]), 100, true);
  for (let i = 0; i < specs.length; i++) {
    if (!specs[i].ghost) continue;
    assert.equal(specs[i - 1].kind, specs[i].kind,
      `fantasma ${specs[i].key} não está ao lado de uma barra ${specs[i].kind}`);
    assert.equal(specs[i - 1].ghost, false);
  }
});

test("o fantasma usa o valor do mês anterior, não o do mês", () => {
  const specs = B.barSpecs(slot(100, 50, [80, 40]), 100, true);
  const byKey = Object.fromEntries(specs.map(s => [s.key, s.height]));
  assert.equal(byKey.i, B.scaleBar(100, 100));
  assert.equal(byKey.gi, B.scaleBar(80, 100));
  assert.equal(byKey.e, B.scaleBar(50, 100));
  assert.equal(byKey.ge, B.scaleBar(40, 100));
});

test("comparar sem mês anterior não inventa fantasma", () => {
  assert.deepEqual(keys(B.barSpecs(slot(100, 50, null), 100, true)), ["i", "e"]);
});

test("mês sem dado desenha barras de altura zero, não some", () => {
  const specs = B.barSpecs({ data: null, prev: null }, 100, false);
  assert.deepEqual(keys(specs), ["i", "e"]);
  assert.deepEqual(specs.map(s => s.height), [0, 0]);
});

// ── escala ──────────────────────────────────────────────────────────────────

test("zero não vira barra; valor positivo nunca fica invisível", () => {
  assert.equal(B.scaleBar(0, 1000), 0);
  assert.equal(B.scaleBar(1, 1_000_000), B.BAR_MIN_PX);
});

test("o maior valor da série ocupa a altura cheia", () => {
  assert.equal(B.scaleBar(500, 500), B.BAR_MAX_PX);
});

test("maxV zero não vira NaN nem Infinity", () => {
  // Mês em que nada entrou nem saiu: a divisão por zero apareceria na tela
  // como barra de altura NaN, que o browser desenha como colapsada.
  const h = B.scaleBar(10, 0);
  assert.ok(Number.isFinite(h), `altura ${h} não é finita`);
  assert.equal(h, B.BAR_MIN_PX);
});

test("valor ausente ou lixo não quebra a escala", () => {
  for (const v of [null, undefined, NaN, "abc", -5]) {
    assert.equal(B.scaleBar(v, 100), 0, `${JSON.stringify(v)} deveria dar 0`);
  }
});
