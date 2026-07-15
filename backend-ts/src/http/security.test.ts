import { test } from "node:test";
import assert from "node:assert/strict";
import { originAllowed } from "./security.ts";

const req = (origin?: string) => ({ headers: origin ? { origin } : {} }) as any;

test("originAllowed: sem Origin (curl / same-origin GET) permite", () => {
  assert.equal(originAllowed(req()), true);
});

test("originAllowed: localhost/127.0.0.1 permite (qualquer porta)", () => {
  assert.equal(originAllowed(req("http://127.0.0.1:8000")), true);
  assert.equal(originAllowed(req("http://localhost:3000")), true);
});

test("originAllowed: origem externa bloqueia", () => {
  assert.equal(originAllowed(req("https://evil.com")), false);
});

test("originAllowed: Origin malformado bloqueia", () => {
  assert.equal(originAllowed(req("not-a-url")), false);
});
