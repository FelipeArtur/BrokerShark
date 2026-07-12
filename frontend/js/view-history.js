/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/* view-history.js — TxExplorer: a tabela completa de lançamentos do mês.
   Vive no drill-down "Transações" do dashboard; o mês vem do seletor global
   (prop monthSel), não de um picker próprio. Timeline, métricas e gráficos
   moraram aqui na era das abas — hoje são widgets do dashboard. */
/* global React, fetchMonthTransactions, fetchCategoriesFull,
          patchTransactionCategory, fetchUncategorizedMerchants, categorizeBulk */

const { useState: _s2St, useEffect: _s2Ef } = React;
const { fmtBRL, PT_MONTHS, isConsumptionExpense, isRevenue } = window.BS;

function TxExplorer({ monthSel, refreshKey, onEditCategory, initialAccount, openBulk, onBulkConsumed }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [monthTx, setMonthTx] = _s2St([]);
  const [bulkGroups, setBulkGroups] = _s2St([]);
  const [bulkOpen, setBulkOpen] = _s2St(false);
  const [filterFlow, setFilterFlow] = _s2St("all");
  const [filterMethod, setFilterMethod] = _s2St("all");
  const [filterCat, setFilterCat] = _s2St("all");
  const [filterAccount, setFilterAccount] = _s2St(initialAccount || "all");
  const [search, setSearch] = _s2St("");
  const [catsByFlow, setCatsByFlow] = _s2St({ expense: [], income: [] });

  const lastFetchedMonth = React.useRef(null);

  _s2Ef(() => {
    Promise.all([fetchCategoriesFull("expense"), fetchCategoriesFull("income")])
      .then(([exp, inc]) => setCatsByFlow({ expense: exp, income: inc }));
  }, [refreshKey]);

  _s2Ef(() => {
    if (!monthSel) return;
    const { month, year } = monthSel;
    fetchMonthTransactions({ month, year }).then(setMonthTx);
    fetchUncategorizedMerchants({ year, month }).then(setBulkGroups).catch(() => setBulkGroups([]));
    const monthStr = `${year}-${month}`;
    if (lastFetchedMonth.current !== monthStr) {
      // Trocou o mês → filtros de conteúdo resetam; conta pré-filtrada persiste.
      setFilterFlow("all"); setFilterMethod("all"); setFilterCat("all"); setSearch("");
      lastFetchedMonth.current = monthStr;
    }
  }, [monthSel, refreshKey]);

  // Abriu o drill já pedindo o lote (chip "Categorizar em lote" do dashboard).
  _s2Ef(() => {
    if (openBulk) { setBulkOpen(true); onBulkConsumed && onBulkConsumed(); }
  }, [openBulk]);

  _s2Ef(() => {
    const handler = e => setMonthTx(prev => prev.filter(tx => tx.id !== e.detail.id));
    window.addEventListener("bs-tx-optimistic-delete", handler);
    return () => window.removeEventListener("bs-tx-optimistic-delete", handler);
  }, []);

  const uncatCount = bulkGroups.reduce((s, g) => s + g.count, 0);
  const applyBulk = (group, categoryId) =>
    categorizeBulk(group.ids, categoryId)
      .then(() => setBulkGroups(prev =>
        prev.filter(g => !(g.merchant_key === group.merchant_key && g.flow === group.flow))))
      .catch(() => {});

  const monthLabel = monthSel ? `${PT_MONTHS[monthSel.month]} ${monthSel.year}` : "";

  const METHOD_MAP = { pix: "pix", pix_received: "pix", credit: "credit", ted: "ted" };
  const cats = [...new Set(monthTx.map(t => t.category).filter(Boolean))].sort();
  const bankNames = [...new Set(monthTx.map(t => {
    const isNu = t.bank === "nubank" || (t.account_id && t.account_id.startsWith("nu"));
    const isInter = t.bank === "inter" || (t.account_id && t.account_id.startsWith("inter"));
    return isNu ? "Nubank" : (isInter ? "Inter" : (t.bank || t.account_id));
  }).filter(Boolean))].sort();

  const filteredTx = monthTx.filter(t => {
    if (filterFlow !== "all" && t.flow !== filterFlow) return false;
    if (filterMethod !== "all") {
      const m = METHOD_MAP[t.method] || t.method;
      if (m !== filterMethod) return false;
    }
    if (filterCat === "__none__") {
      const categorizable = isConsumptionExpense(t) || isRevenue(t);
      if (!categorizable || t.category_id) return false;
    } else if (filterCat !== "all" && t.category !== filterCat) return false;
    if (filterAccount !== "all") {
      const bName = (t.bank === "nubank" || (t.account_id && t.account_id.startsWith("nu"))) ? "Nubank" :
                    (t.bank === "inter" || (t.account_id && t.account_id.startsWith("inter"))) ? "Inter" : (t.bank || t.account_id);
      if (bName !== filterAccount) return false;
    }
    // Busca no texto exibido E na descrição crua (cauda de roteamento continua achável).
    const label = [t.display_name, window.BS.prettifyDesc(t.description), t.description]
      .filter(Boolean).join(" ").toLowerCase();
    if (search && !label.includes(search.toLowerCase())) return false;
    return true;
  });

  const filtExp = filteredTx.filter(isConsumptionExpense).reduce((s, t) => s + t.amount, 0);
  const filtInc = filteredTx.filter(isRevenue).reduce((s, t) => s + t.amount, 0);
  const hasFilter = filterFlow !== "all" || filterMethod !== "all" || filterCat !== "all" || filterAccount !== "all" || search;

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column" } },

    // Cabeçalho: contagem + lote + totais do que está listado
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line-1)", paddingBottom: 16, marginBottom: 16 } },
      h("div", null,
        h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
          h("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--fg-0)" } }, monthLabel),
          uncatCount > 0 && h("button", {
            onClick: () => setBulkOpen(true),
            title: "Categorizar os lançamentos deste mês de uma vez, agrupados por comerciante",
            style: {
              display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
              padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
              color: "var(--accent)", background: "var(--accent-bg)",
              border: "1px solid color-mix(in oklch, var(--accent) 35%, transparent)",
            }
          }, `Categorizar em lote · ${uncatCount} sem categoria`)
        ),
        h("div", { style: { fontSize: 12, color: "var(--fg-3)", marginTop: 4, fontFamily: "var(--ff-mono)" } },
          `${filteredTx.length} de ${monthTx.length} ${monthTx.length === 1 ? "lançamento" : "lançamentos"}`)
      ),
      h("div", { style: { display: "flex", gap: 28, alignItems: "center" } },
        h("div", { style: { display: "flex", flexDirection: "column", minWidth: 90, textAlign: "right" } },
          h("span", { style: { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 3 } }, "Receitas"),
          h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, color: "var(--pos)" } }, `+${fmtBRL(filtInc)}`)
        ),
        h("div", { style: { display: "flex", flexDirection: "column", minWidth: 90, textAlign: "right" } },
          h("span", { style: { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 3 } }, "Despesas"),
          h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, color: "var(--neg)" } }, `−${fmtBRL(filtExp)}`)
        ),
        h("div", { style: { width: 1, height: 26, background: "var(--line-1)" } }),
        h("div", { style: { display: "flex", flexDirection: "column", minWidth: 104, textAlign: "right" } },
          h("span", { style: { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 3 } }, "Saldo listado"),
          h("span", { className: "mono", style: { fontSize: 16, fontWeight: 800, color: (filtInc - filtExp) >= 0 ? "var(--pos)" : "var(--neg)" } },
            (filtInc - filtExp) >= 0 ? "+" : "−", fmtBRL(Math.abs(filtInc - filtExp)))
        )
      )
    ),

    // Filtros
    h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 } },
      h("div", { className: "filter-pills" },
        [["all", "Tudo"], ["expense", "Despesas"], ["income", "Receitas"]].map(([k, l]) =>
          h("button", { key: k, className: `filter-pill${filterFlow === k ? " active" : ""}`,
            onClick: () => { setFilterFlow(k); if (k === "income") setFilterMethod("all"); } }, l))
      ),
      h("div", { className: "filter-pills" },
        [["all", "Todos"], ["pix", "PIX"], ["credit", "Crédito"], ["ted", "TED"]].map(([k, l]) =>
          h("button", { key: k, className: `filter-pill${filterMethod === k ? " active" : ""}`,
            onClick: () => setFilterMethod(k) }, l))
      ),
      h("select", {
        value: filterCat, onChange: e => setFilterCat(e.target.value),
        className: "select", style: { height: 26, fontSize: 11, padding: "0 24px 0 10px", width: "auto", borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500, cursor: "pointer" }
      },
        h("option", { value: "all" }, "Categoria ▾"),
        h("option", { value: "__none__" }, "Sem categoria"),
        cats.map(c => h("option", { key: c, value: c }, c))
      ),
      h("select", {
        value: filterAccount, onChange: e => setFilterAccount(e.target.value),
        className: "select", style: { height: 26, fontSize: 11, padding: "0 24px 0 10px", width: "auto", borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500, cursor: "pointer" }
      },
        h("option", { value: "all" }, "Banco ▾"),
        bankNames.map(b => h("option", { key: b, value: b }, b))
      ),
      h("div", { style: { flex: 1, minWidth: 16 } }),
      h("input", {
        value: search, onChange: e => setSearch(e.target.value),
        placeholder: "Buscar no mês…", className: "input",
        style: { height: 26, fontSize: 11, padding: "0 10px", width: 160, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500 },
      }),
      hasFilter && h("button", {
        onClick: () => { setFilterFlow("all"); setFilterMethod("all"); setFilterCat("all"); setFilterAccount("all"); setSearch(""); },
        className: "btn btn-ghost", style: { height: 26, padding: "0 8px", fontSize: 11, fontWeight: 600, color: "var(--neg)" },
      }, "Limpar")
    ),

    // Tabela
    h("table", { className: "grid-table" },
      h("thead", null, h("tr", null,
        h("th", { style: { width: 80 } }, "Data"),
        h("th", null, "Descrição"),
        h("th", { style: { width: 140 } }, "Categoria"),
        h("th", { style: { width: 120 } }, "Conta"),
        h("th", { style: { textAlign: "right", width: 120 } }, "Valor")
      )),
      h("tbody", null,
        filteredTx.length === 0 && h("tr", null, h("td", { colSpan: 5, style: { textAlign: "center", padding: 40, color: "var(--fg-3)", fontSize: 13 } }, "Nenhuma transação.")),
        ...filteredTx.map(t =>
          h(window.BS.TxRow, {
            key: t.id, t, cols: ["date", "desc", "cat", "account", "amount"],
            onEditCategory,
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
    ),

    bulkOpen && h(BulkCategorizeModal, {
      groups: bulkGroups, catsByFlow, monthLabel, onApply: applyBulk, onClose: () => setBulkOpen(false),
    })
  );
}

// Bulk-categorize panel: uncategorized transactions grouped by merchant (most-spent
// first). Picking a category tags every occurrence at once (onApply → categorizeBulk).
function BulkCategorizeModal({ groups, catsByFlow, monthLabel, onApply, onClose }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const Modal = window.BS.Modal;
  const prettify = window.BS.prettifyDesc || (s => s);
  const total = groups.reduce((s, g) => s + g.count, 0);
  return h(Modal, { open: true, onClose, title: `Categorizar em lote — ${monthLabel}`, width: 660 },
    h("div", { style: { display: "flex", flexDirection: "column" } },
      h("div", { style: { fontSize: 13, color: "var(--fg-2)", marginBottom: 12, lineHeight: 1.4 } },
        groups.length === 0
          ? `Tudo categorizado em ${monthLabel}. 🎉`
          : `${groups.length} ${groups.length === 1 ? "comerciante" : "comerciantes"} · ${total} lançamentos sem categoria em ${monthLabel}. Escolha a categoria — vale pra todos os iguais deste mês de uma vez.`),
      h("div", { style: { display: "flex", flexDirection: "column", maxHeight: "60vh", overflowY: "auto" } },
        groups.map(g => {
          const list = catsByFlow[g.flow] || [];
          return h("div", { key: `${g.flow}-${g.merchant_key}`, style: { display: "flex", alignItems: "center", gap: 16, padding: "10px 2px", borderBottom: "1px solid var(--line-0)" } },
            h("div", { style: { flex: 1, minWidth: 0 } },
              h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, prettify(g.sample_description)),
              h("div", { style: { fontSize: 11, color: g.flow === "income" ? "var(--pos)" : "var(--fg-3)", marginTop: 3, fontFamily: "var(--ff-mono)" } },
                `${g.count}× · ${fmtBRL(g.total)}${g.flow === "income" ? " · receita" : ""}`)
            ),
            // One-click accept of the history suggestion (defaultValue wouldn't fire
            // onChange), plus a select to pick any other category.
            g.suggested_category_id != null && h("button", {
              onClick: () => onApply(g, g.suggested_category_id),
              title: "Aplicar esta categoria a todos os iguais",
              style: {
                cursor: "pointer", whiteSpace: "nowrap", padding: "5px 10px", borderRadius: 6,
                fontSize: 12, fontWeight: 600, color: "var(--accent)",
                background: "color-mix(in oklch, var(--accent) 12%, transparent)",
                border: "1px solid color-mix(in oklch, var(--accent) 40%, transparent)",
              }
            }, `✓ ${g.suggested_category_name}`),
            h("select", {
              value: "", "aria-label": "Categoria",
              onChange: e => { if (e.target.value) onApply(g, parseInt(e.target.value)); },
              style: {
                height: 30, minWidth: 160, fontSize: 12, fontWeight: 500, padding: "0 8px", borderRadius: 6,
                cursor: "pointer", backgroundColor: "var(--bg-0)", color: "var(--fg-1)", outline: "none",
                border: "1px solid var(--line-1)",
              }
            },
              h("option", { value: "" }, g.suggested_category_id != null ? "Outra…" : "Escolher categoria…"),
              list.map(c => h("option", { key: c.id, value: c.id }, c.name))
            )
          );
        })
      )
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { TxExplorer });

})();
