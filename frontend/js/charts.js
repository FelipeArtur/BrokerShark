/**
 * charts.js — Chart.js instance management.
 * Each create* function destroys any existing instance before recreating.
 */

const GRID_COLOR  = "#2a2d3a";
const MUTED_COLOR = "#7c8494";
const TEXT_COLOR  = "#e2e8f0";

const AXIS_DEFAULTS = {
  x: { ticks: { color: MUTED_COLOR }, grid: { color: GRID_COLOR } },
  y: { ticks: { color: MUTED_COLOR }, grid: { color: GRID_COLOR } },
};

const CAT_COLORS = [
  "#3b82f6","#a855f7","#22c55e","#ef4444","#eab308",
  "#06b6d4","#f97316","#ec4899","#84cc16","#64748b",
];

const _charts = {};

function _destroy(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function createMonthlyChart(data) {
  _destroy("monthly");
  _charts["monthly"] = new Chart(document.getElementById("chart-monthly"), {
    type: "line",
    data: {
      labels: data.map(d => d.label),
      datasets: [
        {
          label: "Receitas",
          data: data.map(d => d.income),
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,0.07)",
          tension: 0.35,
          fill: true,
          pointRadius: 3,
        },
        {
          label: "Gastos",
          data: data.map(d => d.expenses),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.07)",
          tension: 0.35,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: MUTED_COLOR, font: { size: 12 } } } },
      scales: AXIS_DEFAULTS,
    },
  });
}

function createCategoriesChart(data) {
  _destroy("categories");
  if (!data.length) return;
  _charts["categories"] = new Chart(document.getElementById("chart-categories"), {
    type: "bar",
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        label: "Gasto",
        data: data.map(d => d.total),
        backgroundColor: CAT_COLORS,
        borderRadius: 5,
      }],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: MUTED_COLOR }, grid: { color: GRID_COLOR } },
        y: { ticks: { color: TEXT_COLOR }, grid: { display: false } },
      },
    },
  });
}

function createAccountsChart(data) {
  _destroy("accounts");
  _charts["accounts"] = new Chart(document.getElementById("chart-accounts"), {
    type: "bar",
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        label: "Saldo",
        data: data.map(d => d.balance),
        backgroundColor: data.map(d => d.balance >= 0 ? "#3b82f6" : "#ef4444"),
        borderRadius: 5,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: MUTED_COLOR }, grid: { display: false } },
        y: { ticks: { color: MUTED_COLOR }, grid: { color: GRID_COLOR } },
      },
    },
  });
}

function createInvestmentsChart(data) {
  _destroy("investments");
  if (!data.length) return;
  _charts["investments"] = new Chart(document.getElementById("chart-investments"), {
    type: "doughnut",
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        data: data.map(d => d.balance),
        backgroundColor: ["#a855f7","#3b82f6","#22c55e"],
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      cutout: "68%",
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: MUTED_COLOR, font: { size: 11 }, padding: 10 },
        },
      },
    },
  });
}
