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
  if (!data || !data.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1 || 1);
  const points = data.map((v, i) => [i * stepX, height - ((v - min) / range) * (height - 4) - 2]);
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  return React.createElement("svg", { width, height, style: { display: "block", overflow: "visible" } },
    fill && React.createElement("path", { d: fillPath, fill: color, style: { opacity: 0.18 } }),
    React.createElement("path", { d: linePath, stroke: color, strokeWidth, fill: "none", strokeLinejoin: "round", strokeLinecap: "round" })
  );
}

/* ── BarChart ───────────────────────────────────────────────────────────── */
function BarChart({ data, height = 140, valueKey = "value", labelKey = "day", color = "var(--info)" }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data.map(d => d[valueKey])) || 1;
  return React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: 3, height, padding: "4px 0" } },
    data.map((d, i) => {
      const h = Math.max(2, (d[valueKey] / max) * (height - 18));
      return React.createElement("div", { key: i, style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 } },
        React.createElement("div", {
          title: fmtBRL(d[valueKey]),
          style: { width: "100%", height: h, background: color, borderRadius: "2px 2px 0 0", opacity: 0.85 }
        }),
        React.createElement("div", { style: { fontSize: 9, color: "var(--fg-2)", whiteSpace: "nowrap" } }, d[labelKey])
      );
    })
  );
}

/* ── DualLine ───────────────────────────────────────────────────────────── */
function DualLine({ data, height = 180 }) {
  if (!data || !data.length) return null;
  const w = 600, padL = 40, padR = 12, padT = 12, padB = 24;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const max = Math.max(...data.flatMap(d => [d.income || 0, d.expenses || 0])) * 1.1 || 1;
  const stepX = innerW / (data.length - 1 || 1);
  const pts = (key) => data.map((d, i) => [padL + i * stepX, padT + innerH - ((d[key] || 0) / max) * innerH]);
  const path = (points) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const fillPath = (points) => `${path(points)} L ${points[points.length - 1][0]} ${padT + innerH} L ${points[0][0]} ${padT + innerH} Z`;
  const incPts = pts("income"), expPts = pts("expenses");
  const ticks = [0, max / 2, max];
  return React.createElement("svg", { viewBox: `0 0 ${w} ${height}`, style: { width: "100%", height, display: "block" }, preserveAspectRatio: "none" },
    ticks.map((t, i) => {
      const y = padT + innerH - (t / max) * innerH;
      return [
        React.createElement("line", { key: `gl${i}`, x1: padL, x2: w - padR, y1: y, y2: y, stroke: "var(--line-1)", strokeWidth: 1, strokeDasharray: "2 3" }),
        React.createElement("text", { key: `gt${i}`, x: padL - 4, y: y + 3, fontSize: 9, fill: "var(--fg-2)", textAnchor: "end", fontFamily: "var(--ff-mono)" }, fmtBRLCompact(t)),
      ];
    }),
    data.map((d, i) => React.createElement("text", { key: `xl${i}`, x: padL + i * stepX, y: height - 6, fontSize: 10, fill: "var(--fg-2)", textAnchor: "middle", fontFamily: "var(--ff-mono)" }, d.label)),
    React.createElement("path", { d: fillPath(incPts), fill: "var(--pos)", opacity: 0.12 }),
    React.createElement("path", { d: fillPath(expPts), fill: "var(--neg)", opacity: 0.12 }),
    React.createElement("path", { d: path(incPts), fill: "none", stroke: "var(--pos)", strokeWidth: 1.5, strokeLinejoin: "round" }),
    React.createElement("path", { d: path(expPts), fill: "none", stroke: "var(--neg)", strokeWidth: 1.5, strokeLinejoin: "round" }),
    incPts.map((p, i) => React.createElement("circle", { key: `ic${i}`, cx: p[0], cy: p[1], r: 2.5, fill: "var(--pos)" })),
    expPts.map((p, i) => React.createElement("circle", { key: `ec${i}`, cx: p[0], cy: p[1], r: 2.5, fill: "var(--neg)" }))
  );
}

/* ── Donut ──────────────────────────────────────────────────────────────── */
function Donut({ data, size = 140, thickness = 18, valueKey = "balance", colors }) {
  const COLORS = colors || ["oklch(72% 0.12 290)", "oklch(72% 0.13 230)", "oklch(72% 0.14 155)", "oklch(78% 0.13 75)", "oklch(68% 0.16 25)"];
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0);
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return React.createElement("svg", { width: size, height: size, style: { transform: "rotate(-90deg)" } },
    React.createElement("circle", { cx, cy, r, fill: "none", stroke: "var(--bg-2)", strokeWidth: thickness }),
    data.map((d, i) => {
      const len = ((d[valueKey] || 0) / total) * circ;
      const el = React.createElement("circle", {
        key: i, cx, cy, r, fill: "none",
        stroke: COLORS[i % COLORS.length], strokeWidth: thickness,
        strokeDasharray: `${len} ${circ}`, strokeDashoffset: -offset,
      });
      offset += len;
      return el;
    })
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
