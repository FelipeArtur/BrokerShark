import os
with open("frontend/js/main.js", "r") as f:
    content = f.read()

# 1. State updates
old_state = """const bankFilters = {
  nubank: { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" },
  inter:  { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" }
};

let _txBankCache = { nubank: [], inter: [] };
let _expenseCategories = [];"""

new_state = """const bankFilters = {
  nubank: { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" },
  inter:  { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" }
};

const bankCcFilters = {
  nubank: { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" },
  inter:  { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" }
};

let _txBankCache = { nubank: [], inter: [] };
let _txBankCcCache = { nubank: [], inter: [] };
let _expenseCategories = [];"""

content = content.replace(old_state, new_state)


# 2. Filter checking accounts in loadBankTransactions
old_load_tx = """async function loadBankTransactions(bankName) {
  const f = bankFilters[bankName];
  // Gather accounts for this bank to fetch transactions. We fetch generic 'bank' filter
  const accounts = await fetchAccounts(bankName);
  
  let allTx = [];
  for (const acc of accounts) {"""

new_load_tx = """async function loadBankTransactions(bankName) {
  const f = bankFilters[bankName];
  // Gather accounts for this bank to fetch transactions. We fetch generic 'bank' filter
  const accounts = await fetchAccounts(bankName);
  
  // Filter for checking accounts
  const checkingAccounts = accounts.filter(acc => acc.type === "checking");
  
  let allTx = [];
  for (const acc of checkingAccounts) {"""

content = content.replace(old_load_tx, new_load_tx)


# 3. Add Credit Card functions
cc_funcs = """

function renderCreditCardTransactions(bankName) {
  const f = bankCcFilters[bankName];
  const txs = _txBankCcCache[bankName];
  const filtered = f.category ? txs.filter(t => t.category === f.category) : txs;

  const countEl = document.getElementById(`${bankName}-cc-tx-count`);
  if (countEl) {
    countEl.textContent = filtered.length > 0
      ? `${filtered.length} gasto${filtered.length === 1 ? "" : "s"}`
      : "";
  }

  const container = document.getElementById(`${bankName}-cc-transactions-list`);
  if (!container) return;

  if (!filtered.length) {
    container.innerHTML = `<div class="text-muted text-sm py-4 text-center">Nenhum gasto no cartão registrado</div>`;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const amtCls = t.flow === "expense" ? "text-brandRed" : "text-brandGreen";
    const sign   = t.flow === "expense" ? "−" : "+";
    let catHtml  = "";
    
    if (t.flow === "expense") {
      const label = t.category || "sem categoria";
      catHtml = `<div class="text-[11px] text-muted mt-1 tx-cat editable inline-block" data-tx-id="${t.id}" data-cat-id="${t.category_id ?? ""}" data-bank="${bankName}" data-is-cc="true">${label}</div>`;
    } else if (t.category) {
      catHtml = `<div class="text-[11px] text-muted mt-1 inline-block bg-white/5 px-1.5 rounded">${t.category}</div>`;
    }

    return `
      <div class="flex items-center gap-3 py-3 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors px-2 -mx-2 rounded-lg">
        <div class="text-xs text-muted w-12 shrink-0">${fmtDate(t.date)}</div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-text truncate">${t.description}</div>
          ${catHtml}
        </div>
        <div class="text-sm font-semibold shrink-0 ${amtCls}">${sign}${fmt(t.amount)}</div>
      </div>`;
  }).join("");

  container.querySelectorAll(".tx-cat.editable").forEach(el => {
    el.addEventListener("click", () => openCategoryEditor(el));
  });
}

async function loadCreditCardTransactions(bankName) {
  const f = bankCcFilters[bankName];
  const accounts = await fetchAccounts(bankName);
  
  const creditAccounts = accounts.filter(acc => acc.type === "credit");
  
  let allTx = [];
  for (const acc of creditAccounts) {
    const txs = await fetchRecentTransactions(acc.id, { month: f.month, year: f.year });
    allTx = allTx.concat(txs);
  }
  
  allTx.sort((a,b) => new Date(b.date) - new Date(a.date));
  _txBankCcCache[bankName] = allTx;

  const cats = [...new Set(allTx.map(t => t.category).filter(Boolean))].sort();
  const catSel = document.getElementById(`${bankName}-cc-tx-cat`);
  if (catSel) {
    const prevCat = catSel.value;
    catSel.innerHTML = `<option value="">Todas as categorias</option>` +
      cats.map(c => `<option value="${c}"${c === prevCat ? " selected" : ""}>${c}</option>`).join("");
    if (!cats.includes(prevCat)) {
      f.category = "";
      catSel.value = "";
    }
  }

  renderCreditCardTransactions(bankName);
}

function initBankCcFilters(bankName) {
  const monthSel = document.getElementById(`${bankName}-cc-tx-month`);
  const catSel = document.getElementById(`${bankName}-cc-tx-cat`);
  if (!monthSel || !catSel) return;

  const now = new Date();
  let html = "";
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const val = `${y}-${String(m).padStart(2, "0")}`;
    html += `<option value="${val}"${i === 0 ? " selected" : ""}>${PT_MONTHS[m]} ${y}</option>`;
  }
  monthSel.innerHTML = html;

  monthSel.addEventListener("change", () => {
    const val = monthSel.value;
    const f = bankCcFilters[bankName];
    if (val) {
      const [y, m] = val.split("-").map(Number);
      f.month = m; f.year = y;
    }
    f.category = "";
    catSel.value = "";
    loadCreditCardTransactions(bankName);
  });

  catSel.addEventListener("change", e => {
    bankCcFilters[bankName].category = e.target.value;
    renderCreditCardTransactions(bankName);
  });
}

// ── Refresh Dispatchers ────────────────────────────────────────────────────────
"""

content = content.replace("// ── Refresh Dispatchers ────────────────────────────────────────────────────────", cc_funcs)

# 4. Open Category Editor changes
old_editor = """async function openCategoryEditor(el) {
  if (_expenseCategories.length === 0) {
    _expenseCategories = await fetchExpenseCategories();
  }

  const txId  = el.dataset.txId;
  const catId = el.dataset.catId;
  const bank  = el.dataset.bank;"""

new_editor = """async function openCategoryEditor(el) {
  if (_expenseCategories.length === 0) {
    _expenseCategories = await fetchExpenseCategories();
  }

  const txId  = el.dataset.txId;
  const catId = el.dataset.catId;
  const bank  = el.dataset.bank;
  const isCc  = el.dataset.isCc === "true";"""

content = content.replace(old_editor, new_editor)

old_editor_save = """    const newEl = document.createElement("div");
    newEl.className = el.className;
    newEl.dataset.txId = txId;
    newEl.dataset.catId = String(newCatId);
    newEl.dataset.bank = bank;
    newEl.textContent = newCat?.name ?? "";
    newEl.addEventListener("click", () => openCategoryEditor(newEl));
    select.replaceWith(newEl);

    // Update Cache
    const tx = _txBankCache[bank].find(t => String(t.id) === String(txId));
    if (tx) { tx.category = newCat?.name ?? ""; tx.category_id = newCatId; }
  });"""

new_editor_save = """    const newEl = document.createElement("div");
    newEl.className = el.className;
    newEl.dataset.txId = txId;
    newEl.dataset.catId = String(newCatId);
    newEl.dataset.bank = bank;
    if (isCc) newEl.dataset.isCc = "true";
    newEl.textContent = newCat?.name ?? "";
    newEl.addEventListener("click", () => openCategoryEditor(newEl));
    select.replaceWith(newEl);

    // Update Cache
    const cacheToUpdate = isCc ? _txBankCcCache[bank] : _txBankCache[bank];
    const tx = cacheToUpdate.find(t => String(t.id) === String(txId));
    if (tx) { tx.category = newCat?.name ?? ""; tx.category_id = newCatId; }
  });"""

content = content.replace(old_editor_save, new_editor_save)

# 5. refreshBank updates
old_refresh_bank = """  renderBankHistoryTable(bankName, historyTableData);
  
  await loadBankTransactions(bankName);
}"""

new_refresh_bank = """  renderBankHistoryTable(bankName, historyTableData);
  
  await loadBankTransactions(bankName);
  await loadCreditCardTransactions(bankName);
}"""

content = content.replace(old_refresh_bank, new_refresh_bank)

# 6. init block updates
old_init = """initBankFilters("nubank");
initBankFilters("inter");
initSSE();"""

new_init = """initBankFilters("nubank");
initBankFilters("inter");
initBankCcFilters("nubank");
initBankCcFilters("inter");
initSSE();"""

content = content.replace(old_init, new_init)

with open("frontend/js/main.js", "w") as f:
    f.write(content)
