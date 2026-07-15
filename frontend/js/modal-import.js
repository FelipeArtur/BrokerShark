/* IIFE-wrapped */
(function () {
/* modal-import.js — Modal de importação e célula editável */

const { useState, useEffect, useRef } = React;

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
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return (isFinite(n) && n > 0) ? Math.round(n * 100) / 100 : null;
}

function ImportModal({ onClose, onDone }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const { Modal, BankChip, isSelf, isInvest, fmtDateBR, fmtBRL, fmtBRLCompact, IconImport } = window.BS;
  const names = (window.BS && window.BS.accountNames) || {};
  const BANKS = [
    { id: "nu-db",    label: names["nu-db"]    || "Nubank" },
    { id: "inter-db", label: names["inter-db"] || "Inter" },
  ];
  const accLabel = id => (BANKS.find(b => b.id === id) || {}).label || id;
  const uuid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "imp-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  const toast = (msg, kind = "error") =>
    window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg, kind } }));

  const [files, setFiles]         = useState([]);
  const [groups, setGroups]       = useState(null);
  const [b3s, setB3s]             = useState([]);
  const [rowsByGroup, setRowsByGroup] = useState({});
  const [excluded, setExcluded]   = useState(() => new Set());
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState(null);
  const [results, setResults]     = useState(null);
  const [cats, setCats]           = useState({ expense: [], income: [] });
  const triedRef = useRef("");

  const step = (groups || b3s.length) ? 2 : 1;

  function addFiles(fileList) {
    setErr(null);
    const incoming = Array.from(fileList || []).map(f => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (ext !== "csv" && ext !== "xlsx") return null;
      return { key: uuid(), file: f, account: null, b3: ext === "xlsx", detecting: ext === "csv" };
    }).filter(Boolean);
    if (!incoming.length) { setErr("Envie .csv (extratos) ou .xlsx (relatório B3)."); return; }
    setFiles(prev => [...prev, ...incoming]);
    incoming.filter(f => !f.b3).forEach(f => {
      window.importDetect(f.file).then(acc => {
        setFiles(prev => prev.map(x => x.key === f.key
          ? { ...x, account: acc || x.account, auto: !!acc, detecting: false } : x));
      });
    });
  }
  const removeFile = key => setFiles(prev => prev.filter(f => f.key !== key));
  const setFileAccount = (key, account) =>
    setFiles(prev => prev.map(f => f.key === key ? { ...f, account, auto: false, detecting: false } : f));

  const canAnalyze = files.length > 0 && !busy && files.every(f => f.b3 || f.account);

  async function analyze() {
    setBusy(true); setErr(null);
    try {
      const byAccount = {};
      files.filter(f => !f.b3).forEach(f => {
        (byAccount[f.account] = byAccount[f.account] || []).push(f.file);
      });
      const [txGroups, b3Previews] = await Promise.all([
        Promise.all(Object.keys(byAccount).map(async account => {
          try {
            const res = await window.importPreview(byAccount[account], account);
            return { account, ...res, err: null };
          } catch (e) {
            return { account, batch_id: null, counts: { new: 0, duplicate: 0, skipped: 0, total: 0 }, rows: [], amount_divergence: 0, err: e.message || "Falha ao analisar." };
          }
        })),
        Promise.all(files.filter(f => f.b3).map(async f => {
          try { return { key: f.key, file: f.file, preview: await window.importB3(f.file), err: null }; }
          catch (e) { return { key: f.key, file: f.file, preview: null, err: e.message || "Falha ao ler B3." }; }
        })),
      ]);
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

  const _fileSig = files.map(f => `${f.key}:${f.account || ""}:${f.b3 ? "b3" : ""}`).sort().join("|");
  useEffect(() => {
    if (step === 2 || busy || results) return;
    if (!files.length) return;
    if (files.some(f => !f.b3 && f.detecting)) return;
    if (!files.every(f => f.b3 || f.account)) return;
    if (triedRef.current === _fileSig) return;
    triedRef.current = _fileSig;
    analyze();
  }, [_fileSig, files, busy, step, results]);

  useEffect(() => {
    if (step !== 2) return;
    if (cats.expense.length || cats.income.length) return;
    Promise.all([window.fetchCategoriesFull("expense"), window.fetchCategoriesFull("income")])
      .then(([e, i]) => setCats({ expense: e || [], income: i || [] }))
      .catch(() => {});
  }, [step]);

  function toggle(id) {
    setExcluded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function setGroupAll(account, include) {
    const ids = (rowsByGroup[account] || []).filter(r => r.status === "new").map(r => r.id);
    setExcluded(prev => {
      const n = new Set(prev);
      ids.forEach(id => include ? n.delete(id) : n.add(id));
      return n;
    });
  }

  async function editRow(account, batchId, rowId, fields) {
    const res = await window.patchStagingRow(batchId, rowId, fields);
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
      await Promise.all((groups || []).filter(g => g.batch_id && !g.err).flatMap(g =>
        groupNew(g.account)
          .filter(r => r.category_id == null && r.suggested_category_id != null)
          .map(r => window.patchStagingRow(g.batch_id, r.id, { category_id: r.suggested_category_id }).catch(() => {}))
      ));
      const txStatus = await Promise.all((groups || [])
        .filter(g => g.batch_id && !g.err)
        .map(async g => {
          const excl = (rowsByGroup[g.account] || []).filter(r => excluded.has(r.id)).map(r => r.id);
          try { const res = await window.importConfirm(g.batch_id, excl, sessionId); return { account: g.account, ok: true, inserted: res.inserted || 0 }; }
          catch (e) { return { account: g.account, ok: false, msg: e.message || "falhou" }; }
        }));
      const b3Status = await Promise.all(b3s
        .filter(b => b.preview && !b.err)
        .map(async b => {
          try { const res = await window.importB3(b.file, { confirm: true }); return { b3: true, created: res.created || 0, updated: res.updated || 0 }; }
          catch (e) { return { account: "b3", ok: false, msg: e.message || "falhou" }; }
        }));
      txStatus.forEach(s => { if (s.ok) totalInserted += s.inserted || 0; status.push(s); });
      b3Status.forEach(s => { if (s.b3) { b3Created += s.created; b3Updated += s.updated; } else status.push(s); });
      if (status.some(s => !s.ok)) {
        setResults(status);
      } else {
        onDone({ inserted: totalInserted, kind: "tx", importBatchId: sessionId,
                 b3: { created: b3Created, updated: b3Updated } });
      }
    } catch (e) { setErr(e.message || "Falha ao confirmar."); }
    finally { setBusy(false); }
  }

  const DropZone = h("label", {
    style: {
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
      border: "2px dashed color-mix(in oklch, var(--accent) 40%, transparent)",
      background: "color-mix(in oklch, var(--accent) 5%, transparent)", borderRadius: 16,
      padding: "48px 24px", cursor: busy ? "wait" : "pointer",
      color: "var(--fg-2)", textAlign: "center", transition: "all 0.2s",
    },
    onDragOver: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 15%, transparent)"; },
    onDragLeave: e => { e.preventDefault(); e.currentTarget.style.borderColor = "color-mix(in oklch, var(--accent) 40%, transparent)"; e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 5%, transparent)"; },
    onDrop: e => { e.preventDefault(); e.currentTarget.style.borderColor = "color-mix(in oklch, var(--accent) 40%, transparent)"; e.currentTarget.style.background = "color-mix(in oklch, var(--accent) 5%, transparent)"; addFiles(e.dataTransfer.files); },
  },
    h("div", { style: { background: "var(--bg-0)", padding: 16, borderRadius: "50%", color: "var(--accent)", marginBottom: 4, boxShadow: "0 8px 24px color-mix(in oklch, var(--accent) 20%, transparent)" } }, h(IconImport, { size: 32 })),
    h("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--fg-0)" } }, "Arraste os arquivos aqui, ou clique para escolher"),
    h("div", { style: { fontSize: 14, color: "var(--fg-3)" } }, "Extratos em .csv ou relatórios B3 em .xlsx"),
    h("input", { type: "file", accept: ".csv,.xlsx,text/csv", multiple: true, style: { display: "none" },
      onChange: e => { addFiles(e.target.files); e.target.value = null; } })
  );

  const fileList = files.length > 0 && h("div", { style: { display: "flex", flexDirection: "column", gap: 12, marginTop: 8 } },
    files.map(f => h("div", { key: f.key, style: { display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", background: "var(--bg-0)", border: "1px solid var(--line-1)", borderRadius: 12, boxShadow: "0 4px 12px oklch(0% 0 0 / 0.05)" } },
      h("div", { style: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, gap: 2 } },
        h("span", { style: { fontSize: 14, fontWeight: 700, color: "var(--fg-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.file.name),
        h("span", { style: { color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--ff-mono)" } }, `${(f.file.size / 1024).toFixed(1)} KB`)
      ),
      f.b3
        ? h("span", { style: { fontSize: 12, fontWeight: 700, padding: "6px 12px", background: "var(--info-bg)", color: "var(--info)", borderRadius: 6 } }, "B3")
        : h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
            f.auto && h("span", { title: "conta detectada automaticamente — confira", style: { fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--info)", border: "1px solid color-mix(in oklch, var(--info) 30%, transparent)", borderRadius: 4, padding: "2px 6px" } }, "auto"),
            h("select", {
              value: f.account || "", onChange: e => setFileAccount(f.key, e.target.value || null),
              "aria-label": "Conta de origem",
              style: {
                appearance: "none",
                backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6l4 4 4-4'/></svg>")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 10px center",
                fontSize: 13, fontWeight: 600, padding: "8px 32px 8px 12px", borderRadius: 8, height: 36,
                background: "var(--bg-1)", color: f.account ? "var(--fg-0)" : "var(--fg-3)", border: `1px solid ${f.account ? "var(--line-2)" : "var(--reserve)"}`, cursor: "pointer", outline: "none", transition: "border 0.2s"
              },
            },
              h("option", { value: "" }, "Atribuir Conta…"),
              BANKS.map(b => h("option", { key: b.id, value: b.id }, b.label))
            )
          ),
      h("button", { onClick: () => removeFile(f.key), title: "Remover arquivo", style: { width: 36, height: 36, borderRadius: "50%", background: "transparent", border: "none", color: "var(--fg-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s" }, onMouseEnter: e => { e.currentTarget.style.color = "var(--neg)"; e.currentTarget.style.background = "color-mix(in oklch, var(--neg) 15%, transparent)"; }, onMouseLeave: e => { e.currentTarget.style.color = "var(--fg-3)"; e.currentTarget.style.background = "transparent"; } }, h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5 }, h("line", { x1: 4, y1: 4, x2: 12, y2: 12 }), h("line", { x1: 4, y1: 12, x2: 12, y2: 4 })))
    ))
  );

  const detecting = files.some(f => !f.b3 && f.detecting);
  const needsAccount = files.length > 0 && !detecting && !canAnalyze;
  const step1View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 16 } },
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "Solte os arquivos do mês — a conta é detectada e a revisão abre sozinha."),
    DropZone,
    fileList,
    err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err),
    (busy || detecting)
      ? h("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 4, fontSize: 12, fontWeight: 600, color: "var(--fg-2)" } },
          busy ? "Analisando…" : "Detectando conta…")
      : err
        ? h("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 4 } },
            h("button", { className: "btn btn-primary", disabled: !canAnalyze, onClick: () => { triedRef.current = ""; analyze(); } }, "Tentar de novo"))
        : needsAccount
          ? h("div", { style: { textAlign: "right", marginTop: 4, fontSize: 12, fontWeight: 600, color: "var(--reserve)" } }, "Atribua a conta dos arquivos acima")
          : null
  );

  const classifyRow = r => {
    if (isSelf(r))   return { tag: "transferência", color: "var(--info)", categorizable: false };
    if (isInvest(r)) return { tag: "investimento", color: "var(--reserve)", categorizable: false };
    if (r.method === "credit") return { tag: "crédito", color: "var(--warn)", categorizable: true };
    if (r.flow === "income") return { tag: "receita", color: "var(--pos)", categorizable: true };
    return { tag: "despesa", color: "var(--neg)", categorizable: true };
  };
  const amtMeta = r => {
    const _self = isSelf(r);
    const _invest = isInvest(r);
    return {
      color: _self ? "var(--info)" : _invest ? "var(--reserve)" : (r.flow === "expense" ? "var(--neg)" : "var(--pos)"),
      sign: r.flow === "expense" ? "−" : "+",
    };
  };
  const TagChip = (cls) => h("span", {
    title: `Será classificado como ${cls.tag}`,
    style: {
      fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
      padding: "2px 6px", borderRadius: 4, color: cls.color, whiteSpace: "nowrap", flexShrink: 0,
      border: `1px solid color-mix(in oklch, ${cls.color} 30%, transparent)`,
      background: `color-mix(in oklch, ${cls.color} 10%, transparent)`,
    },
  }, cls.tag);

  const CategorySelect = (g, r) => {
    const list = cats[r.flow] || [];
    const showingSuggestion = r.category_id == null && r.suggested_category_id != null;
    const value = r.category_id != null ? String(r.category_id)
      : (showingSuggestion ? String(r.suggested_category_id) : "");
    return h("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } },
      h("select", {
        value,
        "aria-label": "Categoria",
        onChange: e => editRow(g.account, g.batch_id, r.id, { category_id: e.target.value ? parseInt(e.target.value) : null })
          .catch(() => toast("Não salvou a categoria")),
        style: {
          height: 24, maxWidth: 180, fontSize: 11, fontWeight: 500,
          padding: "0 22px 0 8px", borderRadius: 4, cursor: "pointer", outline: "none",
          backgroundColor: "var(--bg-0)", color: value ? "var(--fg-1)" : "var(--fg-3)",
          border: `1px solid ${showingSuggestion ? "color-mix(in oklch, var(--accent) 40%, transparent)" : "var(--line-1)"}`,
          appearance: "none",
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23888' d='M5 7L0 2h10z'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat", backgroundPosition: "right 7px center",
        },
      },
        h("option", { value: "" }, "Sem categoria"),
        list.map(c => h("option", { key: c.id, value: c.id }, c.name))
      ),
      showingSuggestion && h("span", {
        title: "Sugerido pelo histórico — confirme ou troque",
        style: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--accent)", whiteSpace: "nowrap" },
      }, "sugerido")
    );
  };

  const renderTxGroup = (g) => {
    const rows = rowsByGroup[g.account] || g.rows || [];
    const newRows = groupNew(g.account);
    const allNew = rows.filter(r => r.status === "new");
    const allIncluded = allNew.length > 0 && allNew.every(r => !excluded.has(r.id));
    const subtotal = newRows.reduce((s, r) => s + (r.flow === "expense" ? -r.amount : r.amount), 0);
    const div = g.amount_divergence || 0;
    return h("div", { key: g.account, style: { border: "1px solid var(--line-1)", borderRadius: 12, overflow: "hidden" } },
      h("div", { style: { padding: "16px 20px", background: "var(--bg-1)", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
          h(BankChip, { accountId: g.account }),
          h("span", { style: { fontWeight: 700, fontSize: 14, color: "var(--fg-0)" } }, accLabel(g.account))
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--fg-2)", fontWeight: 600 } },
          allNew.length > 0 && h("button", { className: "data-tag", onClick: () => setGroupAll(g.account, !allIncluded), title: allIncluded ? "Desmarcar todas as novas" : "Marcar todas as novas", style: { cursor: "pointer" } }, allIncluded ? "Desmarcar" : "Marcar todas"),
          h("span", null, `${newRows.length} ${newRows.length === 1 ? "nova" : "novas"}`),
          g.counts.duplicate > 0 && h("span", { style: { color: "var(--fg-3)" } }, `${g.counts.duplicate} já importados`),
          h("span", { style: { fontFamily: "var(--ff-mono)", fontSize: 14, color: subtotal < 0 ? "var(--neg)" : "var(--pos)" } }, `${subtotal < 0 ? "−" : "+"}${fmtBRL(Math.abs(subtotal))}`)
        )
      ),
      g.err && h("div", { style: { padding: "12px 20px", display: "flex", flexDirection: "column", gap: 4, background: "color-mix(in oklch, var(--neg) 10%, transparent)" } },
        h("div", { style: { fontSize: 12, fontWeight: 700, color: "var(--neg)" } }, g.err),
        h("div", { style: { fontSize: 11, fontWeight: 500, color: "var(--fg-2)" } }, "Confira se a conta atribuída (Nubank/Inter) corresponde ao arquivo, ou se é mesmo um extrato desse banco.")),
      Math.abs(div) >= 0.01 && h("div", { style: { padding: "12px 20px", fontSize: 12, fontWeight: 600, color: "var(--reserve)", background: "color-mix(in oklch, var(--reserve) 12%, transparent)", borderBottom: "1px solid var(--line-1)" } },
        `Ajuste de Saldo: ${div > 0 ? "+" : "−"}${fmtBRL(Math.abs(div))} vs extrato original`),
      !g.err && (allNew.length === 0
        ? h("div", { style: { padding: "20px", textAlign: "center", color: "var(--fg-2)", fontSize: 13, fontWeight: 600, background: "var(--bg-0)" } },
            g.counts.duplicate > 0
              ? `Tudo já importado ✓ — ${g.counts.duplicate} lançamento${g.counts.duplicate === 1 ? "" : "s"} já consta${g.counts.duplicate === 1 ? "" : "m"}, nada novo`
              : "Nada novo neste arquivo")
        : h("div", { style: { maxHeight: 320, overflowY: "auto", background: "var(--bg-0)" } },
            g.counts.duplicate > 0 && h("div", { style: { padding: "8px 20px", fontSize: 11, color: "var(--fg-3)", background: "var(--bg-1)", borderBottom: "1px dashed var(--line-1)" } },
              `${g.counts.duplicate} já importado${g.counts.duplicate === 1 ? "" : "s"} (ocultos) · ${allNew.length} novo${allNew.length === 1 ? "" : "s"} abaixo`),
            h("table", { style: { width: "100%", borderCollapse: "collapse" } },
              h("tbody", null, allNew.map((r, i) => {
                const checked = !excluded.has(r.id);
                const { color, sign } = amtMeta(r);
                const cls = classifyRow(r);
                return h("tr", { key: r.id, style: { borderBottom: i < allNew.length - 1 ? "1px solid var(--line-0)" : "none", opacity: checked ? 1 : 0.45, fontSize: 13, transition: "background 0.1s" }, onMouseEnter: e => e.currentTarget.style.background = "var(--bg-1)", onMouseLeave: e => e.currentTarget.style.background = "transparent" },
                  h("td", { style: { padding: "12px 16px", width: 40, textAlign: "center" } },
                    h("input", { type: "checkbox", checked, onChange: () => toggle(r.id), "aria-label": "Incluir", style: { cursor: "pointer", accentColor: "var(--fg-0)" } })),
                  h("td", { style: { padding: "12px 0", color: "var(--fg-3)", whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, fontFamily: "var(--ff-mono)" } }, fmtDateBR(r.date)),
                  h("td", { style: { padding: "10px 16px", width: "100%" } },
                    h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                      h("span", { style: { color: "var(--fg-0)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, window.BS.prettifyDesc(r.description)),
                      TagChip(cls)
                    ),
                    h("div", { style: { fontSize: 11, color: "var(--fg-3)", marginTop: 6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" } },
                      cls.categorizable && CategorySelect(g, r),
                      h(EditableCell, {
                        value: r.display_name || "", kind: "text",
                        color: r.display_name ? "var(--info)" : "var(--fg-3)",
                        render: v => v || "+ apelido",
                        onCommit: v => editRow(g.account, g.batch_id, r.id, { display_name: v }),
                        onError: m => toast(m),
                      })
                    )
                  ),
                  h("td", { style: { padding: "12px 20px", textAlign: "right", whiteSpace: "nowrap" } },
                    h(EditableCell, {
                      value: r.amount, kind: "amount", align: "right", color,
                      render: v => `${sign}${fmtBRL(v)}`,
                      onCommit: v => {
                        const n = _parseAmountInput(v);
                        if (n == null) throw new Error("Valor inválido");
                        return editRow(g.account, g.batch_id, r.id, { amount: n });
                      },
                      onError: m => toast(m),
                    }))
                );
              }))
            )
          )
      )
    );
  };

  const renderB3 = (b) => h("div", { key: b.key, style: { border: "1px solid var(--line-1)", borderRadius: 12, overflow: "hidden" } },
    h("div", { style: { padding: "16px 20px", background: "var(--bg-1)", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-2)" } },
      h("span", { style: { fontWeight: 700, fontSize: 14, color: "var(--fg-0)" } }, "Relatório B3 — posições"),
      b.preview && h("span", { style: { fontWeight: 600 } }, `${b.preview.created} novas · ${b.preview.updated} atualizadas`)),
    b.err && h("div", { style: { padding: "12px 20px", fontSize: 12, fontWeight: 600, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)" } }, b.err),
    b.preview && h("div", { style: { maxHeight: 280, overflowY: "auto", background: "var(--bg-0)" } },
      h("table", { style: { width: "100%", borderCollapse: "collapse" } },
        h("tbody", null, b.preview.positions.map((p, i) => h("tr", { key: i, style: { borderBottom: i < b.preview.positions.length - 1 ? "1px solid var(--line-0)" : "none", fontSize: 13, transition: "background 0.1s" }, onMouseEnter: e => e.currentTarget.style.background = "var(--bg-1)", onMouseLeave: e => e.currentTarget.style.background = "transparent" },
          h("td", { style: { padding: "12px 16px", color: p.status === "new" ? "var(--pos)" : "var(--info)", fontWeight: 700, fontSize: 11 } }, p.status === "new" ? "NOVA" : "ATUALIZA"),
          h("td", { style: { padding: "12px 16px", color: "var(--fg-0)", width: "100%", fontWeight: 600 } }, p.name),
          h("td", { style: { padding: "12px 20px", textAlign: "right", fontWeight: 700, fontFamily: "var(--ff-mono)", color: "var(--fg-0)" } }, fmtBRL(p.balance))
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

  const _willRows = (groups || []).flatMap(g => groupNew(g.account));
  const _typeCounts = _willRows.reduce((acc, r) => { const t = classifyRow(r).tag; acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  const _breakdown = ["despesa", "receita", "crédito", "transferência", "investimento"]
    .filter(t => _typeCounts[t])
    .map(t => `${_typeCounts[t]} ${_typeCounts[t] > 1 ? t + "s" : t}`)
    .join(" · ");

  const step2View = h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 16 } },
    h("div", { style: { display: "flex", flexDirection: "column", gap: 12, maxHeight: "62vh", overflowY: "auto", paddingRight: 4 } },
      (groups || []).map(renderTxGroup),
      b3s.map(renderB3)
    ),
    err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err),
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--line-1)", paddingTop: 14 } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: 2 } },
        h("div", { style: { fontSize: 13, color: "var(--fg-2)" } },
          h("strong", { style: { color: "var(--pos)" } }, txWillImport),
          ` ${txWillImport === 1 ? "transação pronta" : "transações prontas"}`,
          b3Count > 0 && h("span", { style: { color: "var(--fg-3)" } }, ` · ${b3Count} B3`)),
        _breakdown && h("div", { style: { fontSize: 11, color: "var(--fg-3)" } }, _breakdown)),
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

window.BS = window.BS || {};
window.BS.ImportModal = ImportModal;
window.BS.EditableCell = EditableCell;

})();
