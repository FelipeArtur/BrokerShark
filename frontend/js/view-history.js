/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/* view-history.js — TxTableWidget: a "planilha" do painel.
   Todos os lançamentos do mês selecionado, sempre carregados: filtros +
   ordenação por cabeçalho + coluna de método + linha de totais fixa.
   Scroll é interno ao widget — a página nunca rola. */
/* global React, fetchMonthTransactions, fetchCategoriesFull,
          patchTransactionCategory, fetchUncategorizedMerchants, categorizeBulk */

const { useState: _s2St, useEffect: _s2Ef, useMemo: _s2Memo } = React;
const { fmtBRL, PT_MONTHS, isConsumptionExpense, isRevenue } = window.BS;

/* Chave de ordenação por coluna — datas/valores comparam certo, texto em pt-BR */
const SORT_KEYS = {
  date:     t => t.date || "",
  desc:     t => (t.display_name || window.BS.prettifyDesc(t.description) || "").toLowerCase(),
  cat:      t => (t.category || "").toLowerCase(),
  account:  t => t.account_id || "",
  method:   t => t.method || "",
  // Valor assinado: despesas negativas — ordenar por valor = ver maiores saídas/entradas
  amount:   t => t.flow === "expense" ? -t.amount : t.amount,
};

function TxTableWidget({ monthSel, refreshKey, onEditCategory, openBulk, onBulkConsumed, monthTx, setMonthTx, filter, setFilterField, onToggleFacet }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [bulkGroups, setBulkGroups] = _s2St([]);
  const [bulkOpen, setBulkOpen] = _s2St(false);
  const [sort, setSort] = _s2St({ key: "date", dir: -1 });  // mais recente primeiro
  const [catsByFlow, setCatsByFlow] = _s2St({ expense: [], income: [] });

  _s2Ef(() => {
    Promise.all([fetchCategoriesFull("expense"), fetchCategoriesFull("income")])
      .then(([exp, inc]) => setCatsByFlow({ expense: exp, income: inc }));
  }, [refreshKey]);

  _s2Ef(() => {
    if (!monthSel) return;
    const { month, year } = monthSel;
    fetchUncategorizedMerchants({ year, month }).then(setBulkGroups).catch(() => setBulkGroups([]));
  }, [monthSel, refreshKey]);

  // Chip "Categorizar em lote" do widget de categorias abre o modal daqui.
  _s2Ef(() => {
    if (openBulk) { setBulkOpen(true); onBulkConsumed && onBulkConsumed(); }
  }, [openBulk]);

  _s2Ef(() => {
    const handler = e => setMonthTx(prev => prev.filter(tx => tx.id !== e.detail.id));
    window.addEventListener("bs-tx-optimistic-delete", handler);
    return () => window.removeEventListener("bs-tx-optimistic-delete", handler);
  }, []);

  const uncatCount = bulkGroups.reduce((s, g) => s + g.count, 0);
  const applyBulk = (group, categoryId) => {
    const list = catsByFlow[group.flow] || [];
    const catName = list.find(c => c.id === categoryId)?.name || "";
    return categorizeBulk(group.ids, categoryId)
      .then(() => {
        setBulkGroups(prev => prev.filter(g => !(g.merchant_key === group.merchant_key && g.flow === group.flow)));
        if (setMonthTx) {
          setMonthTx(prev => prev.map(tx => group.ids.includes(tx.id) ? { ...tx, category_id: categoryId, category: catName } : tx));
        }
      })
      .catch(() => {});
  };

  const monthLabel = monthSel ? `${PT_MONTHS[monthSel.month]} ${monthSel.year}` : "";

  const bankOf = (t) => (t.bank === "nubank" || (t.account_id && t.account_id.startsWith("nu"))) ? "Nubank"
    : (t.bank === "inter" || (t.account_id && t.account_id.startsWith("inter"))) ? "Inter" : (t.bank || t.account_id);

  const filteredTx = _s2Memo(() => monthTx.filter(t => {
    const norm = {
      flow: t.flow, method: t.method, category: t.category || "Sem categoria", account_id: t.account_id,
      bank: bankOf(t),
      label: [t.display_name, window.BS.prettifyDesc(t.description), t.description].filter(Boolean).join(" "),
    };
    return window.BS.matchesFilter(norm, filter);
  }), [monthTx, filter]);

  const sortedTx = _s2Memo(() => {
    const key = SORT_KEYS[sort.key] || SORT_KEYS.date;
    return [...filteredTx].sort((a, b) => {
      const ka = key(a), kb = key(b);
      const cmp = typeof ka === "number" ? ka - kb : String(ka).localeCompare(String(kb), "pt-BR");
      return (cmp || (a.id - b.id)) * sort.dir;
    });
  }, [filteredTx, sort]);

  const toggleSort = key =>
    setSort(prev => prev.key === key ? { key, dir: -prev.dir } : { key, dir: key === "date" || key === "amount" ? -1 : 1 });

  const filtExp = filteredTx.filter(isConsumptionExpense).reduce((s, t) => s + t.amount, 0);
  const filtInc = filteredTx.filter(isRevenue).reduce((s, t) => s + t.amount, 0);
  const hasFilter = window.BS.facetCount(filter) > 0;

  const Th = (key, label, style) => h("th", {
    className: "sortable", style,
    onClick: () => toggleSort(key),
    title: "Ordenar",
    "aria-sort": sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none",
  }, label, sort.key === key && h("span", { className: "sort-ind" }, sort.dir > 0 ? "▲" : "▼"));

  return h("div", { className: "widget table-widget" },

    // Toolbar: título + lote + filtros + busca — uma linha só
    h("div", { className: "table-toolbar" },
      h("span", { className: "widget-title" }, "Lançamentos"),
      h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-3)" } },
        hasFilter ? `${sortedTx.length} de ${monthTx.length}` : `${monthTx.length}`),
      uncatCount > 0 && h("button", {
        onClick: () => setBulkOpen(true),
        title: "Categorizar os lançamentos deste mês de uma vez, agrupados por comerciante",
        style: {
          display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
          padding: "2px 9px", borderRadius: 999, fontSize: 10, fontWeight: 600,
          color: "var(--accent)", background: "var(--accent-bg)",
          border: "1px solid color-mix(in oklch, var(--accent) 35%, transparent)",
        }
      }, `lote · ${uncatCount}`),
      h("div", { style: { flex: 1 } }),
      h("div", { className: "filter-pills" },
        [["all", "Tudo"], ["expense", "Despesas"], ["income", "Receitas"]].map(([k, l]) =>
          h("button", { key: k, className: `filter-pill${filter.flow === k ? " active" : ""}`,
            onClick: () => { setFilterField("flow", k); if (k === "income") setFilterField("method", "all"); } }, l))
      ),
      h("div", { className: "filter-pills" },
        [["all", "Todos"], ["pix", "PIX"], ["credit", "Crédito"], ["ted", "TED"]].map(([k, l]) =>
          h("button", { key: k, className: `filter-pill${filter.method === k ? " active" : ""}`,
            onClick: () => setFilterField("method", k) }, l))
      ),
      h("input", {
        value: filter.search, onChange: e => setFilterField("search", e.target.value),
        placeholder: "Buscar lançamento…", className: "input",
        style: { height: 24, fontSize: 11, padding: "0 8px", width: 200, background: "var(--bg-0)", border: "2px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500 },
      })
    ),

    // Corpo — scroll interno; thead gruda no topo do scroll
    h("div", { className: "table-scroll" },
      h("table", { className: "grid-table" },
        h("thead", null, h("tr", null,
          Th("date", "Data", { width: 70 }),
          Th("desc", "Descrição"),
          Th("cat", "Categoria", { width: 150 }),
          Th("account", "Conta", { width: 90 }),
          Th("method", "Método", { width: 80 }),
          Th("amount", "Valor", { textAlign: "right", width: 120 })
        )),
        h("tbody", null,
          sortedTx.length === 0 && h("tr", null, h("td", { colSpan: 6, style: { textAlign: "center", padding: 40, color: "var(--fg-3)", fontSize: 13 } },
            monthTx.length === 0 ? "Nenhum lançamento neste mês." : "Nenhum lançamento com esses filtros.")),
          ...sortedTx.map(t =>
            h(window.BS.TxRow, {
              key: t.id, t, cols: ["date", "desc", "cat", "account", "method", "amount"],
              onEditCategory,
              catsByFlow,
              onInlineCategory: async (tx, categoryId) => {
                const list = catsByFlow[tx.flow] || [];
                const catName = list.find(c => c.id === categoryId)?.name || "";
                try {
                  await patchTransactionCategory(tx.id, categoryId);
                  setMonthTx(prev => prev.map(x => x.id === tx.id ? { ...x, category_id: categoryId, category: catName } : x));
                  window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: `Categoria: ${catName}`, kind: "success" } }));
                } catch (e) {
                  window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: "Erro ao categorizar", kind: "error" } }));
                }
              },
              // Sugestão do histórico (suggest-only): só grava neste clique.
              onApplySuggestion: async (tx) => {
                try {
                  await patchTransactionCategory(tx.id, tx.suggested_category_id);
                  window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: `Categorizado como ${tx.suggested_category_name}`, kind: "success" } }));
                  setMonthTx(prev => prev.map(x => x.id === tx.id
                    ? { ...x, category_id: tx.suggested_category_id, category: tx.suggested_category_name }
                    : x));
                } catch (e) {
                  window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: "Erro ao atualizar", kind: "error" } }));
                }
              }
            })
          )
        )
      )
    ),

    // Totais do que está listado — sempre visíveis (o "rodapé de planilha")
    h("div", { className: "table-totals" },
      h("span", null, "Entradas ", h("span", { className: "mono", style: { color: "var(--pos)" } }, "+" + fmtBRL(filtInc))),
      h("span", null, "Saídas ", h("span", { className: "mono", style: { color: "var(--neg)" } }, "−" + fmtBRL(filtExp))),
      h("span", null, "Saldo ", h("span", { className: "mono", style: { color: (filtInc - filtExp) >= 0 ? "var(--pos)" : "var(--neg)" } },
        ((filtInc - filtExp) >= 0 ? "+" : "−") + fmtBRL(Math.abs(filtInc - filtExp)))),
      h("span", { style: { marginLeft: "auto", fontSize: 10, color: "var(--fg-3)" } },
        `${monthLabel} · transferências e investimentos fora dos totais`)
    ),

    bulkOpen && h(BulkCategorizeModal, {
      groups: bulkGroups, catsByFlow, monthLabel, onApply: applyBulk, onClose: () => setBulkOpen(false),
      onRefreshCats: async () => {
        const [exp, inc] = await Promise.all([fetchCategoriesFull("expense"), fetchCategoriesFull("income")]);
        setCatsByFlow({ expense: exp, income: inc });
        return { expense: exp, income: inc };
      }
    })
  );
}

// Bulk-categorize panel: uncategorized transactions grouped by merchant (most-spent
// first). Picking a category tags every occurrence at once (onApply → categorizeBulk).
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

  const applyAllSuggestions = async () => {
    for (const g of withSuggestions) {
      await onApply(g, g.suggested_category_id);
    }
  };

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
Object.assign(window.BS, { TxTableWidget });

})();
