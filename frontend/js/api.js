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
async function fetchSummary(bank)          { return _get(`/api/summary${_qs(bank)}`); }
async function fetchMonthly(bank)          { return _get(`/api/monthly${_qs(bank)}`); }
async function fetchCategories(bank)       { return _get(`/api/categories${_qs(bank)}`); }
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
async function fetchDailySpend()           { return _get("/api/daily-spend"); }
async function fetchRecentActivity()       { return _get("/api/recent-activity"); }
async function fetchPatrimonioHistory()    { return _get("/api/patrimonio-history"); }
async function fetchBudgets()              { return _get("/api/budgets"); }
async function searchTransactions(q)       { return _get(`/api/search?q=${encodeURIComponent(q)}`); }

/* ── Write endpoints ────────────────────────────────────────────────────── */
async function patchTransactionCategory(txId, categoryId) {
  return _patch(`/api/transactions/${txId}`, { category_id: categoryId });
}
async function patchBudget(budgetId, categoryId, amountLimit) {
  return _patch(`/api/budgets/${budgetId}`, { category_id: categoryId, amount_limit: amountLimit });
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
