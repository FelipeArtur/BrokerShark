const { test } = require("node:test");
const assert = require("node:assert");
const F = require("./forward.js");

test("mergeForwardSeries: mês só com compromisso duro", () => {
  const out = F.mergeForwardSeries([{ month: "2026-08", label: "08/2026", total: 500 }], []);
  assert.deepEqual(out, [{
    month: "2026-08", label: "08/2026",
    committed: 500, recurringExpense: 0, recurringIncome: 0, maturity: 0,
    outflow: 500, inflow: 0,
  }]);
});

test("mergeForwardSeries: mês só com previsto", () => {
  const out = F.mergeForwardSeries([], [{ month: "2026-08", label: "08/2026", expense: 100, income: 3850 }]);
  assert.deepEqual(out, [{
    month: "2026-08", label: "08/2026",
    committed: 0, recurringExpense: 100, recurringIncome: 3850, maturity: 0,
    outflow: 100, inflow: 3850,
  }]);
});

test("mergeForwardSeries: duro e previsto no mesmo mês somam na saída sem se fundir", () => {
  const out = F.mergeForwardSeries(
    [{ month: "2026-08", label: "08/2026", total: 500 }],
    [{ month: "2026-08", label: "08/2026", expense: 100, income: 3850 }],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].committed, 500, "comprometido continua isolado");
  assert.equal(out[0].recurringExpense, 100, "previsto continua isolado");
  assert.equal(out[0].outflow, 600);
});

test("mergeForwardSeries: entrada nunca abate a saída", () => {
  const out = F.mergeForwardSeries([], [{ month: "2026-08", label: "08/2026", expense: 100, income: 9999 }]);
  assert.equal(out[0].outflow, 100);
});

test("mergeForwardSeries: meses ficam em ordem cronológica", () => {
  const out = F.mergeForwardSeries(
    [{ month: "2026-12", label: "12/2026", total: 1 }],
    [{ month: "2026-07", label: "07/2026", expense: 1, income: 0 },
     { month: "2026-09", label: "09/2026", expense: 1, income: 0 }],
  );
  assert.deepEqual(out.map(s => s.month), ["2026-07", "2026-09", "2026-12"]);
});

test("mergeForwardSeries: entradas vazias/ausentes → []", () => {
  assert.deepEqual(F.mergeForwardSeries([], []), []);
  assert.deepEqual(F.mergeForwardSeries(null, undefined), []);
});

test("mergeForwardSeries: vencimento de posição entra como entrada, nunca como saída", () => {
  const out = F.mergeForwardSeries([{ month: "2026-09", label: "09/2026", total: 0, maturity: 216.48 }], []);
  assert.equal(out[0].maturity, 216.48);
  assert.equal(out[0].inflow, 216.48);
  assert.equal(out[0].outflow, 0, "vencimento não compromete nada");
});

test("mergeForwardSeries: vencimento e receita recorrente somam na entrada", () => {
  const out = F.mergeForwardSeries(
    [{ month: "2026-09", label: "09/2026", total: 0, maturity: 200 }],
    [{ month: "2026-09", label: "09/2026", expense: 0, income: 3850 }],
  );
  assert.equal(out[0].inflow, 4050);
});

test("forwardScale: teto de saída é o maior mês, não a soma", () => {
  const merged = F.mergeForwardSeries([], [
    { month: "2026-07", label: "07/2026", expense: 100, income: 10 },
    { month: "2026-08", label: "08/2026", expense: 700, income: 20 },
  ]);
  assert.deepEqual(F.forwardScale(merged), { outflow: 700, income: 20 });
});

test("forwardScale: eixos separados — entrada grande não achata a saída", () => {
  const merged = F.mergeForwardSeries([], [{ month: "2026-07", label: "07/2026", expense: 10, income: 5000 }]);
  const sc = F.forwardScale(merged);
  assert.equal(sc.outflow, 10);
  assert.equal(sc.income, 5000);
});

test("forwardScale: série vazia não divide por zero", () => {
  assert.deepEqual(F.forwardScale([]), { outflow: 1, income: 1 });
});

test("merchantLabel: corta CPF mascarado e banco", () => {
  assert.equal(
    F.merchantLabel("joao da silva - •••.000.000-•• - banco exemplo s.a. (0000) agência: 0001 conta: 12345-6"),
    "joao da silva",
  );
});

test("merchantLabel: tira prefixo de transferência e corta no CNPJ", () => {
  assert.equal(
    F.merchantLabel("transferência recebida - empresa exemplo do brasil ltda - 00.000.000/0001-00 - banco exemplo s.a. (0000) agência: 0001"),
    "empresa exemplo do brasil ltda",
  );
});

test("merchantLabel: nome simples passa intacto", () => {
  assert.equal(F.merchantLabel("subway"), "subway");
});

test("merchantLabel: hífen que faz parte do nome é preservado", () => {
  assert.equal(F.merchantLabel("padaria pão - quente"), "padaria pão - quente");
});

test("merchantLabel: string vazia/nula → ''", () => {
  assert.equal(F.merchantLabel(""), "");
  assert.equal(F.merchantLabel(null), "");
  assert.equal(F.merchantLabel(undefined), "");
});

test("merchantLabel: só o prefixo não vira string vazia", () => {
  assert.equal(F.merchantLabel("transferência recebida"), "transferência recebida");
});
