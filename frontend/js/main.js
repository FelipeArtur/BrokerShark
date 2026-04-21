/**
 * main.js — tab switching, SSE real-time connection, render loop.
 */

const PT_MONTHS = ["","Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                   "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const fmt = v =>
  "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

let activeBank = null; // null | "nubank" | "inter"

// ── Tabs ──────────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeBank = btn.dataset.bank || null;
      refresh();
    });
  });
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderSummary(d) {
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

function renderFaturas(data) {
  document.getElementById("faturas-list").innerHTML = data.map(f => {
    const d = f.days_until_due;
    const due = d > 0  ? `vence em ${d} dia${d > 1 ? "s" : ""}`
              : d === 0 ? "vence hoje"
              : `vencida há ${Math.abs(d)} dias`;
    return `
      <div class="fatura-item">
        <div>
          <div class="fatura-name">${f.label}</div>
          <div class="fatura-meta">${f.cycle_start} – ${f.cycle_end}</div>
          <div class="fatura-meta">${due} · ${f.due_date}</div>
        </div>
        <div class="fatura-val">${fmt(f.total)}</div>
      </div>`;
  }).join("");
}

// ── Refresh (debounced) ───────────────────────────────────────────────────────

let _refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(refresh, 300);
}

async function refresh() {
  const bank = activeBank;
  const [summary, monthly, categories, accounts, investments, faturas] =
    await Promise.all([
      fetchSummary(bank),
      fetchMonthly(bank),
      fetchCategories(bank),
      fetchAccounts(bank),
      fetchInvestments(bank),
      fetchFaturas(bank),
    ]);

  renderSummary(summary);
  renderFaturas(faturas);
  createMonthlyChart(monthly);
  createCategoriesChart(categories);
  createAccountsChart(accounts);
  createInvestmentsChart(investments);

  document.getElementById("last-updated").textContent =
    new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── SSE ───────────────────────────────────────────────────────────────────────

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

// ── Init ──────────────────────────────────────────────────────────────────────

initTabs();
initSSE();
refresh();
