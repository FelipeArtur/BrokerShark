import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMultipart } from "./multipart.ts";

const BOUNDARY = "X";
function bodyWith(nParts: number): Buffer {
  let s = "";
  for (let i = 0; i < nParts; i++) {
    s += `--${BOUNDARY}\r\n`;
    s += `Content-Disposition: form-data; name="f${i}"\r\n\r\n`;
    s += `v${i}\r\n`;
  }
  s += `--${BOUNDARY}--\r\n`;
  return Buffer.from(s, "utf-8");
}

test("splitMultipart: extrai campos nomeados", () => {
  const parts = splitMultipart(bodyWith(2), BOUNDARY);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].name, "f0");
  assert.equal(parts[0].data.toString("utf-8"), "v0");
});

test("splitMultipart: excesso de partes lança 413", () => {
  assert.throws(() => splitMultipart(bodyWith(5), BOUNDARY, 4), /413|partes|arquivos/i);
});
