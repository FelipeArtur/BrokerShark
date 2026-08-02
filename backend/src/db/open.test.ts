import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDbPath } from "./open.ts";

// O modo de falha aqui não é um erro na tela: é servir o ledger de produção
// achando que é a demo, e escrever nele. Aconteceu — daí a varredura completa
// das formas que a documentação sugere.

test("caminho sozinho é aceito — é a forma que os READMEs documentam", () => {
  assert.equal(pickDbPath(["data/demo.db"]), "data/demo.db");
});

test("caminho depois de --port", () => {
  assert.equal(pickDbPath(["--port", "9999", "data/demo.db"]), "data/demo.db");
});

test("caminho antes de --port", () => {
  assert.equal(pickDbPath(["data/demo.db", "--port", "9999"]), "data/demo.db");
});

test("o número da porta nunca é confundido com caminho", () => {
  assert.equal(pickDbPath(["--port", "9999"]), undefined);
});

test("sem argumento nenhum, quem chama decide o padrão", () => {
  assert.equal(pickDbPath([]), undefined);
});

test("flag solta não vira caminho", () => {
  assert.equal(pickDbPath(["--force"]), undefined);
});

test("o primeiro caminho ganha quando vêm dois", () => {
  assert.equal(pickDbPath(["a.db", "b.db"]), "a.db");
});
