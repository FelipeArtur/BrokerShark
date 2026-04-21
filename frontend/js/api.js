/**
 * api.js — fetch wrappers for every dashboard endpoint.
 * Each function accepts an optional bank string ("nubank" | "inter" | null).
 */

function _qs(bank) {
  return bank ? `?bank=${bank}` : "";
}

async function fetchSummary(bank)     { return fetch(`/api/summary${_qs(bank)}`).then(r => r.json()); }
async function fetchMonthly(bank)     { return fetch(`/api/monthly${_qs(bank)}`).then(r => r.json()); }
async function fetchCategories(bank)  { return fetch(`/api/categories${_qs(bank)}`).then(r => r.json()); }
async function fetchAccounts(bank)    { return fetch(`/api/accounts${_qs(bank)}`).then(r => r.json()); }
async function fetchInvestments(bank) { return fetch(`/api/investments${_qs(bank)}`).then(r => r.json()); }
async function fetchFaturas(bank)     { return fetch(`/api/faturas${_qs(bank)}`).then(r => r.json()); }
