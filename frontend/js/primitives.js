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

const PT_MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const PT_SHORT = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmtCycleDate(ddmmyyyy) {
  if (!ddmmyyyy) return "—";
  const [d, m] = ddmmyyyy.split("/");
  return `${parseInt(d, 10)} ${PT_SHORT[parseInt(m, 10)]}`;
}
function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function yesterdayISO() {
  const t = new Date(); t.setDate(t.getDate() - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/* ── DualLine ───────────────────────────────────────────────────────────── */
function DualLine({ data, height = 180 }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } }, []);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;

    if (chartRef.current) {
      chartRef.current.data.labels = data.map(d => d.label);
      chartRef.current.data.datasets[0].data = data.map(d => d.income || 0);
      chartRef.current.data.datasets[1].data = data.map(d => d.expenses || 0);
      chartRef.current.update('none');
      return;
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const posColor   = rootStyles.getPropertyValue("--pos").trim() || "oklch(72% 0.14 155)";
    const negColor   = rootStyles.getPropertyValue("--neg").trim() || "oklch(68% 0.16 25)";
    const fg2Color   = rootStyles.getPropertyValue("--fg-2").trim();
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
            borderWidth: 1.5, tension: 0.4, fill: true,
            pointRadius: 2.5, pointBackgroundColor: posColor
          },
          {
            label: "Despesa",
            data: data.map(d => d.expenses || 0),
            borderColor: negColor,
            backgroundColor: negColor.replace(')', ' / 0.12)'),
            borderWidth: 1.5, tension: 0.4, fill: true,
            pointRadius: 2.5, pointBackgroundColor: negColor
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtBRL(ctx.raw)}` } }
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
            ticks: { color: fg2Color, font: { size: 9, family: "JetBrains Mono" }, callback: v => fmtBRLCompact(v), maxTicksLimit: 4 }
          }
        }
      }
    });
  }, [data]);

  return React.createElement("div", { style: { height, width: "100%" } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── Donut ──────────────────────────────────────────────────────────────── */
function Donut({ data, size = 140, thickness = 18, valueKey = "balance", colors }) {
  const canvasRef = _useRef(null);
  const chartRef = _useRef(null);

  _useEffect(() => () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } }, []);

  _useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;

    const COLORS = colors || ["oklch(72% 0.12 290)", "oklch(72% 0.13 230)", "oklch(72% 0.14 155)", "oklch(78% 0.13 75)", "oklch(68% 0.16 25)"];

    if (chartRef.current) {
      if (chartRef.current.data.datasets[0].data.length === data.length) {
        chartRef.current.data.labels = data.map(d => d.name || d.label || "Item");
        chartRef.current.data.datasets[0].data = data.map(d => d[valueKey] || 0);
        chartRef.current.update('none');
        return;
      }
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const ctx = canvasRef.current.getContext("2d");
    chartRef.current = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.map(d => d.name || d.label || "Item"),
        datasets: [{ data: data.map(d => d[valueKey] || 0), backgroundColor: COLORS, borderWidth: 0, hoverOffset: 4 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: `${100 - (thickness / size) * 100}%`,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtBRL(ctx.raw)}` } }
        }
      }
    });
  }, [data, colors, thickness, size, valueKey]);

  return React.createElement("div", { style: { width: size, height: size } },
    React.createElement("canvas", { ref: canvasRef })
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────── */
function Modal({ open, onClose, title, children, width = 480 }) {
  const dialogRef = _useRef(null);
  const titleId   = _useRef("modal-title-" + Math.random().toString(36).slice(2)).current;

  _useEffect(() => {
    if (!open || !dialogRef.current) return;
    const prev = document.activeElement;
    const sel  = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const get  = () => Array.from(dialogRef.current.querySelectorAll(sel));
    get()[0]?.focus();
    function trap(e) {
      if (e.key !== "Tab") return;
      const nodes = get();
      if (!nodes.length) { e.preventDefault(); return; }
      const fi = nodes[0], la = nodes[nodes.length - 1];
      if (e.shiftKey) { if (document.activeElement === fi) { e.preventDefault(); la?.focus(); } }
      else            { if (document.activeElement === la) { e.preventDefault(); fi?.focus(); } }
    }
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); prev?.focus(); };
  }, [open]);

  if (!open) return null;
  return React.createElement("div", {
    onClick: onClose, role: "presentation",
    style: { position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }
  },
    React.createElement("div", {
      ref: dialogRef,
      onClick: e => e.stopPropagation(), className: "pane fade-in",
      role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
      style: { width, maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px oklch(0% 0 0 / 0.5)", borderRadius: "var(--r-2)" }
    },
      React.createElement("div", { style: { padding: "14px 18px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between" } },
        React.createElement("div", { id: titleId, style: { fontWeight: 600, fontSize: "var(--fz-5)" } }, title),
        React.createElement("button", { onClick: onClose, className: "btn btn-ghost btn-sm", "aria-label": "Fechar" }, "✕")
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
    role: "status", "aria-live": "polite", "aria-atomic": "false",
    style: { position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 200 }
  },
    list.map(t => {
      const _k = t.kind === "success" ? "pos" : t.kind === "error" ? "neg" : "info";
      return React.createElement("div", {
        key: t.id, className: "toast pane",
        style: {
          background: `var(--${_k}-bg)`,
          border: `1px solid color-mix(in oklch, var(--${_k}) 30%, transparent)`,
          padding: "10px 14px", minWidth: 240, fontSize: "var(--fz-6)",
          boxShadow: "0 4px 16px oklch(0% 0 0 / 0.3)"
        }
      }, t.msg);
    })
  );
  return { push, Toaster };
}

/* ── BankChip ───────────────────────────────────────────────────────────── */
const _BANKCHIP_FALLBACK = { "nu-cc": "Nu Crédito", "nu-db": "Nu Conta", "inter-cc": "Inter Crédito", "inter-db": "Inter Conta" };
function BankChip({ bank, accountId }) {
  const label = accountId
    ? (window.BS.accountNames?.[accountId] || _BANKCHIP_FALLBACK[accountId] || accountId)
    : (bank === "nubank" ? "Nubank" : "Inter");
  const cls = bank || (accountId?.startsWith("nu") ? "nubank" : "inter");
  return React.createElement("span", { className: `chip ${cls}` }, label);
}

/* ── SegmentControl ─────────────────────────────────────────────────────── */
function SegmentControl({ options, value, onChange, columns = 3 }) {
  return React.createElement("div", { className: "seg-control", role: "radiogroup", style: { gridTemplateColumns: `repeat(${columns}, 1fr)` } },
    options.map(opt => React.createElement("button", {
      key: opt.value, type: "button",
      role: "radio", "aria-checked": opt.value === value,
      className: `seg-btn${opt.value === value ? " active" : ""}`,
      onClick: () => onChange(opt.value),
    }, opt.icon && React.createElement("span", null, opt.icon), React.createElement("span", null, opt.label)))
  );
}

/* ── CurrencyInput ──────────────────────────────────────────────────────── */
function CurrencyInput({ value, onChange, autoFocus, large = false, id }) {
  const [raw, setRaw] = _useState(value ? value.toFixed(2).replace(".", ",") : "");
  const ref = _useRef(null);
  _useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  const parse = s => { if (!s) return 0; const n = parseFloat(s.replace(/[^\d,]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
  const fmt   = n => n ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  return React.createElement("div", { style: { position: "relative" } },
    React.createElement("span", { style: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--fg-2)", fontFamily: "var(--ff-mono)", fontSize: large ? 18 : 13 } }, "R$"),
    React.createElement("input", {
      ref, id: id || undefined, type: "text", inputMode: "decimal", value: raw,
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
      style: { height: 32, padding: "4px 8px", fontSize: "var(--fz-7)", flex: 1,
        colorScheme: document.documentElement.dataset.theme === "light" ? "light" : "Dark" }
    })
  );
}

/* ── FieldRow ───────────────────────────────────────────────────────────── */
function FieldRow({ label, hint, id, children }) {
  return React.createElement("div", { className: "field-row" },
    React.createElement("div", { className: "field-label" },
      React.createElement("label", { className: "eyebrow", style: { color: "var(--fg-1)" }, htmlFor: id || undefined }, label),
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
      alt: "",
      width: size, height: size,
      style: { borderRadius: 6, display: "block", flexShrink: 0 }
    }),
    React.createElement("span", { style: { fontWeight: 700, fontSize: 14, letterSpacing: "-0.015em", color: "var(--fg-0)" } },
      "Broker",
      React.createElement("span", { style: { color: "var(--info)" } }, "Shark")
    )
  );
}

/* ── TxRow ──────────────────────────────────────────────────────────────── */
const TxRow = React.memo(({ t, cols, onEditCategory }) => {
  const h = React.createElement;
  const isThirdParty = !!t.is_third_party;
  const rows = [
    h("tr", { 
      key: t.id, 
      onClick: () => onEditCategory && onEditCategory(t),
      style: { cursor: "pointer", opacity: isThirdParty ? 0.6 : 1, filter: isThirdParty ? "grayscale(100%)" : "none" }
    },
      cols.includes("date") && h("td", { className: "mono", style: { color: "var(--fg-3)", fontSize: 10 } }, fmtDateBR(t.date)),
      cols.includes("desc") && h("td", { style: { maxWidth: cols.includes("account") ? 260 : "none" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 6, overflow: "hidden" } },
          h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isThirdParty ? "var(--fg-3)" : "var(--fg-0)", fontWeight: 500, textDecoration: isThirdParty ? "line-through" : "none" } }, t.display_name || t.description),
          isThirdParty && h("span", { title: "Despesa de terceiros: não contabilizada", style: { fontSize: 9, padding: "2px 6px", borderRadius: 4, border: "1px dashed var(--fg-3)", color: "var(--fg-2)", fontWeight: 600, flexShrink: 0 } }, "TERCEIROS")
        )
      ),
      cols.includes("cat") && h("td", null,
        t.flow === "expense"
          ? h("span", { className: "data-tag" }, t.category || "—")
          : h("span", { className: "data-tag", style: { borderColor: "color-mix(in oklch, var(--pos) 30%, transparent)", color: "var(--pos)" } }, t.category || "Receita")
      ),
      cols.includes("account") && h("td", null, h(BankChip, { accountId: t.account_id, bank: t.bank })),
      cols.includes("amount") && h("td", { className: "num" },
        h("div", { style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, width: "100%" } },
          h("span", { style: { color: "var(--fg-3)", fontSize: 10 } }, t.flow === "expense" ? "−" : "+"),
          h("span", { style: { color: t.flow === "expense" ? "var(--fg-0)" : "var(--pos)", fontWeight: 600, textDecoration: isThirdParty ? "line-through" : "none" } },
            fmtBRL(t.amount)
          )
        )
      )
    )
  ];
  return h(React.Fragment, null, ...rows);
}, (prev, next) => 
  prev.t.id === next.t.id && 
  prev.t.category === next.t.category &&
  prev.t.is_third_party === next.t.is_third_party &&
  prev.t.display_name === next.t.display_name
);

window.BS = window.BS || {};
Object.assign(window.BS, {
  fmtBRL, fmtBRLCompact, fmtDateBR, todayISO, yesterdayISO,
  PT_MONTHS, PT_SHORT, fmtCycleDate,
  DualLine, Donut,
  Modal, useToasts, BankChip, SegmentControl, CurrencyInput, DateChooser, FieldRow,
  BrokerSharkLogo, TxRow,
});
