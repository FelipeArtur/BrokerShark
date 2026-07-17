const { test } = require("node:test");
const assert = require("node:assert");
const P = require("./palette.js");

test("quantizeHue é estável: mesma string, mesmo índice", () => {
  assert.equal(P.quantizeHue("Padaria do Zé"), P.quantizeHue("Padaria do Zé"));
  assert.equal(P.quantizeHue("iFood"), P.quantizeHue("iFood"));
});

test("quantizeHue cai sempre dentro da paleta (0..7)", () => {
  const nomes = ["", "a", "iFood", "Uber", "Padaria do Zé", "SUPERMERCADO XYZ",
                 "99Pay", "Ação Ltda", "🍕", "x".repeat(500)];
  for (const n of nomes) {
    const i = P.quantizeHue(n);
    assert.ok(Number.isInteger(i), `${JSON.stringify(n)} → ${i} não é inteiro`);
    assert.ok(i >= 0 && i < 8, `${JSON.stringify(n)} → ${i} fora de 0..7`);
  }
});

test("quantizeHue não quebra com string vazia", () => {
  assert.equal(P.quantizeHue(""), 0);
});

test("swatchColor devolve um oklch() da paleta", () => {
  const c = P.swatchColor("iFood");
  assert.match(c, /^oklch\(/);
  assert.equal(c, P.swatchColor("iFood"));
});

test("swatchColor usa hues distintos pra nomes que caem em índices distintos", () => {
  const cores = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(P.swatchColor));
  assert.ok(cores.size > 1, "todas as cores iguais — quantização quebrada");
});
