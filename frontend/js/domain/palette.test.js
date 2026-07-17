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

test("swatchColor cobre a paleta inteira e nunca sai dela", () => {
  // 200 nomes sintéticos: se a quantização estiver sã, os 8 matizes aparecem.
  // A versão fraca deste teste só exigia size > 1 — uma quantização quebrada
  // que colapsasse tudo em 2 cores passaria.
  const nomes = Array.from({ length: 200 }, (_, i) => `comerciante ${i}`);
  const cores = new Set(nomes.map(P.swatchColor));
  const daPaleta = new Set(P.HUES.map(hue => `oklch(75% 0.14 ${hue})`));

  assert.equal(cores.size, P.HUES.length,
    `esperava os ${P.HUES.length} matizes da paleta, vi ${cores.size}`);
  for (const c of cores) {
    assert.ok(daPaleta.has(c), `${c} não é da paleta — quantização vazou`);
  }
});
