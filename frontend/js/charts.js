/**
 * charts.js — Chart.js instance management.
 * Each create* function destroys any existing instance before recreating.
 * All functions accept an optional canvasId to allow reuse in multiple sections.
 */

const GRID_COLOR  = "#2a2d3a";
const MUTED_COLOR = "#7c8494";
const TEXT_COLOR  = "#e2e8f0";

// Register ChartDataLabels plugin globally
if (typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
}

const fmtCurrency = v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const fmtCurrencyAbs = v => "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

const AXIS_DEFAULTS = {
  x: { ticks: { color: MUTED_COLOR }, grid: { color: GRID_COLOR } },
  y: { 
    ticks: { 
      color: MUTED_COLOR,
      callback: function(value) { return fmtCurrency(value); }
    }, 
    grid: { color: GRID_COLOR } 
  },
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
          pointRadius: 4,
          pointBackgroundColor: "#22c55e",
        },
        {
          label: "Gastos",
          data: data.map(d => d.expenses),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.07)",
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: "#ef4444",
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { 
        legend: { labels: { color: MUTED_COLOR, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) { label += ': '; }
              if (context.parsed.y !== null) { label += fmtCurrency(context.parsed.y); }
              return label;
            },
            afterBody: function(tooltipItems) {
              const idx = tooltipItems[0].dataIndex;
              const d = data[idx];
              const net = d.income - d.expenses;
              const sign = net >= 0 ? "+" : "−";
              return `\nSaldo Líquido: ${sign}${fmtCurrencyAbs(net)}`;
            }
          }
        },
        datalabels: {
          color: TEXT_COLOR,
          align: 'top',
          offset: 4,
          font: { size: 10 },
          formatter: function(value) {
            if (value === 0) return '';
            if (value >= 1000) {
              return (value / 1000).toFixed(1).replace('.', ',') + 'k';
            }
            return value;
          }
        }
      },
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
        borderRadius: 8,
      }],
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      layout: {
        padding: { right: 60 } // make room for datalabels
      },
      plugins: { 
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return fmtCurrency(context.parsed.x);
            }
          }
        },
        datalabels: {
          color: TEXT_COLOR,
          anchor: 'end',
          align: 'right',
          font: { size: 11, weight: 'bold' },
          formatter: function(value) {
            return fmtCurrency(value);
          }
        }
      },
      scales: {
        x: { ticks: { color: MUTED_COLOR }, grid: { color: GRID_COLOR } },
        y: { ticks: { color: TEXT_COLOR }, grid: { display: false } },
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
      ctx.fillText(fmtCurrency(total), cx, cy);
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
        backgroundColor: ["#a855f7","#3b82f6","#22c55e", "#f97316", "#eab308"],
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      cutout: "68%",
      maintainAspectRatio: false,
      layout: {
        padding: 20
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: MUTED_COLOR, font: { size: 11 }, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ' ' + fmtCurrency(context.parsed);
            }
          }
        },
        datalabels: {
          color: '#ffffff',
          font: { size: 11, weight: 'bold' },
          formatter: function(value) {
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
            if (pct < 5) return ''; // Hide small percentages
            return pct + '%';
          }
        }
      },
    },
  });
}
