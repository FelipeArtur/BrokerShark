/**
 * @file api.js
 * @brief Wrappers de fetch para todos os endpoints do dashboard (leitura,
 *        escrita e import). Valores monetários trafegam em REAIS (float) no
 *        campo `amount`; campos `*_cents` do backend são centavos inteiros.
 */

/**
 * @brief Monta a query-string ignorando valores nulos/vazios.
 * @param obj objeto {chave: valor} com os parâmetros candidatos
 * @return string "?a=1&b=2" já com encodeURIComponent, ou "" se nada sobrar
 */
function _params(obj) {
  const entries = Object.entries(obj).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
/**
 * @brief Monta a query-string do filtro de banco.
 * @param bank nome do banco ("nubank"/"inter") ou nulo p/ todos
 * @return string "?bank=…" ou "" quando não há filtro
 */
function _qs(bank) { return _params({ bank }); }

/**
 * @brief Faz um GET e devolve o JSON da resposta.
 * @param url caminho do endpoint
 * @return Promise com o corpo da resposta já parseado
 */
async function _get(url)  { return fetch(url).then(r => r.json()); }
/**
 * @brief Faz um POST JSON, convertendo resposta não-ok em Error.
 * @param url caminho do endpoint
 * @param body objeto serializado como JSON no corpo
 * @return Promise com o JSON da resposta
 */
async function _post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}
/**
 * @brief Faz um PATCH JSON, convertendo resposta não-ok em Error.
 * @param url caminho do endpoint
 * @param body objeto com só os campos a alterar
 * @return Promise com o JSON da resposta
 */
async function _patch(url, body) {
  const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}
/**
 * @brief Faz um PUT JSON (upsert), convertendo resposta não-ok em Error.
 * @param url caminho do endpoint
 * @param body objeto completo do recurso
 * @return Promise com o JSON da resposta
 */
async function _put(url, body) {
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}
/**
 * @brief Faz um DELETE JSON com body, convertendo resposta não-ok em Error.
 * @param url caminho do endpoint
 * @param body objeto identificando o recurso
 * @return Promise com o JSON da resposta
 */
async function _delBody(url, body) {
  const r = await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}

/* ── Read endpoints ─────────────────────────────────────────────────────── */
/**
 * @brief Lista as posições de investimento abertas.
 * @param bank filtra por banco emissor; omitido = todos
 * @return Promise com as posições (`balance` em reais)
 */
async function fetchInvestments(bank)      { return _get(`/api/investments${_qs(bank)}`); }
/**
 * @brief Lista as contas com o saldo atual.
 * @param bank filtra por banco; omitido = todas
 * @return Promise com as contas (`balance` em reais)
 */
async function fetchAccounts(bank)         { return _get(`/api/accounts${_qs(bank)}`); }
/**
 * @brief Lista as categorias de despesa (só id + nome).
 * @return Promise com a lista de categorias
 */
async function fetchExpenseCategories()         { return _get("/api/expense-categories"); }
/**
 * @brief Lista as categorias de despesa com os agregados (contagem, alvo).
 * @return Promise com a lista de categorias completa
 */
async function fetchExpenseCategoriesFull()     { return _get("/api/expense-categories-full"); }
/**
 * @brief Lista as categorias de um fluxo com os agregados.
 *
 * Sem `month`: contagem + alvo fixo. Com `month`: alvo VIGENTE já resolvido
 * (override do mês → fixo), gasto do mês e gasto do mês anterior.
 *
 * @param flow "expense" (padrão) ou "income"
 * @param month mês "YYYY-MM"; omitido = sem gasto/Δ, alvo fixo apenas
 * @return Promise com as categorias. `budget_cents`/`spent_cents`/
 *         `prev_spent_cents` em CENTAVOS inteiros; `budget_cents` null =
 *         sem alvo (≠ alvo zero); `budget_source` = "month"|"fixed"|null
 */
async function fetchCategoriesFull(flow = "expense", month) { return _get(`/api/categories-full${_params({ flow, month })}`); }

/* ── New v2 read endpoints ──────────────────────────────────────────────── */
/**
 * @brief Lista os lançamentos de um mês, com sugestão de categoria.
 * @param month mês 1–12 do seletor global
 * @param year ano do seletor global
 * @return Promise com as transações (`amount` em reais)
 */
async function fetchMonthTransactions({ month, year } = {}) { return _get(`/api/month-transactions${_params({ month, year })}`); }
/**
 * @brief Busca a série mensal de patrimônio líquido (caixa + investimentos).
 * @return Promise com pontos {label, value} (`value` em reais)
 */
async function fetchLiquidityHistory()     { return _get("/api/liquidity-history"); }
/**
 * @brief Busca lançamentos por texto livre em todo o histórico.
 * @param q termo de busca
 * @return Promise com as transações que casam
 */
async function searchTransactions(q)       { return _get(`/api/search?q=${encodeURIComponent(q)}`); }
/**
 * @brief Busca a série de receita/despesa mês a mês, incluindo o mês corrente.
 * @param bank filtra por banco; omitido = todos
 * @return Promise com {year, month, income, expenses} (valores em reais)
 */
async function fetchMonthlyFull(bank)      { return _get(`/api/monthly${_params({ bank, present: 1 })}`); }
/**
 * @brief Lê o estado do backup do DB (existência e idade).
 * @return Promise com {exists, name, age_seconds}
 */
async function fetchBackupStatus()         { return _get("/api/backup-status"); }
/**
 * @brief Agrupa os lançamentos sem categoria do mês por comerciante.
 * @param year ano do mês selecionado
 * @param month mês 1–12 selecionado
 * @return Promise com grupos {merchant_key, flow, ids, count, total} (total em reais)
 */
async function fetchUncategorizedMerchants({ year, month } = {}) { return _get(`/api/uncategorized-merchants${_params({ year, month })}`); }
/**
 * @brief Categoriza várias transações de uma vez.
 * @param ids ids das transações a categorizar
 * @param categoryId id da categoria destino
 * @return Promise com o resultado do backend
 */
async function categorizeBulk(ids, categoryId) { return _post("/api/transactions/categorize-bulk", { ids, category_id: categoryId }); }
/**
 * @brief Busca a DRE do mês (receita, despesa de consumo e investimento líquido).
 * @param month mês 1–12 selecionado
 * @param year ano selecionado
 * @return Promise com {income_total, expense_total, investment_net} em reais
 */
async function fetchCashflowStatement({ month, year } = {}) { return _get(`/api/cashflow-statement${_params({ month, year })}`); }
/**
 * @brief Calcula o "disponível pra gastar" agora (posição, não fluxo).
 * @return Promise com {available, checking_total} em reais
 */
async function fetchAvailable() {
  const r = await fetch("/api/available");
  if (!r.ok) throw new Error("falha ao calcular disponível");
  return r.json();
}

/* ── Write endpoints ────────────────────────────────────────────────────── */
/**
 * @brief Troca a categoria de uma transação.
 * @param txId id da transação
 * @param categoryId id da categoria destino (null limpa)
 * @return Promise com a transação atualizada
 */
async function patchTransactionCategory(txId, categoryId) {
  return _patch(`/api/transactions/${txId}`, { category_id: categoryId });
}
/**
 * @brief Altera campos arbitrários de uma transação (validados no server).
 * @param txId id da transação
 * @param fields só os campos a mudar (category_id, display_name, is_third_party…)
 * @return Promise com a transação atualizada
 */
async function patchTransaction(txId, fields) {
  return _patch(`/api/transactions/${txId}`, fields);
}
/**
 * @brief Lista os maiores destinos de PIX do mês.
 * @param month mês 1–12 selecionado
 * @param year ano selecionado
 * @return Promise com os destinos e totais (em reais)
 */
async function fetchPixTop({ month, year } = {}) { return _get(`/api/pix-top${_params({ month, year })}`); }
/**
 * @brief Lança um movimento manual de investimento (aplicação/resgate).
 * @param investment_name nome da posição
 * @param operation "apply" ou "redeem"
 * @param amount valor em REAIS
 * @param date data ISO (YYYY-MM-DD)
 * @param description descrição livre
 * @return Promise com o resultado do backend
 */
async function postInvestmentMovement({ investment_name, operation, amount, date, description }) {
  return _post("/api/investment-movements", { investment_name, operation, amount, date, description });
}
/**
 * @brief Cria uma categoria.
 * @param name nome da categoria
 * @param flow "expense" ou "income"
 * @return Promise com a categoria criada
 */
async function postCategory(name, flow)       { return _post("/api/categories", { name, flow }); }
/**
 * @brief Renomeia uma categoria.
 * @param id id da categoria
 * @param name novo nome
 * @return Promise com a categoria atualizada
 */
async function patchCategory(id, name)        { return _patch(`/api/categories/${id}`, { name }); }
/**
 * @brief Grava o alvo de gasto de uma categoria (upsert).
 *
 * Sem `refMonth` grava o ALVO FIXO (vale todo mês); com `refMonth` grava o
 * override daquele mês, que tem precedência sobre o fixo.
 *
 * @param categoryId categoria de despesa (o backend recusa categoria de receita)
 * @param amountCents alvo em CENTAVOS inteiros, >= 0
 * @param refMonth "YYYY-MM" p/ override do mês; omitido = alvo fixo
 * @return Promise com o resultado do backend
 */
async function putCategoryBudget(categoryId, amountCents, refMonth) {
  return _put("/api/category-budget", { category_id: categoryId, amount_cents: amountCents, ref_month: refMonth ?? "" });
}
/**
 * @brief Remove o alvo de uma categoria.
 *
 * Apagar o override de um mês faz a categoria voltar a HERDAR o alvo fixo;
 * apagar o fixo (sem `refMonth`) deixa a categoria sem alvo — que é estado
 * diferente de alvo zero.
 *
 * @param categoryId categoria de despesa
 * @param refMonth "YYYY-MM" p/ remover só o override; omitido = remove o fixo
 * @return Promise com o resultado do backend
 */
async function deleteCategoryBudget(categoryId, refMonth) {
  return _delBody("/api/category-budget", { category_id: categoryId, ref_month: refMonth ?? "" });
}
/**
 * @brief Exclui uma categoria, reatribuindo os lançamentos dela.
 * @param id id da categoria a excluir
 * @param reassignToId id da categoria que recebe os lançamentos órfãos
 * @return Promise com o resultado do backend
 */
async function deleteCategory(id, reassignToId) {
  const r = await fetch(`/api/categories/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reassign_to_id: reassignToId }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();
}
/**
 * @brief Exclui uma transação, devolvendo o payload que permite desfazer.
 * @param id id da transação
 * @return Promise com { ok, deleted, restore } — `restore` alimenta restoreTransactions
 */
async function deleteTransaction(id) {
  const r = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return r.json();  // { ok, deleted, restore }
}
/**
 * @brief Recria transações excluídas (o "desfazer" do toast).
 * @param restore payload `restore` devolvido por deleteTransaction/deleteImportBatch
 * @return Promise com o resultado do backend
 */
async function restoreTransactions(restore) { return _post("/api/transactions/restore", { restore }); }

/* ── File import (multipart upload + staged confirm) ─────────────────────── */
/**
 * @brief Envia os extratos de UMA conta e devolve o preview com dedup + staging.
 * @param files um File ou array de Files, todos da mesma conta
 * @param accountId conta dona dos arquivos ("nu-db"/"inter-db")
 * @return Promise com {batch_id, counts, rows, amount_divergence} (`amount` em reais)
 */
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
/**
 * @brief Descobre a conta dona de um CSV pelo cabeçalho.
 * @param file arquivo CSV solto no import
 * @return Promise com o account_id detectado, ou null quando não dá pra saber
 */
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
/**
 * @brief Edita uma linha do preview antes do confirm.
 * @param batchId batch_id devolvido por importPreview
 * @param rowId id da linha em staging
 * @param fields campos a alterar — `amount` em REAIS, category_id, display_name
 * @return Promise com {ok, row, amount_divergence} (divergência em reais)
 */
async function patchStagingRow(batchId, rowId, fields) {
  // Edit one preview row (amount/category_id/display_name) → {ok, row, amount_divergence}.
  return _patch(`/api/import/staging/${batchId}/${rowId}`, fields);
}
/**
 * @brief Confirma um batch de staging, inserindo as linhas no ledger.
 * @param batchId batch_id do preview desta conta
 * @param excludeIds ids das linhas desmarcadas, que não devem ser inseridas
 * @param importBatchId id de sessão compartilhado por todas as contas do mesmo drop
 * @return Promise com {inserted, …}
 */
async function importConfirm(batchId, excludeIds = [], importBatchId = null) {
  const body = { batch_id: batchId, exclude_ids: excludeIds };
  // One session id shared across every confirm of a multi-account drop, so the
  // whole import reverses as one unit in the Histórico.
  if (importBatchId) body.import_batch_id = importBatchId;
  return _post("/api/import/confirm", body);
}
/**
 * @brief Reverte uma importação inteira (todas as contas da mesma sessão).
 * @param importBatchId id de sessão usado no importConfirm
 * @return Promise com { ok, deleted, restore }
 */
async function deleteImportBatch(importBatchId) {
  const r = await fetch(`/api/import/batch/${encodeURIComponent(importBatchId)}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao reverter importação"); }
  return r.json();  // { ok, deleted, restore }
}

/* ── B3 investment-position import (XLSX): preview parses, confirm upserts ── */
/**
 * @brief Envia o relatório B3 (.xlsx): preview só parseia, confirm faz o upsert.
 * @param file arquivo xlsx do relatório consolidado
 * @param confirm false (padrão) = preview; true = grava as posições
 * @return Promise com {created, updated, positions} (`balance` em reais)
 */
async function importB3(file, { confirm = false } = {}) {
  const form = new FormData();
  form.append("file", file);
  const url = confirm ? "/api/import/b3" : "/api/import/b3/preview";
  const r = await fetch(url, { method: "POST", body: form });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "falha ao ler relatório B3"); }
  return r.json();
}
/**
 * @brief Busca a evolução mensal da carteira de investimentos.
 * @return Promise com pontos {label, cumulative} (`cumulative` em reais)
 */
async function fetchInvestmentEvolution()    { return _get("/api/investment-evolution"); }
