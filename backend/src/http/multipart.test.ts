import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { parseMultipart, fileParts, fieldValue } from "./multipart.ts";
import type { Req } from "./respond.ts";

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

function reqWith(body: Buffer, contentType = `multipart/form-data; boundary=${BOUNDARY}`): Req {
  const stream = Readable.from([body]) as unknown as Req;
  stream.headers = { "content-type": contentType } as Req["headers"];
  return stream;
}

test("parseMultipart: extrai campos nomeados", async () => {
  const parts = await parseMultipart(reqWith(bodyWith(2)));
  assert.equal(parts.length, 2);
  assert.equal(parts[0].name, "f0");
  assert.equal(parts[0].data.toString("utf-8"), "v0");
  assert.equal(fieldValue(parts, "f1"), "v1");
});

test("parseMultipart: excesso de partes lança 413", async () => {
  await assert.rejects(
    () => parseMultipart(reqWith(bodyWith(5)), 4),
    /413|partes|arquivos/i,
  );
});

test("parseMultipart: separa arquivo de campo", async () => {
  const body = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="account_id"\r\n\r\nconta-a\r\n` +
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="extrato.csv"\r\n` +
    `Content-Type: text/csv\r\n\r\nData,Valor\r\n--${BOUNDARY}--\r\n`,
    "utf-8",
  );
  const parts = await parseMultipart(reqWith(body));
  assert.equal(fieldValue(parts, "account_id"), "conta-a");
  const files = fileParts(parts);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, "extrato.csv");
  assert.equal(files[0].contentType, "text/csv");
  assert.equal(files[0].data.toString("utf-8"), "Data,Valor");
});

test("parseMultipart: content-type errado é 400", async () => {
  await assert.rejects(
    () => parseMultipart(reqWith(bodyWith(1), "application/json")),
    /multipart/i,
  );
});

test("parseMultipart: corpo malformado é 400, não crash", async () => {
  await assert.rejects(
    () => parseMultipart(reqWith(Buffer.from("lixo sem boundary"))),
    /malformado/i,
  );
});
