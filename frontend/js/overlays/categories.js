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
   * @brief Grava o novo nome da categoria em edição, se de fato mudou.
   * @param cat categoria sendo renomeada
   */
  async function commitRename(cat) {
    if (editName.trim() && editName.trim() !== cat.name) {
      await patchCategory(cat.id, editName.trim());
      fetchCategoriesFull(flow).then(setCats);
      onRefresh && onRefresh();
    }
    setEditingId(null);
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
          h("div", { style: { width: 32, height: 32, background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-1)" } },
            h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" },
              h("line", { x1: 2, y1: 5, x2: 14, y2: 5 }), h("circle", { cx: 9.5, cy: 5, r: 1.7, fill: "currentColor", stroke: "none" }),
              h("line", { x1: 2, y1: 11, x2: 14, y2: 11 }), h("circle", { cx: 5.5, cy: 11, r: 1.7, fill: "currentColor", stroke: "none" })
            )
          ),
          h("h2", { style: { margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--fg-0)" } }, "Gerenciar Categorias")
        ),
        onClose && h("button", { className: "px-btn", onClick: onClose, title: "Fechar", "aria-label": "Fechar" }, "✕")
      ),
      h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2,
      })
    ),

    // Content
    h("div", { style: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "24px 32px", gap: 24 } },

      // Inline Add Form
      h("form", { onSubmit: handleAdd, className: "px-row" },
        h("div", { className: "px-swatch", style: { background: flow === 'expense' ? "var(--neg)" : "var(--pos)" } }, "+"),
        h("input", {
          className: "px-field", type: "text", placeholder: `Nova categoria de ${flow === 'expense' ? 'despesa' : 'receita'}...`, value: newName,
          onChange: e => setNewName(e.target.value),
          style: { flex: 1 }
        }),
        h("button", {
          className: "px-btn px-btn--primary", type: "submit", disabled: adding || !newName.trim(),
        }, adding ? "ADICIONANDO…" : "ADICIONAR")
      ),

      err && h("div", { style: { padding: "12px 16px", color: "var(--neg)", fontSize: 13, background: "color-mix(in oklch, var(--neg) 10%, transparent)", fontWeight: 500 } }, err),

      // Categories List
      cats.length === 0
        ? h("div", { className: "px-empty" }, "NENHUMA CATEGORIA CADASTRADA")
        : h("div", { className: "px-list" },
            cats.map((cat) => h("div", { className: "px-row", key: cat.id },
              h("div", { className: "px-swatch", style: { background: flow === 'expense' ? "var(--neg)" : "var(--pos)" } }),
              editingId === cat.id
                ? h("input", {
                    className: "px-field", autoFocus: true,
                    value: editName,
                    onChange: e => setEditName(e.target.value),
                    onKeyDown: e => {
                      if (e.key === "Escape") setEditingId(null);
                      if (e.key === "Enter") commitRename(cat);
                    },
                    onBlur: () => commitRename(cat),
                    style: { flex: 1 }
                  })
                : h("span", {
                    style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "var(--fg-0)", fontSize: 15, cursor: "text" },
                    onClick: () => { setEditingId(cat.id); setEditName(cat.name); },
                    title: "Clique para renomear"
                  }, cat.name),
              h("button", {
                className: "px-btn", title: "Renomear", "aria-label": "Renomear",
                onClick: () => { setEditingId(cat.id); setEditName(cat.name); }
              }, "✎"),
              h("span", { className: "px-chip" },
                cat.transaction_count === 1 ? "1 lançamento" : `${cat.transaction_count} lançamentos`
              ),
              h("button", {
                className: "px-btn px-btn--danger", title: "Excluir", "aria-label": "Excluir",
                onClick: () => { setDeleteModal(cat); setReassignTo(cat.transaction_count > 0 ? "" : "0"); setErr(""); }
              }, "×")
            ))
          )
    ),

    // Delete confirmation modal
    h(window.BS.Modal, { open: !!deleteModal, onClose: () => setDeleteModal(null), title: "Excluir Categoria", width: 400 },
      deleteModal && h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
        h("p", { style: { fontSize: 15, color: "var(--fg-0)", margin: 0, lineHeight: 1.4 } },
          "Deseja excluir a categoria ", h("strong", { style: { color: "var(--neg)" } }, deleteModal.name), "?"
        ),
        deleteModal.transaction_count > 0 && h("div", { style: { background: "color-mix(in oklch, var(--warn) 5%, transparent)", padding: 16, border: "1px solid color-mix(in oklch, var(--warn) 20%, transparent)" } },
          h("p", { style: { fontSize: 13, color: "var(--warn)", margin: "0 0 16px 0", fontWeight: 600 } },
            `⚠️ Existem ${deleteModal.transaction_count} lançamentos atrelados a ela.`
          ),
          h("label", { style: { fontSize: 11, color: "var(--fg-2)", marginBottom: 8, display: "block", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 } }, "Reatribuir para:"),
          h("select", {
            className: "px-field", value: reassignTo, onChange: e => setReassignTo(e.target.value),
            style: { width: "100%" }
          },
            h("option", { value: "", disabled: true }, "Escolher categoria destino…"),
            otherCats.map(c => h("option", { key: c.id, value: c.id }, c.name))
          )
        ),
        err && h("div", { style: { color: "var(--neg)", fontSize: 13, padding: "12px 16px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", fontWeight: 500 } }, err),
        h("div", { style: { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 } },
          h("button", { className: "px-btn", onClick: () => setDeleteModal(null) }, "CANCELAR"),
          h("button", {
            className: "px-btn px-btn--danger",
            onClick: handleDelete,
            disabled: deleting || (!reassignTo && deleteModal.transaction_count > 0),
          }, deleting ? "EXCLUINDO…" : "EXCLUIR DEFINITIVAMENTE")
        )
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.CategoriesPanel = CategoriesPanel;

})();
