const { test } = require("node:test");
const assert = require("node:assert");
const M = require("./money.js");

const tx = (o) => Object.assign(
  { flow: "expense", method: "pix", amount: 100, is_revenue: 0, is_settlement: 0, is_third_party: 0 },
  o,
);

test("despesa de consumo", () => {
  assert.equal(M.moneyKind(tx({ flow: "expense", method: "pix" })), M.KIND.EXPENSE);
});

test("tx ausente é null, não EXPENSE — senão isConsumptionExpense(null) vira true", () => {
  assert.equal(M.moneyKind(null), null);
  assert.equal(M.moneyKind(undefined), null);
});

test("receita real exige is_revenue=1", () => {
  assert.equal(M.moneyKind(tx({ flow: "income", method: "pix", is_revenue: 1 })), M.KIND.REVENUE);
});

test("liquidação ganha de despesa — senão o consumo dobra", () => {

  const t = tx({ flow: "expense", method: "credit", is_settlement: 1 });
  assert.equal(M.moneyKind(t), M.KIND.SETTLEMENT);
});

test("perna SELF de saída ganha de invest (caso real: method='transfer')", () => {

  const t = tx({ flow: "expense", method: "transfer", counterpart: "SELF" });
  assert.equal(M.moneyKind(t), M.KIND.TRANSFER);
});

test("perna SELF de entrada (caso real: income/pix, is_revenue=0) não é receita", () => {

  const t = tx({ flow: "income", method: "pix", is_revenue: 0, counterpart: "SELF" });
  assert.equal(M.moneyKind(t), M.KIND.TRANSFER);
});

test("dest_account_id preenchido também é transferência", () => {
  assert.equal(M.moneyKind(tx({ flow: "expense", method: "pix", dest_account_id: "conta-b" })), M.KIND.TRANSFER);
});

test("perna de investimento: saída via transfer", () => {
  assert.equal(M.moneyKind(tx({ flow: "expense", method: "transfer" })), M.KIND.INVEST);
});

test("perna de investimento: entrada income sem is_revenue", () => {
  assert.equal(M.moneyKind(tx({ flow: "income", method: "transfer", is_revenue: 0 })), M.KIND.INVEST);
});

test("third-party não é despesa nem receita", () => {
  assert.equal(M.moneyKind(tx({ flow: "expense", method: "pix", is_third_party: 1 })), M.KIND.THIRD_PARTY);
  assert.equal(M.moneyKind(tx({ flow: "income", method: "pix", is_revenue: 1, is_third_party: 1 })), M.KIND.THIRD_PARTY);
});

test("espécies são mutuamente exclusivas e exaustivas", () => {
  const kinds = new Set(Object.values(M.KIND));
  const samples = [
    tx({}), tx({ flow: "income", is_revenue: 1 }), tx({ is_settlement: 1 }),
    tx({ counterpart: "SELF" }), tx({ method: "transfer" }), tx({ is_third_party: 1 }),
    tx({ flow: "income", is_revenue: 0 }), tx({ dest_account_id: "x" }),
  ];
  for (const s of samples) {
    const k = M.moneyKind(s);
    assert.ok(kinds.has(k), `espécie desconhecida: ${k}`);
    assert.ok(M.KIND_COLOR[k], `sem cor: ${k}`);
    assert.ok(M.KIND_LABEL[k], `sem rótulo: ${k}`);
  }
});

test("equivale à regra consumo-despesa do CLAUDE.md em toda linha alcançável", () => {

  const rule = (t) => t.flow === "expense" && t.method !== "transfer"
    && !t.is_settlement && !t.is_third_party && t.dest_account_id == null;

  const reachable = (t) => !(t.counterpart === "SELF" && t.method !== "transfer" && t.flow === "expense");

  let checked = 0;
  for (const flow of ["expense", "income"])
    for (const method of ["pix", "credit", "transfer", "ted"])
      for (const is_settlement of [0, 1])
        for (const is_third_party of [0, 1])
          for (const is_revenue of [0, 1])
            for (const dest of [null, "conta-b"])
              for (const cp of [null, "SELF"]) {
                const t = { flow, method, is_settlement, is_third_party, is_revenue,
                  dest_account_id: dest, counterpart: cp };
                if (!reachable(t)) continue;
                assert.equal(M.moneyKind(t) === M.KIND.EXPENSE, rule(t),
                  `divergiu: ${JSON.stringify(t)}`);
                checked++;
              }
  assert.ok(checked > 100, `varredura rasa demais: ${checked}`);
});

test("equivale às regras de perna de investimento em toda linha alcançável", () => {

  // Espelho de investmentOut()/investmentIn() em backend/src/db/ledgerSql.ts.
  // Sem `self_pair_tx_id` aqui: a perna SELF chega pelo `counterpart`, que é o
  // que o cliente recebe.
  const isSelf = (t) => t.counterpart === "SELF" || t.dest_account_id != null;
  const out = (t) => t.flow === "expense" && t.method === "transfer" && !isSelf(t)
    && !t.is_settlement && !t.is_third_party;
  const inn = (t) => t.flow === "income" && !t.is_revenue && t.method === "transfer"
    && !isSelf(t) && !t.is_settlement && !t.is_third_party;

  // `is_revenue` só é zerado por quem também marca a linha: `selfPairs` põe
  // counterpart SELF, e a classificação de investimento reescreve o método pra
  // 'transfer'. Entrada com is_revenue=0 fora dos dois não é produzível.
  const reachable = (t) =>
    !(t.counterpart === "SELF" && t.method !== "transfer" && t.flow === "expense") &&
    !(t.flow === "income" && !t.is_revenue && t.method !== "transfer" && t.counterpart !== "SELF");

  let checked = 0;
  for (const flow of ["expense", "income"])
    for (const method of ["pix", "credit", "transfer", "ted"])
      for (const is_settlement of [0, 1])
        for (const is_third_party of [0, 1])
          for (const is_revenue of [0, 1])
            for (const dest of [null, "conta-b"])
              for (const cp of [null, "SELF"]) {
                const t = { flow, method, is_settlement, is_third_party, is_revenue,
                  dest_account_id: dest, counterpart: cp };
                if (!reachable(t)) continue;
                assert.equal(M.moneyKind(t) === M.KIND.INVEST, out(t) || inn(t),
                  `divergiu: ${JSON.stringify(t)}`);
                checked++;
              }
  assert.ok(checked > 100, `varredura rasa demais: ${checked}`);
});

test("dinheiro de terceiro aplicado não vira investimento seu", () => {
  const t = tx({ flow: "expense", method: "transfer", is_third_party: 1 });
  assert.equal(M.moneyKind(t), M.KIND.THIRD_PARTY);
});

test("perna SELF de saída fora de 'transfer' é inalcançável — se aparecer, é bug de ingestão", () => {

  const t = { flow: "expense", method: "pix", counterpart: "SELF", is_settlement: 0,
    is_third_party: 0, is_revenue: 0, dest_account_id: null };
  assert.equal(M.moneyKind(t), M.KIND.TRANSFER);
});

test("fmtParts separa centavos do inteiro", () => {
  assert.deepEqual(M.fmtParts(1240), { int: "1.240", cents: ",00" });
  assert.deepEqual(M.fmtParts(1240.5), { int: "1.240", cents: ",50" });
  assert.deepEqual(M.fmtParts(-99.9), { int: "99", cents: ",90" });
  assert.deepEqual(M.fmtParts(0), { int: "0", cents: ",00" });
  assert.deepEqual(M.fmtParts(null), { int: "0", cents: ",00" });
});

test("kindSign segue o flow", () => {
  assert.equal(M.kindSign(tx({ flow: "income" })), "+");
  assert.equal(M.kindSign(tx({ flow: "expense" })), "−");
});
