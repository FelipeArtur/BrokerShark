(function () {

const { useState: _ovSt, useEffect: _ovEf } = React;

function CategoriesPanel({ refreshKey, onRefresh, onClose }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [flow, setFlow] = _ovSt("expense");
  const [cats, setCats] = _ovSt([]);
  const [newName, setNewName] = _ovSt("");
  const [adding, setAdding] = _ovSt(false);
  const [err, setErr] = _ovSt("");
  const [deleteModal, setDeleteModal] = _ovSt(null);
  const [reassignTo, setReassignTo] = _ovSt("");
  const [deleting, setDeleting] = _ovSt(false);
  const [editingId, setEditingId] = _ovSt(null);
  const [editName, setEditName] = _ovSt("");

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

  async function commitRename(cat) {
    if (editName.trim() && editName.trim() !== cat.name) {
      await patchCategory(cat.id, editName.trim());
      fetchCategoriesFull(flow).then(setCats);
      onRefresh && onRefresh();
    }
    setEditingId(null);
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

  const swatch = flow === 'expense' ? "var(--neg)" : "var(--pos)";

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" } },

    h("div", { style: { padding: "20px 28px", borderBottom: "1px solid var(--line-1)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 } },
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("h2", { style: { margin: 0, fontFamily: "var(--ff-sans)", fontSize: 15, letterSpacing: "1px", textTransform: "uppercase", color: "var(--fg-0)" } }, "Categorias"),
        onClose && h("button", { className: "px-btn px-btn--ghost px-btn--sm", onClick: onClose, title: "Fechar (Esc)", "aria-label": "Fechar" }, "✕")
      ),
      h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2,
      }),
      h("form", { onSubmit: handleAdd, style: { display: "flex", gap: 8 } },
        h("input", {
          className: "px-field", type: "text", placeholder: `Nova categoria de ${flow === 'expense' ? 'despesa' : 'receita'}…`, value: newName,
          onChange: e => setNewName(e.target.value),
          style: { flex: 1 }
        }),
        h("button", {
          className: "px-btn px-btn--primary", type: "submit", disabled: adding || !newName.trim(),
        }, adding ? "ADICIONANDO…" : "ADICIONAR")
      ),
      err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err)
    ),

    h("div", { style: { flex: 1, overflowY: "auto" } },
      cats.length === 0
        ? h("div", { className: "px-empty" }, "Nenhuma categoria cadastrada")
        : h("div", { className: "px-list", style: { padding: "0 12px" } },
            cats.map((cat) => h("div", { className: "cat-row", key: cat.id },
              h("div", { className: "px-swatch", style: { background: swatch } }),
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
                : h("button", {
                    className: "cat-name",
                    onClick: () => { setEditingId(cat.id); setEditName(cat.name); },
                    title: "Clique para renomear"
                  }, cat.name),
              h("span", { className: "cat-count" },
                cat.transaction_count === 1 ? "1 lançamento" : `${cat.transaction_count} lançamentos`
              ),
              editingId !== cat.id && h("div", { className: "cat-actions" },
                h("button", {
                  className: "px-btn px-btn--ghost px-btn--sm", title: "Renomear", "aria-label": "Renomear",
                  onClick: () => { setEditingId(cat.id); setEditName(cat.name); }
                }, "✎"),
                h("button", {
                  className: "px-btn px-btn--ghost px-btn--sm cat-del", title: "Excluir", "aria-label": "Excluir",
                  onClick: () => { setDeleteModal(cat); setReassignTo(cat.transaction_count > 0 ? "" : "0"); setErr(""); }
                }, "×")
              )
            ))
          )
    ),

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
