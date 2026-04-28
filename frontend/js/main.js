/**
 * main.js — section navigation, state management, SSE connection, render loop.
 * Updated for Tailwind CSS Bento Grid Layout.
 */

const PT_MONTHS = ["","Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                   "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const fmt = v =>
  "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

const fmtDate = iso => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
};

// ── State ──────────────────────────────────────────────────────────────────────

const state = {
  activeSection: "overview", // overview | nubank | inter | investments
};

const bankFilters = {
  nubank: { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" },
  inter:  { month: new Date().getMonth() + 1, year: new Date().getFullYear(), category: "" }
};

let _txBankCache = { nubank: [], inter: [] };
let _expenseCategories = [];

// ── Navigation & Visibility ────────────────────────────────────────────────────

function initSectionNav() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // Reset all buttons visually
      document.querySelectorAll(".nav-btn").forEach(b => {
        b.classList.remove("text-text", "bg-bg", "shadow-sm");
        b.classList.add("text-muted", "hover:text-text", "hover:bg-white/5");
      });
      // Set active button visually
      btn.classList.add("text-text", "bg-bg", "shadow-sm");
      btn.classList.remove("text-muted", "hover:text-text", "hover:bg-white/5");

      state.activeSection = btn.dataset.target;

      // Toggle sections
      ["overview", "nubank", "inter", "investments"].forEach(sec => {
        const el = document.getElementById(`section-${sec}`);
        if (el) {
          if (sec === state.activeSection) {
            el.classList.remove("hidden");
            el.classList.add("block");
          } else {
            el.classList.remove("block");
            el.classList.add("hidden");
          }
        }
      });

      refresh();
    });
  });
}

// ── Overview Renderers ─────────────────────────────────────────────────────────

function renderOverviewCards(d) {
  document.getElementById("c-income").textContent   = fmt(d.income);
  document.getElementById("c-expenses").textContent = fmt(d.expenses);
  document.getElementById("c-reservas").textContent = fmt(d.reservas);
  document.getElementById("c-month").textContent    = PT_MONTHS[d.month] + " " + d.year;

  const bal = document.getElementById("c-balance");
  bal.textContent = (d.balance >= 0 ? "+" : "−") + fmt(d.balance);
  bal.className   = `text-2xl font-bold mb-1 ${d.balance >= 0 ? "text-brandGreen" : "text-brandRed"}`;

  const top = document.getElementById("c-top-cat");
  top.textContent = d.top_category ? "Top: " + d.top_category.name : "";
}

function renderOverviewFaturas(data) {
  document.getElementById("overview-faturas").innerHTML = data.map(f => {
    const d    = f.days_until_due;
    const due  = d > 0  ? `Vence em ${d} dia${d > 1 ? "s" : ""}`
               : d === 0 ? "Vence hoje"
               : `Vencida há ${Math.abs(d)} dias`;
    const cls  = d <= 3 ? "border-brandRed" : d <= 7 ? "border-brandYellow" : "border-brandGreen";
    return `
      <div class="flex justify-between items-start p-3 bg-bg rounded-xl border-l-4 ${cls}">
        <div>
          <div class="font-semibold text-sm text-text">${f.label}</div>
          <div class="text-xs text-muted mt-1">${f.cycle_start} – ${f.cycle_end}</div>
          <div class="text-xs font-medium mt-1 ${d <= 3 ? 'text-brandRed' : 'text-muted'}">${due}</div>
        </div>
        <div class="text-base font-bold text-text">${fmt(f.total)}</div>
      </div>`;
  }).join("");
}

// ── Bank Specific Renderers (Nubank & Inter) ───────────────────────────────────

function renderBankVisualCards(bankName, accounts) {
  const container = document.getElementById(`${bankName}-cards-container`);
  if (!container) return;

  const bgGradient = bankName === "nubank" 
    ? "bg-gradient-to-br from-nubank/90 to-nubank text-white" 
    : "bg-gradient-to-br from-inter/90 to-inter text-white";

  let html = "";

  accounts.forEach(a => {
    if (a.type === "credit" && a.billing_info) {
      const b = a.billing_info;
      const d = b.days_until_due;
      const urgBadge = d <= 3 
        ? `<span class="bg-red-500/20 text-red-100 px-2 py-0.5 rounded text-xs ml-2">Urgente</span>` 
        : "";

      html += `
        <div class="relative overflow-hidden rounded-2xl p-6 shadow-lg ${bgGradient}">
          <div class="absolute -right-4 -top-4 w-32 h-32 rounded-full bg-white/10 blur-2xl"></div>
          <div class="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-black/20 blur-2xl"></div>
          
          <div class="relative z-10 flex flex-col h-full justify-between">
            <div>
              <div class="flex justify-between items-start mb-2">
                <div class="font-semibold text-lg opacity-90">${a.name}</div>
                <svg class="w-8 h-8 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
              </div>
              <div class="text-sm opacity-80 mb-1">Fatura Atual</div>
              <div class="text-3xl font-bold mb-6">${fmt(b.total)}</div>
            </div>
            
            <div class="flex justify-between items-end text-sm">
              <div>
                <div class="opacity-80 text-xs uppercase tracking-wider mb-1">Vencimento</div>
                <div class="font-medium">${b.due_date} ${urgBadge}</div>
              </div>
              <div class="text-right">
                <div class="opacity-80 text-xs uppercase tracking-wider mb-1">Ciclo</div>
                <div class="font-medium">${b.cycle_start} - ${b.cycle_end}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (a.type === "checking" && a.monthly_summary) {
      const balCls = a.balance >= 0 ? "text-text" : "text-brandRed";
      html += `
        <div class="relative overflow-hidden rounded-2xl p-6 shadow-sm bg-surface border border-border flex flex-col justify-between">
          <div>
            <div class="flex justify-between items-start mb-6">
              <div class="font-semibold text-lg text-text">${a.name}</div>
              <div class="px-2 py-1 rounded bg-brandGreen/10 text-brandGreen text-[10px] font-bold uppercase tracking-wider">Conta</div>
            </div>
            <div class="text-sm text-muted mb-1">Saldo Disponível</div>
            <div class="text-3xl font-bold ${balCls} mb-6">${(a.balance >= 0 ? "" : "−") + fmt(a.balance)}</div>
          </div>

          <div class="flex gap-6 text-sm bg-bg p-3 rounded-xl border border-border/50">
            <div>
              <div class="text-xs text-muted mb-1">Entradas (Mês)</div>
              <div class="font-medium text-brandGreen">+${fmt(a.monthly_summary.income)}</div>
            </div>
            <div>
              <div class="text-xs text-muted mb-1">Saídas (Mês)</div>
              <div class="font-medium text-brandRed">-${fmt(a.monthly_summary.expenses)}</div>
            </div>
          </div>
        </div>
      `;
    }
  });

  container.innerHTML = html;
}

function renderBankTransactions(bankName) {
  const f = bankFilters[bankName];
  const txs = _txBankCache[bankName];
  const filtered = f.category ? txs.filter(t => t.category === f.category) : txs;

  const countEl = document.getElementById(`${bankName}-tx-count`);
  if (countEl) {
    countEl.textContent = filtered.length > 0
      ? `${filtered.length} transaç${filtered.length === 1 ? "ão" : "ões"}`
      : "";
  }

  const container = document.getElementById(`${bankName}-transactions-list`);
  if (!container) return;

  if (!filtered.length) {
    container.innerHTML = `<div class="text-muted text-sm py-4 text-center">Nenhuma transação registrada</div>`;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const amtCls = t.flow === "expense" ? "text-brandRed" : "text-brandGreen";
    const sign   = t.flow === "expense" ? "−" : "+";
    let catHtml  = "";
    
    if (t.flow === "expense") {
      const label = t.category || "sem categoria";
      catHtml = `<div class="text-[11px] text-muted mt-1 tx-cat editable inline-block" data-tx-id="${t.id}" data-cat-id="${t.category_id ?? ""}" data-bank="${bankName}">${label}</div>`;
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

function renderBankHistoryTable(bankName, months) {
  const tbody = document.getElementById(`${bankName}-monthly-history`);
  if (!tbody) return;

  const now   = new Date();
  const curY  = now.getFullYear();
  const curM  = now.getMonth() + 1;

  tbody.innerHTML = months.map(r => {
    const netCls  = r.net >= 0 ? "text-brandGreen" : "text-brandRed";
    const netSign = r.net >= 0 ? "+" : "−";
    const isCur   = r.year === curY && r.month === curM;
    const bgCls   = isCur ? "bg-brandBlue/5" : "";
    
    return `
      <tr class="mh-row border-b border-border last:border-0 ${bgCls}" data-year="${r.year}" data-month="${r.month}" data-bank="${bankName}">
        <td class="py-3 px-2 text-muted">
          ${r.label}${isCur ? ' <span class="text-[9px] bg-brandBlue text-white px-1.5 py-0.5 rounded ml-2 font-bold uppercase">Atual</span>' : ""}
        </td>
        <td class="py-3 px-2 text-right text-brandGreen font-medium">${r.income > 0 ? fmt(r.income) : "—"}</td>
        <td class="py-3 px-2 text-right text-brandRed font-medium">${r.expenses > 0 ? fmt(r.expenses) : "—"}</td>
        <td class="py-3 px-2 text-right ${netCls} font-bold">${netSign}${fmt(r.net)}</td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll(".mh-row").forEach(row => {
    row.addEventListener("click", () => {
      const y = parseInt(row.dataset.year,  10);
      const m = parseInt(row.dataset.month, 10);
      const b = row.dataset.bank;
      jumpToBankMonth(b, y, m);
    });
  });
}

// ── Transaction Actions & Filters ──────────────────────────────────────────────

async function loadBankTransactions(bankName) {
  const f = bankFilters[bankName];
  // Gather accounts for this bank to fetch transactions. We fetch generic 'bank' filter
  const accounts = await fetchAccounts(bankName);
  
  let allTx = [];
  for (const acc of accounts) {
    const txs = await fetchRecentTransactions(acc.id, { month: f.month, year: f.year });
    allTx = allTx.concat(txs);
  }
  
  // Sort descending by date
  allTx.sort((a,b) => new Date(b.date) - new Date(a.date));
  _txBankCache[bankName] = allTx;

  const cats = [...new Set(allTx.map(t => t.category).filter(Boolean))].sort();
  const catSel = document.getElementById(`${bankName}-tx-cat`);
  if (catSel) {
    const prevCat = catSel.value;
    catSel.innerHTML = `<option value="">Todas as categorias</option>` +
      cats.map(c => `<option value="${c}"${c === prevCat ? " selected" : ""}>${c}</option>`).join("");
    if (!cats.includes(prevCat)) {
      f.category = "";
      catSel.value = "";
    }
  }

  renderBankTransactions(bankName);
}

function jumpToBankMonth(bankName, year, month) {
  const f = bankFilters[bankName];
  f.year = year;
  f.month = month;
  f.category = "";

  const val = `${year}-${String(month).padStart(2, "0")}`;
  const monthSel = document.getElementById(`${bankName}-tx-month`);
  if (monthSel) {
    if (!monthSel.querySelector(`option[value="${val}"]`)) {
      const PT_MONTHS_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = `${PT_MONTHS_SHORT[month - 1]} ${year}`;
      monthSel.appendChild(opt);
    }
    monthSel.value = val;
  }
  
  const catSel = document.getElementById(`${bankName}-tx-cat`);
  if(catSel) catSel.value = "";

  loadBankTransactions(bankName);
}

function initBankFilters(bankName) {
  const monthSel = document.getElementById(`${bankName}-tx-month`);
  const catSel = document.getElementById(`${bankName}-tx-cat`);
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
    const f = bankFilters[bankName];
    if (val) {
      const [y, m] = val.split("-").map(Number);
      f.month = m; f.year = y;
    }
    f.category = "";
    catSel.value = "";
    loadBankTransactions(bankName);
  });

  catSel.addEventListener("change", e => {
    bankFilters[bankName].category = e.target.value;
    renderBankTransactions(bankName);
  });
}

async function openCategoryEditor(el) {
  if (_expenseCategories.length === 0) {
    _expenseCategories = await fetchExpenseCategories();
  }

  const txId  = el.dataset.txId;
  const catId = el.dataset.catId;
  const bank  = el.dataset.bank;

  const select = document.createElement("select");
  select.className = "bg-surface text-text border border-border rounded text-[11px] py-0.5 px-1 outline-none focus:border-brandBlue";
  select.innerHTML = _expenseCategories
    .map(c => `<option value="${c.id}"${String(c.id) === catId ? " selected" : ""}>${c.name}</option>`)
    .join("");

  el.replaceWith(select);
  select.focus();

  let committed = false;

  select.addEventListener("change", async () => {
    committed = true;
    const newCatId = parseInt(select.value, 10);
    const newCat   = _expenseCategories.find(c => c.id === newCatId);

    try {
      await patchTransactionCategory(txId, newCatId);
    } catch {
      restoreBadge(el);
      return;
    }

    const newEl = document.createElement("div");
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
  });

  select.addEventListener("blur", () => {
    if (!committed) restoreBadge(el);
  });

  function restoreBadge(orig) {
    if (!document.contains(select)) return;
    select.replaceWith(orig);
  }
}


// ── Refresh Dispatchers ────────────────────────────────────────────────────────

async function refreshOverview() {
  const bank = null;
  const [summary, monthly, categories, faturas] = await Promise.all([
    fetchSummary(bank),
    fetchMonthly(bank),
    fetchCategories(bank),
    fetchFaturas(bank),
  ]);
  renderOverviewCards(summary);
  renderOverviewFaturas(faturas);
  createMonthlyChart(monthly, "chart-monthly");
  createCategoriesChart(categories, "chart-categories");
}

async function refreshBank(bankName) {
  const [accounts, monthly, categories, history] = await Promise.all([
    fetchAccounts(bankName),
    fetchMonthly(bankName),
    fetchCategories(bankName),
    fetchAccountHistory(bankName) // API accepts bank name param if modified, or fallback to fetching separate
  ]);
  
  // NOTE: fetchAccountHistory originally expected an account_id. We need to check if it supports bank filters. 
  // For the sake of the dashboard, if API requires acc ID, we might need a specialized endpoint or aggregate.
  // We will assume backend supports ?bank= as per API unified logic.
  
  // To avoid breaking API contract if fetchAccountHistory strictly needs ID, we'll fetch monthly which has the same structure.
  // ACTUALLY, `fetchMonthly` returns the line chart data, `fetchAccountHistory` returns table format. We can just use fetchMonthly data to build the table.
  const historyTableData = monthly.map(m => ({
    year: parseInt(m.label.split('/')[1]), // Assuming MM/YYYY
    month: parseInt(m.label.split('/')[0]),
    label: PT_MONTHS[parseInt(m.label.split('/')[0])] + " " + m.label.split('/')[1],
    income: m.income,
    expenses: m.expenses,
    net: m.income - m.expenses
  })).reverse(); // Reverse to show newest first

  renderBankVisualCards(bankName, accounts);
  createMonthlyChart(monthly, `chart-${bankName}-monthly`);
  createCategoriesChart(categories, `chart-${bankName}-categories`);
  renderBankHistoryTable(bankName, historyTableData);
  
  await loadBankTransactions(bankName);
}

async function refreshInvestments() {
  const investments = await fetchInvestments(null);
  
  const total = investments.reduce((s, inv) => s + inv.balance, 0);
  document.getElementById("investments-cards").innerHTML = investments.map(inv => {
    const pct = total > 0 ? ((inv.balance / total) * 100).toFixed(1) : "0.0";
    const bgCls = inv.bank === "nubank" ? "bg-nubank/20 text-nubank" : "bg-inter/20 text-inter";
    
    return `
      <div class="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <div class="flex justify-between items-center mb-4">
          <div class="font-semibold text-text">${inv.name}</div>
          <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${bgCls}">
            ${inv.bank === "nubank" ? "Nubank" : "Inter"}
          </span>
        </div>
        <div class="text-3xl font-bold text-brandPurple mb-1">${fmt(inv.balance)}</div>
        <div class="text-xs text-muted">${pct}% do total · Reservas</div>
      </div>`;
  }).join("");

  createInvestmentsChart(investments, "chart-investments");
}

async function refresh() {
  switch (state.activeSection) {
    case "overview":    await refreshOverview(); break;
    case "nubank":      await refreshBank("nubank"); break;
    case "inter":       await refreshBank("inter"); break;
    case "investments": await refreshInvestments(); break;
  }
  
  document.getElementById("last-updated").textContent =
    new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── SSE ────────────────────────────────────────────────────────────────────────

let _refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(refresh, 300);
}

function initSSE() {
  const dot = document.getElementById("sse-dot");
  function connect() {
    const es = new EventSource("/api/events");
    es.onopen = () => { dot.classList.remove("bg-muted"); dot.classList.add("bg-brandGreen"); };
    es.onmessage = e => { if (e.data === "update") scheduleRefresh(); };
    es.onerror = () => {
      dot.classList.remove("bg-brandGreen"); dot.classList.add("bg-muted");
      es.close();
      setTimeout(connect, 5000);
    };
  }
  connect();
}

// ── Init ───────────────────────────────────────────────────────────────────────

initSectionNav();
initBankFilters("nubank");
initBankFilters("inter");
initSSE();
refresh();
