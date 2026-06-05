/* app.js — BrokerShark v2 app shell */
/* global React, ReactDOM, fetchExpenseCategories, patchTransaction,
          searchTransactions, postCategory, deleteCategory, deleteTransaction,
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

  return h(Modal, { open: !!tx, onClose, title: "Perfil da Transação", width: 640 },
    tx && h("div", { style: { display: "flex", flexDirection: "column", gap: 32 } },
      
      // Hero Header Block - More Premium
      h("div", { style: { background: "var(--bg-1)", padding: "40px 32px", borderRadius: 16, border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" } },
        
        // Background accent
        h("div", { style: { position: "absolute", top: 0, left: 0, right: 0, height: 4, background: amtColor } }),
        
        // Top Row: Type & Date vs Bank
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 } },
          h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
            h("div", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 } }, 
               isSelf ? "Transferência Própria" : isInvest ? "Movimento de Investimento" : flowIsExpense ? "Comprovante de Despesa" : "Comprovante de Receita"
            ),
            h("div", { className: "mono", style: { fontSize: 13, color: "var(--fg-2)" } }, fmtDateBR(tx.date))
          ),
          h(window.BS.BankChip, { accountId: tx.account_id, bank: tx.bank })
        ),
        
        // Amount & Display Name
        h("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
          h("span", { className: "num", style: { fontSize: 56, fontWeight: 800, letterSpacing: "-0.04em", color: amtColor, lineHeight: 1 } },
            sign + fmtBRL(tx.amount)
          ),
          h("div", { style: { fontSize: 24, fontWeight: 700, color: "var(--fg-0)", wordBreak: "break-word", lineHeight: 1.2 } },
            displayName || tx.description
          )
        ),

        // Technical details strip (cleaner)
        h("div", { style: { display: "flex", gap: 32, marginTop: 40, paddingTop: 24, borderTop: "1px dashed var(--line-2)" } },
          h("div", { style: { display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 } },
             h("span", { style: { color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, fontSize: 10 } }, "Nome Original"),
             h("span", { className: "mono", style: { color: "var(--fg-1)", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, tx.description)
          ),
          h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
             h("span", { style: { color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, fontSize: 10 } }, "Método"),
             h("span", { className: "mono", style: { color: "var(--fg-1)", fontSize: 12, textTransform: "uppercase" } }, methodLabel || "—")
          )
        )
      ),

      // Edit Form Block
      h("div", { style: { display: "flex", flexDirection: "column", gap: 32, padding: "0 8px" } },

        // Name
        h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
          h("label", { style: { fontSize: 11, color: "var(--fg-2)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" } }, "Renomear Transação"),
          h("input", {
            className: "input", type: "text",
            placeholder: tx.description?.slice(0, 50) || "Ex: Almoço Padaria...",
            value: displayName,
            onChange: e => setDisplayName(e.target.value),
            style: { fontSize: 15, height: 44, borderRadius: 8, padding: "0 16px", background: "var(--bg-1)", border: "1px solid var(--line-1)" }
          })
        ),

        // Category
        flowIsExpense && h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
          h("div", { style: { fontSize: 11, color: "var(--fg-2)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" } }, "Classificação"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 } },
            cats.map(c => h("button", {
              key: c.id, type: "button",
              onClick: () => setSelected(c.id),
              "aria-pressed": selected === c.id,
              style: {
                padding: "12px 8px", borderRadius: 8, textAlign: "center",
                fontSize: 12, fontWeight: selected === c.id ? 700 : 500,
                background: selected === c.id ? "var(--fg-0)" : "var(--bg-1)",
                border: selected === c.id ? "1px solid var(--fg-0)" : "1px solid var(--line-1)",
                color: selected === c.id ? "var(--bg-0)" : "var(--fg-1)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "all 0.15s", cursor: "pointer"
              }
            }, c.name))
          )
        ),

        // Third Party toggle
        h("button", {
          type: "button",
          onClick: handleToggleThirdParty,
          style: {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px", borderRadius: 8, textAlign: "left",
            background: isThirdParty ? "var(--warn-bg, rgba(255,160,0,0.12))" : "var(--bg-1)",
            border: isThirdParty ? "1px solid var(--warn, #fa0)" : "1px solid var(--line-1)",
            color: isThirdParty ? "var(--warn, #fa0)" : "var(--fg-2)",
            fontSize: 13, fontWeight: isThirdParty ? 600 : 500, cursor: "pointer", transition: "all 0.15s"
          }
        },
          h("span", {}, isThirdParty ? "Transação de terceiros (Ocultada dos totais)" : "Marcar como transação de terceiros"),
          h("span", { style: { fontSize: 16 } }, isThirdParty ? "🔒" : "🔓")
        ),

        err && h("div", { style: { fontSize: 12, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)", padding: "12px 16px", borderRadius: 8 } }, err)
      ),

      // Footer Actions
      h("div", { style: { display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", paddingTop: 16 } },
        h("button", {
          className: "btn btn-ghost",
          onClick: handleDelete, disabled: deleting,
          style: { color: "var(--neg)", fontSize: 13, fontWeight: 700, padding: "0 16px", height: 40 }
        }, deleting ? "Excluindo…" : "Excluir lançamento"),
        h("div", { style: { display: "flex", gap: 12 } },
          h("button", { className: "btn btn-ghost", onClick: onClose, style: { fontSize: 13, fontWeight: 600, padding: "0 16px", height: 40 } }, "Cancelar"),
          h("button", { className: "btn btn-primary", onClick: save, disabled: saving, style: { padding: "0 24px", height: 40, fontSize: 13, fontWeight: 700, borderRadius: 8 } },
            saving ? "Salvando…" : "Salvar Alterações")
        )
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
      style: { width: 720, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: 16, boxShadow: "0 16px 48px oklch(0% 0 0 / 0.4)", overflow: "hidden", display: "flex", flexDirection: "column" }
    },
      h("div", {
        "aria-live": "polite", "aria-atomic": "true",
        style: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }
      }, query.length >= 2 ? `${results.length} resultado${results.length !== 1 ? "s" : ""}` : ""),
      h("div", { style: { display: "flex", alignItems: "center", gap: 16, padding: "20px 24px", borderBottom: "1px solid var(--line-0)" } },
        h("span", { style: { color: "var(--fg-2)", display: "flex", alignItems: "center", flexShrink: 0 } },
          h(IconSearch, { size: 24 })
        ),
        h("input", {
          ref: inputRef,
          value: query, onChange: e => setQuery(e.target.value),
          onKeyDown: onKey,
          placeholder: "Buscar transações por nome, categoria ou valor...",
          style: { flex: 1, background: "none", border: "none", outline: "none", fontSize: 18, color: "var(--fg-0)", fontWeight: 500 }
        })
      ),
      results.length > 0 && h("div", { style: { maxHeight: 440, overflowY: "auto", padding: "12px 0" } },
        h("div", { style: { padding: "4px 24px 12px", fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 } },
          results.length, " resultado", results.length !== 1 ? "s" : ""
        ),
        results.map((t, i) => {
          const hlt = (text) => {
            if (!query || query.length < 2 || !text) return text;
            const parts = text.toString().split(new RegExp(`(${query})`, 'gi'));
            return parts.map((p, idx) => p.toLowerCase() === query.toLowerCase() 
              ? h("strong", { key: idx, style: { color: "var(--info)", background: "color-mix(in oklch, var(--info) 20%, transparent)", padding: "0 2px", borderRadius: 2 } }, p) 
              : p);
          };
          return h("button", {
            key: t.id,
            onClick: () => { onSelect(t); onClose(); },
            onMouseEnter: () => setActiveIdx(i),
            style: {
              display: "flex", alignItems: "center",
              width: "100%", padding: "12px 24px", border: "none",
              background: i === activeIdx ? "var(--bg-2)" : "transparent",
              cursor: "pointer", transition: "background 0.05s"
            }
          },
            h("div", { style: { minWidth: 0, flex: 1, textAlign: "left", display: "grid", gridTemplateColumns: "1fr 140px 100px", alignItems: "center", gap: 16 } },
              h("div", { style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } },
                h("div", { style: { fontSize: 14, color: "var(--fg-0)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, hlt(t.description)),
                h("div", { style: { fontSize: 12, color: "var(--fg-3)" } }, hlt(t.category || "—"))
              ),
              h("div", { style: { fontSize: 12, color: "var(--fg-2)", fontFamily: "var(--ff-mono)" } }, fmtDateBR(t.date)),
              h("div", { style: { textAlign: "right" } },
                h("span", { className: "num", style: { color: COLOR[t.flow] || "var(--fg-1)", fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" } },
                  LABEL[t.flow] || "", fmtBRL(t.amount))
              )
            )
          );
        })
      ),
      query.length >= 2 && results.length === 0 && h("div", {
        style: { padding: "40px 24px", textAlign: "center", color: "var(--fg-3)", fontSize: 14 }
      }, `Nenhum resultado para "${query}"`),
      h("div", { style: { padding: "12px 24px", borderTop: "1px solid var(--line-0)", background: "var(--bg-0)", fontSize: 11, color: "var(--fg-3)", display: "flex", gap: 24 } },
        h("span", null, h("span", { style: { fontFamily: "var(--ff-mono)", background: "var(--bg-2)", padding: "2px 6px", borderRadius: 4, marginRight: 6 } }, "↑↓"), "Navegar"),
        h("span", null, h("span", { style: { fontFamily: "var(--ff-mono)", background: "var(--bg-2)", padding: "2px 6px", borderRadius: 4, marginRight: 6 } }, "Enter"), "Selecionar"),
        h("span", null, h("span", { style: { fontFamily: "var(--ff-mono)", background: "var(--bg-2)", padding: "2px 6px", borderRadius: 4, marginRight: 6 } }, "Esc"), "Fechar")
      )
    )
  );
}

function IconImport({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
  },
    React.createElement("path", { d: "M8 11 L8 2" }),
    React.createElement("path", { d: "M4 6 L8 2 L12 6" }),
    React.createElement("path", { d: "M2 14 L14 14" })
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
        err && h("div", { style: { color: "var(--neg)", fontSize: 12, background: "color-mix(in oklch, var(--neg) 10%, transparent)", padding: "10px 14px", borderRadius: 6, border: "1px dashed color-mix(in oklch, var(--neg) 30%, transparent)" } }, err),
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

/* ── ConfirmDeleteModal — confirmação explícita antes de excluir ─────────── */
function ConfirmDeleteModal({ tx, onCancel, onConfirm }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const desc = tx.display_name || tx.description || "";
  const m = /\((\d+)\/(\d+)\)\s*$/.exec(tx.description || "");
  const isParcela = !!m && Number(tx.installments || 0) > 1;
  const nParcelas = isParcela ? Number(m[2]) : 0;
  const isSelf = tx.counterpart === "SELF";

  const warnings = [];
  if (isParcela) warnings.push(`Faz parte de uma compra parcelada — todas as ${nParcelas} parcelas serão excluídas.`);
  if (isSelf) warnings.push("É uma transferência entre suas contas — os dois lançamentos do par serão excluídos.");

  return h(Modal, { open: true, onClose: onCancel, title: "Excluir lançamento?", width: 440 },
    h("div", { style: { padding: 4 } },
      h("div", { style: { background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 6, padding: "10px 12px", marginBottom: 12 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 } },
          h("span", { style: { fontSize: 13, color: "var(--fg-0)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, desc),
          h("span", { className: "num", style: { fontSize: 14, fontWeight: 700, color: tx.flow === "expense" ? "var(--neg)" : "var(--pos)", flexShrink: 0 } },
            (tx.flow === "expense" ? "−" : "+") + fmtBRL(tx.amount))
        ),
        h("div", { style: { fontSize: 11, color: "var(--fg-3)", marginTop: 2 } }, fmtDateBR(tx.date))
      ),
      warnings.map((w, i) => h("div", {
        key: i,
        style: { display: "flex", gap: 6, fontSize: 12, color: "var(--fg-1)", background: "var(--info-bg)", border: "1px solid color-mix(in oklch, var(--info) 30%, transparent)", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }
      }, h("span", null, "ⓘ"), h("span", null, w))),
      h("div", { style: { fontSize: 12, color: "var(--fg-2)", marginBottom: 14 } }, "Esta ação não pode ser desfeita."),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
        h("button", { className: "btn btn-ghost btn-sm", onClick: onCancel, autoFocus: true }, "Cancelar"),
        h("button", {
          className: "btn btn-sm",
          onClick: onConfirm,
          style: { background: "var(--neg)", color: "#fff", border: "1px solid var(--neg)", minWidth: 90 }
        }, "Excluir")
      )
    )
  );
}

function App() {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [tw, setTw] = useTweaks();
  const [section, setSection] = useState("money");
  const [editTx, setEditTx] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);  // tx aguardando confirmação de exclusão
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
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

  // Delete path: gated by an explicit confirmation (setConfirmDelete) — no undo.
  // The server still cascades installment groups / auto-transfer pairs and reverts
  // investment balances; here we just notify the result. Used by the editor modal
  // and the row actions, both routed through the confirmation dialog.
  async function handleDeleteTx(id) {
    try {
      const res = await deleteTransaction(id);
      setRefreshKey(k => k + 1);
      const n = res?.deleted || 1;
      push(n > 1 ? `${n} lançamentos excluídos` : "Lançamento excluído", "success");
    } catch (e) {
      push(e.message || "Erro ao excluir lançamento.", "error");
    }
  }

  const SECTIONS = [
    { id: "money",       label: "Visão do Mês", shortcut: "1" },
    { id: "history",     label: "Histórico",    shortcut: "2" },
    { id: "investments", label: "Investimentos",shortcut: "3" },
  ];

  return h("div", { id: "app", style: { height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-0)" } },

    // ── Premium Topbar
    h("header", { style: { 
      height: 60, padding: "0 32px", 
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "var(--bg-0)", borderBottom: "1px solid var(--line-1)",
      position: "sticky", top: 0, zIndex: 10
    } },
      
      // Left: Logo & Nav
      h("div", { style: { display: "flex", alignItems: "center", gap: 48 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }, onClick: () => setSection("money") },
          h(BrokerSharkLogo, { size: 24 })
        ),
        h("nav", { style: { display: "flex", gap: 8 } },
          SECTIONS.map(s => h("button", {
            key: s.id, onClick: () => setSection(s.id),
            style: { 
              padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
              color: section === s.id ? "var(--bg-0)" : "var(--fg-1)",
              background: section === s.id ? "var(--fg-0)" : "transparent",
              transition: "all 0.15s", display: "flex", alignItems: "center", gap: 8
            },
            onMouseEnter: e => { if(section !== s.id) { e.currentTarget.style.color = "var(--fg-0)"; e.currentTarget.style.background = "var(--bg-1)"; } },
            onMouseLeave: e => { if(section !== s.id) { e.currentTarget.style.color = "var(--fg-1)"; e.currentTarget.style.background = "transparent"; } }
          }, 
            s.label,
            s.shortcut && h("kbd", { style: { 
              fontFamily: "var(--ff-mono)", fontSize: 10, fontWeight: 600,
              color: section === s.id ? "color-mix(in oklch, var(--bg-0) 70%, transparent)" : "var(--fg-3)", 
              background: section === s.id ? "color-mix(in oklch, var(--bg-0) 15%, transparent)" : "var(--bg-1)", 
              border: section === s.id ? "none" : "1px solid var(--line-1)",
              padding: "0 5px", borderRadius: 4, height: 18, display: "inline-flex", alignItems: "center"
            } }, s.shortcut)
          ))
        )
      ),

      // Right: Actions
      h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
        
        // Search Trigger
        h("div", { 
          onClick: () => setSearchModalOpen(true),
          style: { display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 32, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-3)", fontSize: 13, cursor: "text", width: 200, transition: "border-color 0.15s" },
          onMouseEnter: e => e.currentTarget.style.borderColor = "var(--line-2)",
          onMouseLeave: e => e.currentTarget.style.borderColor = "var(--line-1)"
        },
          h(IconSearch, { size: 14 }),
          h("span", { style: { flex: 1, fontWeight: 500 } }, "Buscar..."),
          h("kbd", { style: { fontFamily: "var(--ff-mono)", fontSize: 10, background: "var(--bg-2)", padding: "2px 6px", borderRadius: 4, color: "var(--fg-3)" } }, "/")
        ),

        // Categories Toggle
        h("button", { 
          onClick: () => setCategoriesOpen(true),
          title: "Gerenciar Categorias",
          style: { width: 32, height: 32, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, transition: "background 0.1s" },
          onMouseEnter: e => e.currentTarget.style.background = "var(--bg-2)",
          onMouseLeave: e => e.currentTarget.style.background = "var(--bg-1)"
        }, "⚙️"),

        // Theme Toggle
        h("button", { 
          onClick: () => setTw("theme", tw.theme === "Dark" ? "Light" : "Dark"),
          title: "Alternar Tema",
          style: { width: 32, height: 32, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, transition: "background 0.1s" },
          onMouseEnter: e => e.currentTarget.style.background = "var(--bg-2)",
          onMouseLeave: e => e.currentTarget.style.background = "var(--bg-1)"
        }, tw.theme === "Dark" ? "☀️" : "🌙"),
        
        // Prominent Import Button
        h("button", { 
          onClick: () => setImportOpen(true),
          style: { height: 32, padding: "0 16px", borderRadius: 6, background: "var(--fg-0)", color: "var(--bg-0)", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "transform 0.1s" },
          onMouseEnter: e => e.currentTarget.style.transform = "scale(1.02)",
          onMouseLeave: e => e.currentTarget.style.transform = "scale(1)"
        }, h(IconImport, { size: 14 }), "Importar Dados")
      )
    ),

    // ── Body
    h("main", { style: { flex: 1, overflowY: "auto", position: "relative" } },
      h("div", { style: { width: "100%", maxWidth: 1200, margin: "0 auto", padding: "48px 0", minHeight: "100%", display: "flex", flexDirection: "column" } },
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

        h("footer", { style: { marginTop: "auto", paddingTop: 64, paddingBottom: 24, fontSize: 11, color: "var(--fg-3)", display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("span", null, "BrokerShark"),
          h("span", { style: { fontFamily: "var(--ff-mono)" } }, "localhost:8080 · SQLite")
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
      onOpenCategories: () => setCategoriesOpen(true),
    }),

    categoriesOpen && h(window.BS.Drawer, {
      open: categoriesOpen, onClose: () => setCategoriesOpen(false), width: 680
    }, h(window.BS.CategoriesPanel, { refreshKey, onRefresh: () => setRefreshKey(k => k + 1) })),

    h(CategoryEditor, {
      tx: editTx, onClose: () => setEditTx(null),
      onSave: (result) => {
        if (result?.deleted) {
          setEditTx(null);
          setConfirmDelete(result._tx);  // pede confirmação antes de excluir
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

    confirmDelete && h(ConfirmDeleteModal, {
      tx: confirmDelete,
      onCancel: () => setConfirmDelete(null),
      onConfirm: () => { const id = confirmDelete.id; setConfirmDelete(null); handleDeleteTx(id); },
    }),

    h(Toaster, null)
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
