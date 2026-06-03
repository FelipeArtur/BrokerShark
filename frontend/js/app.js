/* app.js — BrokerShark v2 app shell */
/* global React, ReactDOM, fetchExpenseCategories, patchTransaction,
          searchTransactions, postCategory, deleteCategory, deleteTransaction, restoreTransactions,
          fetchAccounts, importPreview, importConfirm, importB3 */

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  fmtBRL, fmtDateBR, Modal, useToasts, SegmentControl, BankChip, BrokerSharkLogo,
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
    onSave({ deleted: true, _tx: tx });
  }

  const METHOD_LABELS = { pix: "PIX", pix_received: "PIX", credit: "Crédito", ted: "TED", transfer: "Transfer.", other: "Outro" };
  const methodLabel = tx ? (METHOD_LABELS[tx.method] || tx.method || "") : "";
  const flowIsExpense = tx?.flow === "expense";
  
  const isSelf = tx?.counterpart === "SELF";
  const isInvest = !isSelf && tx && (tx.method === "transfer" || (tx.flow === "income" && !tx.is_revenue));
  const amtColor = isSelf ? "var(--info)" : isInvest ? "var(--reserve)" : (flowIsExpense ? "var(--neg)" : "var(--pos)");
  const sign = flowIsExpense ? "−" : "+";

  return h(Modal, { open: !!tx, onClose, title: "Transação", width: 480 },
    tx && h("div", { style: { display: "flex", flexDirection: "column" } },
      h("div", { style: { background: "var(--bg-1)", padding: "12px 16px", borderBottom: "1px solid var(--line-1)" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 } },
          h("div", { style: { fontSize: 9, color: "var(--fg-3)", fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: "0.05em" } }, isSelf ? "Transferência Própria" : isInvest ? "Movimento de Investimento" : flowIsExpense ? "Comprovante de Despesa" : "Comprovante de Receita"),
          h("div", { style: { fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--ff-mono)" } }, fmtDateBR(tx.date))
        ),
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
          h("div", { style: { fontSize: 14, fontWeight: 500, color: "var(--fg-1)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 16 } },
            displayName || tx.description
          ),
          h("span", { className: "num", style: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em", color: amtColor, lineHeight: 1 } },
            sign + fmtBRL(tx.amount)
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

/* ── ImportWizard ─────────────────────────────────────────────────────── */
function ImportModal({ onClose, onDone }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const { Modal, SegmentControl } = window.BS;
  const names = (window.BS && window.BS.accountNames) || {};
  const ACCOUNTS = [
    { id: "nu-db",    label: names["nu-db"]    || "Nubank",   hint: "Conta (CSV)" },
    { id: "inter-db", label: names["inter-db"] || "Inter",    hint: "Conta (CSV)" },
    { id: "inter-cc", label: names["inter-cc"] || "Inter CC", hint: "Fatura (CSV)" },
    { id: "b3",       label: "Relatório B3",                  hint: "Posições (XLSX)" },
  ];

  const [account, setAccount]   = useState(null);
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState(null);
  const [b3Preview, setB3Preview] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);

  async function analyze(targetFile) {
    const f = targetFile || file;
    if (!f) { setErr("Escolha um arquivo."); return; }
    setBusy(true); setErr(null);
    try {
      if (account === "b3") {
        const res = await importB3(f);
        setB3Preview(res);
      } else {
        const res = await importPreview(f, account);
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
      const excludedArr = Array.from(excluded);
      const res = await importConfirm(preview.batch_id, excludedArr);
      onDone({ inserted: res.inserted || 0, kind: "tx" });
    } catch (e) { setErr(e.message || "Falha ao confirmar."); }
    finally { setBusy(false); }
  }

  const willImport = preview ? (preview.counts.new - excluded.size) : 0;
  const isPreviewing = preview || b3Preview;
  const [currentStep, setCurrentStep] = useState(1);
  const step = isPreviewing ? 3 : currentStep;

  const handleFileSelect = (f) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const isB3 = account === "b3";
    if (isB3 && ext !== "xlsx") return setErr("Para a B3, envie um arquivo .xlsx");
    if (!isB3 && ext !== "csv") return setErr("Para bancos, envie um arquivo .csv");
    setFile(f); setErr(null); analyze(f);
  };

  const step1View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 24 } },
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "Passo 1: De onde veio o arquivo que você quer importar?"),
    h(SegmentControl, {
      options: ACCOUNTS.map(a => ({ value: a.id, label: h("div", null, h("div", null, a.label), h("div", { style: { fontSize: 10, color: "var(--fg-3)", fontWeight: 400, marginTop: 2 } }, a.hint)) })),
      value: account,
      onChange: (val) => { setAccount(val); setFile(null); setErr(null); },
      columns: 2
    }),
    h("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 8 } },
      h("button", { 
        className: "btn btn-primary", 
        disabled: !account,
        onClick: () => setCurrentStep(2)
      }, "Próximo ›")
    )
  );

  const DropZone = h("label", {
    style: {
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      border: "2px dashed var(--line-2)", background: "var(--bg-0)", borderRadius: 8,
      padding: "40px 24px", cursor: busy ? "wait" : "pointer",
      minHeight: 160, color: "var(--fg-2)", fontSize: 13, textAlign: "center", transition: "all 0.2s"
    },
    onDragOver: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--pos)"; e.currentTarget.style.color = "var(--pos)"; },
    onDragLeave: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--line-2)"; e.currentTarget.style.color = "var(--fg-2)"; },
    onDrop: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--line-2)"; const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }
  },
    busy ? h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
      h("div", { className: "spinner", style: { width: 16, height: 16, border: "2px solid var(--line-2)", borderTopColor: "var(--pos)", borderRadius: "50%", animation: "spin 1s linear infinite" } }),
      "Processando..."
    ) : file ? h("div", { style: { color: "var(--pos)", fontWeight: 600 } }, `${file.name} (${(file.size/1024).toFixed(1)} KB)`) 
    : h("div", null,
      h("div", { style: { marginBottom: 8, color: "var(--fg-1)" } }, "Arraste o arquivo ou clique para selecionar"),
      h("div", { style: { fontSize: 12, color: "var(--fg-3)" } }, account === "b3" ? "Apenas arquivos .xlsx" : "Apenas arquivos .csv")
    ),
    h("input", { type: "file", accept: account === "b3" ? ".xlsx" : ".csv,text/csv", style: { display: "none" }, onChange: e => { const f = e.target.files[0]; if (f) handleFileSelect(f); e.target.value = null; } })
  );

  const step2View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 24 } },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
      h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "Passo 2: Envie o extrato ou fatura"),
      h("button", { onClick: () => setCurrentStep(1), className: "btn btn-ghost btn-sm" }, "‹ Voltar")
    ),
    DropZone,
    err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err)
  );

  const Stat = (label, val, color) => h("div", { style: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px dashed var(--line-1)", fontSize: 13 } },
    h("span", { style: { color: "var(--fg-2)" } }, label),
    h("span", { style: { color: color || "var(--fg-1)", fontWeight: 600 } }, val)
  );

  const reviewView = preview && h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 24 } },
    h("div", { style: { display: "flex", gap: 24 } },
      // Left pane: Summary
      h("div", { style: { width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 } },
        h("div", { style: { padding: 16, background: "var(--bg-1)", borderRadius: 8, border: "1px solid var(--line-1)" } },
          Stat("Prontas para Importar", willImport, "var(--pos)"),
          Stat("Já Existem", preview.counts.duplicate, "var(--fg-3)"),
          Stat("Ignoradas", preview.counts.skipped, "var(--reserve)")
        ),
        err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" } },
          h("button", { className: "btn btn-primary", disabled: busy || willImport <= 0, onClick: confirm }, busy ? "Importando..." : "Confirmar Importação"),
          h("button", { className: "btn btn-ghost", onClick: () => { setPreview(null); setFile(null); setCurrentStep(2); } }, "Cancelar")
        )
      ),
      // Right pane: Table
      h("div", { style: { flex: 1, border: "1px solid var(--line-1)", borderRadius: 8, display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: 400 } },
        h("div", { style: { padding: "8px 12px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-2)", fontSize: 12, color: "var(--fg-2)", display: "flex", justifyContent: "space-between" } },
          h("span", null, "Transações Encontradas"),
          h("span", null, "Desmarque para ignorar")
        ),
        h("div", { style: { flex: 1, overflowY: "auto", background: "var(--bg-0)" } },
          h("table", { style: { width: "100%", borderCollapse: "collapse" } },
            h("tbody", null,
              preview.rows.map(r => {
                const isNew = r.status === "new";
                const checked = isNew && !excluded.has(r.id);
                
                const isSelf = r.counterpart === "SELF";
                const isInvest = !isSelf && r && (r.method === "transfer" || (r.flow === "income" && !r.is_revenue));
                const amtColor = isSelf ? "var(--info)" : isInvest ? "var(--reserve)" : (r.flow === "expense" ? "var(--neg)" : "var(--pos)");
                const sign = r.flow === "expense" ? "−" : "+";

                return h("tr", { key: r.id, style: { borderBottom: "1px solid var(--line-0)", opacity: (!isNew || !checked) ? 0.4 : 1, fontSize: 13 } },
                  h("td", { style: { padding: "8px 12px", width: 32, textAlign: "center" } },
                    isNew ? h("input", { type: "checkbox", checked, onChange: () => toggle(r.id), style: { cursor: "pointer" } }) : h("span", { style: { color: "var(--fg-3)" } }, "−")
                  ),
                  h("td", { style: { padding: "8px 12px", color: "var(--fg-2)", whiteSpace: "nowrap", fontSize: 11 } }, r.date),
                  h("td", { style: { padding: "8px 12px", color: isNew ? "var(--fg-1)" : "var(--fg-3)", width: "100%", fontWeight: 500 } }, r.description),
                  h("td", { style: { padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap", color: amtColor, fontWeight: 600 } }, `${sign}${window.BS.fmtBRL(r.amount)}`)
                );
              })
            )
          )
        )
      )
    )
  );

  const b3View = b3Preview && h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 24 } },
    h("div", { style: { display: "flex", gap: 24 } },
      h("div", { style: { width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 } },
        h("div", { style: { padding: 16, background: "var(--bg-1)", borderRadius: 8, border: "1px solid var(--line-1)" } },
          Stat("Novas Posições", b3Preview.created, "var(--pos)"),
          Stat("Atualizadas", b3Preview.updated, "var(--info)")
        ),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" } },
          h("button", { className: "btn btn-primary", disabled: busy || b3Preview.total <= 0, onClick: confirm, style: { background: "var(--info)", borderColor: "var(--info)", color: "#000" } }, busy ? "Importando..." : "Confirmar B3"),
          h("button", { className: "btn btn-ghost", onClick: () => { setB3Preview(null); setFile(null); setCurrentStep(2); } }, "Cancelar")
        )
      ),
      h("div", { style: { flex: 1, border: "1px solid var(--line-1)", borderRadius: 8, display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: 400 } },
        h("div", { style: { padding: "8px 12px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-2)", fontSize: 12, color: "var(--fg-2)" } }, "Posições B3"),
        h("div", { style: { flex: 1, overflowY: "auto", background: "var(--bg-0)" } },
          h("table", { style: { width: "100%", borderCollapse: "collapse" } },
            h("tbody", null,
              b3Preview.positions.map((p, i) => h("tr", { key: i, style: { borderBottom: "1px solid var(--line-0)", fontSize: 13 } },
                h("td", { style: { padding: "8px 12px", color: p.status === "new" ? "var(--pos)" : "var(--info)", fontWeight: 600, fontSize: 11 } }, p.status === "new" ? "NOVA" : "ATUALIZA"),
                h("td", { style: { padding: "8px 12px", color: "var(--fg-1)", width: "100%", fontWeight: 500 } }, p.name),
                h("td", { style: { padding: "8px 12px", textAlign: "right", fontWeight: 600 } }, window.BS.fmtBRL(p.balance))
              ))
            )
          )
        )
      )
    )
  );

  return h(Modal, {
    open: true,
    onClose,
    title: `Importar Dados ${step === 3 ? "— Revisão" : ""}`,
    width: step === 3 ? 900 : 540
  },
    step === 1 ? step1View : step === 2 ? step2View : (preview ? reviewView : b3View)
  );
}

function App() {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [tw, setTw] = useTweaks();
  const [section, setSection] = useState("money");
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
      if (e.key === "c" || e.key === "C") { e.preventDefault(); setSection("categorize"); }
      if (SECTION_MAP[e.key]) setSection(SECTION_MAP[e.key]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Single safe delete path: the server deletes immediately (handling installment
  // groups, auto-transfer pairs and investment-balance reverts) and returns a
  // restore payload. "Desfazer" replays it on the server — reliable, never a
  // hidden-but-not-deleted row. Used by both the row actions and the editor modal.
  async function handleDeleteTx(id) {
    try {
      const res = await deleteTransaction(id);
      setRefreshKey(k => k + 1);
      const n = res?.deleted || 1;
      const msg = n > 1 ? `${n} lançamentos excluídos` : "Lançamento excluído";
      push(msg, "info", {
        label: "Desfazer",
        onClick: async () => {
          try {
            await restoreTransactions(res.restore);
            push("Restaurado", "success");
            setRefreshKey(k => k + 1);
          } catch (e) {
            push(e.message || "Erro ao restaurar.", "error");
          }
        },
      });
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
          setEditTx(null);
          handleDeleteTx(result._tx.id);  // same safe delete+undo path as the table
          return;
        }
        {
          const parts = [];
          if (result?.category) parts.push(`Categoria: ${result.category}`);
          if ("display_name" in (result || {})) parts.push(result.display_name ? `Nome: ${result.display_name}` : "Nome fantasia removido");
          if ("is_third_party" in (result || {})) parts.push(result.is_third_party ? "Excluído dos gastos" : "Incluído nos gastos");
          push(parts.length ? parts.join(" · ") : "Salvo", "success");
          setRefreshKey(k => k + 1);
        }
        setEditTx(null);
      }
    }),

    h(Toaster, null)
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
