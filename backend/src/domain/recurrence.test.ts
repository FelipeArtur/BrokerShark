import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECURRENCE_THRESHOLDS as TH,
  detectRecurrences,
  projectRecurrences,
} from "./recurrence.ts";
import type { RecurrenceInput } from "./recurrence.ts";

// Helper: uma cobrança de `cents` no dia 10 de cada mês listado.
function monthly(merchant: string, flow: "expense" | "income", months: string[], cents: number | number[]): RecurrenceInput[] {
  return months.map((m, i) => ({
    date: `${m}-10`,
    amountCents: Array.isArray(cents) ? cents[i] : cents,
    flow,
    merchant,
  }));
}

test("limiares são os calibrados no ledger real", () => {
  assert.deepEqual(TH, { minMonths: 3, maxGapMonths: 2, maxCv: 0.35, maxStaleMonths: 2 });
});

test("três meses consecutivos de valor estável viram recorrência", () => {
  const out = detectRecurrences(monthly("spotify", "expense", ["2026-04", "2026-05", "2026-06"], 3190), "2026-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].merchant, "spotify");
  assert.equal(out[0].flow, "expense");
  assert.equal(out[0].monthlyCents, 3190);
  assert.equal(out[0].cadenceMonths, 1);
  assert.equal(out[0].occurrences, 3);
  assert.equal(out[0].firstMonth, "2026-04");
  assert.equal(out[0].lastMonth, "2026-06");
  assert.equal(out[0].staleMonths, 0);
});

test("menos de minMonths na corrida é rejeitado", () => {
  const out = detectRecurrences(monthly("spotify", "expense", ["2026-05", "2026-06"], 3190), "2026-06");
  assert.deepEqual(out, []);
});

test("corrida recente é recortada — histórico antigo com buraco grande não conta", () => {
  // Mesma pessoa: movimento esporádico em 2021, corrida viva em 2026.
  const rows = [
    ...monthly("exemplo", "expense", ["2021-03", "2021-08", "2022-10"], 5000),
    ...monthly("exemplo", "expense", ["2026-03", "2026-04", "2026-05", "2026-06"], 171119),
  ];
  const out = detectRecurrences(rows, "2026-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].firstMonth, "2026-03", "a corrida começa depois do buraco");
  assert.equal(out[0].occurrences, 4);
  assert.equal(out[0].monthlyCents, 171119);
});

test("gap de 2 meses é tolerado dentro da corrida", () => {
  const out = detectRecurrences(monthly("sesi", "expense", ["2026-02", "2026-04", "2026-06"], 15680), "2026-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].occurrences, 3);
  assert.equal(out[0].cadenceMonths, 2);
});

test("gap de 3 meses quebra a corrida", () => {
  // 2025-09 fica fora; sobram 2 meses → abaixo de minMonths.
  const out = detectRecurrences(monthly("x", "expense", ["2025-09", "2026-05", "2026-06"], 1000), "2026-06");
  assert.deepEqual(out, []);
});

test("cv acima do limiar rejeita (valor instável não é recorrência)", () => {
  const out = detectRecurrences(
    monthly("mercado", "expense", ["2026-04", "2026-05", "2026-06"], [1000, 9000, 4000]),
    "2026-06",
  );
  assert.deepEqual(out, []);
});

test("recorrência morta não projeta — stale acima do limiar rejeita", () => {
  // Última em 2026-02, asOf 2026-06 → stale 4.
  const out = detectRecurrences(monthly("academia", "expense", ["2025-12", "2026-01", "2026-02"], 9900), "2026-06");
  assert.deepEqual(out, []);
});

test("stale dentro do limiar passa e é reportado", () => {
  const out = detectRecurrences(
    monthly("salario", "income", ["2026-02", "2026-03", "2026-04"], 385000),
    "2026-06",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].staleMonths, 2);
});

test("duas cobranças no mesmo mês somam num valor só, não viram cadência quinzenal", () => {
  const rows: RecurrenceInput[] = [
    { date: "2026-04-05", amountCents: 1000, flow: "expense", merchant: "padaria" },
    { date: "2026-04-20", amountCents: 1000, flow: "expense", merchant: "padaria" },
    { date: "2026-05-05", amountCents: 1000, flow: "expense", merchant: "padaria" },
    { date: "2026-05-20", amountCents: 1000, flow: "expense", merchant: "padaria" },
    { date: "2026-06-05", amountCents: 1000, flow: "expense", merchant: "padaria" },
    { date: "2026-06-20", amountCents: 1000, flow: "expense", merchant: "padaria" },
  ];
  const out = detectRecurrences(rows, "2026-06");
  assert.equal(out.length, 1);
  assert.equal(out[0].occurrences, 3, "conta meses, não linhas");
  assert.equal(out[0].monthlyCents, 2000, "soma o mês");
  assert.equal(out[0].cadenceMonths, 1);
});

test("mediana ignora um mês fora da curva", () => {
  // 100/100/100/130 → média 107,5; mediana 100. cv fica dentro do limiar.
  const out = detectRecurrences(
    monthly("assinatura", "expense", ["2026-03", "2026-04", "2026-05", "2026-06"], [10000, 10000, 10000, 13000]),
    "2026-06",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].monthlyCents, 10000);
});

test("entrada e saída do mesmo comerciante são itens separados", () => {
  const rows = [
    ...monthly("exemplo", "expense", ["2026-04", "2026-05", "2026-06"], 171119),
    ...monthly("exemplo", "income", ["2026-04", "2026-05", "2026-06"], 20000),
  ];
  const out = detectRecurrences(rows, "2026-06");
  assert.equal(out.length, 2);
  const exp = out.find(r => r.flow === "expense")!;
  const inc = out.find(r => r.flow === "income")!;
  assert.equal(exp.monthlyCents, 171119, "não compensa líquido");
  assert.equal(inc.monthlyCents, 20000);
});

test("comerciante vazio é ignorado", () => {
  const out = detectRecurrences(monthly("", "expense", ["2026-04", "2026-05", "2026-06"], 1000), "2026-06");
  assert.deepEqual(out, []);
});

test("entrada vazia → []", () => {
  assert.deepEqual(detectRecurrences([], "2026-06"), []);
});

test("saída ordenada por valor mensal decrescente", () => {
  const rows = [
    ...monthly("pequeno", "expense", ["2026-04", "2026-05", "2026-06"], 1000),
    ...monthly("grande", "expense", ["2026-04", "2026-05", "2026-06"], 500000),
  ];
  const out = detectRecurrences(rows, "2026-06");
  assert.deepEqual(out.map(r => r.merchant), ["grande", "pequeno"]);
});

test("mês com valor zero não estoura o cv (guarda de divisão)", () => {
  const out = detectRecurrences(monthly("zerado", "expense", ["2026-04", "2026-05", "2026-06"], 0), "2026-06");
  assert.deepEqual(out, [], "recorrência de valor zero não interessa");
});

// ---- projectRecurrences ----

test("project: cadência 1 preenche a janela inteira", () => {
  const recs = detectRecurrences(monthly("spotify", "expense", ["2026-04", "2026-05", "2026-06"], 3190), "2026-06");
  const out = projectRecurrences(recs, "2026-07", 3);
  assert.deepEqual(out, [
    { month: "2026-07", expenseCents: 3190, incomeCents: 0 },
    { month: "2026-08", expenseCents: 3190, incomeCents: 0 },
    { month: "2026-09", expenseCents: 3190, incomeCents: 0 },
  ]);
});

test("project: mês já observado não recebe projeção (senão real e previsto dobram)", () => {
  const recs = detectRecurrences(monthly("spotify", "expense", ["2026-04", "2026-05", "2026-06"], 3190), "2026-06");
  const out = projectRecurrences(recs, "2026-06", 3);
  assert.equal(out.find(m => m.month === "2026-06"), undefined, "junho já foi medido pelo ledger");
  assert.equal(out[0].month, "2026-07");
});

test("project: mês ainda não importado recebe projeção", () => {
  // Ledger termina em maio; janela começa em junho (mês-calendário corrente).
  const recs = detectRecurrences(monthly("aluguel", "expense", ["2026-03", "2026-04", "2026-05"], 171119), "2026-05");
  const out = projectRecurrences(recs, "2026-06", 2);
  assert.deepEqual(out, [
    { month: "2026-06", expenseCents: 171119, incomeCents: 0 },
    { month: "2026-07", expenseCents: 171119, incomeCents: 0 },
  ]);
});

test("project: cadência 2 pula meses, ancorada na última ocorrência", () => {
  const recs = detectRecurrences(monthly("sesi", "expense", ["2026-02", "2026-04", "2026-06"], 15680), "2026-06");
  const out = projectRecurrences(recs, "2026-07", 4);
  assert.deepEqual(out, [
    { month: "2026-08", expenseCents: 15680, incomeCents: 0 },
    { month: "2026-10", expenseCents: 15680, incomeCents: 0 },
  ]);
});

test("project: entrada e saída ficam em bandas separadas no mesmo mês", () => {
  const recs = detectRecurrences([
    ...monthly("aluguel", "expense", ["2026-04", "2026-05", "2026-06"], 171119),
    ...monthly("salario", "income", ["2026-04", "2026-05", "2026-06"], 385000),
  ], "2026-06");
  const out = projectRecurrences(recs, "2026-07", 1);
  assert.deepEqual(out, [{ month: "2026-07", expenseCents: 171119, incomeCents: 385000 }]);
});

test("project: recorrência atrasada retoma a cadência dentro da janela", () => {
  // Salário parou em 2026-04, asOf 2026-06 (stale 2, dentro do limiar).
  // As emissões de 05 e 06 caem fora da janela; 07 e 08 entram.
  const recs = detectRecurrences(monthly("salario", "income", ["2026-02", "2026-03", "2026-04"], 385000), "2026-06");
  const out = projectRecurrences(recs, "2026-07", 2);
  assert.deepEqual(out, [
    { month: "2026-07", expenseCents: 0, incomeCents: 385000 },
    { month: "2026-08", expenseCents: 0, incomeCents: 385000 },
  ]);
});

test("project: sem recorrências → []", () => {
  assert.deepEqual(projectRecurrences([], "2026-06", 12), []);
});
