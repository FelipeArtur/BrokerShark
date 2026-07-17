/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/**
 * @file categories.js
 * @brief CategoriesPanel — gerenciamento de categorias (criar, renomear,
 *        excluir com reatribuição), aberto como Drawer pelo painel de ajustes.
 */
/* view-overview.js — CategoriesPanel (a antiga tela "Dinheiro" virou o dashboard;
   ver view-dashboard.js) */
/* global React, fetchCategoriesFull, postCategory, patchCategory, deleteCategory */

const { useState: _ovSt, useEffect: _ovEf } = React;

/* ── CategoriesPanel — gerenciar categorias (Drawer via TweaksPanel) ──────────
   Restaurada após o pivot ter apagado a declaração da função mas deixado o corpo
   (form + lista + modal de exclusão) preso dentro de OverviewView, que quebrava
   a tela Dinheiro com dados (`handleAdd`/`CategoriesPanel is not defined`). */
/**
 * @brief Renderiza o painel de gerenciamento de categorias.
 * @param props.refreshKey muda para forçar a recarga da lista
 * @param props.onRefresh avisa o shell que as categorias mudaram
 * @param props.onClose fecha o painel; ausente esconde o botão ✕
 * @return elemento React do painel
 */
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
  const [editingId, setEditingId] = _ovSt(null);
  const [editName, setEditName] = _ovSt("");

  _ovEf(() => { fetchCategoriesFull(flow).then(setCats); }, [flow, refreshKey]);

  /**
   * @brief Cria a categoria digitada no formulário e recarrega a lista.
   * @param e evento de submit do form
   */
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

  /**
   * @brief Exclui a categoria do modal, reatribuindo os lançamentos dela.
   *
   * Exige um destino escolhido: excluir sem reatribuir deixaria lançamentos
   * órfãos, indistinguíveis dos que ainda faltam categorizar.
   */
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

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" } },
    
    // Header
    h("div", { style: { padding: "24px 32px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-0)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 } },
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
          h("div", { style: { width: 32, height: 32, borderRadius: "50%", background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-1)" } },
            h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" },
              h("line", { x1: 2, y1: 5, x2: 14, y2: 5 }), h("circle", { cx: 9.5, cy: 5, r: 1.7, fill: "currentColor", stroke: "none" }),
              h("line", { x1: 2, y1: 11, x2: 14, y2: 11 }), h("circle", { cx: 5.5, cy: 11, r: 1.7, fill: "currentColor", stroke: "none" })
            )
          ),
          h("h2", { style: { margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--fg-0)" } }, "Gerenciar Categorias")
        ),
        onClose && h("button", {
          onClick: onClose, title: "Fechar",
          style: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "transparent", border: "none", color: "var(--fg-3)", cursor: "pointer", transition: "all 0.1s" },
          onMouseEnter: e => { e.currentTarget.style.color = "var(--fg-0)"; e.currentTarget.style.background = "var(--bg-2)"; },
          onMouseLeave: e => { e.currentTarget.style.color = "var(--fg-3)"; e.currentTarget.style.background = "transparent"; }
        }, "✕")
      ),
      h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2,
      })
    ),

    // Content
    h("div", { style: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "24px 32px", gap: 24 } },
      
      // Inline Add Form
      h("form", { onSubmit: handleAdd, style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, border: "1px solid var(--line-2)", background: "var(--bg-1)", transition: "border 0.2s", boxShadow: "0 2px 8px oklch(0% 0 0 / 0.05)" } },
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: flow === 'expense' ? "color-mix(in oklch, var(--neg) 15%, transparent)" : "color-mix(in oklch, var(--pos) 15%, transparent)", color: flow === 'expense' ? "var(--neg)" : "var(--pos)", fontWeight: 700, fontSize: 16, lineHeight: 1 } }, "+"),
        h("input", {
          type: "text", placeholder: `Nova categoria de ${flow === 'expense' ? 'despesa' : 'receita'}...`, value: newName,
          onChange: e => setNewName(e.target.value),
          style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--fg-0)", fontSize: 15, fontWeight: 500 }
        }),
        h("button", {
          type: "submit", disabled: adding || !newName.trim(),
          style: { fontSize: 13, fontWeight: 600, color: "var(--fg-0)", padding: "6px 16px", background: "var(--bg-3)", border: "none", borderRadius: 6, cursor: newName.trim() ? "pointer" : "default", opacity: newName.trim() ? 1 : 0.5, transition: "opacity 0.2s" }
        }, adding ? "..." : "Adicionar")
      ),

      err && h("div", { style: { padding: "12px 16px", color: "var(--neg)", fontSize: 13, background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 8, fontWeight: 500 } }, err),

      // Categories List
      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        cats.length === 0 
          ? h("div", { style: { padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 14, fontWeight: 500 } }, "Nenhuma categoria cadastrada.")
          : cats.map((cat, i) => h("div", { 
              key: cat.id, 
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderRadius: 8, background: "transparent", transition: "background 0.1s" },
              onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-1)",
              onMouseLeave: (e) => e.currentTarget.style.background = "transparent",
            },
              h("div", { style: { display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 } }, 
                h("div", { style: { width: 8, height: 8, borderRadius: "50%", background: flow === 'expense' ? "var(--neg)" : "var(--pos)", flexShrink: 0 } }),
                editingId === cat.id
                  ? h("input", {
                      autoFocus: true,
                      value: editName,
                      onChange: e => setEditName(e.target.value),
                      onKeyDown: async (e) => {
                        if (e.key === "Escape") setEditingId(null);
                        if (e.key === "Enter") {
                          if (editName.trim() && editName.trim() !== cat.name) {
                            await patchCategory(cat.id, editName.trim());
                            fetchCategoriesFull(flow).then(setCats);
                            onRefresh && onRefresh();
                          }
                          setEditingId(null);
                        }
                      },
                      onBlur: async () => {
                        if (editName.trim() && editName.trim() !== cat.name) {
                          await patchCategory(cat.id, editName.trim());
                          fetchCategoriesFull(flow).then(setCats);
                          onRefresh && onRefresh();
                        }
                        setEditingId(null);
                      },
                      style: { flex: 1, background: "var(--bg-2)", border: "none", outline: "none", color: "var(--fg-0)", fontSize: 15, fontWeight: 600, padding: "4px 8px", borderRadius: 6, margin: "-4px 0" }
                    })
                  : h("span", { 
                      style: { fontWeight: 600, color: "var(--fg-0)", fontSize: 15, cursor: "text" },
                      onClick: () => { setEditingId(cat.id); setEditName(cat.name); },
                      title: "Clique para renomear"
                    }, cat.name)
              ),
              h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
                h("span", { style: { color: "var(--fg-3)", fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" } }, 
                  cat.transaction_count === 1 ? "1 lançamento" : `${cat.transaction_count} lançamentos`
                ),
                h("button", {
                  title: "Excluir",
                  style: { color: "var(--fg-3)", fontSize: 18, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer", transition: "all 0.1s" },
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
      deleteModal && h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
        h("p", { style: { fontSize: 15, color: "var(--fg-0)", margin: 0, lineHeight: 1.4 } }, 
          "Deseja excluir a categoria ", h("strong", { style: { color: "var(--neg)" } }, deleteModal.name), "?"
        ),
        deleteModal.transaction_count > 0 && h("div", { style: { background: "color-mix(in oklch, var(--warn) 5%, transparent)", padding: 16, borderRadius: 8, border: "1px solid color-mix(in oklch, var(--warn) 20%, transparent)" } },
          h("p", { style: { fontSize: 13, color: "var(--warn)", margin: "0 0 16px 0", fontWeight: 600 } },
            `⚠️ Existem ${deleteModal.transaction_count} lançamentos atrelados a ela.`
          ),
          h("label", { style: { fontSize: 11, color: "var(--fg-2)", marginBottom: 8, display: "block", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 } }, "Reatribuir para:"),
          h("select", {
            value: reassignTo, onChange: e => setReassignTo(e.target.value),
            className: "select", style: { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--line-2)", background: "var(--bg-0)", fontSize: 14, fontWeight: 500, color: "var(--fg-0)", outline: "none" }
          },
            h("option", { value: "", disabled: true }, "Escolher categoria destino…"),
            otherCats.map(c => h("option", { key: c.id, value: c.id }, c.name))
          )
        ),
        err && h("div", { style: { color: "var(--neg)", fontSize: 13, padding: "12px 16px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 8, fontWeight: 500 } }, err),
        h("div", { style: { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 } },
          h("button", { className: "btn btn-ghost", style: { fontSize: 14, fontWeight: 600 }, onClick: () => setDeleteModal(null) }, "Cancelar"),
          h("button", {
            className: "btn",
            onClick: handleDelete,
            disabled: deleting || (!reassignTo && deleteModal.transaction_count > 0),
            style: { background: "var(--neg)", color: "var(--fg-0)", border: "none", padding: "0 20px", height: 36, borderRadius: 6, fontSize: 14, fontWeight: 600, opacity: (deleting || (!reassignTo && deleteModal.transaction_count > 0)) ? 0.5 : 1 }
          }, deleting ? "Excluindo…" : "Excluir Definitivamente")
        )
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.CategoriesPanel = CategoriesPanel;

})();
