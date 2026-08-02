(function () {

const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

const { useState: _ovSt, useEffect: _ovEf } = React;

// Regras aprendidas: categorizar grava `comerciante → categoria`, e daí em
// diante essa regra sugere sozinha. Sem tela, uma regra errada gravada uma vez
// sugeria errado pra sempre — o único conserto era recategorizar por acaso o
// mesmo comerciante. Mora aqui, e não num overlay próprio, porque regra é
// justamente "categoria vista pelo lado do comerciante": mesma cabeça, mesma
// entrada, um ponto de acesso a menos.
function RulesTab({ onRefresh }) {
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
      "Nada aprendido ainda — categorize um lançamento e a primeira aparece aqui.");
  }

  return h(React.Fragment, null,
    err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 0" } }, err),
    h("div", { className: "px-list" },
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

  // `reassignTo` vazio significa "deixar sem categoria", que é uma escolha
  // válida — não um formulário pela metade. Antes, categoria sem lançamento
  // nenhum abria com `"0"` e o cliente mandava `reassign_to_id: 0`, que o
  // servidor recusa (id tem que ser > 0): excluir uma categoria vazia era
  // impossível, e a mensagem falava de "categoria de destino" numa tela onde
  // nem havia destino a escolher.
  async function handleDelete() {
    if (!deleteModal) return;
    setDeleting(true); setErr("");
    try {
      await deleteCategory(deleteModal.id, reassignTo ? parseInt(reassignTo, 10) : undefined);
      setDeleteModal(null); setReassignTo("");
      fetchCategoriesFull(flow).then(setCats);
      onRefresh && onRefresh();
    } catch (ex) { setErr(ex.message); } finally { setDeleting(false); }
  }

  const otherCats = deleteModal ? cats.filter(c => c.id !== deleteModal.id) : cats;

  const swatch = flow === 'expense' ? "var(--neg)" : "var(--pos)";

  // Categoria é o corpo; regra é consequência dela. Antes as duas eram abas
  // irmãs, o que escondia a função central atrás de um clique e dava a "Regras"
  // um peso que ela não tem — ninguém abre este painel pra mexer em regra.
  return h(window.BS.Modal, { open: true, onClose, title: "Categorias", width: 620 },
    h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },

      h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2, fill: true,
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
      err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),

      cats.length === 0
        ? h("div", { className: "px-empty" }, "Nenhuma categoria de " + (flow === "expense" ? "despesa" : "receita") + " ainda.")
        : h("div", { className: "px-list" },
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
                  onClick: () => { setDeleteModal(cat); setReassignTo(""); setErr(""); }
                }, "×")
              )
            ))
          ),

      // A pergunta que o painel antigo deixava sem resposta era "de onde
      // surgiram essas regras?". A resposta está aqui, na primeira linha, e não
      // numa aba com nome de jargão.
      h("details", { className: "px-details" },
        h("summary", null, "O que o BrokerShark aprendeu sozinho"),
        h("p", { style: { margin: "0 0 10px", fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6 } },
          "Quando você escolhe a categoria de um lançamento, o BrokerShark guarda o comerciante dele. ",
          "Na próxima vez que o mesmo nome aparecer, a categoria vem sugerida na tabela do mês, ",
          "na categorização em lote e na prévia do import. Ele nunca aplica sozinho: você confirma. ",
          "Corrija ou apague aqui o que ficou errado; lançamento já categorizado não muda."),
        h(RulesTab, { onRefresh }),
      ),
    ),

    h(window.BS.Modal, { open: !!deleteModal, onClose: () => setDeleteModal(null), title: "Excluir categoria", width: 400 },
      deleteModal && h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },
        h("p", { style: { fontSize: 15, color: "var(--fg-0)", margin: 0, lineHeight: 1.4 } },
          "Deseja excluir a categoria ", h("strong", { style: { color: "var(--neg)" } }, deleteModal.name), "?"
        ),
        deleteModal.transaction_count === 0
          ? h("p", { style: { fontSize: 12, color: "var(--fg-3)", margin: 0, lineHeight: 1.5 } },
              "Nenhum lançamento usa esta categoria, então nada muda no seu histórico.")
          : h("div", { style: { background: "color-mix(in oklch, var(--warn) 5%, transparent)", padding: 16, border: "1px solid color-mix(in oklch, var(--warn) 20%, transparent)" } },
              h("p", { style: { fontSize: 13, color: "var(--warn)", margin: "0 0 4px 0", fontWeight: 600 } },
                deleteModal.transaction_count === 1
                  ? "1 lançamento está nesta categoria."
                  : `${deleteModal.transaction_count} lançamentos estão nesta categoria.`),
              h("p", { style: { fontSize: 12, color: "var(--fg-2)", margin: "0 0 12px 0", lineHeight: 1.5 } },
                "Eles não são apagados. Escolha para onde vão:"),
              h("select", {
                className: "px-field", value: reassignTo, onChange: e => setReassignTo(e.target.value),
                "aria-label": "Para onde vão os lançamentos", style: { width: "100%" }
              },
                // "Deixar sem categoria" é a única opção que sempre existe, e é
                // o que o servidor já fazia quando o cliente não mandava
                // destino. Sem ela, a última categoria de um fluxo não tinha
                // para onde reatribuir e o botão ficava desligado para sempre.
                h("option", { value: "" }, "Deixar sem categoria"),
                otherCats.map(c => h("option", { key: c.id, value: c.id }, c.name))
              )
            ),
        err && h("div", { style: { color: "var(--neg)", fontSize: 13, padding: "12px 16px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", fontWeight: 500 } }, err),
        h("div", { style: { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 } },
          h("button", { className: "px-btn", onClick: () => setDeleteModal(null) }, "CANCELAR"),
          h("button", {
            className: "px-btn px-btn--danger",
            onClick: handleDelete,
            disabled: deleting,
          }, deleting ? "EXCLUINDO…" : "EXCLUIR")
        )
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.CategoriesPanel = CategoriesPanel;

})();
