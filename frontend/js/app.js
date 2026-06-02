/* app.js — BrokerShark v2 app shell */
/* global React, ReactDOM, fetchExpenseCategories, patchTransactionCategory, patchTransaction,
          postTransaction, postIncome, postInvestmentMovement, searchTransactions,
          fetchExpenseCategoriesFull, postCategory, deleteCategory, deleteTransaction,
          fetchAccounts, importPreview, importConfirm, importB3 */

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  fmtBRL, fmtDateBR, Modal, useToasts, BankChip, BrokerSharkLogo,
  PT_SHORT,
  OverviewView, HistoryView, InvestmentsView,
  CategoriesPanel,
} = window.BS;

function _currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/* ── SVG icons ──────────────────────────────────────────────────────────── */
function IconSearch({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round",
    style: { display: "block", flexShrink: 0 }
  },
    React.createElement("circle", { cx: 6.5, cy: 6.5, r: 4 }),
    React.createElement("path", { d: "M10 10 L14 14" })
  );
}

function IconSettings({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round",
    style: { display: "block", flexShrink: 0 }
  },
    React.createElement("line", { x1: 2, y1: 5, x2: 14, y2: 5 }),
    React.createElement("circle", { cx: 9.5, cy: 5, r: 1.7, fill: "currentColor", stroke: "none" }),
    React.createElement("line", { x1: 2, y1: 11, x2: 14, y2: 11 }),
    React.createElement("circle", { cx: 5.5, cy: 11, r: 1.7, fill: "currentColor", stroke: "none" })
  );
}

/* ── Tweaks (localStorage) ──────────────────────────────────────────────── */
const TWEAK_DEFAULTS = { theme: "Dark" };
function useTweaks() {
  const stored = JSON.parse(localStorage.getItem("bs_tweaks") || "{}");
  const [tw, setTwState] = useState({ ...TWEAK_DEFAULTS, ...stored });
  const setTw = useCallback((key, val) => {
    setTwState(prev => {
      const next = { ...prev, [key]: val };
      localStorage.setItem("bs_tweaks", JSON.stringify(next));
      return next;
    });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme   = tw.theme;
    document.documentElement.dataset.density = "comfortable";  // fixo — densidade não é editável
  }, [tw.theme]);
  return [tw, setTw];
}

/* ── Transaction panel (micro-profile modal) ────────────────────────────── */
function CategoryEditor({ tx, onClose, onSave }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(tx?.category_id || null);
  const [displayName, setDisplayName] = useState(tx?.display_name || "");
  const [isThirdParty, setIsThirdParty] = useState(!!(tx?.is_third_party));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (tx) {
      fetchExpenseCategories().then(cats => {
        setCats(cats);
      });
      setSelected(tx.category_id);
      setDisplayName(tx.display_name || "");
      setIsThirdParty(!!(tx.is_third_party));
      setErr(null);
    }
  }, [tx]);

  async function handleToggleThirdParty() {
    const next = !isThirdParty;
    setIsThirdParty(next);
    if (next && !selected) {
      const evtCat = cats.find(c => c.name === "Eventos / Terceiros");
      if (evtCat) setSelected(evtCat.id);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const fields = {};
      if (selected !== tx.category_id) fields.category_id = selected;
      const trimmed = displayName.trim() || null;
      if (trimmed !== (tx.display_name || null)) fields.display_name = trimmed;
      const thirdPartyVal = isThirdParty ? 1 : 0;
      if (thirdPartyVal !== (tx.is_third_party || 0)) fields.is_third_party = thirdPartyVal;
      if (Object.keys(fields).length > 0) {
        await patchTransaction(tx.id, fields);
      }
      const catName = cats.find(c => c.id === selected)?.name || tx.category || "";
      onSave({ ...fields, category: catName });
    }
    catch (e) { setErr(e.message || "Erro ao salvar."); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!confirm("Excluir esta transação permanentemente?")) return;
    setDeleting(true);
    try {
      await deleteTransaction(tx.id);
      onSave({ deleted: true });
    }
    catch (e) { setErr(e.message || "Erro ao excluir."); }
    finally { setDeleting(false); }
  }

  const METHOD_LABELS = { pix: "PIX", pix_received: "PIX", credit: "Crédito", ted: "TED", transfer: "Transfer.", other: "Outro" };
  const methodLabel = tx ? (METHOD_LABELS[tx.method] || tx.method || "") : "";
  const flowIsExpense = tx?.flow === "expense";

  return h(Modal, { open: !!tx, onClose, title: "Transação", width: 480 },
    tx && h("div", { style: { display: "flex", flexDirection: "column" } },
      h("div", { style: { background: "var(--bg-1)", padding: "12px 16px", borderBottom: "1px solid var(--line-1)" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 } },
          h("div", { style: { fontSize: 9, color: "var(--fg-3)", fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: "0.05em" } }, flowIsExpense ? "Comprovante de Despesa" : "Comprovante de Receita"),
          h("div", { style: { fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--ff-mono)" } }, fmtDateBR(tx.date))
        ),
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
          h("div", { style: { fontSize: 14, fontWeight: 500, color: "var(--fg-1)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 16 } },
            displayName || tx.description
          ),
          h("span", { className: "num", style: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em", color: flowIsExpense ? "var(--fg-0)" : "var(--pos)", lineHeight: 1 } },
            (flowIsExpense ? "−" : "+") + fmtBRL(tx.amount)
          )
        )
      ),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 16, padding: "16px 20px" } },

        h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h("label", { style: { fontSize: 10, color: "var(--fg-2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" } }, "Nome fantasia"),
          h("input", {
            className: "input", type: "text",
            placeholder: tx.description?.slice(0, 50) || "Nome amigável…",
            value: displayName,
            onChange: e => setDisplayName(e.target.value),
            style: { fontSize: 13, background: "var(--bg-2)", border: "1px solid var(--line-2)", padding: "8px 10px" }
          })
        ),

        flowIsExpense && h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          h("div", { style: { fontSize: 10, color: "var(--fg-2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" } }, "Categoria"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 } },
            cats.map(c => h("button", {
              key: c.id, type: "button",
              onClick: () => setSelected(c.id),
              "aria-pressed": selected === c.id,
              style: {
                padding: "6px 8px", borderRadius: 4, textAlign: "center",
                fontSize: 11, fontWeight: selected === c.id ? 600 : 500,
                background: selected === c.id ? "var(--info-bg)" : "var(--bg-1)",
                border: selected === c.id ? "1px solid var(--info)" : "1px solid var(--line-1)",
                color: selected === c.id ? "var(--fg-0)" : "var(--fg-1)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
              }
            }, c.name))
          )
        ),

        h("button", {
          type: "button",
          onClick: handleToggleThirdParty,
          style: {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", borderRadius: 4, textAlign: "left",
            background: isThirdParty ? "var(--warn-bg, rgba(255,160,0,0.12))" : "var(--bg-1)",
            border: isThirdParty ? "1px solid var(--warn, #fa0)" : "1px solid var(--line-1)",
            color: isThirdParty ? "var(--warn, #fa0)" : "var(--fg-2)",
            fontSize: 11, fontWeight: isThirdParty ? 600 : 500, cursor: "pointer",
          }
        },
          h("span", {}, isThirdParty ? "Excluído dos meus gastos (Terceiros)" : "Não é meu — excluir dos meus gastos"),
          h("span", { style: { fontSize: 12 } }, isThirdParty ? "🔒" : "🔓")
        ),

        err && h("div", { style: { fontSize: 11, color: "var(--neg)", padding: "2px 0" } }, err),

        h("div", { style: { display: "flex", gap: 8, justifyContent: "space-between", marginTop: 4, paddingTop: 16, borderTop: "1px solid var(--line-1)" } },
          h("button", {
            className: "btn btn-ghost btn-sm",
            onClick: handleDelete, disabled: deleting,
            style: { color: "var(--neg)", fontSize: 12, padding: "0 8px" }
          }, deleting ? "Excluindo…" : "Excluir lançamento"),
          h("div", { style: { display: "flex", gap: 8 } },
            h("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "Cancelar"),
            h("button", { className: "btn btn-primary btn-sm", onClick: save, disabled: saving, style: { minWidth: 80, fontSize: 12 } },
              saving ? "Salvando…" : "Salvar")
          )
        )
      )
    )
  );
}

/* ── TweaksPanel ────────────────────────────────────────────────────────── */
function TweaksPanel({ tw, setTw, onClose, onOpenCategories }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const Row = ({ label, children }) => h("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line-1)" }
  },
    h("span", { style: { fontSize: "var(--fz-7)", color: "var(--fg-1)" } }, label), children);

  const Radio = ({ options, value, onChange }) => h("div", { style: { display: "flex", gap: 4 } },
    options.map(o => h("button", {
      key: o, type: "button", onClick: () => onChange(o),
      style: {
        padding: "3px 9px", fontSize: 11, borderRadius: 4,
        border: o === value ? "1px solid var(--info)" : "1px solid var(--line-1)",
        background: o === value ? "var(--info-bg)" : "var(--bg-2)",
        color: o === value ? "var(--info)" : "var(--fg-1)"
      }
    }, o))
  );

  return h("div", { className: "tweaks-panel", role: "dialog", "aria-label": "Configurações" },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
      h("span", { style: { fontWeight: 700, fontSize: "var(--fz-5)" } }, "Configurações"),
      h("button", { className: "btn btn-ghost btn-sm", "aria-label": "Fechar", onClick: onClose }, "✕")
    ),

    h(Row, { label: "Tema" },
      h(Radio, { options: ["Dark", "Light"], value: tw.theme, onChange: v => setTw("theme", v) })
    ),

    h("div", { style: { marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 } },
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => { onOpenCategories(); onClose(); },
        style: { justifyContent: "center", fontSize: 12, color: "var(--fg-1)", height: 34 }
      },
        h("span", { style: { fontSize: 14, marginRight: 4 } }, "⊞"),
        "Categorias"
      ),
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => { localStorage.removeItem("bs_tweaks"); location.reload(); },
        style: { justifyContent: "center", fontSize: 12, color: "var(--fg-3)", height: 34 }
      },
        h("span", { style: { fontSize: 14, marginRight: 4 } }, "↺"),
        "Restaurar"
      )
    )
  );
}

/* ── SearchModal ─────────────────────────────────────────────────────────── */
function SearchModal({ onClose, onSelect }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setActiveIdx(0); return; }
    debounceRef.current = setTimeout(() => {
      searchTransactions(query).then(r => { setResults(r); setActiveIdx(0); });
    }, 300);
  }, [query]);

  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && results[activeIdx]) { onSelect(results[activeIdx]); onClose(); return; }
    if (e.key === "Tab" && panelRef.current) {
      const sel = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
      const nodes = Array.from(panelRef.current.querySelectorAll(sel));
      if (!nodes.length) { e.preventDefault(); return; }
      const fi = nodes[0], la = nodes[nodes.length - 1];
      if (e.shiftKey) { if (document.activeElement === fi) { e.preventDefault(); la.focus(); } }
      else            { if (document.activeElement === la) { e.preventDefault(); fi.focus(); } }
    }
  }

  const LABEL = { expense: "−", income: "+" };
  const COLOR = { expense: "var(--neg)", income: "var(--pos)" };

  return h("div", {
    onClick: onClose,
    style: { position: "fixed", inset: 0, zIndex: 100, background: "oklch(0% 0 0 / 0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "10vh" }
  },
    h("div", {
      ref: panelRef,
      role: "dialog", "aria-modal": "true", "aria-label": "Buscar transações",
      onClick: e => e.stopPropagation(),
      style: { width: 520, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", boxShadow: "0 8px 32px oklch(0% 0 0 / 0.5)", overflow: "hidden" }
    },
      h("div", {
        "aria-live": "polite", "aria-atomic": "true",
        style: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }
      }, query.length >= 2 ? `${results.length} resultado${results.length !== 1 ? "s" : ""}` : ""),
      h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--line-1)" } },
        h("span", { style: { color: "var(--fg-3)", display: "flex", alignItems: "center", flexShrink: 0 } },
          h(IconSearch, { size: 18 })
        ),
        h("input", {
          ref: inputRef,
          value: query, onChange: e => setQuery(e.target.value),
          onKeyDown: onKey,
          placeholder: "Buscar transações…",
          style: { flex: 1, background: "none", border: "none", outline: "none", fontSize: 14, color: "var(--fg-0)" }
        })
      ),
      results.length > 0 && h("div", { style: { maxHeight: 360, overflowY: "auto" } },
        h("div", { style: { padding: "4px 14px", fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, background: "var(--bg-2)" } },
          results.length, " resultado", results.length !== 1 ? "s" : ""
        ),
        results.map((t, i) => h("button", {
          key: t.id,
          onClick: () => { onSelect(t); onClose(); },
          onMouseEnter: () => setActiveIdx(i),
          style: {
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
            width: "100%", padding: "10px 14px", borderBottom: "1px solid var(--line-1)",
            background: i === activeIdx ? "var(--bg-2)" : "transparent",
          }
        },
          h("div", { style: { minWidth: 0, flex: 1, textAlign: "left" } },
            h("div", { style: { fontSize: 13, color: "var(--fg-0)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.description),
            h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2, fontFamily: "var(--ff-mono)" } },
              fmtDateBR(t.date), " · ", t.category || "—"
            )
          ),
          h("span", { style: { color: COLOR[t.flow] || "var(--fg-1)", fontSize: 13, fontWeight: 700, fontFamily: "var(--ff-mono)", flexShrink: 0 } },
            LABEL[t.flow] || "", fmtBRL(t.amount, { decimals: 0 }))
        ))
      ),
      query.length >= 2 && results.length === 0 && h("div", {
        style: { padding: "24px 14px", textAlign: "center", color: "var(--fg-3)", fontSize: 13 }
      }, `Nenhum resultado para "${query}"`),
      h("div", { style: { padding: "6px 14px", borderTop: "1px solid var(--line-1)", fontSize: 10, color: "var(--fg-3)", display: "flex", gap: 14 } },
        h("span", null, "↑↓ navegar"),
        h("span", null, "Enter selecionar"),
        h("span", null, "Esc fechar")
      )
    )
  );
}

/* ── Main App ────────────────────────────────────────────────────────────── */
function IconImport({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
  },
    React.createElement("path", { d: "M8 2 L8 10" }),
    React.createElement("path", { d: "M5 7 L8 10 L11 7" }),
    React.createElement("path", { d: "M3 12 L13 12" })
  );
}

/* ── ImportModal — upload bank/broker export, review preview, confirm ─────── */
function ImportModal({ onClose, onDone }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const names = (window.BS && window.BS.accountNames) || {};
  const ACCOUNTS = [
    { id: "nu-db",    label: names["nu-db"]    || "Nubank Conta",   hint: "Extrato (CSV)" },
    { id: "inter-db", label: names["inter-db"] || "Inter Conta",    hint: "Extrato (CSV)" },
    { id: "inter-cc", label: names["inter-cc"] || "Inter Crédito",  hint: "Fatura (CSV)" },
    { id: "b3",       label: "Relatório B3",                        hint: "Posições (XLSX)" },
  ];

  const [account, setAccount]   = useState("nu-db");
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState(null);
  const [b3Preview, setB3Preview] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);

  async function analyze() {
    if (!file) { setErr("Escolha um arquivo."); return; }
    setBusy(true); setErr(null);
    try {
      if (account === "b3") {
        const res = await importB3(file);          // preview only — nothing written
        setB3Preview(res);
      } else {
        const res = await importPreview(file, account);
        setPreview(res);
        setExcluded(new Set());
      }
    } catch (e) { setErr(e.message || "Falha ao analisar."); }
    finally { setBusy(false); }
  }

  function toggle(id) {
    setExcluded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      if (b3Preview) {
        const res = await importB3(file, { confirm: true });
        onDone({ inserted: res.total || 0, created: res.created || 0, updated: res.updated || 0, kind: "b3" });
        return;
      }
      const res = await importConfirm(preview.batch_id, [...excluded]);
      onDone(res);
    } catch (e) { setErr(e.message || "Falha ao confirmar."); setBusy(false); }
  }

  const willImport = preview ? (preview.counts.new - excluded.size) : 0;

  const STATUS_META = {
    new:       { label: "nova",      color: "var(--pos)" },
    duplicate: { label: "já existe", color: "var(--fg-3)" },
    skipped:   { label: "ignorada",  color: "var(--reserve)" },
  };

  function Chip({ n, meta }) {
    return h("span", { style: {
      fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
      background: "color-mix(in oklch, " + meta.color + " 16%, transparent)", color: meta.color,
    } }, `${n} ${meta.label}${n === 1 ? "" : "s"}`);
  }

  // ── Step 1: choose account + file
  const step1 = h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
    h("p", { style: { fontSize: 13, color: "var(--fg-2)", margin: 0 } },
      "Suba o extrato ou fatura exportado do banco. Nada é gravado até você revisar e confirmar."),
    h("div", null,
      h("label", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.05em" } }, "Conta de destino"),
      h("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 6 } },
        ACCOUNTS.map(a => h("button", {
          key: a.id, onClick: () => setAccount(a.id),
          "aria-pressed": account === a.id,
          style: {
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "9px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left",
            background: account === a.id ? "color-mix(in oklch, var(--info) 14%, transparent)" : "transparent",
            border: `1px solid ${account === a.id ? "var(--info)" : "var(--line-1)"}`,
            color: "var(--fg-1)",
          },
        },
          h("span", { style: { fontWeight: 600, fontSize: 13 } }, a.label),
          h("span", { style: { fontSize: 11, color: "var(--fg-3)" } }, a.hint)
        ))
      )
    ),
    h("div", null,
      h("label", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.05em" } }, "Arquivo"),
      h("input", {
        type: "file", accept: account === "b3" ? ".xlsx" : ".csv,text/csv", style: { display: "block", marginTop: 6, fontSize: 13 },
        onChange: e => { setFile(e.target.files[0] || null); setErr(null); },
      })
    ),
    err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),
    h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
      h("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"),
      h("button", { className: "btn btn-primary", disabled: busy || !file, onClick: analyze },
        busy ? "Analisando…" : "Analisar")
    )
  );

  // ── Step 2: preview + confirm
  const nothingNew = preview && preview.counts.new === 0;
  const thStyle = (w) => ({
    padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 600,
    color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em",
    borderBottom: "1px solid var(--line-1)", ...(w ? { width: w } : {}),
  });

  const summaryChips = preview && h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
    h(Chip, { n: preview.counts.new,       meta: STATUS_META.new }),
    h(Chip, { n: preview.counts.duplicate, meta: STATUS_META.duplicate }),
    h(Chip, { n: preview.counts.skipped,   meta: STATUS_META.skipped })
  );

  // Empty state: re-uploading an already-imported file (the common monthly case).
  const emptyState = preview && h("div", {
    style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "28px 12px", textAlign: "center" }
  },
    h("div", { style: { fontSize: 28, color: "var(--pos)", lineHeight: 1 } }, "✓"),
    h("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--fg-1)" } }, "Tudo deste arquivo já está importado"),
    h("div", { style: { fontSize: 12, color: "var(--fg-3)" } },
      `Nada novo. ${preview.counts.duplicate} já existem · ${preview.counts.skipped} ignoradas`),
    h("button", { className: "btn btn-primary", style: { marginTop: 6 }, onClick: onClose }, "Fechar")
  );

  const reviewBody = preview && h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
    summaryChips,
    h("div", { style: { fontSize: 12, color: "var(--fg-2)" } },
      "Revise abaixo — desmarque o que não quiser importar."),
    h("div", { style: { maxHeight: "44vh", overflow: "auto", border: "1px solid var(--line-1)", borderRadius: 8 } },
      h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
        h("thead", null,
          h("tr", { style: { position: "sticky", top: 0, background: "var(--bg-2)", zIndex: 1 } },
            h("th", { style: thStyle(28) }, ""),
            h("th", { style: thStyle() }, "Data"),
            h("th", { style: thStyle() }, "Descrição"),
            h("th", { style: { ...thStyle(), textAlign: "right" } }, "Valor")
          )
        ),
        h("tbody", null,
          preview.rows.map(r => {
            const meta = STATUS_META[r.status] || STATUS_META.skipped;
            const isNew = r.status === "new";
            const checked = isNew && !excluded.has(r.id);
            const sign = r.flow === "expense" ? "−" : "+";
            return h("tr", { key: r.id, style: { borderTop: "1px solid var(--line-1)", opacity: isNew ? 1 : 0.55 } },
              h("td", { style: { padding: "6px 8px", width: 28 } },
                isNew
                  ? h("input", { type: "checkbox", checked, "aria-label": `Importar ${r.description}`, onChange: () => toggle(r.id) })
                  : h("span", { title: meta.label, style: { color: meta.color } }, "•")
              ),
              h("td", { style: { padding: "6px 8px", whiteSpace: "nowrap", color: "var(--fg-3)" } }, r.date),
              h("td", { style: { padding: "6px 8px", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                r.description,
                r.method === "transfer" && h("span", {
                  title: "não conta como gasto nem receita",
                  style: { marginLeft: 6, fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: "var(--reserve-bg)", color: "var(--reserve)", whiteSpace: "nowrap" }
                }, "transferência"),
                r.note && r.status === "skipped" && h("span", { style: { marginLeft: 6, fontSize: 10, color: "var(--fg-3)" } }, r.note)
              ),
              h("td", { style: { padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: r.flow === "expense" ? "var(--neg)" : "var(--pos)" } },
                `${sign} ${fmtBRL(r.amount)}`)
            );
          })
        )
      )
    ),
    err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
      h("button", { className: "btn btn-ghost", onClick: () => { setPreview(null); setErr(null); } }, "‹ Voltar"),
      h("button", { className: "btn btn-primary", disabled: busy || willImport <= 0, onClick: confirm },
        busy ? "Importando…" : `Importar ${willImport} ${willImport === 1 ? "lançamento" : "lançamentos"}`)
    )
  );

  // ── Step 2 (B3): review parsed investment positions before upsert
  const B3_TYPE_LABEL = { savings: "Poupança", treasury: "Tesouro Direto", cdb: "CDB / Renda fixa", lci: "LCI / Renda fixa", lca: "LCA / Renda fixa" };
  const b3Total = b3Preview ? b3Preview.total : 0;
  const b3Body = b3Preview && h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
    h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
      h(Chip, { n: b3Preview.created, meta: STATUS_META.new }),
      h(Chip, { n: b3Preview.updated, meta: { label: "atualiza", color: "var(--info)" } })
    ),
    b3Total === 0
      ? h("div", { style: { padding: "20px 0", textAlign: "center", color: "var(--fg-3)", fontSize: 13 } }, "Nenhuma posição encontrada no relatório.")
      : h("div", { style: { fontSize: 12, color: "var(--fg-2)" } },
          "Cada posição vira/atualiza um investimento (saldo = valor atual). Nenhum lançamento de extrato é tocado."),
    b3Total > 0 && h("div", { style: { maxHeight: "44vh", overflow: "auto", border: "1px solid var(--line-1)", borderRadius: 8 } },
      h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
        h("thead", null,
          h("tr", { style: { position: "sticky", top: 0, background: "var(--bg-2)", zIndex: 1 } },
            h("th", { style: thStyle() }, "Posição"),
            h("th", { style: thStyle() }, "Tipo"),
            h("th", { style: { ...thStyle(), textAlign: "right" } }, "Valor")
          )
        ),
        h("tbody", null,
          b3Preview.positions.map((p, i) => h("tr", { key: i, style: { borderTop: "1px solid var(--line-1)" } },
            h("td", { style: { padding: "6px 8px" } },
              h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                h("span", { style: { maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p.name),
                p.status === "new"
                  ? h("span", { style: { fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: "color-mix(in oklch, var(--pos) 16%, transparent)", color: "var(--pos)" } }, "nova")
                  : h("span", { style: { fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: "color-mix(in oklch, var(--info) 16%, transparent)", color: "var(--info)" } }, "atualiza")
              ),
              h(BankChip, { bank: p.bank })
            ),
            h("td", { style: { padding: "6px 8px", color: "var(--fg-3)", whiteSpace: "nowrap" } }, B3_TYPE_LABEL[p.type] || p.type),
            h("td", { style: { padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 600 } }, fmtBRL(p.balance))
          ))
        )
      )
    ),
    err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
      h("button", { className: "btn btn-ghost", onClick: () => { setB3Preview(null); setErr(null); } }, "‹ Voltar"),
      h("button", { className: "btn btn-primary", disabled: busy || b3Total <= 0, onClick: confirm },
        busy ? "Importando…" : `Importar ${b3Total} ${b3Total === 1 ? "posição" : "posições"}`)
    )
  );

  const step2 = preview ? (nothingNew ? emptyState : reviewBody) : b3Body;

  return h(Modal, { open: true, onClose, title: "Importar extrato / fatura", width: 620 },
    (preview || b3Preview) ? step2 : step1);
}

function App() {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [tw, setTw] = useTweaks();
  const [section, setSection] = useState("money");
  const [entryKind, setEntryKind] = useState("expense");
  const [editTx, setEditTx] = useState(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [historyAccount, setHistoryAccount] = useState(null); // drill-down: filter Histórico by account
  const { push, Toaster } = useToasts();

  // Dinheiro is always "now"; the period selector lives inside Histórico.
  const currentMonth = _currentMonth();

  // Boot: populate account names for data-driven BankChip
  useEffect(() => {
    fetchAccounts().then(accs => {
      window.BS.accountNames = Object.fromEntries(accs.map(a => [a.id, a.name]));
    }).catch(() => {});
  }, []);

  // SSE
  useEffect(() => {
    let es, debounce;
    function connect() {
      es = new EventSource("/api/events");
      es.onmessage = e => {
        if (e.data === "connected") return;
        if (e.data === "update") {
          clearTimeout(debounce);
          debounce = setTimeout(() => setRefreshKey(k => k + 1), 300);
        }
      };
      es.onerror = () => setTimeout(connect, 5000);
    }
    connect();
    return () => { clearTimeout(debounce); es?.close(); };
  }, []);

  // Keyboard shortcuts (functional, no visual hints shown)
  useEffect(() => {
    const SECTION_MAP = { "1": "money", "2": "history", "3": "investments" };
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "Escape") { setSearchModalOpen(false); setTweaksOpen(false); }
      if (e.key === "/") { e.preventDefault(); setSearchModalOpen(true); }
      if (SECTION_MAP[e.key]) setSection(SECTION_MAP[e.key]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleDeleteTx(id) {
    try {
      await deleteTransaction(id);
      setRefreshKey(k => k + 1);
    } catch (e) {
      push(e.message || "Erro ao excluir lançamento.", "error");
    }
  }

  const SECTIONS = [
    { id: "money",       label: "Visão do Mês"  },
    { id: "history",     label: "Histórico" },
    { id: "investments", label: "Investimentos" },
  ];

  return h("div", { id: "app", style: { height: "100vh", display: "flex", flexDirection: "column" } },

    // ── Topbar
    h("header", { className: "app-topbar" },
      h(BrokerSharkLogo, { size: 26 }),
      h("div", { style: { width: 1, height: 20, background: "var(--line-1)", margin: "0 6px" } }),

      // Nav
      h("nav", { style: { display: "flex", gap: 2 } },
        SECTIONS.map(s => h("button", {
          key: s.id, className: `nav-btn${section === s.id ? " active" : ""}`,
          onClick: () => setSection(s.id),
          "aria-current": section === s.id ? "page" : undefined,
        }, s.label))
      ),

      h("div", { style: { flex: 1 } }),

      // Import button
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => setImportOpen(true),
        title: "Importar extrato ou fatura (CSV)",
        style: { display: "flex", alignItems: "center", gap: 6, padding: "0 10px", height: 30 }
      },
        h(IconImport, { size: 17 }),
        h("span", { style: { fontSize: 12 } }, "Importar")
      ),

      // Search button
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => setSearchModalOpen(true),
        title: "Buscar transações (/)",
        style: { display: "flex", alignItems: "center", gap: 6, padding: "0 10px", height: 30 }
      },
        h(IconSearch, { size: 17 }),
        h("span", { style: { fontSize: 12 } }, "Buscar")
      ),

      // Settings
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => setTweaksOpen(o => !o),
        title: "Configurações",
        style: { display: "flex", alignItems: "center", padding: "0 10px", height: 30 }
      },
        h(IconSettings, { size: 17 })
      )
    ),

    // ── Body
    h("div", { className: "app-body" },
      h("main", { className: "app-main" },
        h("div", { className: "main-content" },
          section === "money"      && h(OverviewView, {
            onJumpToAccount: (accId) => { setHistoryAccount(accId || null); setSection("history"); },
            onEditCategory: setEditTx, onDeleteTx: handleDeleteTx, refreshKey, filterMonth: currentMonth,
            onImport: () => setImportOpen(true)
          }),
          section === "history"    && h(HistoryView, {
            onEditCategory: setEditTx, onDeleteTx: handleDeleteTx, refreshKey,
            initialAccount: historyAccount, onAccountConsumed: () => setHistoryAccount(null)
          }),
          section === "investments" && h(InvestmentsView, { refreshKey, filterMonth: "all" }),
          section === "categories" && h(CategoriesPanel, { refreshKey, onRefresh: () => setRefreshKey(k => k + 1) }),

          h("footer", { style: { marginTop: 20, padding: "12px 0", borderTop: "1px solid var(--line-1)", fontSize: 10, color: "var(--fg-3)" } },
            h("span", null, "BrokerShark · localhost:8080 · SQLite")
          )
        )
      )
    ),

    // ── Modals & overlays
    searchModalOpen && h(SearchModal, {
      onClose: () => setSearchModalOpen(false),
      onSelect: t => setEditTx(t),
    }),
    importOpen && h(ImportModal, {
      onClose: () => setImportOpen(false),
      onDone: (res) => {
        setImportOpen(false);
        const n = res?.inserted ?? 0;
        const msg = res?.kind === "b3"
          ? (n > 0 ? `${n} ${n === 1 ? "posição importada" : "posições importadas"}` : "Nenhuma posição encontrada")
          : (n > 0 ? `${n} ${n === 1 ? "lançamento importado" : "lançamentos importados"}` : "Nada novo para importar");
        push(msg, n > 0 ? "success" : "info");
        setRefreshKey(k => k + 1);
      },
    }),
    tweaksOpen && h("div", { className: "tweaks-overlay", onClick: () => setTweaksOpen(false) }),
    tweaksOpen && h(TweaksPanel, {
      tw, setTw,
      onClose: () => setTweaksOpen(false),
      onOpenCategories: () => setSection("categories"),
    }),

    h(CategoryEditor, {
      tx: editTx, onClose: () => setEditTx(null),
      onSave: (result) => {
        if (result?.deleted) {
          push("Transação excluída", "success");
        } else {
          const parts = [];
          if (result?.category) parts.push(`Categoria: ${result.category}`);
          if ("display_name" in (result || {})) parts.push(result.display_name ? `Nome: ${result.display_name}` : "Nome fantasia removido");
          if ("is_third_party" in (result || {})) parts.push(result.is_third_party ? "Excluído dos gastos" : "Incluído nos gastos");
          push(parts.length ? parts.join(" · ") : "Salvo", "success");
        }
        setEditTx(null);
        setRefreshKey(k => k + 1);
      }
    }),

    h(Toaster, null)
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
