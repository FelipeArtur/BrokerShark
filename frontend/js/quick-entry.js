/* global React, postImportCsvPreview, postImportCsvConfirm, fetchExpenseCategories */

/* ── ImportModal ──────────────────────────────────────────────────────────── */
const { useState: _qSt, useMemo: _qMemo, useEffect: _imEf, useRef: _imRef } = React;

const IMPORT_ACCOUNTS = [
  { id: "nu-cc",    label: "Nubank · Crédito (fatura)" },
  { id: "inter-cc", label: "Inter · Crédito (fatura)"  },
  { id: "nu-db",    label: "Nubank · Conta corrente"   },
  { id: "inter-db", label: "Inter · Conta corrente"    },
];

const TYPE_LABELS = {
  transfer:            "Transfer. interna",
  investment_movement: "Investimento",
};

const _OVERLAY = { position: "fixed", inset: 0, background: "oklch(0% 0 0 / 0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 };
const _BOX_BASE = { background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: 12, boxShadow: "0 20px 60px oklch(0% 0 0 / 0.4)", display: "flex", flexDirection: "column" };
const _HDR = { padding: "14px 18px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between" };

function ImportModal({ open, onClose, onImported, defaultAccountId }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [step, setStep]           = _qSt("upload");
  const [accountId, setAccountId] = _qSt(defaultAccountId || "nu-cc");
  const [file, setFile]           = _qSt(null);
  const [rows, setRows]           = _qSt([]);
  const [expCats, setExpCats]     = _qSt([]);
  const [loading, setLoading]     = _qSt(false);
  const [error, setError]         = _qSt(null);
  const [saving, setSaving]       = _qSt(false);
  const [result, setResult]       = _qSt(null);
  const fileRef   = _imRef(null);
  const dialogRef = _imRef(null);
  const titleId   = _imRef("im-" + Math.random().toString(36).slice(2)).current;

  _imEf(() => {
    if (open) {
      setStep("upload"); setFile(null); setRows([]); setError(null); setResult(null);
      fetchExpenseCategories().then(setExpCats).catch(() => {});
    }
  }, [open]);

  _imEf(() => {
    if (defaultAccountId) setAccountId(defaultAccountId);
  }, [defaultAccountId]);

  _imEf(() => {
    if (!open) return;
    const sel = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const get = () => Array.from(dialogRef.current?.querySelectorAll(sel) || []);
    const raf = requestAnimationFrame(() => get()[0]?.focus());
    function trap(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const nodes = get();
      if (!nodes.length) { e.preventDefault(); return; }
      const fi = nodes[0], la = nodes[nodes.length - 1];
      if (e.shiftKey) { if (document.activeElement === fi) { e.preventDefault(); la.focus(); } }
      else            { if (document.activeElement === la) { e.preventDefault(); fi.focus(); } }
    }
    document.addEventListener("keydown", trap);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("keydown", trap); };
  }, [open, step]);

  async function handleAnalyze() {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const res = await postImportCsvPreview(file, accountId);
      if (res.error) { setError(res.error); return; }
      setRows(res.rows.map(r => ({ ...r })));
      setStep("review");
    } catch (e) {
      setError(e.message || "Erro ao processar CSV.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setSaving(true); setError(null);
    try {
      const res = await postImportCsvConfirm(rows);
      setResult(res);
      if (res.imported > 0) onImported && onImported();
    } catch (e) {
      setError(e.message || "Erro ao importar.");
    } finally {
      setSaving(false);
    }
  }

  function toggleDupes(val) {
    setRows(prev => prev.map(r => r.is_duplicate ? { ...r, include: val } : r));
  }
  function setRowField(idx, key, val) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));
  }

  const included    = rows.filter(r => r.include).length;
  const dupeCount   = rows.filter(r => r.is_duplicate).length;
  const specialCount = rows.filter(r => r._type === "transfer" || r._type === "investment_movement").length;
  const newCount    = rows.filter(r => !r.is_duplicate).length;

  if (!open) return null;

  // ── Result screen ──
  if (result) {
    return h("div", { style: _OVERLAY, onClick: onClose },
      h("div", { ref: dialogRef, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
                 style: { ..._BOX_BASE, width: 400, maxWidth: "92vw" }, onClick: e => e.stopPropagation() },
        h("div", { style: _HDR },
          h("div", { id: titleId, style: { fontWeight: 600, fontSize: "var(--fz-5)" } }, "Importação concluída"),
          h("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "✕")
        ),
        h("div", { style: { padding: "24px 20px", textAlign: "center", display: "flex", flexDirection: "column", gap: 12 } },
          h("div", { style: { fontSize: 40 } }, result.imported > 0 ? "✓" : "—"),
          h("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--fg-0)" } },
            `${result.imported} lançamento${result.imported !== 1 ? "s" : ""} importado${result.imported !== 1 ? "s" : ""}`
          ),
          result.skipped > 0 && h("div", { style: { fontSize: 12, color: "var(--fg-3)" } }, `${result.skipped} pulados`),
          result.errors?.length > 0 && h("div", { style: { fontSize: 11, color: "var(--neg)", textAlign: "left", background: "var(--bg-2)", padding: 10, borderRadius: 6, maxHeight: 100, overflowY: "auto" } },
            result.errors.map((e, i) => h("div", { key: i }, e))
          ),
          h("button", { className: "btn btn-primary", onClick: onClose, style: { marginTop: 8 } }, "Fechar")
        )
      )
    );
  }

  // ── Upload step ──
  if (step === "upload") {
    return h("div", { style: _OVERLAY, onClick: onClose },
      h("div", { ref: dialogRef, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
                 style: { ..._BOX_BASE, width: 440, maxWidth: "92vw" }, onClick: e => e.stopPropagation() },
        h("div", { style: _HDR },
          h("div", { id: titleId, style: { fontWeight: 600, fontSize: "var(--fz-5)" } }, "Importar CSV"),
          h("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "✕")
        ),
        h("div", { style: { padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 14 } },
          h("div", null,
            h("label", { htmlFor: "im-account", style: { fontSize: 11, fontWeight: 600, color: "var(--fg-2)", display: "block", marginBottom: 6 } }, "Conta"),
            h("select", {
              id: "im-account", className: "select", value: accountId, onChange: e => setAccountId(e.target.value),
              style: { width: "100%", height: 34 }
            },
              IMPORT_ACCOUNTS.map(a => h("option", { key: a.id, value: a.id }, a.label))
            )
          ),
          h("div", {
            onClick: () => fileRef.current?.click(),
            onDragOver: e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--info)"; },
            onDragLeave: e => { e.currentTarget.style.borderColor = ""; },
            onDrop: e => {
              e.preventDefault(); e.currentTarget.style.borderColor = "";
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            },
            style: { border: "2px dashed var(--line-2)", borderRadius: 8, padding: "28px 20px", textAlign: "center", cursor: "pointer", transition: "border-color 0.15s" }
          },
            h("input", { ref: fileRef, type: "file", accept: ".csv", style: { display: "none" },
              onChange: e => { const f = e.target.files[0]; if (f) setFile(f); } }),
            file
              ? h("div", null,
                  h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-0)" } }, file.name),
                  h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 4 } }, `${(file.size / 1024).toFixed(1)} KB · clique para trocar`)
                )
              : h("div", null,
                  h("div", { style: { fontSize: 24, marginBottom: 8 } }, "⤓"),
                  h("div", { style: { fontSize: 12, color: "var(--fg-2)" } }, "Arraste o arquivo CSV aqui"),
                  h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 4 } }, "ou clique para selecionar")
                )
          ),
          error && h("div", { style: { fontSize: 11, color: "var(--neg)", padding: "6px 10px", background: "var(--bg-2)", borderRadius: 6 } }, error),
          h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
            h("button", { className: "btn", onClick: onClose }, "Cancelar"),
            h("button", { className: "btn btn-primary", disabled: !file || loading, onClick: handleAnalyze },
              loading ? "Analisando…" : "Analisar CSV")
          )
        )
      )
    );
  }

  // ── Review step ──
  return h("div", { style: _OVERLAY, onClick: onClose },
    h("div", { ref: dialogRef, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId,
               style: { ..._BOX_BASE, width: "min(92vw, 840px)", maxHeight: "85vh" }, onClick: e => e.stopPropagation() },
      // Header
      h("div", { style: { ..._HDR } },
        h("div", { style: { display: "flex", alignItems: "baseline", gap: 10 } },
          h("div", { id: titleId, style: { fontWeight: 600, fontSize: "var(--fz-5)" } }, "Revisar importação"),
          h("span", { style: { fontSize: 11, color: "var(--fg-3)" } },
            `${newCount} novas · ${dupeCount} duplic. · ${specialCount} internas`
          )
        ),
        h("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "✕")
      ),

      // Bulk actions
      dupeCount > 0 && h("div", { style: { padding: "6px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", gap: 8, alignItems: "center" } },
        h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, `${dupeCount} duplicata${dupeCount !== 1 ? "s" : ""}:`),
        h("button", { className: "btn btn-ghost btn-sm", onClick: () => toggleDupes(false) }, "Desmarcar"),
        h("button", { className: "btn btn-ghost btn-sm", onClick: () => toggleDupes(true) }, "Marcar todas"),
      ),

      // Table
      h("div", { style: { flex: 1, overflowY: "auto" } },
        h("table", { className: "grid-table", style: { fontSize: 11 } },
          h("thead", null,
            h("tr", null,
              h("th", { style: { width: 64 } }, "Data"),
              h("th", null, "Descrição"),
              h("th", { style: { width: 80 } }, "Conta"),
              h("th", { style: { width: 140 } }, "Categoria"),
              h("th", { style: { width: 100, textAlign: "right" } }, "Valor"),
              h("th", { style: { width: 36, textAlign: "center" } }, "✓"),
            )
          ),
          h("tbody", null,
            rows.map((row, idx) => {
              const isDup     = row.is_duplicate;
              const isSpecial = row._type === "transfer" || row._type === "investment_movement";
              const rowBg     = isDup ? "color-mix(in oklch, var(--warn) 7%, transparent)" : "transparent";
              return h("tr", { key: idx, style: { background: rowBg, opacity: row.include ? 1 : 0.4 } },
                h("td", { className: "mono", style: { color: "var(--fg-2)", fontSize: 10 } },
                  row.date ? row.date.slice(5).replace("-", "/") : "—"
                ),
                h("td", { style: { maxWidth: 0 } },
                  h("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: row.description },
                    row.description,
                    isDup && h("span", { style: { marginLeft: 5, fontSize: 9, color: "var(--warn)", fontWeight: 700 } }, "DUP")
                  )
                ),
                h("td", { style: { fontSize: 10, color: "var(--fg-3)" } },
                  row.account_id || row.investment_name || "—"
                ),
                h("td", null,
                  isSpecial
                    ? h("span", { className: "chip", style: { fontSize: 9 } }, TYPE_LABELS[row._type])
                    : row.flow === "income"
                      ? h("span", { className: "chip pos", style: { fontSize: 9 } }, "Receita")
                      : h("select", {
                          className: "select", style: { height: 22, fontSize: 10, padding: "0 4px" },
                          value: row.category_id || "",
                          onChange: e => setRowField(idx, "category_id", parseInt(e.target.value) || null),
                        },
                          h("option", { value: "" }, "— categoria —"),
                          expCats.map(c => h("option", { key: c.id, value: c.id }, c.name))
                        )
                ),
                h("td", { className: "num", style: { color: row.flow === "expense" || row._type === "investment_movement" ? "var(--neg)" : "var(--pos)", fontWeight: 600 } },
                  (row.flow === "expense" || row._type === "investment_movement" ? "−" : "+"),
                  " R$ ",
                  (row.amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                ),
                h("td", { style: { textAlign: "center" } },
                  h("input", {
                    type: "checkbox", checked: !!row.include,
                    onChange: e => setRowField(idx, "include", e.target.checked),
                    style: { cursor: "pointer", width: 14, height: 14 }
                  })
                )
              );
            })
          )
        )
      ),

      // Footer
      h("div", { style: { padding: "10px 16px", borderTop: "1px solid var(--line-1)", display: "flex", alignItems: "center", gap: 10 } },
        error && h("span", { style: { flex: 1, fontSize: 11, color: "var(--neg)" } }, error),
        h("div", { style: { flex: 1 } }),
        h("button", { className: "btn", onClick: () => { setStep("upload"); setRows([]); setError(null); } }, "← Voltar"),
        h("button", {
          className: "btn btn-primary", disabled: included === 0 || saving,
          onClick: handleConfirm,
        }, saving ? "Importando…" : `Importar ${included} lançamento${included !== 1 ? "s" : ""}`)
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.ImportModal = ImportModal;
