/**
 * @file    Contrato com o backend. Um verbo, um jeito de errar.
 * @details Todo request passa por `_send`, inclusive DELETE e upload multipart.
 */

function _params(obj) {
  const entries = Object.entries(obj).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

/**
 * @param body  objeto → JSON; FormData → multipart; undefined → sem corpo.
 * @param msg   mensagem de fallback quando o servidor não mandou `error`.
 */
async function _send(method, url, body, msg = "request failed") {
  const opts = { method };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || msg);
  }
  return r.json();
}

/**
 * @brief   Leitura. NÃO rejeita em status de erro — devolve o corpo como veio.
 * @details Deliberado: as telas consomem leitura sem `.catch()`, e rejeitar trocaria
 *          "dado estranho" por "widget que nunca preenche".
 * @note    Quem precisa falhar alto usa `_send("GET", …)`.
 */
const _get   = (url)            => fetch(url).then(r => r.json());
const _post  = (url, body, msg) => _send("POST", url, body, msg);
const _patch = (url, body, msg) => _send("PATCH", url, body, msg);
const _put   = (url, body, msg) => _send("PUT", url, body, msg);
const _del   = (url, body, msg) => _send("DELETE", url, body, msg);

/** Um arquivo (ou vários) + campos avulsos, no formato que o import espera. */
function _form(files, fields = {}) {
  const form = new FormData();
  for (const f of (Array.isArray(files) ? files : [files])) form.append("file", f);
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  return form;
}

async function fetchInvestments(bank)      { return _get(`/api/investments${_params({ bank })}`); }

// Ficha da posição + snapshots datados (rendimento computado no servidor).
// Falha alto (`_send`) porque abre num overlay dedicado: sem posição não há o
// que desenhar, e o overlay tem onde mostrar o erro.
async function fetchInvestment(id) {
  return _send("GET", `/api/investments/${encodeURIComponent(id)}`, undefined, "posição não encontrada");
}

async function fetchAccounts(bank)         { return _get(`/api/accounts${_params({ bank })}`); }

// closed=1 traz as encerradas junto — o painel de contas precisa vê-las pra
// poder reabrir; os widgets, não.
async function fetchAllAccounts()          { return _get("/api/accounts?closed=1"); }

async function postAccount(account)        { return _post("/api/accounts", account); }

async function patchAccount(id, fields)    { return _patch(`/api/accounts/${encodeURIComponent(id)}`, fields); }

async function deleteAccount(id)           { return _del(`/api/accounts/${encodeURIComponent(id)}`); }

// Regras APRENDIDAS ao categorizar. Aprender sem poder desaprender é o
// problema: regra errada gravada uma vez sugere errado pra sempre.
async function fetchRules()                { return _get("/api/rules"); }

async function patchRule(id, fields)       { return _patch(`/api/rules/${id}`, fields); }

async function deleteRule(id)              { return _del(`/api/rules/${id}`); }


async function fetchCategoriesFull(flow = "expense", month) { return _get(`/api/categories-full${_params({ flow, month })}`); }

async function fetchMonthTransactions({ month, year } = {}) { return _get(`/api/month-transactions${_params({ month, year })}`); }

async function fetchLiquidityHistory()     { return _get("/api/liquidity-history"); }

async function fetchCommitments({ month, year } = {}) { return _get(`/api/commitments${_params({ month, year })}`); }

async function fetchMonthlyFull(bank)      { return _get(`/api/monthly${_params({ bank, present: 1 })}`); }

async function fetchBackupStatus()         { return _get("/api/backup-status"); }

async function fetchUncategorizedMerchants({ year, month } = {}) { return _get(`/api/uncategorized-merchants${_params({ year, month })}`); }

async function categorizeBulk(ids, categoryId) { return _post("/api/transactions/categorize-bulk", { ids, category_id: categoryId }); }

async function fetchCashflowStatement({ month, year } = {}) { return _get(`/api/cashflow-statement${_params({ month, year })}`); }

async function fetchAvailable()            { return _send("GET", "/api/available", undefined, "falha ao calcular disponível"); }

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
  return _del(`/api/categories/${id}`, { reassign_to_id: reassignToId });
}

async function deleteTransaction(id)        { return _del(`/api/transactions/${id}`); }

async function restoreTransactions(restore) { return _post("/api/transactions/restore", { restore }); }

async function importPreview(files, accountId) {
  return _post("/api/import/preview", _form(files, { account_id: accountId }), "falha ao analisar arquivo");
}

// Sugestão de destino; falhar aqui é normal (arquivo de formato desconhecido),
// então devolve null em vez de estourar na cara de quem só escolheu um arquivo.
async function importDetect(file) {
  try {
    const out = await _post("/api/import/detect", _form(file));
    const hit = out[0];
    if (!hit || !hit.account_id) return null;
    //> Fatura vem do FORMATO que o servidor leu, nunca deduzida de um id de conta.
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
  return _del(`/api/import/batch/${encodeURIComponent(importBatchId)}`, undefined, "falha ao reverter importação");
}

async function importB3(file, { confirm = false } = {}) {
  const url = confirm ? "/api/import/b3" : "/api/import/b3/preview";
  return _post(url, _form(file), "falha ao ler relatório B3");
}

async function importFaturaPreview(file) {
  return _post("/api/import/fatura/preview", _form(file), "falha ao ler fatura");
}

async function importFaturaConfirm(file, dueDate = null, importBatchId = null) {
  return _post(
    "/api/import/fatura",
    _form(file, { due_date: dueDate, import_batch_id: importBatchId }),
    "falha ao importar fatura",
  );
}

async function fetchInvestmentEvolution()    { return _get("/api/investment-evolution"); }
