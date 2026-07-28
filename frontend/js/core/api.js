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

async function _put(url, body) {
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}


async function fetchInvestments(bank)      { return _get(`/api/investments${_qs(bank)}`); }

// Ficha da posição + snapshots datados (rendimento computado no servidor).
async function fetchInvestment(id) {
  const r = await fetch(`/api/investments/${encodeURIComponent(id)}`);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "posição não encontrada"); }
  return r.json();
}

async function fetchAccounts(bank)         { return _get(`/api/accounts${_qs(bank)}`); }

// closed=1 traz as encerradas junto — o painel de contas precisa vê-las pra
// poder reabrir; os widgets, não.
async function fetchAllAccounts()          { return _get("/api/accounts?closed=1"); }

async function postAccount(account)        { return _post("/api/accounts", account); }

async function patchAccount(id, fields)    { return _patch(`/api/accounts/${encodeURIComponent(id)}`, fields); }

async function deleteAccount(id) {
  const r = await fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}

// Regras APRENDIDAS ao categorizar. Aprender sem poder desaprender é o
// problema: regra errada gravada uma vez sugere errado pra sempre.
async function fetchRules()                { return _get("/api/rules"); }

async function patchRule(id, fields)       { return _patch(`/api/rules/${id}`, fields); }

async function deleteRule(id) {
  const r = await fetch(`/api/rules/${id}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}

async function fetchExpenseCategories()         { return _get("/api/expense-categories"); }

async function fetchCategoriesFull(flow = "expense", month) { return _get(`/api/categories-full${_params({ flow, month })}`); }

async function fetchMonthTransactions({ month, year } = {}) { return _get(`/api/month-transactions${_params({ month, year })}`); }

async function fetchLiquidityHistory()     { return _get("/api/liquidity-history"); }

async function fetchCommitments()           { return _get("/api/commitments"); }

async function fetchMonthlyFull(bank)      { return _get(`/api/monthly${_params({ bank, present: 1 })}`); }

async function fetchBackupStatus()         { return _get("/api/backup-status"); }

async function fetchUncategorizedMerchants({ year, month } = {}) { return _get(`/api/uncategorized-merchants${_params({ year, month })}`); }

async function categorizeBulk(ids, categoryId) { return _post("/api/transactions/categorize-bulk", { ids, category_id: categoryId }); }

async function fetchCashflowStatement({ month, year } = {}) { return _get(`/api/cashflow-statement${_params({ month, year })}`); }

async function fetchAvailable() {
  const r = await fetch("/api/available");
  if (!r.ok) throw new Error("falha ao calcular disponível");
  return r.json();
}

async function patchTransactionCategory(txId, categoryId) {
  return _patch(`/api/transactions/${txId}`, { category_id: categoryId });
}

async function patchTransaction(txId, fields) {
  return _patch(`/api/transactions/${txId}`, fields);
}

async function postCategory(name, flow)       { return _post("/api/categories", { name, flow }); }

async function patchCategory(id, name)        { return _patch(`/api/categories/${id}`, { name }); }

async function putCategoryBudget(categoryId, amountCents, refMonth) {
  return _put("/api/category-budget", { category_id: categoryId, amount_cents: amountCents, ref_month: refMonth ?? "" });
}

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

async function restoreTransactions(restore) { return _post("/api/transactions/restore", { restore }); }

async function importPreview(files, accountId) {

  const form = new FormData();
  (Array.isArray(files) ? files : [files]).forEach(f => form.append("file", f));
  form.append("account_id", accountId);
  const r = await fetch("/api/import/preview", { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao analisar arquivo"); }
  return r.json();
}

async function importDetect(file) {

  try {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/import/detect", { method: "POST", body: form });
    if (!r.ok) return null;
    const out = await r.json().catch(() => []);
    const hit = out[0];
    if (!hit || !hit.account_id) return null;
    // O servidor diz se é fatura pelo FORMATO do arquivo. O cliente não deve
    // deduzir isso de um id de conta — id de conta é configuração de quem usa.
    return { accountId: hit.account_id, invoice: !!hit.invoice };
  } catch { return null; }
}

async function patchStagingRow(batchId, rowId, fields) {

  return _patch(`/api/import/staging/${batchId}/${rowId}`, fields);
}

async function importConfirm(batchId, excludeIds = [], importBatchId = null) {
  const body = { batch_id: batchId, exclude_ids: excludeIds };

  if (importBatchId) body.import_batch_id = importBatchId;
  return _post("/api/import/confirm", body);
}

async function deleteImportBatch(importBatchId) {
  const r = await fetch(`/api/import/batch/${encodeURIComponent(importBatchId)}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao reverter importação"); }
  return r.json();
}

async function importB3(file, { confirm = false } = {}) {
  const form = new FormData();
  form.append("file", file);
  const url = confirm ? "/api/import/b3" : "/api/import/b3/preview";
  const r = await fetch(url, { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao ler relatório B3"); }
  return r.json();
}

async function importFaturaPreview(file) {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/import/fatura/preview", { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao ler fatura"); }
  return r.json();
}

async function importFaturaConfirm(file, dueDate = null, importBatchId = null) {
  const form = new FormData();
  form.append("file", file);
  if (dueDate) form.append("due_date", dueDate);
  if (importBatchId) form.append("import_batch_id", importBatchId);
  const r = await fetch("/api/import/fatura", { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao importar fatura"); }
  return r.json();
}

async function fetchInvestmentEvolution()    { return _get("/api/investment-evolution"); }
