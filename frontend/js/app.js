/* app.js — BrokerShark v2 app shell */
/* global React, ReactDOM, fetchExpenseCategories, patchTransactionCategory, patchTransaction,
          postTransaction, postIncome, postInvestmentMovement, searchTransactions,
          fetchExpenseCategoriesFull, postCategory, deleteCategory, deleteTransaction,
          fetchAccounts */

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  fmtBRL, fmtDateBR, Modal, useToasts, BankChip, BrokerSharkLogo,
  PT_SHORT,
  OverviewView, AccountsCardsView, InvestmentsView, HistoryView,
  CategoriesPanel,
} = window.BS;

function _buildMonths(n) {
  const now = new Date();
  const months = Array.from({ length: n }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { v, label: `${PT_SHORT[d.getMonth() + 1]} ${d.getFullYear()}` };
  });
  return [{ v: "all", label: "Todo período" }, ...months];
}

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
const TWEAK_DEFAULTS = { theme: "dark", density: "comfortable" };
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
    document.documentElement.dataset.density = tw.density;
  }, [tw.theme, tw.density]);
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
    tx && h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },

      h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
        h("div", { style: { fontSize: 11, color: "var(--fg-3)", fontFamily: "monospace", wordBreak: "break-all" } }, tx.description),
        h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 } },
          methodLabel && h("span", { className: "chip", style: { fontSize: 10 } }, methodLabel),
          tx.bank && h("span", { className: "chip", style: { fontSize: 10 } }, tx.bank),
          h("span", { style: { fontSize: 11, color: "var(--fg-2)", marginLeft: "auto" } }, fmtDateBR(tx.date)),
          h("span", { style: { fontSize: 13, fontWeight: 700, color: flowIsExpense ? "var(--neg)" : "var(--pos)" } },
            (flowIsExpense ? "−" : "+") + fmtBRL(tx.amount))
        )
      ),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
        h("label", { style: { fontSize: 11, color: "var(--fg-2)", fontWeight: 600 } }, "Nome fantasia"),
        h("input", {
          className: "input", type: "text",
          placeholder: tx.description?.slice(0, 50) || "Nome amigável…",
          value: displayName,
          onChange: e => setDisplayName(e.target.value),
          style: { fontSize: 13 }
        })
      ),

      flowIsExpense && h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        h("div", { style: { fontSize: 11, color: "var(--fg-2)", fontWeight: 600 } }, "Categoria"),
        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 5 } },
          cats.map(c => h("button", {
            key: c.id, type: "button",
            onClick: () => setSelected(c.id),
            "aria-pressed": selected === c.id,
            style: {
              padding: "7px 10px", borderRadius: 6, textAlign: "left",
              fontSize: "var(--fz-7)", fontWeight: selected === c.id ? 600 : 400,
              background: selected === c.id ? "var(--info-bg)" : "var(--bg-0)",
              border: selected === c.id ? "1px solid var(--info)" : "1px solid var(--line-1)",
              color: selected === c.id ? "var(--fg-0)" : "var(--fg-1)",
            }
          }, c.name))
        )
      ),

      h("button", {
        type: "button",
        onClick: handleToggleThirdParty,
        style: {
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", borderRadius: 6, textAlign: "left",
          background: isThirdParty ? "var(--warn-bg, rgba(255,160,0,0.12))" : "var(--bg-0)",
          border: isThirdParty ? "1px solid var(--warn, #fa0)" : "1px solid var(--line-1)",
          color: isThirdParty ? "var(--warn, #fa0)" : "var(--fg-2)",
          fontSize: 12, fontWeight: isThirdParty ? 600 : 400, cursor: "pointer",
        }
      },
        h("span", { style: { fontSize: 14 } }, isThirdParty ? "🔒" : "🔓"),
        h("span", {}, isThirdParty ? "Excluído dos meus gastos" : "Não é meu — excluir dos meus gastos")
      ),

      err && h("div", { style: { fontSize: 11, color: "var(--neg)", padding: "2px 0" } }, err),

      h("div", { style: { display: "flex", gap: 8, justifyContent: "space-between", marginTop: 2 } },
        h("button", {
          className: "btn btn-ghost btn-sm",
          onClick: handleDelete, disabled: deleting,
          style: { color: "var(--neg)", borderColor: "var(--neg)", fontSize: 12 }
        }, deleting ? "Excluindo…" : "🗑 Excluir"),
        h("div", { style: { display: "flex", gap: 8 } },
          h("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "Cancelar"),
          h("button", { className: "btn btn-primary", onClick: save, disabled: saving, style: { minWidth: 80 } },
            saving ? "Salvando…" : "Salvar")
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
      h(Radio, { options: ["dark", "light"], value: tw.theme, onChange: v => setTw("theme", v) })
    ),
    h(Row, { label: "Densidade" },
      h(Radio, { options: ["compact", "default", "comfortable"], value: tw.density, onChange: v => setTw("density", v) })
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
      style: { width: 520, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: 12, boxShadow: "0 20px 60px oklch(0% 0 0 / 0.6)", overflow: "hidden" }
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
function App() {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [tw, setTw] = useTweaks();
  const [section, setSection] = useState("overview");
  const [entryKind, setEntryKind] = useState("expense");
  const [editTx, setEditTx] = useState(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterMonth, setFilterMonth] = useState("all");
  const { push, Toaster } = useToasts();

  const months12 = useMemo(() => _buildMonths(12), []);

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
    const SECTION_MAP = { "1": "overview", "2": "accounts", "3": "investments", "4": "history" };
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
    { id: "overview",    label: "Visão Geral"     },
    { id: "accounts",    label: "Contas & Cartões" },
    { id: "investments", label: "Investimentos"    },
    { id: "history",     label: "Histórico"        },
  ];

  const isCurrentMonth = filterMonth === _currentMonth();
  const isAllPeriod    = filterMonth === "all";
  const fmIdx          = months12.findIndex(m => m.v === filterMonth);

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

      h("div", { style: { width: 1, height: 20, background: "var(--line-1)", margin: "0 8px" } }),

      // Month selector — global (arrow navigation)
      h("div", { style: { display: "flex", alignItems: "center", gap: 3 } },
        h("span", { className: "topbar-label", style: { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap", marginRight: 3 } }, "Período"),
        h("button", {
          onClick: () => setFilterMonth(isAllPeriod ? _currentMonth() : "all"),
          title: isAllPeriod ? "Ir para mês atual" : "Ver todo o período",
          style: {
            padding: "2px 7px", height: 22, borderRadius: 4, fontSize: 10, fontWeight: 600, lineHeight: 1,
            background: isAllPeriod ? "var(--reserve)" : "transparent",
            border: isAllPeriod ? "1px solid var(--reserve)" : "1px solid var(--line-1)",
            color: isAllPeriod ? "var(--bg-0)" : "var(--fg-3)", cursor: "pointer",
          }
        }, "Todos"),
        h("button", {
          className: "btn btn-ghost btn-sm",
          disabled: isAllPeriod || fmIdx <= 1,
          onClick: () => { if (!isAllPeriod && fmIdx > 1) setFilterMonth(months12[fmIdx - 1].v); },
          style: { width: 22, padding: 0, fontSize: 14, opacity: (isAllPeriod || fmIdx <= 1) ? 0.3 : 1 }
        }, "‹"),
        h("span", {
          style: {
            fontSize: 11, fontWeight: 600, minWidth: 52, textAlign: "center", letterSpacing: "-0.01em",
            color: isAllPeriod ? "var(--fg-3)" : isCurrentMonth ? "var(--fg-1)" : "var(--info)",
          }
        }, isAllPeriod ? "— —" : (months12[fmIdx]?.label || "")),
        h("button", {
          className: "btn btn-ghost btn-sm",
          disabled: isAllPeriod || fmIdx >= months12.length - 1,
          onClick: () => { if (!isAllPeriod && fmIdx < months12.length - 1) setFilterMonth(months12[fmIdx + 1].v); },
          style: { width: 22, padding: 0, fontSize: 14, opacity: (isAllPeriod || fmIdx >= months12.length - 1) ? 0.3 : 1 }
        }, "›"),
        !isCurrentMonth && !isAllPeriod && h("button", {
          className: "btn btn-ghost btn-sm",
          onClick: () => setFilterMonth(_currentMonth()),
          title: "Mês atual",
          style: { fontSize: 10, padding: "2px 5px", height: 22, color: "var(--info)", marginLeft: 1 }
        }, "↺")
      ),

      h("div", { style: { flex: 1 } }),

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
        section === "overview"    && h(OverviewView,      { onJumpToAccount: () => setSection("accounts"), onEditCategory: setEditTx, onDeleteTx: handleDeleteTx, refreshKey, filterMonth }),
        section === "accounts"    && h(AccountsCardsView, { onEditCategory: setEditTx, onDeleteTx: handleDeleteTx, refreshKey, filterMonth }),
        section === "investments" && h(InvestmentsView,   { refreshKey, filterMonth }),
        section === "history"     && h(HistoryView,       { onEditCategory: setEditTx, onDeleteTx: handleDeleteTx, refreshKey }),
        section === "categories"  && h(CategoriesPanel,   { refreshKey, onRefresh: () => setRefreshKey(k => k + 1) }),

        h("footer", { style: { marginTop: 20, padding: "12px 0", borderTop: "1px solid var(--line-1)", fontSize: 10, color: "var(--fg-3)" } },
          h("span", null, "BrokerShark · localhost:8080 · SQLite")
        )
      )
    ),

    // ── Modals & overlays
    searchModalOpen && h(SearchModal, {
      onClose: () => setSearchModalOpen(false),
      onSelect: t => setEditTx(t),
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
