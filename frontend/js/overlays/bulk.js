/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/**
 * @file modal-bulk.js
 * @brief Modal de categorização em lote por comerciante: uma escolha etiqueta
 *        todas as ocorrências do mês de uma vez.
 */
/* modal-bulk.js — categorização em lote por comerciante. Saiu de
   view-history.js: 177 linhas que não eram a tabela. */
/* global React, postCategory */

const { fmtBRL } = window.BS;

// Bulk-categorize panel: uncategorized transactions grouped by merchant (most-spent
// first). Picking a category tags every occurrence at once (onApply → categorizeBulk).
/**
 * @brief Renderiza o painel de categorização em lote.
 * @param props.groups comerciantes sem categoria {merchant_key, flow, count,
 *        total, sample_description, suggested_category_id} — `total` em REAIS
 * @param props.catsByFlow {expense, income} — opções por fluxo do comerciante
 * @param props.monthLabel rótulo do mês exibido no título
 * @param props.onApply chamado com (grupo, categoryId); grava via categorizeBulk
 * @param props.onClose fecha o modal
 * @param props.onRefreshCats recarrega as categorias após criar uma nova;
 *        deve devolver as listas novas {expense, income}
 * @return elemento React do modal
 */
function BulkCategorizeModal({ groups, catsByFlow, monthLabel, onApply, onClose, onRefreshCats }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const [pendingCats, setPendingCats] = React.useState({});
  const [creatingFor, setCreatingFor] = React.useState(null);
  const [newCatName, setNewCatName] = React.useState("");
  const [isSavingNew, setIsSavingNew] = React.useState(false);
  const Modal = window.BS.Modal;
  const prettify = window.BS.prettifyDesc || (s => s);
  const total = groups.reduce((s, g) => s + g.count, 0);
  const withSuggestions = groups.filter(g => g.suggested_category_id != null);

  /**
   * @brief Aplica, em sequência, a sugestão de todos os comerciantes que têm uma.
   *
   * Sequencial de propósito: cada onApply remove o grupo da lista, e disparar
   * tudo em paralelo competiria pelo mesmo estado.
   */
  const applyAllSuggestions = async () => {
    for (const g of withSuggestions) {
      await onApply(g, g.suggested_category_id);
    }
  };

  /**
   * @brief Cria a categoria digitada e já a aplica ao comerciante.
   * @param g grupo do comerciante — o `flow` dele define o fluxo da nova categoria
   */
  const handleCreateNew = async (g) => {
    if (!newCatName.trim() || isSavingNew) return;
    setIsSavingNew(true);
    try {
      await postCategory(newCatName.trim(), g.flow);
      const newLists = await onRefreshCats();
      const list = newLists[g.flow] || [];
      const createdCat = list.find(c => c.name.toLowerCase() === newCatName.trim().toLowerCase());
      if (createdCat) await onApply(g, createdCat.id);
      setCreatingFor(null); setNewCatName("");
    } catch (e) {
      alert("Erro ao criar categoria: " + e.message);
    } finally { setIsSavingNew(false); }
  };

  /**
   * @brief Deriva uma cor estável do nome do comerciante (avatar).
   * @param str nome exibido do comerciante
   * @return string oklch() — mesmo nome sempre devolve a mesma cor
   */
  const stringToColor = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `oklch(75% 0.14 ${Math.abs(hash % 360)})`;
  };

  return h(Modal, { open: true, onClose, title: `Categorizar em lote — ${monthLabel}`, width: 720 },
    h("div", { style: { display: "flex", flexDirection: "column" } },
      h("div", { style: { fontSize: 14, color: "var(--fg-2)", marginBottom: 20, lineHeight: 1.5 } },
        groups.length === 0
          ? `Tudo categorizado em ${monthLabel}. 🎉`
          : `${groups.length} ${groups.length === 1 ? "comerciante aguarda" : "comerciantes aguardam"} categorização. Isso afetará ${total} transações neste mês de uma só vez.`),
      
      withSuggestions.length > 0 && h("div", {
        style: {
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", marginBottom: 24, borderRadius: 12,
          background: "linear-gradient(135deg, color-mix(in oklch, var(--accent) 15%, transparent), color-mix(in oklch, var(--accent) 5%, transparent))",
          border: "1px solid color-mix(in oklch, var(--accent) 20%, transparent)",
          boxShadow: "inset 0 1px 0 color-mix(in oklch, white 10%, transparent)"
        }
      },
        h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
          h("span", { style: { fontSize: 14, fontWeight: 800, color: "var(--fg-0)", letterSpacing: "-0.01em" } }, `Temos ${withSuggestions.length} sugest${withSuggestions.length === 1 ? "ão" : "ões"} automáticas`),
          h("span", { style: { fontSize: 12, color: "var(--fg-2)" } }, "Baseadas no seu histórico de compras.")
        ),
        h("button", {
          onClick: applyAllSuggestions,
          title: "Aplica todas as categorias sugeridas com um clique",
          style: {
            cursor: "pointer", padding: "10px 18px", borderRadius: 8,
            fontSize: 13, fontWeight: 700, color: "var(--bg-0)",
            background: "var(--accent)", border: "none",
            boxShadow: "0 4px 12px color-mix(in oklch, var(--accent) 40%, transparent)"
          }
        }, "Aceitar e aplicar")
      ),
      
      h("div", { style: { display: "flex", flexDirection: "column", gap: 12, maxHeight: "55vh", overflowY: "auto", paddingRight: 4 } },
        groups.map(g => {
          const list = catsByFlow[g.flow] || [];
          const isPending = !!pendingCats[g.merchant_key];
          const displayName = prettify(g.sample_description);
          const initial = displayName.charAt(0).toUpperCase();
          const avatarColor = stringToColor(displayName);
          
          return h("div", {
            key: `${g.flow}-${g.merchant_key}`,
            style: {
              display: "flex", alignItems: "center", gap: 16,
              padding: "16px", borderRadius: 12,
              background: "var(--bg-1)", border: "1px solid var(--line-1)",
              boxShadow: "0 4px 12px oklch(0% 0 0 / 0.05)",
              transition: "transform 0.2s, box-shadow 0.2s"
            }
          },
            h("div", {
              style: {
                width: 44, height: 44, borderRadius: "50%",
                background: `color-mix(in oklch, ${avatarColor} 12%, transparent)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: avatarColor, fontSize: 18, fontWeight: 700, flexShrink: 0
              }
            }, initial),
            
            h("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } },
              h("div", { style: { fontSize: 15, fontWeight: 700, color: "var(--fg-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, displayName),
              h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
                h("span", { style: { fontSize: 11, color: "var(--fg-2)", background: "var(--bg-2)", padding: "3px 8px", borderRadius: 6, fontWeight: 600 } }, `${g.count} transaç${g.count === 1 ? "ão" : "ões"}`),
                h("span", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: g.flow === "income" ? "var(--pos)" : "var(--neg)" } }, (g.flow === "income" ? "+" : "−") + fmtBRL(Math.abs(g.total)))
              )
            ),
            
            h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
              g.suggested_category_id != null && !isPending && creatingFor !== g.merchant_key && h("button", {
                onClick: () => onApply(g, g.suggested_category_id),
                title: "Aplicar sugestão inteligente",
                style: {
                  cursor: "pointer", padding: "8px 16px", borderRadius: 8,
                  fontSize: 12, fontWeight: 700, color: "var(--accent)",
                  background: "color-mix(in oklch, var(--accent) 15%, transparent)",
                  border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
                  transition: "background 0.2s"
                }
              }, `✨ ${g.suggested_category_name}`),
              
              h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
                creatingFor === g.merchant_key ? h(React.Fragment, null,
                  h("input", {
                    autoFocus: true, placeholder: "Nome da nova categoria...",
                    value: newCatName, onChange: e => setNewCatName(e.target.value),
                    onKeyDown: e => {
                      if (e.key === "Escape") { setCreatingFor(null); setNewCatName(""); }
                      if (e.key === "Enter") handleCreateNew(g);
                    },
                    style: {
                      height: 36, minWidth: 200, fontSize: 13, padding: "0 12px", borderRadius: 8,
                      border: "1px solid var(--accent)", outline: "none", background: "var(--bg-0)", color: "var(--fg-0)"
                    }
                  }),
                  h("button", {
                    onClick: () => handleCreateNew(g),
                    disabled: !newCatName.trim() || isSavingNew,
                    style: { cursor: "pointer", padding: "0 16px", height: 36, borderRadius: 8, fontSize: 13, fontWeight: 700, color: "var(--bg-0)", background: "var(--accent)", border: "none", opacity: (!newCatName.trim() || isSavingNew) ? 0.5 : 1 }
                  }, isSavingNew ? "..." : "Criar")
                ) : h(React.Fragment, null,
                  h("select", {
                    value: pendingCats[g.merchant_key] || "", "aria-label": "Categoria",
                    onChange: e => {
                      if (e.target.value === "__NEW__") {
                        setCreatingFor(g.merchant_key);
                        setNewCatName("");
                      } else {
                        setPendingCats(p => ({ ...p, [g.merchant_key]: e.target.value }));
                      }
                    },
                    style: {
                      appearance: "none",
                      backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6l4 4 4-4'/></svg>")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 10px center",
                      height: 36, minWidth: 160, fontSize: 13, fontWeight: 600, padding: "0 32px 0 12px", borderRadius: 8,
                      cursor: "pointer", backgroundColor: "var(--bg-0)", color: "var(--fg-1)", outline: "none",
                      border: "1px solid var(--line-2)", transition: "border-color 0.2s"
                    }
                  },
                    h("option", { value: "" }, g.suggested_category_id != null ? "Outra categoria…" : "Escolher…"),
                    list.map(c => h("option", { key: c.id, value: c.id }, c.name)),
                    h("option", { value: "__NEW__" }, "+ Criar nova categoria...")
                  ),
                  isPending && h("button", {
                    onClick: () => { onApply(g, parseInt(pendingCats[g.merchant_key])); setPendingCats(p => ({ ...p, [g.merchant_key]: null })); },
                    style: { cursor: "pointer", padding: "0 16px", height: 36, borderRadius: 8, fontSize: 13, fontWeight: 700, color: "var(--bg-0)", background: "var(--fg-1)", border: "none" }
                  }, "Salvar")
                )
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
