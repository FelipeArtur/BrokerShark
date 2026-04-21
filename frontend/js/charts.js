/**
 * charts.js — Chart.js instance management.
 * Each create* function destroys any existing instance before recreating.
 * All functions accept an optional canvasId to allow reuse in multiple sections.
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

function createMonthlyChart(data, canvasId = "chart-monthly") {
  const key = canvasId;
  _destroy(key);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  _charts[key] = new Chart(canvas, {
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

function createCategoriesChart(data, canvasId = "chart-categories") {
  const key = canvasId;
  _destroy(key);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;
  _charts[key] = new Chart(canvas, {
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

function createAccountsChart(data, canvasId = "chart-accounts") {
  const key = canvasId;
  _destroy(key);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;

  const BANK_LABEL   = { nubank: "Nubank", inter: "Inter" };
  const METHOD_LABEL = { credit: "Crédito", pix: "PIX", ted: "TED" };
  const METHOD_COLOR = { credit: "#3b82f6", pix: "#a855f7", ted: "#22c55e" };

  const labels = data.map(d => `${BANK_LABEL[d.bank] ?? d.bank} ${METHOD_LABEL[d.method] ?? d.method}`);
  const values = data.map(d => d.total);
  const colors = data.map(d => METHOD_COLOR[d.method] ?? "#64748b");

  _charts[key] = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Gastos",
        data: values,
        backgroundColor: colors,
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

function createInvestmentsChart(data, canvasId = "chart-investments") {
  const key = canvasId;
  _destroy(key);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;

  const total = data.reduce((s, d) => s + d.balance, 0);
  const fmt   = v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

  const centerTextPlugin = {
    id: "centerText",
    beforeDraw(chart) {
      const { width, height, ctx } = chart;
      ctx.save();
      ctx.font        = `700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillStyle   = TEXT_COLOR;
      ctx.textAlign   = "center";
      ctx.textBaseline = "middle";
      const cx = width  / 2;
      const cy = height / 2 + (chart.legend?.height ? chart.legend.height / 2 : 10);
      ctx.fillText(fmt(total), cx, cy);
      ctx.restore();
    },
  };

  _charts[key] = new Chart(canvas, {
    type: "doughnut",
    plugins: [centerTextPlugin],
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

function createAccountMonthlyChart(data, canvasId = "chart-account-monthly") {
  createMonthlyChart(data, canvasId);
}
