/* api.js — fetch wrappers for every dashboard endpoint */

function _params(obj) {
  const entries = Object.entries(obj).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
function _qs(bank) { return _params({ bank }); }

async function _get(url)  { return fetch(url).then(r => r.json()); }
async function _post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}
async function _patch(url, body) {
  const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}

/* ── Read endpoints ─────────────────────────────────────────────────────── */
async function fetchSummary({ bank, month, year, period } = {}) { return _get(`/api/summary${_params({ bank, month, year, period })}`); }
async function fetchMonthly(bank)                          { return _get(`/api/monthly${_qs(bank)}`); }
async function fetchCategories({ bank, month, year, period } = {}) { return _get(`/api/categories${_params({ bank, month, year, period })}`); }
async function fetchExpensesByMethod(bank) { return _get(`/api/expenses-by-method${_qs(bank)}`); }
async function fetchInvestments(bank)      { return _get(`/api/investments${_qs(bank)}`); }
async function fetchAccounts(bank)         { return _get(`/api/accounts${_qs(bank)}`); }

async function fetchAccountDetail(id)      { return _get(`/api/account/${encodeURIComponent(id)}`); }
async function fetchCategoriesByAccount(id){ return _get(`/api/categories${_params({ account: id })}`); }
async function fetchMonthlyByAccount(id)   { return _get(`/api/monthly${_params({ account: id })}`); }
async function fetchAccountHistory(id)     { return _get(`/api/account-history${_params({ account: id })}`); }
async function fetchRecentTransactions(id, { limit = 100, month = null, year = null } = {}) {
  return _get(`/api/transactions${_params({ account: id, limit, month, year })}`);
}
async function fetchExpenseCategories()         { return _get("/api/expense-categories"); }
async function fetchExpenseCategoriesFull()     { return _get("/api/expense-categories-full"); }
async function fetchCategoriesFull(flow = "expense") { return _get(`/api/categories-full${_params({ flow })}`); }

/* ── New v2 read endpoints ──────────────────────────────────────────────── */
async function fetchDailySpend({ month, year } = {})  { return _get(`/api/daily-spend${_params({ month, year })}`); }
async function fetchRecentActivity()       { return _get("/api/recent-activity"); }
async function fetchMonthTransactions({ month, year } = {}) { return _get(`/api/month-transactions${_params({ month, year })}`); }
async function fetchPatrimonioHistory()    { return _get("/api/patrimonio-history"); }
async function fetchLiquidityHistory()     { return _get("/api/liquidity-history"); }
async function fetchBudgets()              { return _get("/api/budgets"); }
async function searchTransactions(q)       { return _get(`/api/search?q=${encodeURIComponent(q)}`); }
async function fetchMonthlyFull(bank)      { return _get(`/api/monthly${_params({ bank, present: 1 })}`); }
async function fetchCoverage()             { return _get("/api/statement-coverage"); }
async function fetchUncategorizedMerchants({ year, month } = {}) { return _get(`/api/uncategorized-merchants${_params({ year, month })}`); }
async function categorizeBulk(ids, categoryId) { return _post("/api/transactions/categorize-bulk", { ids, category_id: categoryId }); }
async function recordCoverage(periods, origin = "manual") { return _post("/api/statement-coverage", { periods, origin }); }
async function fetchCashflowStatement({ month, year } = {}) { return _get(`/api/cashflow-statement${_params({ month, year })}`); }
async function fetchAvailable() {
  const r = await fetch("/api/available");
  if (!r.ok) throw new Error("falha ao calcular disponível");
  return r.json();
}

/* ── Write endpoints ────────────────────────────────────────────────────── */
async function patchTransactionCategory(txId, categoryId) {
  return _patch(`/api/transactions/${txId}`, { category_id: categoryId });
}
async function patchTransaction(txId, fields) {
  return _patch(`/api/transactions/${txId}`, fields);
}
async function fetchPixTop({ month, year } = {}) { return _get(`/api/pix-top${_params({ month, year })}`); }
async function patchBudget(budgetId, categoryId, amountLimit) {
  return _patch(`/api/budgets/${budgetId}`, { category_id: categoryId, amount_limit: amountLimit });
}
async function fetchInvestmentMovements({ month, year, investment_id } = {}) { return _get(`/api/investment-movements${_params({ month, year, investment_id })}`); }
async function patchInvestmentBalance(id, balance) {
  return _patch(`/api/investments/${id}/balance`, { balance });
}
async function postInvestmentMovement({ investment_name, operation, amount, date, description }) {
  return _post("/api/investment-movements", { investment_name, operation, amount, date, description });
}
async function postCategory(name, flow)       { return _post("/api/categories", { name, flow }); }
async function deleteCategory(id, reassignToId) {
  const r = await fetch(`/api/categories/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reassign_to_id: reassignToId }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}
async function deleteTransaction(id) {
  const r = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();  // { ok, deleted, restore }
}
async function restoreTransactions(restore) { return _post("/api/transactions/restore", { restore }); }

/* ── File import (multipart upload + staged confirm) ─────────────────────── */
async function importPreview(files, accountId) {
  // `files` is one File or an array — all belonging to `accountId`. Sending them
  // in ONE multipart POST lets the backend dedup across the combined set
  // (preview_import_multi); one POST per file would reintroduce cross-file dupes.
  const form = new FormData();
  (Array.isArray(files) ? files : [files]).forEach(f => form.append("file", f));
  form.append("account_id", accountId);
  const r = await fetch("/api/import/preview", { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao analisar arquivo"); }
  return r.json();
}
async function importDetect(file) {
  // Sniff one CSV's header → owning account_id ("nu-db"/"inter-db") or null.
  // Pre-fills the import account per dropped file. Never throws: an unknown
  // header (or any failure) returns null and the user assigns manually.
  try {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/import/detect", { method: "POST", body: form });
    if (!r.ok) return null;
    const out = await r.json().catch(() => []);
    return (out[0] || {}).account_id || null;
  } catch { return null; }
}
async function patchStagingRow(batchId, rowId, fields) {
  // Edit one preview row (amount/category_id/display_name) → {ok, row, amount_divergence}.
  return _patch(`/api/import/staging/${batchId}/${rowId}`, fields);
}
async function importConfirm(batchId, excludeIds = [], importBatchId = null) {
  const body = { batch_id: batchId, exclude_ids: excludeIds };
  // One session id shared across every confirm of a multi-account drop, so the
  // whole import reverses as one unit in the Histórico.
  if (importBatchId) body.import_batch_id = importBatchId;
  return _post("/api/import/confirm", body);
}
async function deleteImportBatch(importBatchId) {
  const r = await fetch(`/api/import/batch/${encodeURIComponent(importBatchId)}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao reverter importação"); }
  return r.json();  // { ok, deleted, restore }
}

/* ── B3 investment-position import (XLSX): preview parses, confirm upserts ── */
async function importB3(file, { confirm = false } = {}) {
  const form = new FormData();
  form.append("file", file);
  const url = confirm ? "/api/import/b3" : "/api/import/b3/preview";
  const r = await fetch(url, { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao ler relatório B3"); }
  return r.json();
}
async function fetchInvestmentEvolution()    { return _get("/api/investment-evolution"); }
