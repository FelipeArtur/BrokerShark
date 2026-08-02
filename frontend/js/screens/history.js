(function () {

const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

const { useState: _s2St, useEffect: _s2Ef, useMemo: _s2Memo, useCallback: _s2Cb } = React;
const { fmtBRL, PT_MONTHS, isConsumptionExpense, isRevenue, isInvest } = window.BS;

const SORT_KEYS = {
  date:     t => t.date || "",
  desc:     t => (t.display_name || window.BS.prettifyDesc(t.description) || "").toLowerCase(),
  cat:      t => (t.category || "").toLowerCase(),
  account:  t => t.account_id || "",
  method:   t => t.method || "",

  amount:   t => t.flow === "expense" ? -t.amount : t.amount,
};

const COLLAPSE_KEY = "bs.tableCollapsed";

const loadCollapsed = () => {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); }
  catch { return new Set(); }
};

function TxTableWidget({ monthSel, refreshKey, onEditCategory, openBulk, onBulkConsumed, monthTx, setMonthTx,
                         filter, setFilterField, onToggleFacet, accounts, catsIndex, isLatestMonth }) {
  const [bulkGroups, setBulkGroups] = _s2St([]);
  const [bulkOpen, setBulkOpen] = _s2St(false);
  const [sort, setSort] = _s2St({ key: "date", dir: -1 });
  const [catsByFlow, setCatsByFlow] = _s2St({ expense: [], income: [] });
  const [grouped, setGrouped] = _s2St(true);
  const [collapsed, setCollapsed] = _s2St(loadCollapsed);

  _s2Ef(() => {
    Promise.all([fetchCategoriesFull("expense"), fetchCategoriesFull("income")])
      .then(([exp, inc]) => setCatsByFlow({ expense: exp, income: inc }));
  }, [refreshKey]);

  _s2Ef(() => {
    if (!monthSel) return;
    const { month, year } = monthSel;
    fetchUncategorizedMerchants({ year, month }).then(setBulkGroups).catch(() => setBulkGroups([]));
  }, [monthSel, refreshKey]);

  _s2Ef(() => {
    if (openBulk) { setBulkOpen(true); onBulkConsumed && onBulkConsumed(); }
  }, [openBulk]);

  _s2Ef(() => {
    const handler = e => setMonthTx(prev => prev.filter(tx => tx.id !== e.detail.id));
    window.addEventListener("bs-tx-optimistic-delete", handler);
    return () => window.removeEventListener("bs-tx-optimistic-delete", handler);
  }, []);

  const toggleCollapse = _s2Cb((key) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const applyBulk = async (group, categoryId) => {
    const list = catsByFlow[group.flow] || [];
    const catName = list.find(c => c.id === categoryId)?.name || "";
    await categorizeBulk(group.ids, categoryId);
    setBulkGroups(prev => prev.filter(g => !(g.merchant_key === group.merchant_key && g.flow === group.flow)));
    if (setMonthTx) {
      setMonthTx(prev => prev.map(tx => group.ids.includes(tx.id) ? { ...tx, category_id: categoryId, category: catName } : tx));
    }
    return {

      undo: async () => {
        await Promise.all(group.ids.map(id => patchTransactionCategory(id, null)));
        setBulkGroups(prev => [...prev, group]);
        if (setMonthTx) {
          setMonthTx(prev => prev.map(tx => group.ids.includes(tx.id) ? { ...tx, category_id: null, category: null } : tx));
        }
      },
    };
  };

  const monthLabel = monthSel ? `${PT_MONTHS[monthSel.month]} ${monthSel.year}` : "";

  const bankOf = (t) => window.BS.bankLabel(t.bank, t.account_id);

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

  const groups = _s2Memo(
    () => grouped ? window.BS.buildGroups(sortedTx, catsIndex) : [],
    [grouped, sortedTx, catsIndex],
  );

  const singleAccount = filter.accounts.size === 1 ? [...filter.accounts][0] : null;
  const showBalance = !grouped && !!singleAccount && sort.key === "date" && !!isLatestMonth;

  const balanceById = _s2Memo(() => {
    if (!showBalance) return null;
    const acct = (accounts || []).find(a => a.id === singleAccount);
    if (!acct || acct.balance == null) return null;
    const chrono = monthTx
      .filter(t => t.account_id === singleAccount)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const map = new Map();
    let bal = acct.balance;
    for (let i = chrono.length - 1; i >= 0; i--) {
      map.set(chrono[i].id, bal);
      bal += (chrono[i].flow === "expense" ? chrono[i].amount : -chrono[i].amount);
    }
    return map;
  }, [showBalance, singleAccount, accounts, monthTx]);

  const toggleSort = key =>
    setSort(prev => prev.key === key ? { key, dir: -prev.dir } : { key, dir: key === "date" || key === "amount" ? -1 : 1 });

  const filtExp = filteredTx.filter(isConsumptionExpense).reduce((s, t) => s + t.amount, 0);
  const filtInc = filteredTx.filter(isRevenue).reduce((s, t) => s + t.amount, 0);

  const filtInv = filteredTx.filter(isInvest)
    .reduce((s, t) => s + (t.flow === "expense" ? t.amount : -t.amount), 0);
  const hasFilter = window.BS.facetCount(filter) > 0;

  const Th = (key, label, style) => h("th", {
    className: "sortable", style,
    onClick: () => toggleSort(key),
    title: "Ordenar",
    "aria-sort": sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none",
  }, label, sort.key === key && h("span", { className: "sort-ind" }, sort.dir > 0 ? "▲" : "▼"));

  const cols = ["date", "desc", "cat", "account", "method", "amount"];
  if (showBalance) cols.push("balance");
  const colSpan = cols.length;

  const rowFor = (t, g) => h(window.BS.TxRow, {
    key: t.id, t, cols,
    amountSize: g ? window.BS.scaleFor(t.amount, g.maxAmount) : undefined,
    runningBalance: balanceById ? balanceById.get(t.id) : undefined,
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
  });

  return h("div", { className: "widget table-widget" },

    h("div", { className: "table-toolbar" },
      h("span", { className: "widget-title" }, "Lançamentos"),
      h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-3)" } },
        hasFilter ? `${sortedTx.length} de ${monthTx.length}` : `${monthTx.length}`),
      h("div", { style: { flex: 1 } }),
      h("button", {
        className: `px-seg-btn${grouped ? " active" : ""}`,
        onClick: () => setGrouped(g => !g),
        title: grouped
          ? "Agrupado por categoria — desagrupe pra ver em ordem cronológica (e o saldo corrente, com uma conta filtrada)"
          : "Lista corrida — agrupe pra ver totais e alvo por categoria",
      }, grouped ? "agrupado" : "corrido"),
      h("div", { className: "px-seg" },
        [["all", "Tudo"], ["expense", "Despesas"], ["income", "Receitas"]].map(([k, l]) =>
          h("button", { key: k, className: `px-seg-btn${filter.flow === k ? " active" : ""}`,
            onClick: () => { setFilterField("flow", k); if (k === "income") setFilterField("method", "all"); } }, l))
      ),
      h("div", { className: "px-seg" },
        [["all", "Todos"], ["pix", "PIX"], ["credit", "Crédito"], ["ted", "TED"]].map(([k, l]) =>
          h("button", { key: k, className: `px-seg-btn${filter.method === k ? " active" : ""}`,
            onClick: () => setFilterField("method", k) }, l))
      ),
      h("input", {
        value: filter.search, onChange: e => setFilterField("search", e.target.value),
        placeholder: "Buscar lançamento…", className: "input",
        style: { height: 24, fontSize: 11, padding: "0 8px", width: 200, background: "var(--bg-0)", border: "2px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500 },
      })
    ),

    h("div", { className: "table-scroll" },
      h("table", { className: "grid-table" },
        h("thead", null, h("tr", null,
          Th("date", "Data", { width: 70 }),
          Th("desc", "Descrição"),
          Th("cat", "Categoria", { width: 150 }),
          Th("account", "Conta", { width: 90 }),
          Th("method", "Método", { width: 80 }),
          Th("amount", "Valor", { textAlign: "right", width: 130 }),
          showBalance && h("th", { style: { textAlign: "right", width: 100 }, title: "Saldo da conta após o lançamento" }, "Saldo")
        )),
        h("tbody", null,
          sortedTx.length === 0 && h("tr", null, h("td", { colSpan, style: { textAlign: "center", padding: 40, color: "var(--fg-3)", fontSize: 13 } },
            monthTx.length === 0 ? "Nenhum lançamento neste mês." : "Nenhum lançamento com esses filtros.")),

          ...(grouped
            ? groups.flatMap(g => {
                const isOpen = !collapsed.has(g.key);
                const rows = [h(GroupHeader, {
                  key: g.key, g, isOpen, colSpan,
                  onToggle: () => toggleCollapse(g.key),
                  onFacet: g.isCat && onToggleFacet ? () => onToggleFacet("categories", g.label) : null,
                })];
                if (isOpen) g.txs.forEach(t => rows.push(rowFor(t, g)));
                return rows;
              })
            : sortedTx.map(t => rowFor(t, null)))
        )
      )
    ),

    //> Investido primeiro: é o único que NÃO entra na conta do saldo.
    h("div", { className: "table-totals" },
      h("span", { title: "Aplicações menos resgates. Fora do saldo: investir não é gastar nem ganhar." },
        "Investido ", h(window.BS.Money, { value: Math.abs(filtInv), kind: "invest", emphasis: true, t: { flow: filtInv >= 0 ? "expense" : "income" } })),
      h("span", null, "Entradas ", h(window.BS.Money, { value: filtInc, kind: "revenue", emphasis: true, t: { flow: "income" } })),
      h("span", null, "Saídas ", h(window.BS.Money, { value: filtExp, kind: "expense", emphasis: true, t: { flow: "expense" } })),
      h("span", null, "Saldo ", h(window.BS.Money, {
        value: Math.abs(filtInc - filtExp), emphasis: true,
        kind: (filtInc - filtExp) >= 0 ? "revenue" : "expense",
        t: { flow: (filtInc - filtExp) >= 0 ? "income" : "expense" },
      })),
      h("span", { style: { marginLeft: "auto", fontSize: 10, color: "var(--fg-3)" } },
        `${monthLabel} · ${hasFilter ? "totais do recorte filtrado" : "transferências e liquidações fora dos totais"}`)
    ),

    bulkOpen && h(window.BS.BulkCategorizeModal, {
      groups: bulkGroups, catsByFlow, monthLabel, onApply: applyBulk, onClose: () => setBulkOpen(false),
      onRefreshCats: async () => {
        const [exp, inc] = await Promise.all([fetchCategoriesFull("expense"), fetchCategoriesFull("income")]);
        setCatsByFlow({ expense: exp, income: inc });
        return { expense: exp, income: inc };
      },
      onToast: (msg, kind, action) =>
        window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg, kind, action } })),
    })
  );
}

function GroupHeader({ g, isOpen, colSpan, onToggle, onFacet }) {
  const st = window.BS.budgetState(g.total, g.budget);
  const delta = window.BS.groupDelta(g);
  const color = window.BS.KIND_COLOR[g.kind];

  return h("tr", { className: "group-header" },
    h("td", { colSpan, onClick: onToggle, style: { cursor: "pointer" } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 10, width: "100%" } },
        h("span", { className: "mono", style: { color: "var(--fg-3)", fontSize: 11, width: 8 } }, isOpen ? "▾" : "▸"),
        h("span", {
          style: { fontWeight: 700, fontSize: 12, color: g.isCat ? "var(--fg-0)" : color,
            cursor: onFacet ? "pointer" : "inherit" },
          onClick: onFacet ? (e => { e.stopPropagation(); onFacet(); }) : undefined,
          title: onFacet ? "Filtrar por esta categoria" : window.BS.KIND_HINT[g.kind],
        }, g.label),
        h("span", { className: "mono", style: { fontSize: 11, color: "var(--fg-3)" } }, `${g.count}`),

        g.isCat
          ? h(window.BS.Money, { value: g.total, kind: g.kind, emphasis: true,
              t: { flow: g.kind === "revenue" ? "income" : "expense" } })
          : h(window.BS.Money, {
              value: Math.abs(g.net), kind: g.kind, emphasis: true,
              t: { flow: g.net >= 0 ? "expense" : "income" },
              title: g.net === 0
                ? "as pernas se cancelam — o dinheiro só mudou de conta, não saiu"
                : window.BS.KIND_HINT[g.kind],
            }),

        st && h("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 160 } },
          h("div", { style: { flex: 1, height: 6, background: "var(--bg-2)", border: "1px solid var(--line-1)", minWidth: 60 } },
            h("div", { style: { width: `${Math.min(100, st.ratio * 100)}%`, height: "100%", background: st.color } })
          ),
          h("span", { className: "mono", style: { fontSize: 11, color: st.color, fontWeight: 700 },
            title: `Alvo ${g.budgetSource === "month" ? "só deste mês" : "fixo"}: ${fmtBRL(g.budget)}` },
            `${Math.round(st.ratio * 100)}%`)
        ),
        g.isCat && g.kind === "expense" && !st && h("span", { style: { fontSize: 11, color: "var(--fg-3)" } }, "sem alvo"),

        delta != null && h("span", {
          className: "mono",
          style: { fontSize: 11, color: delta > 0 ? "var(--neg)" : "var(--fg-3)", marginLeft: "auto" },
          title: `Mês anterior: ${fmtBRL(g.prevSpent)}`,
        }, `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}% vs. mês anterior`)
      )
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { TxTableWidget });

})();
