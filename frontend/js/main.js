/**
 * main.js — section navigation, state management, SSE connection, render loop.
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
  activeSection: "overview",
  activeBank:    null,   // null | "nubank" | "inter"
  activeAccount: null,   // null | "nu-cc" | "nu-db" | "inter-cc" | "inter-db"
};

const txFilters = {
  month:    new Date().getMonth() + 1,
  year:     new Date().getFullYear(),
  category: "",
};

let _txAll = [];  // full fetched list for current account+month, before category filter

// ── Helpers ────────────────────────────────────────────────────────────────────

function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "";
}

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

// ── Overview renderers ─────────────────────────────────────────────────────────

function renderOverviewCards(d) {
  document.getElementById("c-income").textContent   = fmt(d.income);
  document.getElementById("c-expenses").textContent = fmt(d.expenses);
  document.getElementById("c-reservas").textContent = fmt(d.reservas);
  document.getElementById("c-month").textContent    = PT_MONTHS[d.month] + " " + d.year;

  const bal = document.getElementById("c-balance");
  bal.textContent = (d.balance >= 0 ? "+" : "−") + fmt(d.balance);
  bal.className   = "card-value " + (d.balance >= 0 ? "green" : "red");

  const top = document.getElementById("c-top-cat");
  top.textContent = d.top_category ? "Top: " + d.top_category.name : "";
}

function renderOverviewFaturas(data) {
  document.getElementById("overview-faturas").innerHTML = data.map(f => {
    const d    = f.days_until_due;
    const due  = d > 0  ? `vence em ${d} dia${d > 1 ? "s" : ""}`
               : d === 0 ? "vence hoje"
               : `vencida há ${Math.abs(d)} dias`;
    const cls  = d <= 3 ? "urgent" : d <= 7 ? "warning" : "";
    return `
      <div class="fatura-item ${cls}">
        <div>
          <div class="fatura-name">${f.label}</div>
          <div class="fatura-meta">${f.cycle_start} – ${f.cycle_end}</div>
          <div class="fatura-meta">${due} · ${f.due_date}</div>
        </div>
        <div class="fatura-val">${fmt(f.total)}</div>
      </div>`;
  }).join("");
}

// ── Transaction filters ────────────────────────────────────────────────────────

function initTxFilters() {
  const monthSel = document.getElementById("tx-month-select");
  const now      = new Date();
  let html = `<option value="">Todos os meses</option>`;
  for (let i = 0; i < 12; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m   = d.getMonth() + 1;
    const y   = d.getFullYear();
    const val = `${y}-${String(m).padStart(2, "0")}`;
    html += `<option value="${val}"${i === 0 ? " selected" : ""}>${PT_MONTHS[m]} ${y}</option>`;
  }
  monthSel.innerHTML = html;

  monthSel.addEventListener("change", () => {
    const val = monthSel.value;
    if (val) {
      const [y, m]    = val.split("-").map(Number);
      txFilters.month = m;
      txFilters.year  = y;
    } else {
      txFilters.month = null;
      txFilters.year  = null;
    }
    txFilters.category = "";
    document.getElementById("tx-cat-select").value = "";
    if (state.activeAccount) refreshTransactions();
  });

  document.getElementById("tx-cat-select").addEventListener("change", e => {
    txFilters.category = e.target.value;
    renderFilteredTransactions();
  });
}

function resetTxFilters() {
  const now       = new Date();
  txFilters.month = now.getMonth() + 1;
  txFilters.year  = now.getFullYear();
  txFilters.category = "";
  const monthSel = document.getElementById("tx-month-select");
  if (monthSel) {
    const val = `${txFilters.year}-${String(txFilters.month).padStart(2, "0")}`;
    monthSel.value = val;
  }
  const catSel = document.getElementById("tx-cat-select");
  if (catSel) catSel.value = "";
}

async function refreshTransactions() {
  _txAll = await fetchRecentTransactions(state.activeAccount, {
    month: txFilters.month,
    year:  txFilters.year,
  });
  const cats    = [...new Set(_txAll.map(t => t.category).filter(Boolean))].sort();
  const catSel  = document.getElementById("tx-cat-select");
  const prevCat = catSel.value;
  catSel.innerHTML = `<option value="">Todas as categorias</option>` +
    cats.map(c => `<option value="${c}"${c === prevCat ? " selected" : ""}>${c}</option>`).join("");
  if (!cats.includes(prevCat)) txFilters.category = "";
  renderFilteredTransactions();
}

function renderFilteredTransactions() {
  const filtered = txFilters.category
    ? _txAll.filter(t => t.category === txFilters.category)
    : _txAll;
  const countEl = document.getElementById("tx-count");
  countEl.textContent = filtered.length > 0
    ? `${filtered.length} transaç${filtered.length === 1 ? "ão" : "ões"}`
    : "";
  renderTransactionList(filtered);
}

// ── Accounts renderers ─────────────────────────────────────────────────────────

function renderAccountsGrid(accounts) {
  const TYPE_LABEL = { credit: "Crédito", checking: "Conta" };
  const BANK_LABEL = { nubank: "Nubank", inter: "Inter" };

  document.getElementById("accounts-all-grid").innerHTML = accounts.map(a => {
    const bal     = a.balance;
    const balCls  = bal >= 0 ? "green" : "red";
    const typeBadge = `<span class="account-type-badge ${a.type}">${TYPE_LABEL[a.type] ?? a.type}</span>`;
    return `
      <div class="account-card" data-account="${a.id}" onclick="selectAccount('${a.id}')">
        <div class="account-card-header">
          <div>
            <div class="account-card-name">${a.name}</div>
            <div class="account-card-bank">${BANK_LABEL[a.bank] ?? a.bank}</div>
          </div>
          ${typeBadge}
        </div>
        <div class="account-card-balance ${balCls}">${(bal >= 0 ? "" : "−") + fmt(bal)}</div>
        <div class="account-card-sub">${a.type === "credit" ? "Saldo a pagar" : "Saldo disponível"}</div>
      </div>`;
  }).join("");
}

function renderAccountHero(detail) {
  const el       = document.getElementById("account-hero");
  const summary  = detail.monthly_summary;
  const billing  = detail.billing_info;
  const TYPE_LABEL = { credit: "Crédito", checking: "Conta" };

  let urgencyBadge = "";
  let metaLine     = "";
  let statsHtml    = "";

  if (detail.type === "credit" && billing) {
    const d = billing.days_until_due;
    const urgCls  = d <= 3 ? "urgent" : d <= 7 ? "warning" : "ok";
    const urgText = d > 0  ? `vence em ${d} dia${d > 1 ? "s" : ""}`
                  : d === 0 ? "vence hoje"
                  : `vencida há ${Math.abs(d)} dias`;
    urgencyBadge = `<span class="urgency-badge ${urgCls}">${urgText}</span>`;
    metaLine     = `<div class="account-hero-meta">Ciclo: ${billing.cycle_start} – ${billing.cycle_end} · Venc: ${billing.due_date}${urgencyBadge}</div>`;

    statsHtml = `
      <div class="account-hero-stats">
        <div>
          <div class="account-hero-stat-label">Fatura atual</div>
          <div class="account-hero-stat-value red">${fmt(billing.total)}</div>
        </div>
        <div>
          <div class="account-hero-stat-label">Gastos no mês</div>
          <div class="account-hero-stat-value">${fmt(summary.expenses)}</div>
        </div>
        ${summary.top_category ? `
        <div>
          <div class="account-hero-stat-label">Top categoria</div>
          <div class="account-hero-stat-value">${summary.top_category.name}</div>
        </div>` : ""}
      </div>`;
  } else {
    statsHtml = `
      <div class="account-hero-stats">
        <div>
          <div class="account-hero-stat-label">Receitas no mês</div>
          <div class="account-hero-stat-value green">${fmt(summary.income)}</div>
        </div>
        <div>
          <div class="account-hero-stat-label">Gastos no mês</div>
          <div class="account-hero-stat-value red">${fmt(summary.expenses)}</div>
        </div>
        <div>
          <div class="account-hero-stat-label">Saldo no mês</div>
          <div class="account-hero-stat-value ${summary.income - summary.expenses >= 0 ? "green" : "red"}">
            ${(summary.income - summary.expenses >= 0 ? "+" : "−") + fmt(summary.income - summary.expenses)}
          </div>
        </div>
      </div>`;
  }

  const balCls = detail.balance >= 0 ? "green" : "red";

  el.innerHTML = `
    <div class="account-hero-header">
      <div class="account-hero-name">${detail.name}</div>
      <span class="account-type-badge ${detail.type}">${TYPE_LABEL[detail.type] ?? detail.type}</span>
    </div>
    <div class="account-hero-balance ${balCls}">${(detail.balance >= 0 ? "" : "−") + fmt(detail.balance)}</div>
    <div class="account-hero-meta">${detail.type === "credit" ? "Saldo a pagar" : "Saldo disponível"}</div>
    ${metaLine}
    ${statsHtml}`;
}

function renderTransactionList(transactions) {
  const container = document.getElementById("transactions-list");
  if (!transactions.length) {
    container.innerHTML = `<div class="tx-empty">Nenhuma transação registrada</div>`;
    return;
  }
  container.innerHTML = transactions.map(t => {
    const amtCls = t.flow === "expense" ? "expense" : "income";
    const sign   = t.flow === "expense" ? "−" : "+";
    const cat    = t.category ? `<div class="tx-cat">${t.category}</div>` : "";
    return `
      <div class="tx-row">
        <div class="tx-date">${fmtDate(t.date)}</div>
        <div class="tx-info">
          <div class="tx-desc">${t.description}</div>
          ${cat}
        </div>
        <div class="tx-amount ${amtCls}">${sign}${fmt(t.amount)}</div>
      </div>`;
  }).join("");
}

// ── Monthly history table ──────────────────────────────────────────────────────

function renderMonthlyHistoryTable(months) {
  const tbody = document.getElementById("monthly-history-body");
  const now   = new Date();
  const curY  = now.getFullYear();
  const curM  = now.getMonth() + 1;

  tbody.innerHTML = months.map(r => {
    const netCls  = r.net >= 0 ? "green" : "red";
    const netSign = r.net >= 0 ? "+" : "−";
    const isCur   = r.year === curY && r.month === curM;
    return `
      <tr class="mh-row${isCur ? " mh-current" : ""}"
          data-year="${r.year}" data-month="${r.month}" tabindex="0">
        <td class="mh-label">${r.label}${isCur ? ' <span class="mh-badge">atual</span>' : ""}</td>
        <td class="num green">${r.income  > 0 ? fmt(r.income)  : "—"}</td>
        <td class="num red">${r.expenses > 0 ? fmt(r.expenses) : "—"}</td>
        <td class="num ${netCls}">${netSign}${fmt(r.net)}</td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll(".mh-row").forEach(row => {
    row.addEventListener("click", () => {
      const y = parseInt(row.dataset.year,  10);
      const m = parseInt(row.dataset.month, 10);
      jumpToMonth(y, m);
    });
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        row.click();
      }
    });
  });
}

function jumpToMonth(year, month) {
  txFilters.year     = year;
  txFilters.month    = month;
  txFilters.category = "";

  const val = `${year}-${String(month).padStart(2, "0")}`;
  const monthSel = document.getElementById("tx-month-select");
  // Add the option if it doesn't exist yet (older months beyond the initial 12)
  if (!monthSel.querySelector(`option[value="${val}"]`)) {
    const PT_MONTHS_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const opt = document.createElement("option");
    opt.value       = val;
    opt.textContent = `${PT_MONTHS_SHORT[month - 1]} ${year}`;
    monthSel.appendChild(opt);
  }
  monthSel.value = val;

  document.getElementById("tx-cat-select").value = "";
  if (state.activeAccount) refreshTransactions();

  document.getElementById("account-transactions").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Investments renderers ──────────────────────────────────────────────────────

function renderInvestmentCards(investments) {
  const total = investments.reduce((s, inv) => s + inv.balance, 0);
  document.getElementById("investments-cards").innerHTML = investments.map(inv => {
    const pct = total > 0 ? ((inv.balance / total) * 100).toFixed(1) : "0.0";
    return `
      <div class="investment-card">
        <div class="investment-card-header">
          <div class="investment-card-name">${inv.name}</div>
          <span class="investment-bank-badge ${inv.bank}">${inv.bank === "nubank" ? "Nubank" : "Inter"}</span>
        </div>
        <div class="investment-card-balance">${fmt(inv.balance)}</div>
        <div class="investment-card-pct">${pct}% do total · ${fmt(total)} em reservas</div>
      </div>`;
  }).join("");
}

// ── Refresh functions ──────────────────────────────────────────────────────────

async function refreshOverview() {
  const bank = state.activeBank;
  const [summary, monthly, categories, faturas] = await Promise.all([
    fetchSummary(bank),
    fetchMonthly(bank),
    fetchCategories(bank),
    fetchFaturas(bank),
  ]);
  renderOverviewCards(summary);
  renderOverviewFaturas(faturas);
  createMonthlyChart(monthly);
  createCategoriesChart(categories);

  document.getElementById("last-updated").textContent =
    new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

async function refreshAccounts() {
  const account = state.activeAccount;

  if (!account) {
    const accounts = await fetchAccounts(null);
    renderAccountsGrid(accounts);
    show("accounts-all-grid");
    hide("account-hero");
    hide("account-charts");
    hide("account-monthly-history");
    hide("account-transactions");
    return;
  }

  const [detail, history] = await Promise.all([
    fetchAccountDetail(account),
    fetchAccountHistory(account),
    refreshTransactions(),
  ]);

  renderAccountHero(detail);
  renderMonthlyHistoryTable(history);

  hide("accounts-all-grid");
  show("account-hero");
  show("account-charts");
  show("account-monthly-history");
  show("account-transactions");

  if (detail.type === "credit") {
    const categories = await fetchCategoriesByAccount(account);
    createCategoriesChart(categories, "chart-account-categories");
    show("chart-panel-categories");
    hide("chart-panel-monthly");
  } else {
    const monthly = await fetchMonthlyByAccount(account);
    createAccountMonthlyChart(monthly);
    show("chart-panel-monthly");
    hide("chart-panel-categories");
  }

  document.getElementById("last-updated").textContent =
    new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

async function refreshInvestments() {
  const investments = await fetchInvestments(null);
  renderInvestmentCards(investments);
  createInvestmentsChart(investments);

  document.getElementById("last-updated").textContent =
    new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── Central dispatcher ─────────────────────────────────────────────────────────

async function refresh() {
  switch (state.activeSection) {
    case "overview":    return refreshOverview();
    case "accounts":    return refreshAccounts();
    case "investments": return refreshInvestments();
  }
}

// ── Debounced refresh (for SSE) ────────────────────────────────────────────────

let _refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(refresh, 300);
}

// ── Navigation init ────────────────────────────────────────────────────────────

function initSectionNav() {
  document.querySelectorAll(".section-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".section-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeSection = btn.dataset.section;
      document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
      document.getElementById(`section-${state.activeSection}`).classList.add("active");
      refresh();
    });
  });
}

function initBankTabs() {
  document.querySelectorAll(".bank-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".bank-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeBank = btn.dataset.bank || null;
      if (state.activeSection === "overview") refresh();
    });
  });
}

function initAccountPills() {
  document.querySelectorAll(".account-pill").forEach(btn => {
    btn.addEventListener("click", () => selectAccount(btn.dataset.account || null));
  });
}

// Programmatic account selection (called from account cards onclick and pills)
function selectAccount(accountId) {
  state.activeAccount = accountId;
  resetTxFilters();
  document.querySelectorAll(".account-pill").forEach(b => {
    b.classList.toggle("active", (b.dataset.account || null) === accountId);
  });
  if (state.activeSection === "accounts") refreshAccounts();
}

// ── SSE ────────────────────────────────────────────────────────────────────────

function initSSE() {
  const dot = document.getElementById("sse-dot");

  function connect() {
    const es = new EventSource("/api/events");

    es.onopen = () => dot.classList.add("live");

    es.onmessage = e => {
      if (e.data === "update") scheduleRefresh();
    };

    es.onerror = () => {
      dot.classList.remove("live");
      es.close();
      setTimeout(connect, 5000);
    };
  }

  connect();
}

// ── Init ───────────────────────────────────────────────────────────────────────

initSectionNav();
initBankTabs();
initAccountPills();
initTxFilters();
initSSE();
refresh();
