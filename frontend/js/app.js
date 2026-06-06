/* app.js — BrokerShark v2 app shell */
/* global React, ReactDOM, fetchExpenseCategories, patchTransaction,
          searchTransactions, postCategory, deleteCategory, deleteTransaction,
          fetchAccounts, importPreview, importConfirm, importB3,
          patchStagingRow, deleteImportBatch */

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

function IconTheme({ size = 17 }) {
  // Half-filled disc — the canonical contrast/theme glyph (Linear-style), no emoji.
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7, style: { display: "block", flexShrink: 0 }
  },
    React.createElement("circle", { cx: 8, cy: 8, r: 6 }),
    React.createElement("path", { d: "M8 2 A6 6 0 0 1 8 14 Z", fill: "currentColor", stroke: "none" })
  );
}

function IconLock({ size = 16, open = false }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
    style: { display: "block", flexShrink: 0 }
  },
    React.createElement("rect", { x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.2 }),
    React.createElement("path", { d: open ? "M5.5 7 V5 a2.5 2.5 0 0 1 4.8 -1" : "M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" })
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
            background: isThirdParty ? "var(--warn-bg)" : "var(--bg-1)",
            border: isThirdParty ? "1px solid var(--warn)" : "1px solid var(--line-1)",
            color: isThirdParty ? "var(--warn)" : "var(--fg-2)",
            fontSize: 13, fontWeight: isThirdParty ? 600 : 500, cursor: "pointer", transition: "all 0.15s"
          }
        },
          h("span", {}, isThirdParty ? "Transação de terceiros (Ocultada dos totais)" : "Marcar como transação de terceiros"),
          h(IconLock, { open: !isThirdParty })
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

/* ── EditableCell — click-to-edit preview cell ────────────────────────────
   Verification-first: a row reads as plain text until you click (or press
   Enter/F2) a cell. Commit on blur or Enter; Esc reverts. onCommit does the
   PATCH and throws on failure, which reverts the cell and toasts. */
function EditableCell({ value, kind, render, onCommit, onError, align = "left", color }) {
  const h = React.createElement;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);

  function start() { setDraft(value == null ? "" : String(value)); setEditing(true); }
  async function commit() {
    setEditing(false);
    const same = String(draft) === String(value == null ? "" : value);
    if (same) return;
    setSaving(true);
    try {
      await onCommit(draft);
      setFlash(true); setTimeout(() => setFlash(false), 600);
    } catch (e) {
      if (onError) onError(e.message || "não salvou");
    } finally { setSaving(false); }
  }

  if (editing) {
    return h("input", {
      ref: inputRef, value: draft,
      onChange: e => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: e => {
        if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
        else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
      },
      inputMode: kind === "amount" ? "decimal" : "text",
      "aria-label": kind === "amount" ? "Editar valor" : "Editar apelido",
      style: {
        width: "100%", boxSizing: "border-box", font: "inherit",
        textAlign: align, color: "var(--fg-0)", background: "var(--bg-2)",
        border: "1px solid var(--pos)", borderRadius: 4, padding: "1px 5px",
        fontFamily: kind === "amount" ? "var(--ff-mono)" : "inherit",
      },
    });
  }
  return h("span", {
    tabIndex: 0, role: "button", title: "Clique para editar",
    onClick: start,
    onKeyDown: e => { if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); start(); } },
    onFocus: e => { e.currentTarget.style.borderBottomColor = "var(--line-2)"; },
    onBlur: e => { e.currentTarget.style.borderBottomColor = "transparent"; },
    onMouseEnter: e => { e.currentTarget.style.borderBottomColor = "var(--line-2)"; },
    onMouseLeave: e => { e.currentTarget.style.borderBottomColor = "transparent"; },
    style: {
      cursor: "text", display: "inline-block", maxWidth: "100%",
      color: color || "var(--fg-1)", outline: "none", borderBottom: "1px dashed transparent",
      background: flash ? "color-mix(in oklch, var(--pos) 20%, transparent)" : "transparent",
      borderRadius: 3, transition: "background 0.4s",
      fontFamily: kind === "amount" ? "var(--ff-mono)" : "inherit",
    },
  }, saving ? "…" : render(value));
}

function _parseAmountInput(raw) {
  let s = String(raw).trim().replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");  // BRL "1.234,56"
  const n = parseFloat(s);
  return (isFinite(n) && n > 0) ? Math.round(n * 100) / 100 : null;
}

/* ── ImportModal — multi-file, per-account, editable preview ──────────────── */
function ImportModal({ onClose, onDone }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const { Modal, BankChip } = window.BS;
  const names = (window.BS && window.BS.accountNames) || {};
  const BANKS = [
    { id: "nu-db",    label: names["nu-db"]    || "Nubank" },
    { id: "inter-db", label: names["inter-db"] || "Inter" },
    { id: "inter-cc", label: names["inter-cc"] || "Inter CC" },
  ];
  const accLabel = id => (BANKS.find(b => b.id === id) || {}).label || id;
  const uuid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "imp-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  const toast = (msg, kind = "error") =>
    window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg, kind } }));

  const [files, setFiles]         = useState([]);   // [{key, file, account|null, b3}]
  const [groups, setGroups]       = useState(null); // tx groups (one per account)
  const [b3s, setB3s]             = useState([]);   // [{key, file, preview, err}]
  const [rowsByGroup, setRowsByGroup] = useState({}); // account -> editable rows copy
  const [excluded, setExcluded]   = useState(() => new Set());
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState(null);
  const [results, setResults]     = useState(null); // per-account confirm status

  const step = (groups || b3s.length) ? 2 : 1;

  function addFiles(fileList) {
    setErr(null);
    const incoming = Array.from(fileList || []).map(f => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (ext !== "csv" && ext !== "xlsx") return null;
      return { key: uuid(), file: f, account: null, b3: ext === "xlsx" };
    }).filter(Boolean);
    if (!incoming.length) { setErr("Envie .csv (extratos/faturas) ou .xlsx (relatório B3)."); return; }
    setFiles(prev => [...prev, ...incoming]);
  }
  const removeFile = key => setFiles(prev => prev.filter(f => f.key !== key));
  const setFileAccount = (key, account) =>
    setFiles(prev => prev.map(f => f.key === key ? { ...f, account } : f));

  const canAnalyze = files.length > 0 && files.every(f => f.b3 || f.account) && !busy;

  async function analyze() {
    setBusy(true); setErr(null);
    try {
      const byAccount = {};
      files.filter(f => !f.b3).forEach(f => {
        (byAccount[f.account] = byAccount[f.account] || []).push(f.file);
      });
      const txGroups = [];
      for (const account of Object.keys(byAccount)) {
        try {
          const res = await importPreview(byAccount[account], account);  // one POST, all files
          txGroups.push({ account, ...res, err: null });
        } catch (e) {
          txGroups.push({ account, batch_id: null,
            counts: { new: 0, duplicate: 0, skipped: 0, total: 0 }, rows: [],
            amount_divergence: 0, err: e.message || "Falha ao analisar." });
        }
      }
      const b3Previews = [];
      for (const f of files.filter(f => f.b3)) {
        try { b3Previews.push({ key: f.key, file: f.file, preview: await importB3(f.file), err: null }); }
        catch (e) { b3Previews.push({ key: f.key, file: f.file, preview: null, err: e.message || "Falha ao ler B3." }); }
      }
      const rmap = {};
      txGroups.forEach(g => { rmap[g.account] = g.rows || []; });
      setRowsByGroup(rmap);
      setExcluded(new Set());
      setGroups(txGroups.length ? txGroups : null);
      setB3s(b3Previews);
      if (!txGroups.length && !b3Previews.length) setErr("Nada para importar.");
    } catch (e) { setErr(e.message || "Falha ao analisar."); }
    finally { setBusy(false); }
  }

  function toggle(id) {
    setExcluded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // PATCH one staged row, then refresh its row + the group's divergence.
  async function editRow(account, batchId, rowId, fields) {
    const res = await patchStagingRow(batchId, rowId, fields);  // throws → EditableCell reverts
    setRowsByGroup(prev => ({
      ...prev,
      [account]: (prev[account] || []).map(r => r.id === rowId ? { ...r, ...res.row } : r),
    }));
    setGroups(prev => (prev || []).map(g =>
      g.account === account ? { ...g, amount_divergence: res.amount_divergence } : g));
  }

  function groupNew(account) {
    return (rowsByGroup[account] || []).filter(r => r.status === "new" && !excluded.has(r.id));
  }
  const txWillImport = (groups || []).reduce((s, g) => s + groupNew(g.account).length, 0);
  const b3Count = b3s.filter(b => b.preview && b.preview.total > 0).length;

  async function confirm() {
    setBusy(true); setErr(null);
    const sessionId = uuid();
    let totalInserted = 0, b3Created = 0, b3Updated = 0;
    const status = [];
    try {
      for (const g of (groups || [])) {
        if (!g.batch_id || g.err) continue;
        const excl = (rowsByGroup[g.account] || []).filter(r => excluded.has(r.id)).map(r => r.id);
        try {
          const res = await importConfirm(g.batch_id, excl, sessionId);  // shared session id
          totalInserted += res.inserted || 0;
          status.push({ account: g.account, ok: true, inserted: res.inserted || 0 });
        } catch (e) {
          status.push({ account: g.account, ok: false, msg: e.message || "falhou" });
        }
      }
      for (const b of b3s) {
        if (!b.preview || b.err) continue;
        try { const res = await importB3(b.file, { confirm: true }); b3Created += res.created || 0; b3Updated += res.updated || 0; }
        catch (e) { status.push({ account: "b3", ok: false, msg: e.message || "falhou" }); }
      }
      if (status.some(s => !s.ok)) {
        setResults(status);  // a per-account confirm failed → show status, stay open
      } else {
        onDone({ inserted: totalInserted, kind: "tx", importBatchId: sessionId,
                 b3: { created: b3Created, updated: b3Updated } });
      }
    } catch (e) { setErr(e.message || "Falha ao confirmar."); }
    finally { setBusy(false); }
  }

  /* ── Step 1: drop files + assign an account per file ── */
  const DropZone = h("label", {
    style: {
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      border: "2px dashed var(--line-2)", background: "var(--bg-0)", borderRadius: 8,
      padding: "28px 24px", cursor: busy ? "wait" : "pointer",
      color: "var(--fg-2)", fontSize: 13, textAlign: "center", transition: "all 0.2s",
    },
    onDragOver: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--pos)"; },
    onDragLeave: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--line-2)"; },
    onDrop: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--line-2)"; addFiles(e.dataTransfer.files); },
  },
    h("div", { style: { marginBottom: 6, color: "var(--fg-1)" } }, "Arraste os arquivos do mês ou clique para selecionar"),
    h("div", { style: { fontSize: 12, color: "var(--fg-3)" } }, "Vários extratos/faturas (.csv) de uma vez · relatório B3 (.xlsx)"),
    h("input", { type: "file", accept: ".csv,.xlsx,text/csv", multiple: true, style: { display: "none" },
      onChange: e => { addFiles(e.target.files); e.target.value = null; } })
  );

  const fileList = files.length > 0 && h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
    files.map(f => h("div", { key: f.key, style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: 6 } },
      h("span", { style: { flex: 1, fontSize: 13, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        f.file.name, h("span", { style: { color: "var(--fg-3)", marginLeft: 6, fontSize: 11 } }, `${(f.file.size / 1024).toFixed(1)} KB`)),
      f.b3
        ? h("span", { className: "chip", style: { fontSize: 11 } }, "Relatório B3")
        : h("select", {
            value: f.account || "", onChange: e => setFileAccount(f.key, e.target.value || null),
            "aria-label": "Conta de origem",
            style: { fontSize: 12, padding: "4px 8px", borderRadius: 5, background: "var(--bg-2)", color: f.account ? "var(--fg-0)" : "var(--fg-3)", border: `1px solid ${f.account ? "var(--line-2)" : "var(--reserve)"}` },
          },
            h("option", { value: "" }, "Conta de origem…"),
            BANKS.map(b => h("option", { key: b.id, value: b.id }, b.label))
          ),
      h("button", { className: "btn btn-ghost btn-sm", onClick: () => removeFile(f.key), "aria-label": "Remover", title: "Remover" }, "✕")
    ))
  );

  const step1View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 16 } },
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "Solte os arquivos do mês e diga de qual conta cada um veio."),
    DropZone,
    fileList,
    err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err),
    h("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 4 } },
      h("button", { className: "btn btn-primary", disabled: !canAnalyze, onClick: analyze },
        busy ? "Analisando…" : "Analisar ›")
    )
  );

  /* ── Step 2: grouped, editable review ── */
  const amtMeta = r => {
    const isSelf = r.counterpart === "SELF";
    const isInvest = !isSelf && (r.method === "transfer" || (r.flow === "income" && !r.is_revenue));
    return {
      color: isSelf ? "var(--info)" : isInvest ? "var(--reserve)" : (r.flow === "expense" ? "var(--neg)" : "var(--pos)"),
      sign: r.flow === "expense" ? "−" : "+",
    };
  };

  const renderTxGroup = (g) => {
    const rows = rowsByGroup[g.account] || g.rows || [];
    const newRows = groupNew(g.account);
    const subtotal = newRows.reduce((s, r) => s + (r.flow === "expense" ? -r.amount : r.amount), 0);
    const div = g.amount_divergence || 0;
    return h("div", { key: g.account, style: { border: "1px solid var(--line-1)", borderRadius: 8, overflow: "hidden" } },
      h("div", { style: { padding: "9px 14px", background: "var(--bg-1)", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
          h(BankChip, { accountId: g.account }),
          h("span", { style: { fontWeight: 600, fontSize: 13 } }, accLabel(g.account))
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--fg-2)" } },
          h("span", null, `${newRows.length} ${newRows.length === 1 ? "nova" : "novas"}`),
          g.counts.duplicate > 0 && h("span", { style: { color: "var(--fg-3)" } }, `${g.counts.duplicate} já existem`),
          h("span", { style: { fontFamily: "var(--ff-mono)", fontWeight: 700, color: subtotal < 0 ? "var(--neg)" : "var(--pos)" } }, `${subtotal < 0 ? "−" : "+"}${fmtBRL(subtotal)}`)
        )
      ),
      g.err && h("div", { style: { padding: "10px 14px", fontSize: 12, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)" } }, g.err),
      Math.abs(div) >= 0.01 && h("div", { style: { padding: "7px 14px", fontSize: 12, color: "var(--reserve)", background: "color-mix(in oklch, var(--reserve) 12%, transparent)", borderBottom: "1px solid var(--line-1)" } },
        `Valores ajustados: ${div > 0 ? "+" : "−"}${fmtBRL(Math.abs(div))} vs extrato`),
      !g.err && h("div", { style: { maxHeight: 280, overflowY: "auto", background: "var(--bg-0)" } },
        h("table", { style: { width: "100%", borderCollapse: "collapse" } },
          h("tbody", null, rows.map(r => {
            const isNew = r.status === "new";
            const checked = isNew && !excluded.has(r.id);
            const { color, sign } = amtMeta(r);
            return h("tr", { key: r.id, style: { borderBottom: "1px solid var(--line-0)", opacity: (!isNew || !checked) ? 0.45 : 1, fontSize: 13 } },
              h("td", { style: { padding: "7px 10px", width: 30, textAlign: "center" } },
                isNew ? h("input", { type: "checkbox", checked, onChange: () => toggle(r.id), "aria-label": "Incluir", style: { cursor: "pointer" } })
                      : h("span", { style: { color: "var(--fg-3)" } }, "−")),
              h("td", { style: { padding: "7px 10px", color: "var(--fg-3)", whiteSpace: "nowrap", fontSize: 11 } }, fmtDateBR(r.date)),
              h("td", { style: { padding: "7px 10px", width: "100%" } },
                // raw bank description stays visible as context (never a placeholder-as-label)
                h("div", { style: { color: isNew ? "var(--fg-1)" : "var(--fg-3)", fontWeight: 500 } }, r.description),
                isNew && h("div", { style: { fontSize: 11, color: "var(--fg-3)", marginTop: 1 } },
                  "apelido: ", h(EditableCell, {
                    value: r.display_name || "", kind: "text", color: "var(--fg-2)",
                    render: v => v || "—",
                    onCommit: v => editRow(g.account, g.batch_id, r.id, { display_name: v }),
                    onError: m => toast(m),
                  }))
              ),
              h("td", { style: { padding: "7px 10px", textAlign: "right", whiteSpace: "nowrap" } },
                isNew ? h(EditableCell, {
                  value: r.amount, kind: "amount", align: "right", color,
                  render: v => `${sign}${fmtBRL(v)}`,
                  onCommit: v => {
                    const n = _parseAmountInput(v);
                    if (n == null) throw new Error("Valor inválido");
                    return editRow(g.account, g.batch_id, r.id, { amount: n });
                  },
                  onError: m => toast(m),
                }) : h("span", { style: { color, fontWeight: 600, fontFamily: "var(--ff-mono)" } }, `${sign}${fmtBRL(r.amount)}`))
            );
          }))
        )
      )
    );
  };

  const renderB3 = (b) => h("div", { key: b.key, style: { border: "1px solid var(--line-1)", borderRadius: 8, overflow: "hidden" } },
    h("div", { style: { padding: "9px 14px", background: "var(--bg-1)", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-2)" } },
      h("span", { style: { fontWeight: 600, fontSize: 13, color: "var(--fg-1)" } }, "Relatório B3 — posições"),
      b.preview && h("span", null, `${b.preview.created} novas · ${b.preview.updated} atualizadas`)),
    b.err && h("div", { style: { padding: "10px 14px", fontSize: 12, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)" } }, b.err),
    b.preview && h("div", { style: { maxHeight: 240, overflowY: "auto", background: "var(--bg-0)" } },
      h("table", { style: { width: "100%", borderCollapse: "collapse" } },
        h("tbody", null, b.preview.positions.map((p, i) => h("tr", { key: i, style: { borderBottom: "1px solid var(--line-0)", fontSize: 13 } },
          h("td", { style: { padding: "7px 10px", color: p.status === "new" ? "var(--pos)" : "var(--info)", fontWeight: 600, fontSize: 11 } }, p.status === "new" ? "NOVA" : "ATUALIZA"),
          h("td", { style: { padding: "7px 10px", color: "var(--fg-1)", width: "100%", fontWeight: 500 } }, p.name),
          h("td", { style: { padding: "7px 10px", textAlign: "right", fontWeight: 600, fontFamily: "var(--ff-mono)" } }, fmtBRL(p.balance))
        ))))
    )
  );

  const resultsView = results && h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 12 } },
    h("div", { style: { fontSize: 13, color: "var(--fg-1)" } }, "Resultado da importação (algumas contas falharam):"),
    results.map((s, i) => h("div", { key: i, style: { display: "flex", justifyContent: "space-between", padding: "8px 12px", borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", fontSize: 13 } },
      h("span", null, s.account === "b3" ? "Relatório B3" : accLabel(s.account)),
      h("span", { style: { color: s.ok ? "var(--pos)" : "var(--neg)", fontWeight: 600 } },
        s.ok ? `${s.inserted} importadas` : (s.msg || "falhou")))),
    h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 } },
      h("button", { className: "btn btn-primary", onClick: () => onDone({ inserted: results.filter(s => s.ok).reduce((a, s) => a + (s.inserted || 0), 0), kind: "tx" }) }, "Fechar"))
  );

  const step2View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 16 } },
    h("div", { style: { display: "flex", flexDirection: "column", gap: 12, maxHeight: "62vh", overflowY: "auto", paddingRight: 4 } },
      (groups || []).map(renderTxGroup),
      b3s.map(renderB3)
    ),
    err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err),
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--line-1)", paddingTop: 14 } },
      h("div", { style: { fontSize: 13, color: "var(--fg-2)" } },
        h("strong", { style: { color: "var(--pos)" } }, txWillImport),
        ` ${txWillImport === 1 ? "transação pronta" : "transações prontas"}`,
        b3Count > 0 && h("span", { style: { color: "var(--fg-3)" } }, ` · ${b3Count} B3`)),
      h("div", { style: { display: "flex", gap: 8 } },
        h("button", { className: "btn btn-ghost", disabled: busy, onClick: () => { setGroups(null); setB3s([]); setRowsByGroup({}); setResults(null); } }, "‹ Voltar"),
        h("button", { className: "btn btn-primary", disabled: busy || (txWillImport <= 0 && b3Count <= 0), onClick: confirm },
          busy ? "Importando…" : "Confirmar importação"))
    )
  );

  return h(Modal, {
    open: true, onClose,
    title: `Importar Dados${step === 2 ? " — Revisão" : ""}`,
    width: step === 2 ? 820 : 560,
  }, results ? resultsView : (step === 1 ? step1View : step2View));
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
          style: { background: "var(--neg)", color: "var(--fg-0)", border: "1px solid var(--neg)", minWidth: 90 }
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
        

        // Categories Toggle
        h("button", { 
          onClick: () => setCategoriesOpen(true),
          title: "Gerenciar Categorias",
          style: { width: 32, height: 32, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, transition: "background 0.1s" },
          onMouseEnter: e => e.currentTarget.style.background = "var(--bg-2)",
          onMouseLeave: e => e.currentTarget.style.background = "var(--bg-1)"
        }, h(IconSettings, { size: 15 })),

        // Theme Toggle
        h("button", {
          onClick: () => setTw("theme", tw.theme === "Dark" ? "Light" : "Dark"),
          title: "Alternar Tema",
          style: { width: 32, height: 32, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.1s" },
          onMouseEnter: e => e.currentTarget.style.background = "var(--bg-2)",
          onMouseLeave: e => e.currentTarget.style.background = "var(--bg-1)"
        }, h(IconTheme, { size: 15 })),
        
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
        // Reversível enquanto o toast vive: "Desfazer" remove o lote inteiro
        // (compras + total da fatura, que o delete por linha protege) via delete_batch.
        const undo = (res?.kind === "tx" && res?.importBatchId && n > 0)
          ? {
              label: "Desfazer",
              onClick: async () => {
                try {
                  const r = await deleteImportBatch(res.importBatchId);
                  push(`Importação revertida (${r.deleted} ${r.deleted === 1 ? "lançamento" : "lançamentos"})`, "info");
                } catch (e) {
                  push(e.message || "Não foi possível reverter.", "error");
                }
                setRefreshKey(k => k + 1);
              },
            }
          : null;
        push(msg, n > 0 ? "success" : "info", undo);
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
    }, h(window.BS.CategoriesPanel, { refreshKey, onRefresh: () => setRefreshKey(k => k + 1), onClose: () => setCategoriesOpen(false) })),

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
