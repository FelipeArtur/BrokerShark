const { test } = require("node:test");
const assert = require("node:assert");
const J = require("./juice.js");

test("shouldAnimate is false only under reduced-motion", () => {
  assert.equal(J.shouldAnimate(true), false);
  assert.equal(J.shouldAnimate(false), true);
});
