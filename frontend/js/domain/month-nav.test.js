const { test } = require("node:test");
const assert = require("node:assert");
const N = require("./month-nav.js");

/** Série densa de `n` meses a partir de {y, m}. */
function densa(y, m, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ord = y * 12 + m + i;
    out.push({ year: Math.floor((ord - 1) / 12), month: ((ord - 1) % 12) + 1 });
  }
  return out;
}

const at = (monthly, i) => ({ year: monthly[i].year, month: monthly[i].month });
const label = (m) => `${m.year}-${String(m.month).padStart(2, "0")}`;

test("voltar um ano cai no mesmo mês do ano anterior", () => {
  const monthly = densa(2024, 1, 36); // jan/24 … dez/26
  const sel = { year: 2026, month: 7 };
  const i = N.jumpYearIndex(monthly, sel, -1);
  assert.equal(label(monthly[i]), "2025-07");
});

test("avançar um ano cai no mesmo mês do ano seguinte", () => {
  const monthly = densa(2024, 1, 36);
  const i = N.jumpYearIndex(monthly, { year: 2024, month: 3 }, +1);
  assert.equal(label(monthly[i]), "2025-03");
});

test("dois saltos cobrem dois anos — o ponto do atalho", () => {
  const monthly = densa(2024, 1, 36);
  let sel = { year: 2026, month: 7 };
  sel = at(monthly, N.jumpYearIndex(monthly, sel, -1));
  sel = at(monthly, N.jumpYearIndex(monthly, sel, -1));
  assert.equal(label(sel), "2024-07");
});

test("série esparsa: aterrissa no mês existente mais próximo, não pula buraco", () => {
  //> Só existe dado nesses meses. Índice ± 12 cairia fora da série inteira.
  const monthly = [
    { year: 2024, month: 2 }, { year: 2024, month: 9 },
    { year: 2025, month: 6 }, { year: 2026, month: 7 },
  ];
  const i = N.jumpYearIndex(monthly, { year: 2026, month: 7 }, -1);
  assert.equal(label(monthly[i]), "2025-06", "jul/25 não existe; jun/25 é o mais perto");
});

test("voltar além do começo dos dados para no mês mais antigo", () => {
  const monthly = densa(2026, 1, 7); // jan..jul/26
  const i = N.jumpYearIndex(monthly, { year: 2026, month: 7 }, -1);
  assert.equal(label(monthly[i]), "2026-01");
});

test("avançar além do fim para no mês mais recente", () => {
  const monthly = densa(2026, 1, 7);
  const i = N.jumpYearIndex(monthly, { year: 2026, month: 1 }, +1);
  assert.equal(label(monthly[i]), "2026-07");
});

test("o salto atravessa a virada do ano corretamente", () => {
  const monthly = densa(2025, 1, 24);
  const i = N.jumpYearIndex(monthly, { year: 2026, month: 1 }, -1);
  assert.equal(label(monthly[i]), "2025-01");
});

// ── botão habilitado ou morto ───────────────────────────────────────────────

test("no mês mais antigo, voltar um ano fica desabilitado", () => {
  const monthly = densa(2026, 1, 7);
  assert.equal(N.canJumpYear(monthly, { year: 2026, month: 1 }, -1), false);
  assert.equal(N.canJumpYear(monthly, { year: 2026, month: 1 }, +1), true);
});

test("no mês mais recente, avançar um ano fica desabilitado", () => {
  const monthly = densa(2026, 1, 7);
  assert.equal(N.canJumpYear(monthly, { year: 2026, month: 7 }, +1), false);
});

test("com um mês só, os dois saltos ficam desabilitados", () => {
  const monthly = [{ year: 2026, month: 7 }];
  assert.equal(N.canJumpYear(monthly, { year: 2026, month: 7 }, -1), false);
  assert.equal(N.canJumpYear(monthly, { year: 2026, month: 7 }, +1), false);
});

test("série vazia ou seleção nula não quebram", () => {
  assert.equal(N.jumpYearIndex([], { year: 2026, month: 7 }, -1), -1);
  assert.equal(N.jumpYearIndex(null, { year: 2026, month: 7 }, -1), -1);
  assert.equal(N.jumpYearIndex(densa(2026, 1, 3), null, -1), -1);
  assert.equal(N.canJumpYear([], { year: 2026, month: 7 }, -1), false);
  assert.equal(N.canJumpYear(null, null, -1), false);
});

test("o salto nunca devolve índice fora da série", () => {
  const monthly = densa(2024, 1, 36);
  for (let i = 0; i < monthly.length; i++) {
    for (const d of [-1, +1]) {
      const j = N.jumpYearIndex(monthly, at(monthly, i), d);
      assert.ok(j >= 0 && j < monthly.length, `índice ${j} fora de 0..${monthly.length - 1}`);
    }
  }
});
