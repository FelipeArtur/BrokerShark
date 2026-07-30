import { test } from "node:test";
import assert from "node:assert/strict";
import { makeIdleWatch } from "./sse.ts";

test("dispara depois do tempo quando ninguém voltou", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let saiu = 0;
  const w = makeIdleWatch(900_000, () => true, () => { saiu++; });

  w.arm();
  t.mock.timers.tick(899_999);
  assert.equal(saiu, 0, "não pode sair antes da hora");
  t.mock.timers.tick(1);
  assert.equal(saiu, 1);
});

test("não dispara se alguém voltou entre armar e vencer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let saiu = 0;
  let vazio = true;
  const w = makeIdleWatch(900_000, () => vazio, () => { saiu++; });

  w.arm();
  vazio = false;               // um painel abriu no meio do caminho
  t.mock.timers.tick(900_000);
  assert.equal(saiu, 0, "a conferência no disparo é o que segura este caso");
});

test("cancel desarma", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let saiu = 0;
  const w = makeIdleWatch(900_000, () => true, () => { saiu++; });

  w.arm();
  assert.equal(w.armed, true);
  w.cancel();
  assert.equal(w.armed, false);
  t.mock.timers.tick(900_000);
  assert.equal(saiu, 0);
});

test("armar com alguém conectado não faz nada", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let saiu = 0;
  const w = makeIdleWatch(900_000, () => false, () => { saiu++; });

  w.arm();
  assert.equal(w.armed, false);
  t.mock.timers.tick(900_000);
  assert.equal(saiu, 0);
});

test("idleMs <= 0 desliga o vigia — é o `npm start` na mão", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const ms of [0, -1, NaN]) {
    let saiu = 0;
    const w = makeIdleWatch(ms, () => true, () => { saiu++; });
    w.arm();
    assert.equal(w.armed, false, `idleMs=${ms} não devia armar`);
    t.mock.timers.tick(10_000_000);
    assert.equal(saiu, 0, `idleMs=${ms} não devia sair`);
  }
});

test("rearmar não empilha timers — a última janela é a que vale", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let saiu = 0;
  const w = makeIdleWatch(900_000, () => true, () => { saiu++; });

  w.arm();
  t.mock.timers.tick(500_000);
  w.arm();                     // outra aba fechou: a contagem recomeça
  t.mock.timers.tick(500_000);
  assert.equal(saiu, 0, "o rearme tinha que ter reiniciado a contagem");
  t.mock.timers.tick(400_000);
  assert.equal(saiu, 1);
});
