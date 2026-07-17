/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/**
 * @file bulk.js
 * @brief Categorização em lote por comerciante: uma escolha etiqueta todas as
 *        ocorrências do mês de uma vez.
 */
/* global React, postCategory */

const { fmtBRL } = window.BS;

/**
 * @brief Renderiza o painel de categorização em lote.
 * @param props.groups comerciantes sem categoria {merchant_key, flow, ids, count,
 *        total, sample_description, suggested_category_id, suggested_category_name};
 *        `total` em REAIS
 * @param props.catsByFlow {expense, income} — opções por fluxo do comerciante
 * @param props.monthLabel rótulo do mês exibido no título
 * @param props.onApply (grupo, categoryId) → Promise<{undo}>; rejeita em falha
 * @param props.onClose fecha o modal
 * @param props.onRefreshCats recarrega categorias após criar uma; devolve {expense, income}
 * @param props.onToast (msg, kind, action) — enfileira aviso; `action` é
 *        {label, onClick} e faz o toast durar 6s
 * @return elemento React do modal
 */
function BulkCategorizeModal({ groups, catsByFlow, monthLabel, onApply, onClose, onRefreshCats, onToast }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const [creatingFor, setCreatingFor] = React.useState(null);
  const [newCatName, setNewCatName] = React.useState("");
  const [busy, setBusy] = React.useState(null);
  const Modal = window.BS.Modal;
  const prettify = window.BS.prettifyDesc || (s => s);
  const total = groups.reduce((s, g) => s + g.count, 0);
  const plan = window.BS.suggestionPlan(groups);

  /**
   * @brief Grava a categoria do comerciante e oferece o desfazer.
   *
   * Aplica na hora: o select já carrega a intenção, e um "Salvar" separado
   * custava um terceiro clique. A rede é o toast com Desfazer.
   */
  const apply = async (g, categoryId) => {
    if (busy) return;
    setBusy(g.merchant_key);
    try {
      const { undo } = await onApply(g, categoryId);
      const nome = (catsByFlow[g.flow] || []).find(c => c.id === categoryId)?.name || "categoria";
      onToast(`${g.count} ${g.count === 1 ? "lançamento" : "lançamentos"} → ${nome}`, "success", {
        label: "Desfazer",
        onClick: () => undo().catch(e => onToast(e.message || "Não foi possível desfazer.", "error")),
      });
    } catch (e) {
      onToast(e.message || "Não foi possível categorizar.", "error");
    } finally { setBusy(null); }
  };

  /**
   * @brief Aplica todas as sugestões de uma vez.
   *
   * Dispara em PARALELO e atualiza o estado uma vez só no fim. A versão antiga
   * usava await em série porque cada onApply removia o grupo da lista e o
   * paralelo competia pelo mesmo estado — o motivo era real, mas a solução
   * custava N round-trips em fila. Aqui a decisão (suggestionPlan) é pura e o
   * efeito acontece de uma vez.
   */
  const applyAll = async () => {
    if (busy || plan.length === 0) return;
    setBusy("__all__");
    const res = await Promise.allSettled(
      plan.map(p => onApply(groups.find(g => g.merchant_key === p.merchant_key && g.flow === p.flow), p.category_id))
    );
    const ok = res.filter(r => r.status === "fulfilled");
    const err = res.length - ok.length;
    if (ok.length) {
      onToast(`${ok.length} ${ok.length === 1 ? "comerciante categorizado" : "comerciantes categorizados"}`, "success", {
        label: "Desfazer",
        onClick: () => Promise.all(ok.map(r => r.value.undo()))
          .catch(e => onToast(e.message || "Não foi possível desfazer.", "error")),
      });
    }
    if (err) onToast(`${err} ${err === 1 ? "falhou" : "falharam"}`, "error");
    setBusy(null);
  };

  /**
   * @brief Cria a categoria digitada e já a aplica ao comerciante.
   * @param g grupo do comerciante — o `flow` dele define o fluxo da nova categoria
   */
  const handleCreateNew = async (g) => {
    if (!newCatName.trim() || busy) return;
    setBusy(g.merchant_key);
    try {
      await postCategory(newCatName.trim(), g.flow);
      const novas = await onRefreshCats();
      const criada = (novas[g.flow] || []).find(c => c.name.toLowerCase() === newCatName.trim().toLowerCase());
      setCreatingFor(null); setNewCatName("");
      setBusy(null);
      if (criada) await apply(g, criada.id);
    } catch (e) {
      setBusy(null);
      onToast(e.message || "Não foi possível criar a categoria.", "error");
    }
  };

  return h(Modal, { open: true, onClose, title: `Categorizar em lote — ${monthLabel}`, width: 720 },
    h("div", { style: { display: "flex", flexDirection: "column", gap: "var(--s-5)" } },

      h("div", { className: "label", style: { color: "var(--fg-2)" } },
        groups.length === 0
          ? `Tudo categorizado em ${monthLabel}.`
          : `${groups.length} ${groups.length === 1 ? "comerciante aguarda" : "comerciantes aguardam"} · ${total} ${total === 1 ? "lançamento" : "lançamentos"}`),

      plan.length > 0 && h("div", { className: "px-row" },
        h("span", { style: { flex: 1, fontFamily: "var(--ff-sans)", fontSize: "var(--fz-8)", color: "var(--fg-0)" } },
          `${plan.length} ${plan.length === 1 ? "sugestão automática" : "sugestões automáticas"}`),
        h("button", { className: "px-btn px-btn--primary", onClick: applyAll, disabled: !!busy },
          busy === "__all__" ? "APLICANDO…" : "APLICAR TODAS")
      ),

      groups.length === 0
        ? h("div", { className: "px-empty" }, "NADA A CATEGORIZAR")
        : h("div", { className: "px-list", style: { maxHeight: "55vh", overflowY: "auto" } },
            groups.map(g => {
              const list = catsByFlow[g.flow] || [];
              const nome = prettify(g.sample_description);
              const criando = creatingFor === g.merchant_key;

              return h("div", { className: "px-row", key: `${g.flow}-${g.merchant_key}` },
                h("div", { className: "px-swatch", style: { background: window.BS.swatchColor(nome) } },
                  nome.charAt(0).toUpperCase()),

                h("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                                     whiteSpace: "nowrap", fontSize: "var(--fz-6)", color: "var(--fg-0)" },
                            title: nome }, nome),

                h("span", { className: "px-chip" }, `${g.count}×`),
                h("span", { className: "mono", style: { fontSize: "var(--fz-7)",
                            color: g.flow === "income" ? "var(--pos)" : "var(--neg)" } },
                  (g.flow === "income" ? "+" : "−") + fmtBRL(Math.abs(g.total))),

                criando
                  ? h(React.Fragment, null,
                      h("input", {
                        className: "px-field", autoFocus: true, placeholder: "Nome da categoria…",
                        value: newCatName, style: { width: 160 },
                        onChange: e => setNewCatName(e.target.value),
                        onKeyDown: e => {
                          if (e.key === "Escape") { setCreatingFor(null); setNewCatName(""); }
                          if (e.key === "Enter") handleCreateNew(g);
                        },
                      }),
                      h("button", { className: "px-btn px-btn--primary", onClick: () => handleCreateNew(g),
                                    disabled: !newCatName.trim() || !!busy }, "CRIAR")
                    )
                  : h(React.Fragment, null,
                      g.suggested_category_id != null && h("button", {
                        className: "px-btn", disabled: !!busy,
                        title: "Aplicar a sugestão",
                        onClick: () => apply(g, g.suggested_category_id),
                      }, `✨ ${g.suggested_category_name}`),
                      h("select", {
                        className: "px-field", value: "", "aria-label": "Categoria",
                        disabled: !!busy, style: { width: 150 },
                        onChange: e => {
                          if (e.target.value === "__NEW__") { setCreatingFor(g.merchant_key); setNewCatName(""); }
                          else if (e.target.value) apply(g, parseInt(e.target.value, 10));
                        },
                      },
                        h("option", { value: "" }, g.suggested_category_id != null ? "Outra…" : "Escolher…"),
                        list.map(c => h("option", { key: c.id, value: c.id }, c.name)),
                        h("option", { value: "__NEW__" }, "+ Nova categoria")
                      )
                    )
              );
            })
          )
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { BulkCategorizeModal });

})();
