/**
 * api.js — fetch wrappers for every dashboard endpoint.
 */

function _params(obj) {
  const entries = Object.entries(obj).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

function _qs(bank) { return _params({ bank }); }

async function fetchSummary(bank)           { return fetch(`/api/summary${_qs(bank)}`).then(r => r.json()); }
async function fetchMonthly(bank)           { return fetch(`/api/monthly${_qs(bank)}`).then(r => r.json()); }
async function fetchCategories(bank)        { return fetch(`/api/categories${_qs(bank)}`).then(r => r.json()); }
async function fetchExpensesByMethod(bank)  { return fetch(`/api/expenses-by-method${_qs(bank)}`).then(r => r.json()); }
async function fetchInvestments(bank)       { return fetch(`/api/investments${_qs(bank)}`).then(r => r.json()); }
async function fetchFaturas(bank)           { return fetch(`/api/faturas${_qs(bank)}`).then(r => r.json()); }
async function fetchAccounts(bank)          { return fetch(`/api/accounts${_qs(bank)}`).then(r => r.json()); }

async function fetchAccountDetail(accountId) {
  return fetch(`/api/account/${encodeURIComponent(accountId)}`).then(r => r.json());
}

async function fetchCategoriesByAccount(accountId) {
  return fetch(`/api/categories${_params({ account: accountId })}`).then(r => r.json());
}

async function fetchMonthlyByAccount(accountId) {
  return fetch(`/api/monthly${_params({ account: accountId })}`).then(r => r.json());
}

async function fetchRecentTransactions(accountId, { limit = 100, month = null, year = null } = {}) {
  return fetch(`/api/transactions${_params({ account: accountId, limit, month, year })}`).then(r => r.json());
}

async function fetchAccountHistory(accountId) {
  return fetch(`/api/account-history${_params({ account: accountId })}`).then(r => r.json());
}

async function fetchExpenseCategories() {
  return fetch("/api/expense-categories").then(r => r.json());
}

async function patchTransactionCategory(txId, categoryId) {
  const res = await fetch(`/api/transactions/${txId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: categoryId }),
  });
  if (!res.ok) throw new Error("failed");
  return res.json();
}
