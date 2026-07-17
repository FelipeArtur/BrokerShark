const { test } = require("node:test");
const assert = require("node:assert");
const B = require("./bulk.js");

const g = (k, sug) => ({ merchant_key: k, flow: "expense", ids: [1, 2],
                         suggested_category_id: sug });

test("suggestionPlan só devolve grupos COM sugestão", () => {
  const plano = B.suggestionPlan([g("a", 7), g("b", null), g("c", 9)]);
  assert.deepEqual(plano.map(p => p.merchant_key), ["a", "c"]);
});

test("suggestionPlan carrega ids e category_id de cada grupo", () => {
  const [p] = B.suggestionPlan([g("a", 7)]);
  assert.deepEqual(p, { merchant_key: "a", flow: "expense", ids: [1, 2], category_id: 7 });
});

test("suggestionPlan devolve vazio quando ninguém tem sugestão", () => {
  assert.deepEqual(B.suggestionPlan([g("a", null)]), []);
});

test("suggestionPlan aguenta lista vazia e undefined", () => {
  assert.deepEqual(B.suggestionPlan([]), []);
  assert.deepEqual(B.suggestionPlan(undefined), []);
});

test("suggestionPlan trata id 0 como sugestão ausente só se for null/undefined", () => {
  // 0 não é um id válido no SQLite (AUTOINCREMENT começa em 1), mas a regra é
  // != null — documenta que a checagem não é falsy.
  assert.equal(B.suggestionPlan([g("a", 0)]).length, 1);
});
