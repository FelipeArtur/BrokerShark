/* app.js — BrokerShark v2 app shell */
/* global React, ReactDOM, fetchExpenseCategories, patchTransactionCategory,
          postTransaction, postIncome, postInvestmentMovement, searchTransactions,
          fetchExpenseCategoriesFull, postCategory, deleteCategory */

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  fmtBRL, fmtDateBR, Modal, useToasts, BankChip, BrokerSharkLogo,
  QuickEntry, OverviewView, CardsView, AccountsView, InvestmentsView, HistoryView,
  CategoriesPanel,
} = window.BS;

const _APP_PT_SHORT = ["","Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function _buildMonths(n) {
  const now = new Date();
  return Array.from({ length: n }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { v, label: `${_APP_PT_SHORT[d.getMonth() + 1]} ${d.getFullYear()}` };
  });
}

function _currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/* ── Tweaks (localStorage) ──────────────────────────────────────────────── */
const TWEAK_DEFAULTS = { theme: "dark", density: "default", sidebarSide: "right", showKeyboardHints: true, alwaysOpenSidebar: true };
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

/* ── Category editor modal ──────────────────────────────────────────────── */
function CategoryEditor({ tx, onClose, onSave }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(tx?.category_id || null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tx) { fetchExpenseCategories().then(setCats); setSelected(tx.category_id); }
  }, [tx]);

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    try { await patchTransactionCategory(tx.id, selected); onSave(selected); }
    catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  return h(Modal, { open: !!tx, onClose, title: "Editar categoria", width: 400 },
    tx && h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
      h("div", { style: { fontSize: 12, color: "var(--fg-2)", marginBottom: 4 } }, tx.description, " · ", fmtDateBR(tx.date)),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6 } },
        cats.map(c => h("button", {
          key: c.id, type: "button",
          onClick: () => setSelected(c.id),
          style: {
            padding: "8px 12px", borderRadius: 6, textAlign: "left",
            fontSize: "var(--fz-7)", fontWeight: selected === c.id ? 600 : 400,
            background: selected === c.id ? "var(--info-bg)" : "var(--bg-0)",
            border: selected === c.id ? "1px solid var(--info)" : "1px solid var(--line-1)",
            color: selected === c.id ? "var(--fg-0)" : "var(--fg-1)",
          }
        }, c.name))
      ),
      h("button", { className: "btn btn-primary", onClick: save, disabled: !selected || saving, style: { marginTop: 4 } },
        saving ? "Salvando…" : "Salvar categoria")
    )
  );
}

/* ── TweaksPanel ────────────────────────────────────────────────────────── */
function TweaksPanel({ tw, setTw, onClose, onOpenCategories }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const Row = ({ label, children }) => h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line-1)" } },
    h("span", { style: { fontSize: "var(--fz-7)", color: "var(--fg-1)" } }, label), children);
  const Radio = ({ options, value, onChange }) => h("div", { style: { display: "flex", gap: 4 } },
    options.map(o => h("button", {
      key: o, type: "button", onClick: () => onChange(o),
      style: { padding: "3px 8px", fontSize: 11, borderRadius: 4, border: o === value ? "1px solid var(--info)" : "1px solid var(--line-1)", background: o === value ? "var(--info-bg)" : "var(--bg-2)", color: o === value ? "var(--info)" : "var(--fg-1)" }
    }, o))
  );
  const Toggle = ({ value, onChange }) => h("button", {
    type: "button", onClick: () => onChange(!value),
    style: { width: 36, height: 20, borderRadius: 999, background: value ? "var(--info)" : "var(--bg-3)", border: "none", position: "relative", transition: "background 0.2s", cursor: "pointer" }
  },
    h("span", { style: { position: "absolute", top: 2, left: value ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s" } })
  );

  const Section = ({ label }) => h("div", {
    style: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--fg-3)", padding: "10px 0 4px" }
  }, label);

  return h("div", { className: "tweaks-panel" },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 } },
      h("span", { style: { fontWeight: 700, fontSize: "var(--fz-5)" } }, "Configurações"),
      h("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "✕")
    ),

    h(Section, { label: "Aparência" }),
    h(Row, { label: "Tema" },          h(Radio, { options: ["dark", "light"], value: tw.theme, onChange: v => setTw("theme", v) })),
    h(Row, { label: "Densidade" },     h(Radio, { options: ["compact", "default", "comfortable"], value: tw.density, onChange: v => setTw("density", v) })),

    h(Section, { label: "Layout" }),
    h(Row, { label: "Sidebar à direita" }, h(Toggle, { value: tw.sidebarSide === "right", onChange: v => setTw("sidebarSide", v ? "right" : "left") })),
    h(Row, { label: "Sidebar sempre aberto" }, h(Toggle, { value: tw.alwaysOpenSidebar, onChange: v => setTw("alwaysOpenSidebar", v) })),

    h(Section, { label: "Interface" }),
    h(Row, { label: "Atalhos de teclado" }, h(Toggle, { value: tw.showKeyboardHints, onChange: v => setTw("showKeyboardHints", v) })),

    h("div", { style: { marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 4 } },
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => { onOpenCategories(); onClose(); },
        style: { justifyContent: "flex-start", fontSize: 11, color: "var(--fg-2)" }
      }, "⊞ Gerenciar categorias"),
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => { localStorage.removeItem("bs_tweaks"); location.reload(); },
        style: { justifyContent: "flex-start", fontSize: 11, color: "var(--fg-3)" }
      }, "↺ Restaurar padrões")
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
    if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[activeIdx]) { onSelect(results[activeIdx]); onClose(); }
  }

  const LABEL = { expense: "−", income: "+" };
  const COLOR = { expense: "var(--neg)", income: "var(--pos)" };

  return h("div", {
    onClick: onClose,
    style: { position: "fixed", inset: 0, zIndex: 100, background: "oklch(0% 0 0 / 0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "10vh" }
  },
    h("div", {
      onClick: e => e.stopPropagation(),
      style: { width: 520, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden" }
    },
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--line-1)" } },
        h("span", { style: { color: "var(--fg-3)", fontSize: 16, fontFamily: "var(--ff-mono)", flexShrink: 0 } }, "⌕"),
        h("input", {
          ref: inputRef,
          value: query, onChange: e => setQuery(e.target.value),
          onKeyDown: onKey,
          placeholder: "Buscar transações…",
          style: { flex: 1, background: "none", border: "none", outline: "none", fontSize: 14, color: "var(--fg-0)" }
        }),
        h("span", { className: "kbd", style: { fontSize: 10 } }, "Esc")
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
  const [sidebarOpen, setSidebarOpen] = useState(tw.alwaysOpenSidebar);
  const [entryKind, setEntryKind] = useState("expense");
  const [editTx, setEditTx] = useState(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [live, setLive] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterMonth, setFilterMonth] = useState(_currentMonth);
  const { push, Toaster } = useToasts();

  const months12 = useMemo(() => _buildMonths(12), []);

  useEffect(() => { setSidebarOpen(tw.alwaysOpenSidebar); }, [tw.alwaysOpenSidebar]);

  // SSE
  useEffect(() => {
    let es, debounce;
    function connect() {
      es = new EventSource("/api/events");
      es.onmessage = e => {
        if (e.data === "connected") { setLive(true); return; }
        if (e.data === "update") {
          clearTimeout(debounce);
          debounce = setTimeout(() => setRefreshKey(k => k + 1), 300);
        }
      };
      es.onerror = () => { setLive(false); setTimeout(connect, 5000); };
    }
    connect();
    return () => { clearTimeout(debounce); es?.close(); };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const SECTION_MAP = { "1": "overview", "2": "cards", "3": "accounts", "4": "investments", "5": "history" };
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "Escape") { setSidebarOpen(tw.alwaysOpenSidebar); setSearchModalOpen(false); setTweaksOpen(false); }
      if (e.key === "n" || e.key === "N") { setSidebarOpen(true); setEntryKind("expense"); }
      if (e.key === "e" || e.key === "E") { setSidebarOpen(true); setEntryKind("expense"); }
      if (e.key === "r" || e.key === "R") { setSidebarOpen(true); setEntryKind("income"); }
      if (e.key === "i" || e.key === "I") { setSidebarOpen(true); setEntryKind("investment"); }
      if (e.key === "/") { e.preventDefault(); setSearchModalOpen(true); }
      if (SECTION_MAP[e.key]) setSection(SECTION_MAP[e.key]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tw.alwaysOpenSidebar]);

  async function handleSubmit(data) {
    try {
      if (data.kind === "expense" || !data.kind) {
        await postTransaction(data);
      } else if (data.kind === "income" || data.kind === "transfer" || data.type === "transfer") {
        await postIncome(data);
      } else if (data.kind === "investment") {
        await postInvestmentMovement(data);
      }
      push("Lançamento registrado!", "success");
      setRefreshKey(k => k + 1);
      if (!tw.alwaysOpenSidebar) setSidebarOpen(false);
    } catch (e) {
      push(e.message || "Erro ao salvar", "error");
    }
  }

  const SECTIONS = [
    { id: "overview",     label: "Visão Geral",  key: "1" },
    { id: "cards",        label: "Cartões",       key: "2" },
    { id: "accounts",     label: "Contas",        key: "3" },
    { id: "investments",  label: "Investimentos", key: "4" },
    { id: "history",      label: "Histórico",     key: "5" },
  ];

  const sidebarLeft = tw.sidebarSide === "left";

  const isCurrentMonth = filterMonth === _currentMonth();

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
        },
          s.label,
          tw.showKeyboardHints && h("span", { className: "kbd", style: { marginLeft: 2, opacity: section === s.id ? 1 : 0.5 } }, s.key)
        ))
      ),

      h("div", { style: { width: 1, height: 20, background: "var(--line-1)", margin: "0 8px" } }),

      // Month selector — global
      h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
        h("span", { style: { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, whiteSpace: "nowrap" } }, "Período"),
        h("select", {
          className: "select",
          value: filterMonth,
          onChange: e => setFilterMonth(e.target.value),
          style: { height: 26, padding: "0 8px", fontSize: 11, width: "auto", minWidth: 100,
                   border: isCurrentMonth ? "1px solid var(--line-1)" : "1px solid var(--info)",
                   color: isCurrentMonth ? "var(--fg-1)" : "var(--info)" }
        },
          months12.map(({ v, label }) => h("option", { key: v, value: v }, label))
        ),
        !isCurrentMonth && h("button", {
          className: "btn btn-ghost btn-sm",
          onClick: () => setFilterMonth(_currentMonth()),
          title: "Voltar ao mês atual",
          style: { fontSize: 10, padding: "2px 6px", height: 22, color: "var(--info)" }
        }, "↺")
      ),

      h("div", { style: { flex: 1 } }),

      // Search button
      h("button", {
        className: "btn btn-ghost btn-sm",
        onClick: () => setSearchModalOpen(true),
        title: "Buscar transações (/)",
        style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12 }
      },
        h("span", { style: { fontFamily: "var(--ff-mono)", fontSize: 15 } }, "⌕"),
        tw.showKeyboardHints && h("span", { className: "kbd" }, "/")
      ),

      // Live indicator
      h("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--fg-3)" } },
        h("span", { style: { width: 7, height: 7, borderRadius: "50%", background: live ? "var(--pos)" : "var(--fg-3)", boxShadow: live ? "0 0 8px var(--pos)" : "none", display: "inline-block" } }),
        h("span", null, live ? "ao vivo" : "offline")
      ),

      // Tweaks
      h("button", { className: "btn btn-ghost btn-sm", onClick: () => setTweaksOpen(o => !o), title: "Aparência" }, "⚙"),

      // Import CSV (placeholder)
      h("button", { className: "btn btn-sm", onClick: () => push("Use o bot Telegram para importar CSV.", "info"), style: { height: 30 } },
        h("span", { style: { fontFamily: "var(--ff-mono)", fontWeight: 700 } }, "⤓"), " CSV"
      ),

      // New entry
      h("button", {
        className: "btn btn-primary btn-lg",
        onClick: () => { setEntryKind("expense"); setSidebarOpen(true); }
      },
        h("span", { style: { fontSize: 14, fontWeight: 700, fontFamily: "var(--ff-mono)" } }, "+"),
        " Novo",
        tw.showKeyboardHints && h("span", { className: "kbd", style: { background: "rgba(0,0,0,0.2)", borderColor: "rgba(0,0,0,0.3)", color: "rgba(0,0,0,0.7)", marginLeft: 4 } }, "N")
      )
    ),

    // ── Body
    h("div", { className: "app-body", style: { flexDirection: sidebarLeft ? "row" : "row-reverse" } },

      // Sidebar
      sidebarOpen && h("aside", { className: `app-sidebar ${sidebarLeft ? "left" : "right"}` },
        h(QuickEntry, {
          kind: entryKind, onChangeKind: setEntryKind,
          onSubmit: handleSubmit,
          onCancel: () => { if (!tw.alwaysOpenSidebar) setSidebarOpen(false); }
        })
      ),

      // Main content
      h("main", { className: "app-main" },
        section === "overview"    && h(OverviewView,    { onJumpToAccount: () => setSection("cards"), onEditCategory: setEditTx, refreshKey, filterMonth }),
        section === "cards"       && h(CardsView,       { onEditCategory: setEditTx, refreshKey, filterMonth }),
        section === "accounts"    && h(AccountsView,    { onEditCategory: setEditTx, refreshKey, filterMonth }),
        section === "investments" && h(InvestmentsView, { refreshKey }),
        section === "history"     && h(HistoryView,     { refreshKey }),
        section === "categories"  && h(CategoriesPanel, { refreshKey, onRefresh: () => setRefreshKey(k => k + 1) }),

        h("footer", { style: { marginTop: 20, padding: "12px 0", borderTop: "1px solid var(--line-1)", fontSize: 10, color: "var(--fg-3)", display: "flex", justifyContent: "space-between" } },
          h("span", null, "BrokerShark · localhost:8080 · SQLite"),
          tw.showKeyboardHints && h("span", { style: { display: "flex", gap: 12 } },
            h("span", null, h("span", { className: "kbd" }, "N"), " novo"),
            h("span", null, h("span", { className: "kbd" }, "/"), " buscar"),
            h("span", null, h("span", { className: "kbd" }, "1-5"), " seções"),
            h("span", null, h("span", { className: "kbd" }, "Esc"), " fechar")
          )
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
      onSave: catId => {
        const catNames = { 1: "Alimentação", 2: "Carro", 3: "Jogos", 4: "Lazer", 5: "Atividade física", 6: "Eletrônicos", 7: "Educação", 8: "Igreja", 9: "Dízimo", 10: "Outro" };
        push(`Categoria: ${catNames[catId] || "atualizada"}`, "success");
        setEditTx(null);
        setRefreshKey(k => k + 1);
      }
    }),

    h(Toaster, null)
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
