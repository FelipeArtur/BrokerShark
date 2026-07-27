(function () {

const { useState: _ovSt, useEffect: _ovEf } = React;

// Regras aprendidas: categorizar grava `comerciante → categoria`, e daí em
// diante essa regra sugere sozinha. Sem tela, uma regra errada gravada uma vez
// sugeria errado pra sempre — o único conserto era recategorizar por acaso o
// mesmo comerciante. Mora aqui, e não num overlay próprio, porque regra é
// justamente "categoria vista pelo lado do comerciante": mesma cabeça, mesma
// entrada, um ponto de acesso a menos.
function RulesTab({ onRefresh }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [rules, setRules] = _ovSt(null);
  // As DUAS listas: uma regra pode apontar pra categoria de receita (estorno,
  // reembolso) enquanto a aba de categorias está em despesa. Com a lista
  // filtrada, o select não conteria o valor atual e a tela mostraria a regra
  // apontando pra categoria errada.
  const [cats, setCats] = _ovSt([]);
  const [err, setErr] = _ovSt("");
  const [busy, setBusy] = _ovSt(false);

  const reload = () => fetchRules().then(setRules).catch(e => setErr(e.message));
  _ovEf(() => {
    reload();
    Promise.all([fetchCategoriesFull("expense"), fetchCategoriesFull("income")])
      .then(([e, i]) => setCats([...e, ...i]))
      .catch(() => {});
  }, []);

  async function run(fn) {
    setBusy(true); setErr("");
    try { await fn(); await reload(); onRefresh && onRefresh(); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  if (rules == null) return h("div", { className: "px-empty" }, "Carregando…");

  if (!rules.length) {
    return h("div", { className: "px-empty", style: { lineHeight: 1.6 } },
      "Nenhuma regra ainda.", h("br"),
      h("span", { style: { fontSize: 11 } },
        "Toda vez que você categoriza um lançamento, o comerciante dele vira uma regra e passa a sugerir sozinho. Elas aparecem aqui pra você corrigir ou apagar."));
  }

  return h(React.Fragment, null,
    err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px" } }, err),
    h("div", { className: "px-list", style: { padding: "0 12px" } },
      rules.map(r => h("div", {
        key: r.id, className: "cat-row",
        style: r.enabled ? null : { opacity: 0.5 },
      },
        h("div", { className: "px-swatch", style: { background: r.orphan ? "var(--neg)" : "var(--accent)" } }),

        h("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } },
          h("span", { className: "mono", style: { fontSize: 12, color: "var(--fg-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.matcher),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } },
            r.pending_matches > 0
              ? `pegaria ${r.pending_matches} ${r.pending_matches === 1 ? "lançamento" : "lançamentos"} sem categoria`
              : "nada sem categoria pra pegar agora")),

        r.orphan
          ? h("span", { style: { fontSize: 11, color: "var(--neg)", flexShrink: 0 } }, "categoria apagada")
          : h("select", {
              className: "px-field", value: r.category_id ?? "", disabled: busy,
              style: { flexShrink: 0, maxWidth: 190 },
              onChange: e => run(() => patchRule(r.id, { category_id: Number(e.target.value) })),
            }, cats.map(c => h("option", { key: c.id, value: c.id }, c.name))),

        h("div", { className: "cat-actions" },
          h("button", {
            className: "px-btn px-btn--ghost px-btn--sm", disabled: busy,
            title: r.enabled ? "Desligar — para de sugerir, mas a regra fica" : "Religar",
            onClick: () => run(() => patchRule(r.id, { enabled: r.enabled ? 0 : 1 })),
          }, r.enabled ? "◉" : "○"),
          h("button", {
            className: "px-btn px-btn--ghost px-btn--sm cat-del", disabled: busy,
            title: "Apagar a regra — o que já foi categorizado não muda",
            onClick: () => run(() => deleteRule(r.id)),
          }, "×"),
        ),
      ))),
  );
}

function CategoriesPanel({ refreshKey, onRefresh, onClose }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [tab, setTab] = _ovSt("cats");
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
        h("h2", { style: { margin: 0, fontFamily: "var(--ff-sans)", fontSize: 15, letterSpacing: "1px", textTransform: "uppercase", color: "var(--fg-0)" } },
          tab === "rules" ? "Regras de categoria" : "Categorias"),
        onClose && h("button", { className: "px-btn px-btn--ghost px-btn--sm", onClick: onClose, title: "Fechar (Esc)", "aria-label": "Fechar" }, "✕")
      ),
      h(window.BS.SegmentControl, {
        options: [{ value: "cats", label: "Categorias" }, { value: "rules", label: "Regras" }],
        value: tab, onChange: setTab, columns: 2, fill: true,
      }),
      tab === "cats" && h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2, fill: true,
      }),
      tab === "cats" && h("form", { onSubmit: handleAdd, style: { display: "flex", gap: 8 } },
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
      tab === "rules"
        ? h(RulesTab, { onRefresh })
        : cats.length === 0
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
