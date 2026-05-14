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
async function fetchFaturas(bank)          { return _get(`/api/faturas${_qs(bank)}`); }
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

/* ── New v2 read endpoints ──────────────────────────────────────────────── */
async function fetchDailySpend({ month, year } = {})  { return _get(`/api/daily-spend${_params({ month, year })}`); }
async function fetchRecentActivity()       { return _get("/api/recent-activity"); }
async function fetchMonthTransactions({ month, year } = {}) { return _get(`/api/month-transactions${_params({ month, year })}`); }
async function fetchPatrimonioHistory()    { return _get("/api/patrimonio-history"); }
async function fetchBudgets()              { return _get("/api/budgets"); }
async function searchTransactions(q)       { return _get(`/api/search?q=${encodeURIComponent(q)}`); }
async function fetchMonthlyFull(bank)      { return _get(`/api/monthly${_params({ bank, months: 36 })}`); }

/* ── Write endpoints ────────────────────────────────────────────────────── */
async function patchTransactionCategory(txId, categoryId) {
  return _patch(`/api/transactions/${txId}`, { category_id: categoryId });
}
async function patchBudget(budgetId, categoryId, amountLimit) {
  return _patch(`/api/budgets/${budgetId}`, { category_id: categoryId, amount_limit: amountLimit });
}
async function fetchInvestmentMovements({ month, year } = {}) { return _get(`/api/investment-movements${_params({ month, year })}`); }
async function patchInvestmentBalance(id, balance) {
  return _patch(`/api/investments/${id}/balance`, { balance });
}
async function postTransaction(body)          { return _post("/api/transactions", body); }
async function postIncome(body)               { return _post("/api/incomes", body); }
async function postInvestmentMovement(body)   { return _post("/api/investment-movements", body); }
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
  return r.json();
}

/* ── CSV import ─────────────────────────────────────────────────────────── */
async function postImportCsvPreview(file, accountId) {
  const form = new FormData();
  form.append("file", file);
  form.append("account_id", accountId);
  const r = await fetch("/api/import-csv/preview", { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}
async function postImportCsvConfirm(rows) {
  return _post("/api/import-csv/confirm", { rows });
}
