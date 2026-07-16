const { test } = require("node:test");
const assert = require("node:assert");
const J = require("./juice.js");

test("nextMuted flips", () => {
  assert.equal(J.nextMuted(true), false);
  assert.equal(J.nextMuted(false), true);
});

test("shouldAnimate is false when reduced-motion, regardless of mute", () => {
  assert.equal(J.shouldAnimate(true, false), false);
  assert.equal(J.shouldAnimate(false, false), true);
  assert.equal(J.shouldAnimate(false, true), true); // mute is about sound, not motion
});
