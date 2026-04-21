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
    hide("account-transactions");
    return;
  }

  const [detail, transactions] = await Promise.all([
    fetchAccountDetail(account),
    fetchRecentTransactions(account, 20),
  ]);

  renderAccountHero(detail);
  renderTransactionList(transactions);

  hide("accounts-all-grid");
  show("account-hero");
  show("account-charts");
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
    btn.addEventListener("click", () => {
      document.querySelectorAll(".account-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeAccount = btn.dataset.account || null;
      if (state.activeSection === "accounts") refresh();
    });
  });
}

// Programmatic account selection (called from account cards onclick)
function selectAccount(accountId) {
  state.activeAccount = accountId;
  document.querySelectorAll(".account-pill").forEach(b => {
    b.classList.toggle("active", (b.dataset.account || null) === accountId);
  });
  refreshAccounts();
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
initSSE();
refresh();
