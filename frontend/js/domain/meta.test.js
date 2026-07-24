const { test } = require("node:test");
const assert = require("node:assert");
const M = require("./meta.js");

test("savingsStreak counts trailing positive months", () => {
  assert.equal(M.savingsStreak([100, -5, 20, 30, 40]), 3);
  assert.equal(M.savingsStreak([10, 20, 30]), 3);
  assert.equal(M.savingsStreak([10, 20, -1]), 0);
  assert.equal(M.savingsStreak([]), 0);
});

test("isAllTimeHigh needs a strict trailing max and ≥2 points", () => {
  assert.equal(M.isAllTimeHigh([10, 20, 30]), true);
  assert.equal(M.isAllTimeHigh([30, 20, 30]), false);
  assert.equal(M.isAllTimeHigh([40, 20, 30]), false);
  assert.equal(M.isAllTimeHigh([30]), false);
  assert.equal(M.isAllTimeHigh([]), false);
});

test("budgetProgress math and guards", () => {
  assert.deepEqual(M.budgetProgress(186000, 300000), { pct: 62, remainingCents: 114000 });
  assert.deepEqual(M.budgetProgress(330000, 300000), { pct: 100, remainingCents: -30000 });
  assert.equal(M.budgetProgress(1000, 0), null);
  assert.equal(M.budgetProgress(1000, null), null);
});
