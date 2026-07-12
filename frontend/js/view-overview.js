/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/* view-overview.js — CategoriesPanel (a antiga tela "Dinheiro" virou o dashboard;
   ver view-dashboard.js) */
/* global React, fetchCategoriesFull, postCategory, deleteCategory */

const { useState: _ovSt, useEffect: _ovEf } = React;

/* ── CategoriesPanel — gerenciar categorias (Drawer via TweaksPanel) ──────────
   Restaurada após o pivot ter apagado a declaração da função mas deixado o corpo
   (form + lista + modal de exclusão) preso dentro de OverviewView, que quebrava
   a tela Dinheiro com dados (`handleAdd`/`CategoriesPanel is not defined`). */
function CategoriesPanel({ refreshKey, onRefresh, onClose }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [flow, setFlow] = _ovSt("expense");
  const [cats, setCats] = _ovSt([]);
  const [newName, setNewName] = _ovSt("");
  const [adding, setAdding] = _ovSt(false);
  const [err, setErr] = _ovSt("");
  const [deleteModal, setDeleteModal] = _ovSt(null); // {id, name, transaction_count}
  const [reassignTo, setReassignTo] = _ovSt("");
  const [deleting, setDeleting] = _ovSt(false);

  _ovEf(() => { fetchCategoriesFull(flow).then(setCats); }, [flow, refreshKey]);

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true); setErr("");
    try {
      await postCategory(name, flow);
      setNewName("");
      fetchCategoriesFull(flow).then(setCats);
      onRefresh && onRefresh();
    } catch (ex) { setErr(ex.message); } finally { setAdding(false); }
  }

  async function handleDelete() {
    if (!deleteModal || !reassignTo) return;
    setDeleting(true); setErr("");
    try {
      await deleteCategory(deleteModal.id, parseInt(reassignTo));
      setDeleteModal(null); setReassignTo("");
      fetchCategoriesFull(flow).then(setCats);
      onRefresh && onRefresh();
    } catch (ex) { setErr(ex.message); } finally { setDeleting(false); }
  }

  const otherCats = deleteModal ? cats.filter(c => c.id !== deleteModal.id) : cats;

  return h("div", { className: "fade-in", style: { padding: "20px 0", maxWidth: 640, margin: "0 auto" } },
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
        onClose && h("button", {
          onClick: onClose, title: "Voltar",
          style: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-2)", cursor: "pointer", transition: "all 0.1s" },
          onMouseEnter: e => { e.currentTarget.style.color = "var(--fg-0)"; e.currentTarget.style.background = "var(--bg-2)"; },
          onMouseLeave: e => { e.currentTarget.style.color = "var(--fg-2)"; e.currentTarget.style.background = "var(--bg-1)"; }
        }, "←"),
        h("span", { style: { fontWeight: 700, fontSize: "var(--fz-4)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-2)" } }, "Gerenciar Categorias")
      ),
      h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2,
      })
    ),

    h("div", { className: "panel", style: { display: "flex", flexDirection: "column", overflow: "hidden" } },

      // Inline Add Form (First Row)
      h("form", { onSubmit: handleAdd, style: { display: "flex", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-0)" } },
        h("div", { style: { width: 8, height: 8, borderRadius: "50%", background: "transparent", border: "1px dashed var(--fg-3)", marginRight: 12 } }),
        h("input", {
          type: "text", placeholder: `Adicionar nova categoria de ${flow === 'expense' ? 'despesa' : 'receita'}...`, value: newName,
          onChange: e => setNewName(e.target.value),
          style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--fg-1)", fontSize: 14, fontWeight: 500, padding: 0 }
        }),
        h("button", {
          type: "submit", disabled: adding || !newName.trim(),
          style: { fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 8px", background: "var(--bg-2)", borderRadius: 4, cursor: newName.trim() ? "pointer" : "default", opacity: newName.trim() ? 1 : 0.5 }
        }, adding ? "..." : "ENTER ↵")
      ),
      err && h("div", { style: { padding: "12px 24px", color: "var(--neg)", fontSize: 12, background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderBottom: "1px solid var(--line-1)" } }, err),

      // Categories List
      h("div", { style: { display: "flex", flexDirection: "column" } },
        cats.length === 0 
          ? h("div", { style: { padding: 32, textAlign: "center", color: "var(--fg-3)", fontSize: 13, fontStyle: "italic" } }, "Nenhuma categoria cadastrada.")
          : cats.map((cat, i) => h("div", { 
              key: cat.id, 
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", borderBottom: i < cats.length - 1 ? "1px dashed var(--line-1)" : "none", transition: "background 0.1s" },
              onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-2)",
              onMouseLeave: (e) => e.currentTarget.style.background = "transparent",
            },
              h("div", { style: { fontWeight: 500, color: "var(--fg-1)", display: "flex", alignItems: "center", gap: 12, fontSize: 14 } }, 
                h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: flow === 'expense' ? "var(--neg)" : "var(--pos)" } }),
                cat.name
              ),
              h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
                h("div", { className: "num", style: { color: "var(--fg-3)", fontSize: 13 } }, `${cat.transaction_count} lançamentos`),
                h("button", {
                  title: "Excluir",
                  style: { color: "var(--fg-3)", fontSize: 16, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", cursor: "pointer", transition: "color 0.1s, background 0.1s" },
                  onMouseEnter: (e) => { e.currentTarget.style.color = "var(--neg)"; e.currentTarget.style.background = "color-mix(in oklch, var(--neg) 10%, transparent)"; },
                  onMouseLeave: (e) => { e.currentTarget.style.color = "var(--fg-3)"; e.currentTarget.style.background = "transparent"; },
                  onClick: () => { setDeleteModal(cat); setReassignTo(cat.transaction_count > 0 ? "" : "0"); setErr(""); }
                }, "×")
              )
            ))
      )
    ),

    // Delete confirmation modal
    h(window.BS.Modal, { open: !!deleteModal, onClose: () => setDeleteModal(null), title: "Excluir Categoria", width: 400 },
      deleteModal && h("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
        h("p", { style: { fontSize: 14, color: "var(--fg-1)", margin: 0 } }, 
          "Tem certeza que deseja excluir a categoria ", h("strong", null, deleteModal.name), "?"
        ),
        deleteModal.transaction_count > 0 && h("div", { style: { background: "var(--bg-1)", padding: 16, borderRadius: 8, border: "1px solid var(--line-1)" } },
          h("p", { style: { fontSize: 13, color: "var(--warn)", margin: "0 0 12px 0", fontWeight: 500 } },
            `Há ${deleteModal.transaction_count} lançamento(s) usando esta categoria.`
          ),
          h("label", { style: { fontSize: 11, color: "var(--fg-2)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.05em" } }, "Reatribuir para:"),
          h("select", {
            value: reassignTo, onChange: e => setReassignTo(e.target.value),
            className: "select", style: { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line-1)", background: "var(--bg-0)" }
          },
            h("option", { value: "", disabled: true }, "Escolher categoria destino…"),
            otherCats.map(c => h("option", { key: c.id, value: c.id }, c.name))
          )
        ),
        err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err),
        h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 } },
          h("button", { className: "btn btn-ghost", onClick: () => setDeleteModal(null) }, "Cancelar"),
          h("button", {
            className: "btn",
            onClick: handleDelete,
            disabled: deleting || (!reassignTo && deleteModal.transaction_count > 0),
            style: { background: "var(--neg)", color: "var(--fg-0)", borderColor: "var(--neg)", padding: "8px 16px", borderRadius: 6 }
          }, deleting ? "Excluindo…" : "Excluir Definitivamente")
        )
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.CategoriesPanel = CategoriesPanel;

})();
