/* primitives.js — formatters, hooks, and shared SVG chart components */
/* global React */

const { useState: _useState, useEffect: _useEffect, useCallback: _useCallback, useRef: _useRef } = React;

/* ── Formatters ─────────────────────────────────────────────────────────── */
function fmtBRL(v, opts = {}) {
  const { sign = "auto", decimals = 2 } = opts;
  const n = v ?? 0;
  const s = "R$ " + Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (sign === "always") return (n >= 0 ? "+" : "−") + s;
  if (sign === "neg-only") return n < 0 ? "−" + s : s;
  return n < 0 ? "−" + s : s;
}
function fmtBRLCompact(v) {
  const n = Math.abs(v ?? 0);
  if (n >= 1_000_000) return "R$ " + (n / 1_000_000).toFixed(1).replace(".", ",") + "M";
  if (n >= 1_000)     return "R$ " + (n / 1_000).toFixed(1).replace(".", ",") + "k";
  return "R$ " + n.toFixed(0);
}
function fmtDateBR(iso) {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function yesterdayISO() {
  const t = new Date(); t.setDate(t.getDate() - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/* ── Sparkline ──────────────────────────────────────────────────────────── */
function Sparkline({ data, color = "var(--info)", width = 100, height = 28, fill = true, strokeWidth = 1.5 }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;
    if (chartRef.current) chartRef.current.destroy();
    
    let resolvedColor = color;
    if (color.startsWith("var(")) {
      const match = color.match(/var\(([^)]+)\)/);
      if (match) resolvedColor = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
    }

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.map((_, i) => i),
        datasets: [{
          data: data,
          borderColor: resolvedColor || color,
          borderWidth: strokeWidth,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: fill,
          backgroundColor: fill ? (resolvedColor ? resolvedColor.replace(')', ' / 0.18)') : color) : 'transparent',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: Math.min(...data), max: Math.max(...data) }
        },
        layout: { padding: 0 }
      }
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data, color, fill, strokeWidth]);

  return React.createElement("div", { style: { width, height } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── BarChart ───────────────────────────────────────────────────────────── */
function BarChart({ data, height = 140, valueKey = "value", labelKey = "day", color = "var(--info)" }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;
    if (chartRef.current) chartRef.current.destroy();

    let resolvedColor = color;
    if (color.startsWith("var(")) {
      const match = color.match(/var\(([^)]+)\)/);
      if (match) resolvedColor = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
    }

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => d[labelKey]),
        datasets: [{
          data: data.map(d => d[valueKey]),
          backgroundColor: resolvedColor || color,
          borderRadius: { topLeft: 2, topRight: 2 },
          barPercentage: 0.8,
          categoryPercentage: 0.9
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => fmtBRL(context.raw)
            }
          }
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: { color: getComputedStyle(document.documentElement).getPropertyValue("--fg-2").trim(), font: { size: 9 } }
          },
          y: { display: false, beginAtZero: true }
        }
      }
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data, color, valueKey, labelKey]);

  return React.createElement("div", { style: { height, width: "100%", padding: "4px 0" } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── DualLine ───────────────────────────────────────────────────────────── */
function DualLine({ data, height = 180 }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;
    if (chartRef.current) chartRef.current.destroy();

    const rootStyles = getComputedStyle(document.documentElement);
    const posColor = rootStyles.getPropertyValue("--pos").trim() || "oklch(72% 0.14 155)";
    const negColor = rootStyles.getPropertyValue("--neg").trim() || "oklch(68% 0.16 25)";
    const fg2Color = rootStyles.getPropertyValue("--fg-2").trim();
    const line1Color = rootStyles.getPropertyValue("--line-1").trim();

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: "Receita",
            data: data.map(d => d.income || 0),
            borderColor: posColor,
            backgroundColor: posColor.replace(')', ' / 0.12)'),
            borderWidth: 1.5,
            tension: 0.4,
            fill: true,
            pointRadius: 2.5,
            pointBackgroundColor: posColor
          },
          {
            label: "Despesa",
            data: data.map(d => d.expenses || 0),
            borderColor: negColor,
            backgroundColor: negColor.replace(')', ' / 0.12)'),
            borderWidth: 1.5,
            tension: 0.4,
            fill: true,
            pointRadius: 2.5,
            pointBackgroundColor: negColor
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${fmtBRL(context.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: { color: fg2Color, font: { size: 10, family: "JetBrains Mono" } }
          },
          y: {
            beginAtZero: true,
            grid: { color: line1Color, drawBorder: false, tickLength: 0, borderDash: [2, 3] },
            border: { display: false },
            ticks: {
              color: fg2Color,
              font: { size: 9, family: "JetBrains Mono" },
              callback: (value) => fmtBRLCompact(value),
              maxTicksLimit: 4
            }
          }
        }
      }
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data]);

  return React.createElement("div", { style: { height, width: "100%" } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── Donut ──────────────────────────────────────────────────────────────── */
function Donut({ data, size = 140, thickness = 18, valueKey = "balance", colors }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;
    if (chartRef.current) chartRef.current.destroy();

    const COLORS = colors || ["oklch(72% 0.12 290)", "oklch(72% 0.13 230)", "oklch(72% 0.14 155)", "oklch(78% 0.13 75)", "oklch(68% 0.16 25)"];
    
    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.map(d => d.name || d.label || "Item"),
        datasets: [{
          data: data.map(d => d[valueKey] || 0),
          backgroundColor: COLORS,
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: `${100 - (thickness / size) * 100}%`,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${fmtBRL(context.raw)}`
            }
          }
        }
      }
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data, colors, thickness, size, valueKey]);

  return React.createElement("div", { style: { width: size, height: size } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── Progress ───────────────────────────────────────────────────────────── */
function Progress({ value, max, color = "var(--info)" }) {
  const pct = Math.min(100, ((value || 0) / (max || 1)) * 100);
  const over = value > max;
  return React.createElement("div", { className: "progress-bar" },
    React.createElement("div", { className: "progress-fill", style: { width: `${pct}%`, background: over ? "var(--neg)" : color } })
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────── */
function Modal({ open, onClose, title, children, width = 480 }) {
  if (!open) return null;
  return React.createElement("div", {
    onClick: onClose,
    style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }
  },
    React.createElement("div", {
      onClick: e => e.stopPropagation(), className: "card fade-in",
      style: { width, maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.4)", borderRadius: 12 }
    },
      React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between" } },
        React.createElement("div", { style: { fontWeight: 600, fontSize: "var(--fz-5)" } }, title),
        React.createElement("button", { onClick: onClose, className: "btn btn-ghost btn-sm" }, "✕")
      ),
      React.createElement("div", { style: { padding: 18, overflow: "auto" } }, children)
    )
  );
}

/* ── useToasts ──────────────────────────────────────────────────────────── */
function useToasts() {
  const [list, setList] = _useState([]);
  const push = _useCallback((msg, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setList(l => [...l, { id, msg, kind }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), 3500);
  }, []);
  const Toaster = () => React.createElement("div", {
    style: { position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 200 }
  },
    list.map(t => React.createElement("div", {
      key: t.id, className: "toast card",
      style: { borderLeft: `3px solid ${t.kind === "success" ? "var(--pos)" : t.kind === "error" ? "var(--neg)" : "var(--info)"}`, padding: "10px 14px", minWidth: 240, fontSize: "var(--fz-6)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }
    }, t.msg))
  );
  return { push, Toaster };
}

/* ── BankChip ───────────────────────────────────────────────────────────── */
function BankChip({ bank, accountId }) {
  const label = accountId
    ? ({ "nu-cc": "Nu Crédito", "nu-db": "Nu Conta", "inter-cc": "Inter Crédito", "inter-db": "Inter Conta" }[accountId] || accountId)
    : (bank === "nubank" ? "Nubank" : "Inter");
  const cls = bank || (accountId?.startsWith("nu") ? "nubank" : "inter");
  return React.createElement("span", { className: `chip ${cls}` }, label);
}

/* ── SegmentControl ─────────────────────────────────────────────────────── */
function SegmentControl({ options, value, onChange, columns = 3 }) {
  return React.createElement("div", { className: "seg-control", style: { gridTemplateColumns: `repeat(${columns}, 1fr)` } },
    options.map(opt => React.createElement("button", {
      key: opt.value, type: "button",
      className: `seg-btn${opt.value === value ? " active" : ""}`,
      onClick: () => onChange(opt.value),
    }, opt.icon && React.createElement("span", null, opt.icon), React.createElement("span", null, opt.label)))
  );
}

/* ── CurrencyInput ──────────────────────────────────────────────────────── */
function CurrencyInput({ value, onChange, autoFocus, large = false }) {
  const [raw, setRaw] = _useState(value ? value.toFixed(2).replace(".", ",") : "");
  const ref = _useRef(null);
  _useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  const parse = s => { if (!s) return 0; const n = parseFloat(s.replace(/[^\d,]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
  const fmt   = n => n ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  return React.createElement("div", { style: { position: "relative" } },
    React.createElement("span", { style: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--fg-2)", fontFamily: "var(--ff-mono)", fontSize: large ? 18 : 13 } }, "R$"),
    React.createElement("input", {
      ref, type: "text", inputMode: "decimal", value: raw,
      onChange: e => { setRaw(e.target.value); onChange(parse(e.target.value)); },
      onBlur: () => { const n = parse(raw); setRaw(n ? fmt(n) : ""); },
      placeholder: "0,00", className: "input mono",
      style: { paddingLeft: 36, fontSize: large ? 22 : "var(--fz-5)", fontWeight: 600, height: large ? 48 : 36, letterSpacing: "-0.01em" }
    })
  );
}

/* ── DateChooser ────────────────────────────────────────────────────────── */
function DateChooser({ value, onChange }) {
  const today = todayISO(), yest = yesterdayISO();
  const which = value === today ? "today" : value === yest ? "yest" : "custom";
  return React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
    React.createElement(SegmentControl, {
      columns: 2, value: which,
      onChange: v => { if (v === "today") onChange(today); else if (v === "yest") onChange(yest); },
      options: [{ value: "today", label: "Hoje" }, { value: "yest", label: "Ontem" }],
    }),
    React.createElement("input", {
      type: "date", className: "input", value, onChange: e => onChange(e.target.value),
      style: { height: 32, padding: "4px 8px", fontSize: "var(--fz-7)", flex: 1, colorScheme: "dark" }
    })
  );
}

/* ── FieldRow ───────────────────────────────────────────────────────────── */
function FieldRow({ label, hint, children }) {
  return React.createElement("div", { className: "field-row" },
    React.createElement("div", { className: "field-label" },
      React.createElement("label", { className: "eyebrow", style: { color: "var(--fg-1)" } }, label),
      hint && React.createElement("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, hint)
    ),
    children
  );
}

/* ── BrokerSharkLogo ────────────────────────────────────────────────────── */
function BrokerSharkLogo({ size = 28 }) {
  return React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 8 } },
    React.createElement("img", {
      src: "/static/img/favicon.ico",
      width: size, height: size,
      style: { borderRadius: 6, display: "block", flexShrink: 0 }
    }),
    React.createElement("span", { style: { fontWeight: 700, fontSize: 14, letterSpacing: "-0.015em", color: "var(--fg-0)" } },
      "Broker",
      React.createElement("span", { style: { color: "var(--info)" } }, "Shark")
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, {
  fmtBRL, fmtBRLCompact, fmtDateBR, todayISO, yesterdayISO,
  Sparkline, BarChart, DualLine, Donut, Progress,
  Modal, useToasts, BankChip, SegmentControl, CurrencyInput, DateChooser, FieldRow,
  BrokerSharkLogo,
});
