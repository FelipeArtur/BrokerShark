(function () {

const { useState: _dSt, useEffect: _dEf, useMemo: _dMemo, useCallback: _dCb } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, PT_MONTHS, PT_SHORT,
        isConsumptionExpense } = window.BS;

const INV_TYPE_LABEL = {
  rdb: "Caixinha (RDB)", cdb: "CDB / Renda fixa", tesouro: "Tesouro Direto",
  lci: "LCI / Renda fixa", lca: "LCA / Renda fixa", savings: "Poupança",
};

function Delta({ value, suffix = "vs mês anterior", invert = false }) {
  const h = React.createElement;
  if (value == null) return null;
  const good = invert ? value <= 0 : value >= 0;
  return h(React.Fragment, null,
    h("span", { className: "kpi-delta", style: { color: good ? "var(--pos)" : "var(--neg)" } },
      (value >= 0 ? "+" : "−") + fmtBRL(Math.abs(value))),
    h("span", { style: { color: "var(--fg-3)" } }, suffix)
  );
}

const KpiStrip = React.memo(function KpiStrip({ available, availErr, accounts, cashflow, investTotal,
                    liquidityHistory, evolution, monthLabel, monthly }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const checkingTotal = available ? available.checking_total : 0;
  const patrimonio = checkingTotal + investTotal;

  const seriesDelta = s => (s && s.length > 1) ? s[s.length - 1].value - s[s.length - 2].value : null;
  const patDelta = seriesDelta(liquidityHistory);
  const invDelta = (evolution && evolution.length > 1)
    ? evolution[evolution.length - 1].cumulative - evolution[evolution.length - 2].cumulative : null;

  const netValue = available ? (available.available_net != null ? available.available_net : available.available) : null;
  const committed = available && available.committed_this_month ? available.committed_this_month : 0;
  const availValue = netValue;
  const availNeg = availValue != null && availValue < 0;

  const inc = cashflow ? cashflow.income_total : 0;
  const exp = cashflow ? cashflow.expense_total : 0;
  const invNet = cashflow ? cashflow.investment_net : 0;
  const livre = inc - exp - invNet;

  const checking = (accounts || []).filter(a => a.type === "checking")
    .sort((a, b) => ((a.id || "").startsWith("nu") ? 1 : 2) - ((b.id || "").startsWith("nu") ? 1 : 2));

  return h("div", { className: "kpi-strip" },

    h("div", { className: "kpi kpi-hero" },
      h("span", { className: "kpi-label" }, "Em Caixa (Disponível Agora)"),
      availErr
        ? h("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--neg)" } }, "falha ao carregar")
        : h("span", { className: "kpi-value", style: { color: availNeg ? "var(--neg)" : "var(--fg-0)" } },
            availValue == null ? "—" : (availNeg ? "−" : "") + fmtBRL(Math.abs(availValue))),
      h("span", { className: "kpi-sub" },
        checking.map(a => h("span", { key: a.id, style: { display: "inline-flex", gap: 5, alignItems: "baseline" } },
          h("span", { style: { color: (a.id || "").startsWith("nu") ? "var(--nubank)" : "var(--inter)", fontWeight: 700 } },
            (a.id || "").startsWith("nu") ? "Nu" : "Inter"),
          h("span", { className: "mono", style: { color: "var(--fg-1)", fontSize: 11 } }, fmtBRL(a.balance || 0))
        )),
        committed > 0 && h("span", { className: "mono", style: { color: "var(--warn)", fontSize: 11, marginTop: 2, display: "block" } },
          "− Comprometido este mês " + fmtBRL(committed))
      ),
    ),

    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, "Patrimônio Consolidado"),
      h("span", { className: "kpi-value", title: `Caixa ${fmtBRL(checkingTotal)} + investimentos ${fmtBRL(investTotal)}` },
        (patrimonio < 0 ? "−" : "") + fmtBRL(Math.abs(patrimonio))),
      h("span", { className: "kpi-sub" }, h(Delta, { value: patDelta, suffix: "vs mês passado" }))
    ),

    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, "Resultado do Mês"),
      h("span", { className: "kpi-value", style: { color: livre >= 0 ? "var(--pos)" : (inc === 0 ? "var(--warn)" : "var(--neg)") } },
        (livre >= 0 ? "+" : "−") + fmtBRL(Math.abs(livre))),
      h("span", { className: "kpi-sub" },
        h("span", { className: "mono", style: { color: "var(--pos)" } }, "+" + fmtBRL(inc)),
        h("span", { className: "mono", style: { color: "var(--neg)" } }, "−" + fmtBRL(exp)),
        invNet !== 0 && h("span", { className: "mono", style: { color: invNet > 0 ? "var(--reserve)" : "var(--info)" }, title: invNet > 0 ? "aplicado líquido" : "resgatado líquido" },
          (invNet > 0 ? "→inv " : "←inv ") + fmtBRL(Math.abs(invNet)))
      )
    ),

    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, "Total Investido"),
      h("span", { className: "kpi-value", style: { color: "var(--reserve)" } }, fmtBRL(investTotal)),
      h("span", { className: "kpi-sub" }, h(Delta, { value: invDelta, suffix: "vs mês passado" }))
    )
  );
});

const GeneralWidget = React.memo(function GeneralWidget({ cashflow, liquidityHistory, monthly, monthSel,
                         monthTx, uncatCount, backup }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const inc = cashflow ? cashflow.income_total : 0;
  const exp = cashflow ? cashflow.expense_total : 0;
  const invNet = cashflow ? cashflow.investment_net : 0;
  const livre = inc - exp - invNet;
  const monName = monthSel ? PT_MONTHS[monthSel.month].toLowerCase() : "";

  const parts = [];
  parts.push(h("div", { key: "i", style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 } },
    h("span", { style: { color: "var(--fg-2)" } }, "Entradas (receitas)"),
    h("b", { className: "mono", style: { color: "var(--pos)", fontSize: 13 } }, "+" + fmtBRL(inc))
  ));
  parts.push(h("div", { key: "e", style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 } },
    h("span", { style: { color: "var(--fg-2)" } }, "Saídas (despesas)"),
    h("b", { className: "mono", style: { color: "var(--neg)", fontSize: 13 } }, "−" + fmtBRL(exp))
  ));
  if (invNet > 0) parts.push(h("div", { key: "v", style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 } },
    h("span", { style: { color: "var(--fg-2)" } }, "Aplicações líquidas"),
    h("b", { className: "mono", style: { color: "var(--reserve)", fontSize: 13 } }, fmtBRL(invNet))
  ));
  if (invNet < 0) parts.push(h("div", { key: "v", style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 } },
    h("span", { style: { color: "var(--fg-2)" } }, "Resgates líquidos"),
    h("b", { className: "mono", style: { color: "var(--info)", fontSize: 13 } }, fmtBRL(-invNet))
  ));
  parts.push(h("div", { key: "s", style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--line-1)" } },
    h("span", { style: { color: "var(--fg-1)", fontWeight: 600 } }, "Saldo livre no mês"),
    h("b", { className: "mono", style: { color: livre >= 0 ? "var(--pos)" : "var(--neg)", fontSize: 14 } }, (livre >= 0 ? "+" : "−") + fmtBRL(Math.abs(livre)))
  ));

  const patDelta = liquidityHistory.length > 1
    ? liquidityHistory[liquidityHistory.length - 1].value - liquidityHistory[liquidityHistory.length - 2].value : null;

  const first = monthly[0], last = monthly[monthly.length - 1];
  const cobertura = first && last
    ? `${PT_SHORT[first.month]}/${first.year} → ${PT_SHORT[last.month]}/${last.year} (${monthly.length} meses)` : "—";
  const lastTxDate = monthTx.length
    ? monthTx.reduce((m, t) => (t.date > m ? t.date : m), monthTx[0].date) : null;
  let backupTxt = "—", backupStale = false;
  if (backup) {
    if (!backup.exists) { backupTxt = "Sem backup"; backupStale = true; }
    else {
      const d = Math.floor((backup.age_seconds || 0) / 86400);
      backupTxt = d <= 0 ? "Realizado hoje" : d === 1 ? "Realizado há 1 dia" : `Há ${d} dias`;
      backupStale = d > 40;
    }
  }

  return h("div", { className: "widget wg-4" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Visão Geral do Mês"),
      patDelta != null && h("span", { style: { marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "baseline" } },
        h("span", { className: "kpi-delta", style: { color: patDelta >= 0 ? "var(--pos)" : "var(--neg)" } },
          (patDelta >= 0 ? "+" : "−") + fmtBRLCompact(patDelta)),
        h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase" } }, "evolução patrimonial"))
    ),
    h("div", { className: "widget-body", style: { gap: 16 } },

      h("div", { style: { fontSize: 12, lineHeight: 1.4, color: "var(--fg-1)" } },
        h("div", { style: { color: "var(--fg-0)", fontWeight: 700, textTransform: "capitalize", marginBottom: 8 } }, `Resumo de ${monName}`),
        ...parts
      ),

      h("div", { style: { marginTop: "auto", display: "flex", flexDirection: "column" } },
        h("div", { className: "stat-row" }, h("span", { className: "k" }, "Período analisado"), h("span", { className: "v mono" }, cobertura)),
        h("div", { className: "stat-row" },
          h("span", { className: "k" }, "Total de transações"),
          h("span", { className: "v mono" }, `${monthTx.length}`,
            uncatCount > 0 && h("span", { style: { color: "var(--warn)", marginLeft: 6 } }, `· ${uncatCount} pendentes`))),
        h("div", { className: "stat-row" },
          h("span", { className: "k" }, "Última movimentação"),
          h("span", { className: "v mono" }, lastTxDate ? fmtDateBR(lastTxDate) : "—")),
        h("div", { className: "stat-row" },
          h("span", { className: "k" }, "Status do Backup"),
          h("span", { className: "v mono", style: backupStale ? { color: "var(--warn)" } : null, title: backup && backup.exists ? backup.name : "Unidade externa não detectada" }, backupTxt))
      )
    )
  );
});

const TimelineWidget = React.memo(function TimelineWidget({ monthly, monthSel, onPickMonth }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const now = new Date();
  const [browsingYear, setBrowsingYear] = _dSt(null);
  const [compare, setCompare] = _dSt(false);
  const activeYear = browsingYear || (monthSel ? monthSel.year : now.getFullYear());
  const years = [...new Set(monthly.map(m => m.year))].sort((a, b) => a - b);

  const slots = [];
  for (let m = 1; m <= 12; m++) {
    const data = monthly.find(x => x.year === activeYear && x.month === m);
    const idx = monthly.indexOf(data);
    const prev = idx > 0 ? monthly[idx - 1] : null;
    slots.push({ month: m, data, prev });
  }
  const maxV = Math.max(...slots.map(s => s.data ? Math.max(s.data.income, s.data.expenses) : 0), 1);
  const sel = monthSel && monthly.find(x => x.year === monthSel.year && x.month === monthSel.month);

  return h("div", { className: "widget wg-6" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Fluxo mês a mês"),
      h("button", { onClick: () => setCompare(c => !c), className: "filter-pill" + (compare ? " active" : ""),
        style: { marginLeft: "auto" }, title: "Comparar com o mês anterior" }, "vs ant."),
      h("span", { style: { display: "flex", gap: 10, fontSize: 11, color: "var(--fg-3)", alignItems: "center" } },
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 3 } },
          h("span", { style: { width: 7, height: 7, borderRadius: 2, background: "var(--pos)" } }), "rec"),
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 3 } },
          h("span", { style: { width: 7, height: 7, borderRadius: 2, background: "var(--neg)" } }), "desp"))
    ),
    h("div", { className: "widget-body", style: { gap: 8, overflow: "hidden" } },
      h("div", { style: { display: "flex", gap: 10, overflowX: "auto", scrollbarWidth: "none", flexShrink: 0 } },
        years.map(y => h("button", {
          key: y, onClick: () => setBrowsingYear(y),
          style: {
            fontSize: 10, fontFamily: "var(--ff-mono)", fontWeight: activeYear === y ? 700 : 500,
            color: activeYear === y ? "var(--fg-0)" : "var(--fg-3)", padding: "1px 0", flexShrink: 0,
            borderBottom: activeYear === y ? "2px solid var(--accent)" : "2px solid transparent",
          }
        }, y))
      ),
      h("div", { style: { display: "flex", gap: 2, alignItems: "stretch", flex: 1, minHeight: 0 } },
        slots.map(slot => {
          const d = slot.data;
          const isPicked = d && monthSel && d.year === monthSel.year && d.month === monthSel.month;
          const isCur = activeYear === now.getFullYear() && slot.month === now.getMonth() + 1;
          const net = d ? d.income - d.expenses : 0;
          return h("button", {
            key: slot.month,
            className: `tl-slot${isPicked ? " picked" : ""}`,
            disabled: !d,
            onClick: () => d && onPickMonth({ year: d.year, month: d.month }),
            title: d
              ? `${PT_MONTHS[slot.month]} ${activeYear} — receitas ${fmtBRL(d.income)} · despesas ${fmtBRL(d.expenses)} · saldo ${net >= 0 ? "+" : "−"}${fmtBRL(Math.abs(net))}`
              : `${PT_MONTHS[slot.month]} ${activeYear} (sem dados)`,
          },
            h(window.BS.PixelBars, { slot, maxV, isPicked, compare }),
            h("span", { className: "tl-mon", style: isCur && !isPicked ? { color: "var(--fg-1)", fontWeight: 700 } : null },
              PT_SHORT[slot.month]),
            h("span", { className: "tl-net", style: { color: !d ? "transparent" : net >= 0 ? "var(--pos)" : "var(--neg)" } },
              d ? (net >= 0 ? "+" : "−") + fmtBRLCompact(net) : "·")
          );
        })
      ),
      sel && h("div", { style: { display: "flex", gap: 12, alignItems: "baseline", borderTop: "1px solid var(--line-1)", paddingTop: 7, flexShrink: 0, flexWrap: "wrap" } },
        h("span", { style: { fontSize: 11, fontWeight: 700, color: "var(--fg-1)" } }, `${PT_SHORT[sel.month]}/${sel.year}`),
        h("span", { className: "mono", style: { fontSize: 11, color: "var(--pos)" } }, "+" + fmtBRL(sel.income)),
        h("span", { className: "mono", style: { fontSize: 11, color: "var(--neg)" } }, "−" + fmtBRL(sel.expenses)),
        (() => {
          const idx = monthly.indexOf(sel);
          const prev = idx > 0 ? monthly[idx - 1] : null;
          if (!prev) return null;
          const d = sel.expenses - prev.expenses;
          return h("span", { style: { marginLeft: "auto", fontSize: 10, color: "var(--fg-3)" } },
            "desp ",
            h("span", { className: "mono", style: { fontWeight: 700, color: d <= 0 ? "var(--pos)" : "var(--neg)" } },
              (d >= 0 ? "+" : "−") + fmtBRLCompact(d)),
            ` vs ${PT_SHORT[prev.month]}`);
        })()
      )
    )
  );
});

const AccountsWidget = React.memo(function AccountsWidget({ accounts, available, filter, onToggleFacet }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const checking = (accounts || []).filter(a => a.type === "checking")
    .sort((a, b) => ((a.id || "").startsWith("nu") ? 1 : 2) - ((b.id || "").startsWith("nu") ? 1 : 2));
  const total = available ? available.checking_total : checking.reduce((s, a) => s + (a.balance || 0), 0);
  const colorOf = a => (a.id || "").startsWith("nu") ? "var(--nubank)" : "var(--inter)";

  return h("div", { className: "widget wg-4" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Contas"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(total))
    ),
    h("div", { className: "widget-body", style: { gap: 10 } },
      total > 0 && checking.length > 1 && h("div", { style: { display: "flex", gap: 3, height: 5, flexShrink: 0 } },
        checking.map(a => {
          const pct = ((a.balance || 0) / total) * 100;
          return pct > 0.5 && h("div", { key: a.id, title: `${a.name}: ${pct.toFixed(0)}%`, style: { width: pct + "%", background: colorOf(a), borderRadius: 2, opacity: 0.85 } });
        })
      ),
      h("div", { style: { display: "flex", flexDirection: "column" } },
        checking.map((a, i, arr) => {
          const active = filter && filter.accounts.has(a.id);
          return h("button", {
            key: a.id, onClick: () => onToggleFacet && onToggleFacet("accounts", a.id),
            className: active ? "facet-row facet-active" : "facet-row",
            style: { display: "flex", flexDirection: "column", gap: 2, padding: "9px 6px", textAlign: "left", cursor: "pointer", background: "none",
              border: "none", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none" }
          },
            h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
              h("span", { style: { width: 8, height: 8, background: colorOf(a), flexShrink: 0 } }),
              h("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
              total > 0 && h("span", { className: "mono", style: { fontSize: 11, color: "var(--fg-3)", marginLeft: "auto" } }, `${(((a.balance || 0) / total) * 100).toFixed(0)}%`)
            ),
            h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, paddingLeft: 16, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
          );
        })
      )
    )
  );
});

const CategoriesWidget = React.memo(function CategoriesWidget({ monthTx, uncatCount, onOpenBulk, filter,
                                                               onToggleFacet, catsIndex, monthSel, onBudgetSaved,
                                                               onManageCategories, onCreateCategory }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const expenses = monthTx.filter(isConsumptionExpense);
  const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
  const [editing, setEditing] = _dSt(null);

  const byCat = _dMemo(() => {
    const g = new Map();
    expenses.forEach(t => {
      const id = t.category_id ?? null;
      if (!g.has(id)) g.set(id, { id, name: t.category || "Sem categoria", total: 0 });
      g.get(id).total += t.amount;
    });
    return [...g.values()].sort((a, b) => b.total - a.total);
  }, [monthTx]);

  return h("div", { className: "widget wg-7" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Categorias"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--neg)" } }, "−" + fmtBRL(totalExp)),
      h("button", { className: "px-btn px-btn--ghost px-btn--sm", style: { marginLeft: 8 }, title: "Nova categoria", onClick: onCreateCategory }, "+ Nova"),
      h("button", { className: "px-btn px-btn--ghost px-btn--sm", title: "Gerenciar categorias", onClick: onManageCategories }, "⚙")
    ),
    h("div", { className: "widget-body", style: { gap: 8 } },
      byCat.length === 0
        ? h("div", { className: "px-empty" }, "Nenhuma despesa no mês.")
        : byCat.map((c) => h(CategoryRow, {
            key: c.id ?? "none", c, monthSel, onBudgetSaved,
            meta: c.id != null && catsIndex ? catsIndex.get(c.id) : null,
            active: filter.categories.has(c.name),
            onFacet: () => onToggleFacet("categories", c.name),
            editing: editing === c.id,
            onEdit: () => setEditing(c.id),
            onEditDone: () => setEditing(null),
          })),
      uncatCount > 0 && h("button", {
        onClick: onOpenBulk, className: "px-btn px-btn--ghost px-btn--sm",
        style: { marginTop: "auto", alignSelf: "flex-start", flexShrink: 0, color: "var(--accent)" }
      }, `Categorizar em lote · ${uncatCount}`)
    )
  );
});

function CategoryRow({ c, meta, active, onFacet, editing, onEdit, onEditDone, monthSel, onBudgetSaved }) {
  const h = (t, p, ...cc) => React.createElement(t, p, ...cc);
  const budget = meta && meta.budget_cents != null ? meta.budget_cents / 100 : null;
  const st = window.BS.budgetState(c.total, budget);
  const [draft, setDraft] = _dSt("");

  const canBudget = c.id != null;

  const save = async () => {
    const reais = parseFloat(String(draft).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(reais) || reais < 0) { onEditDone(); return; }
    try {

      await putCategoryBudget(c.id, Math.round(reais * 100), refMonthOf(monthSel));
      onBudgetSaved && onBudgetSaved();
      window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: `Alvo de ${c.name}: ${fmtBRL(reais)}`, kind: "success" } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: "Erro ao gravar alvo", kind: "error" } }));
    }
    onEditDone();
  };

  return h("div", {
    className: active ? "facet-row facet-active" : "facet-row",
    style: { display: "flex", flexDirection: "column", gap: 3, flexShrink: 0, padding: "2px 0" },
  },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } },
      h("button", {
        onClick: onFacet, title: "Filtrar por esta categoria",
        style: { fontSize: 11, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0,
          color: c.id == null ? "var(--fg-3)" : "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      }, c.name),
      h("span", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: "var(--fg-0)", flexShrink: 0 } }, fmtBRL(c.total))
    ),

    st && h("div", { style: { position: "relative", height: 8, background: "var(--bg-2)", border: "1px solid var(--line-1)", overflow: "hidden" } },
      h("div", { style: { width: Math.min(100, st.ratio * 100) + "%", height: "100%", background: st.color, transition: "width 0.2s" } }),
      st.over && h("div", { className: "dither-neg", style: { position: "absolute", inset: 0, opacity: 0.35, pointerEvents: "none" } })),

    canBudget && h("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 11 } },
      editing
        ? h(React.Fragment, null,
            h("input", {
              autoFocus: true, defaultValue: budget != null ? String(budget).replace(".", ",") : "",
              onChange: e => setDraft(e.target.value),
              onKeyDown: e => { if (e.key === "Enter") save(); if (e.key === "Escape") onEditDone(); },
              onBlur: save, placeholder: "0,00", "aria-label": `Alvo de ${c.name}`,
              style: { width: 72, height: 22, fontSize: 11, padding: "0 5px", background: "var(--bg-0)",
                border: "1px solid var(--accent)", color: "var(--fg-0)", fontFamily: "var(--ff-mono)" },
            }),
            h("span", { style: { color: "var(--fg-3)" } },
              refMonthOf(monthSel) ? `alvo de ${window.BS.PT_MONTHS[monthSel.month].toLowerCase()}` : "alvo fixo")
          )
        : h("button", {
            onClick: onEdit,
            title: budget != null
              ? `Alvo ${meta.budget_source === "month" ? "só deste mês" : "fixo"}: ${fmtBRL(budget)} — clique pra mudar`
              : "Definir um alvo de gasto pra esta categoria",
            style: { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11,
              color: st ? st.color : "var(--fg-3)", fontWeight: st ? 700 : 400,
              borderBottom: "1px dashed var(--line-2)" },
          }, budget != null
              ? `${Math.round(st.ratio * 100)}% de ${fmtBRL(budget)}${meta.budget_source === "month" ? " · só este mês" : ""}`
              : "definir alvo")
    )
  );
}

const FaturaWidget = React.memo(function FaturaWidget({ monthTx, filter, onToggleFacet }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const { faturaItems, totalFatura, byBank } = _dMemo(() => {
    const items = monthTx.filter(t => t.method === "credit" && !t.is_settlement);
    const total = items.reduce((s, t) => s + (t.flow === "expense" ? t.amount : -t.amount), 0);
    const banks = {};
    items.forEach(t => {
      const bank = (t.bank === "nubank" || (t.account_id && t.account_id.startsWith("nu"))) ? "Nubank" :
                   (t.bank === "inter" || (t.account_id && t.account_id.startsWith("inter"))) ? "Inter" : "Outros";
      banks[bank] = (banks[bank] || 0) + (t.flow === "expense" ? t.amount : -t.amount);
    });
    return { faturaItems: items, totalFatura: total, byBank: banks };
  }, [monthTx]);

  return h("div", { className: "widget wg-7" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Fatura do Cartão"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: totalFatura > 0 ? "var(--neg)" : "var(--fg-0)" } }, (totalFatura >= 0 ? "−" : "+") + fmtBRL(Math.abs(totalFatura)))
    ),
    h("div", { className: "widget-body", style: { gap: 10 } },
      faturaItems.length === 0
        ? h("div", { className: "px-empty" }, "Nenhuma despesa no crédito neste mês.")
        : h(React.Fragment, null,
            h("div", { style: { display: "flex", gap: 3, height: 5, flexShrink: 0 } },
              Object.entries(byBank).map(([bank, amt]) => {
                const pct = ((amt) / totalFatura) * 100;
                const color = bank === "Nubank" ? "var(--nubank)" : bank === "Inter" ? "var(--inter)" : "var(--accent)";
                return pct > 0.5 && h("div", { key: bank, title: `${bank}: ${pct.toFixed(0)}%`, style: { width: pct + "%", background: color, borderRadius: 2, opacity: 0.85 } });
              })
            ),
            h("div", { style: { display: "flex", flexDirection: "column" } },
              Object.entries(byBank).map(([bank, amt], i, arr) => {
                const color = bank === "Nubank" ? "var(--nubank)" : bank === "Inter" ? "var(--inter)" : "var(--accent)";
                const active = filter && filter.banks.has(bank);
                return h("button", {
                  key: bank, onClick: () => onToggleFacet && onToggleFacet("banks", bank),
                  className: active ? "facet-row facet-active" : "facet-row",
                  style: { display: "flex", flexDirection: "column", gap: 2, padding: "9px 6px", textAlign: "left", cursor: "pointer", background: "none",
                    border: "none", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none" }
                },
                  h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                    h("span", { style: { width: 8, height: 8, background: color, flexShrink: 0 } }),
                    h("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)" } }, `Fatura ${bank}`),
                    totalFatura > 0 && h("span", { className: "mono", style: { fontSize: 11, color: "var(--fg-3)", marginLeft: "auto" } }, `${((amt / totalFatura) * 100).toFixed(0)}%`)
                  ),
                  h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, paddingLeft: 16, color: "var(--neg)" } }, (amt >= 0 ? "−" : "+") + fmtBRL(Math.abs(amt)))
                );
              })
            )
          )
    )
  );
});

const InvestmentsWidget = React.memo(function InvestmentsWidget({ investments, evolution }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const typeLabel = t => INV_TYPE_LABEL[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Investimento");
  const total = investments.reduce((s, i) => s + (i.balance || 0), 0);
  const invDelta = (evolution && evolution.length > 1)
    ? evolution[evolution.length - 1].cumulative - evolution[evolution.length - 2].cumulative : null;

  const rows = _dMemo(() => {
    const out = [];
    const porq = investments.filter(i => i.group_name === "Porquinho");
    investments.filter(i => i.group_name !== "Porquinho").forEach(i => out.push({
      name: i.name, sub: typeLabel(i.type), balance: i.balance || 0, derived: !!i.derived,
    }));
    if (porq.length) out.push({
      name: `Porquinho Inter${porq.length > 1 ? ` ×${porq.length}` : ""}`,
      sub: "CDB · B3", balance: porq.reduce((s, i) => s + (i.balance || 0), 0),
    });
    return out.sort((a, b) => b.balance - a.balance);
  }, [investments]);

  return h("div", { className: "widget wg-7" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Investimentos"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--reserve)" } }, fmtBRL(total))
    ),
    h("div", { className: "widget-body", style: { gap: 0 } },
      investments.length === 0
        ? h("div", { className: "px-empty" }, "Nenhum investimento — importe um relatório B3.")
        : rows.map((r, i, arr) => h("div", {
            key: i,
            style: { display: "flex", flexDirection: "column", gap: 1, padding: "7px 0", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none", flexShrink: 0 }
          },
            h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
              h("span", { title: r.name, style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.name),
              h("span", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: "var(--fg-0)", flexShrink: 0 } }, fmtBRL(r.balance))
            ),
            h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em" } },
              r.sub, total ? ` · ${((r.balance / total) * 100).toFixed(1)}%` : "",
              r.derived ? " · derivado" : "")
          )),
      invDelta != null && h("div", { style: { marginTop: "auto", paddingTop: 8, display: "flex", gap: 6, alignItems: "baseline", flexShrink: 0 } },
        h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.05em" } }, "Δ mês"),
        h("span", { className: "kpi-delta", style: { color: invDelta >= 0 ? "var(--pos)" : "var(--info)" } },
          (invDelta >= 0 ? "+" : "−") + fmtBRL(Math.abs(invDelta))),
        invDelta < 0 && h("span", { style: { fontSize: 11, color: "var(--fg-3)" } }, "(resgate)"))
    )
  );
});

const CADENCE_LABEL = { 1: "todo mês", 2: "a cada 2 meses", 3: "a cada 3 meses" };
const cadenceLabel = (n) => CADENCE_LABEL[n] || `a cada ${n} meses`;

// Coluna de um mês: comprometido DURO sólido embaixo, previsto recorrente
// dithered por cima. O dither é o vocabulário de "não é certo" do sistema.
function ForwardColumn({ slot, scale }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const px = (v, max) => (v > 0 ? Math.max((v / max) * 52, 2) : 0);

  return h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 24 } },
    h("div", { style: { height: 52, width: 12, display: "flex", flexDirection: "column", justifyContent: "flex-end" } },
      slot.recurringExpense > 0 && h("div", {
        className: "dither-warn",
        title: `previsto ${fmtBRL(slot.recurringExpense)}`,
        style: { width: "100%", minHeight: 2, height: px(slot.recurringExpense, scale.outflow) },
      }),
      slot.committed > 0 && h("div", {
        title: `comprometido ${fmtBRL(slot.committed)}`,
        style: { width: "100%", minHeight: 2, height: px(slot.committed, scale.outflow), background: "var(--warn)" },
      }),
    ),
    h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-2)" } }, slot.label.slice(0, 2)),
  );
}

const ForwardWidget = React.memo(function ForwardWidget({ commitments }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const [detailOpen, setDetailOpen] = _dSt(false);

  const recurring = (commitments && commitments.recurring) ||
    { items: [], series: [], expense_monthly: 0, income_monthly: 0 };
  const merged = window.BS.mergeForwardSeries((commitments && commitments.series) || [], recurring.series);
  const scale = window.BS.forwardScale(merged);
  const hasAny = merged.length > 0;

  const detail = h(window.BS.Overlay, { open: detailOpen, onClose: () => setDetailOpen(false) },
    h("div", { className: "widget-h", style: { flexShrink: 0 } },
      h("span", { className: "widget-title" }, "Recorrências detectadas"),
      h("button", { className: "px-btn", onClick: () => setDetailOpen(false) }, "‹ VOLTAR"),
    ),
    h("div", { style: { padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 } },
      h("p", { style: { fontSize: 11, color: "var(--fg-3)", margin: 0, lineHeight: 1.5 } },
        "Derivado do extrato — nada aqui foi digitado. Um lançamento vira recorrência quando o mesmo ",
        "destino se repete por 3 meses ou mais com valor estável e cadência regular."),
      recurring.items.length === 0
        ? h("div", { className: "px-empty" }, "Nenhuma recorrência detectada no histórico recente.")
        : recurring.items.map(it => h("div", {
            key: it.flow + "|" + it.merchant,
            className: "px-row",
            style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
          },
          h("div", { style: { minWidth: 0 } },
            h("div", {
              title: it.merchant,
              style: { fontSize: 12, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
            }, window.BS.merchantLabel(it.merchant)),
            h("div", { style: { fontSize: 11, color: "var(--fg-3)", marginTop: 2 } },
              cadenceLabel(it.cadence_months), " · ", it.occurrences, " ocorrências · última em ", it.last_month,
              it.stale_months > 0 ? ` · ${it.stale_months} ${it.stale_months === 1 ? "mês" : "meses"} sem repetir` : ""),
          ),
          h("span", { className: "mono", style: { flexShrink: 0, color: it.flow === "income" ? "var(--pos)" : "var(--warn)" } },
            (it.flow === "income" ? "+" : "−") + fmtBRL(it.monthly)),
        )),
    ),
  );

  return h("div", { className: "widget wg-7" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Visão de Futuro"),
      recurring.items.length > 0 && h("button", {
        className: "px-btn", onClick: () => setDetailOpen(true),
      }, `${recurring.items.length} RECORRÊNCIAS`),
    ),
    h("div", { className: "widget-body", style: { gap: 8, overflow: "hidden" } },
      !hasAny
        ? h("div", { className: "px-empty" }, "Nada comprometido nem recorrente à frente.")
        : h("div", { style: { display: "flex", alignItems: "flex-end", gap: 6, overflowX: "auto" } },
            merged.map(s => h(ForwardColumn, { key: s.month, slot: s, scale }))),

      hasAny && h("div", { style: { marginTop: 8, display: "flex", flexDirection: "column", gap: 2 } },
        merged.slice(0, 6).map(s => h("div", { key: s.month, style: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 } },
          h("span", { style: { color: "var(--fg-2)" } }, s.label),
          h("span", { style: { display: "flex", gap: 8 } },
            s.outflow > 0 && h("span", { className: "mono", style: { color: "var(--warn)" } }, "− " + fmtBRL(s.outflow)),
            s.recurringIncome > 0 && h("span", { className: "mono", style: { color: "var(--pos)" } }, "+ " + fmtBRL(s.recurringIncome)),
          ),
        ))
      ),

      hasAny && h("div", { style: { marginTop: 6, fontSize: 10, color: "var(--fg-3)", lineHeight: 1.5 } },
        "Sólido = comprometido · dithered = previsto pela recorrência"),
    ),
    detail,
  );
});

const refMonthOf = (monthSel) =>
  monthSel ? `${monthSel.year}-${String(monthSel.month).padStart(2, "0")}` : undefined;

function DashboardView({ monthSel, monthly, onPickMonth, refreshKey, onEditCategory, onImport, onManageCategories }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const [available, setAvailable] = _dSt(null);
  const [commitments, setCommitments] = _dSt(null);
  const [availErr, setAvailErr] = _dSt(false);
  const [loadErr, setLoadErr] = _dSt(false);
  const [retryTick, setRetryTick] = _dSt(0);
  const [accounts, setAccounts] = _dSt([]);
  const [investments, setInvestments] = _dSt([]);
  const [liquidityHistory, setLiquidityHistory] = _dSt([]);
  const [evolution, setEvolution] = _dSt([]);
  const [backup, setBackup] = _dSt(null);
  const [cashflow, setCashflow] = _dSt(null);
  const [monthTx, setMonthTx] = _dSt([]);
  const [uncatCount, setUncatCount] = _dSt(0);
  const [bulkOpen, setBulkOpen] = _dSt(false);

  const [expenseCats, setExpenseCats] = _dSt([]);
  const [filter, setFilter] = _dSt(() => window.BS.emptyFilter());

  const onToggleFacet = (kind, value) => setFilter(f => window.BS.toggleFacet(f, kind, value));

  const setFilterField = (field, value) => setFilter(f => Object.assign({}, f, { [field]: value }));

  const clearFilter = () => setFilter(window.BS.emptyFilter());

  _dEf(() => { setFilter(window.BS.emptyFilter()); }, [monthSel]);

  _dEf(() => {
    setAvailErr(false); setLoadErr(false);
    fetchAvailable().then(setAvailable).catch(() => setAvailErr(true));
    fetchCommitments().then(setCommitments).catch(() => {});
    fetchBackupStatus().then(setBackup).catch(() => {});
    Promise.all([fetchAccounts(), fetchInvestments(), fetchLiquidityHistory(), fetchInvestmentEvolution()])
      .then(([ac, invs, lh, ev]) => {
        setAccounts(ac); setInvestments(invs);
        setLiquidityHistory(lh || []); setEvolution(ev || []);
      }).catch(() => setLoadErr(true));
  }, [refreshKey, retryTick]);

  _dEf(() => {
    if (!monthSel) return;
    const { month, year } = monthSel;
    fetchCashflowStatement({ month, year }).then(setCashflow).catch(() => {});
    fetchMonthTransactions({ month, year }).then(setMonthTx).catch(() => {});
    fetchUncategorizedMerchants({ year, month })
      .then(gs => setUncatCount(gs.reduce((s, g) => s + g.count, 0)))
      .catch(() => setUncatCount(0));
    fetchCategoriesFull("expense", refMonthOf(monthSel)).then(setExpenseCats).catch(() => setExpenseCats([]));
  }, [monthSel, refreshKey, retryTick]);

  _dEf(() => {
    const handler = e => setMonthTx(prev => prev.filter(tx => tx.id !== e.detail.id));
    window.addEventListener("bs-tx-optimistic-delete", handler);
    return () => window.removeEventListener("bs-tx-optimistic-delete", handler);
  }, []);

  const catsIndex = _dMemo(
    () => new Map(expenseCats.map(c => [c.id, c])),
    [expenseCats],
  );

  const reloadBudgets = _dCb(() => {
    if (!monthSel) return;
    fetchCategoriesFull("expense", refMonthOf(monthSel)).then(setExpenseCats).catch(() => {});
  }, [monthSel]);

  const isLatestMonth = _dMemo(() => {
    if (!monthSel || !monthly || !monthly.length) return false;
    const last = monthly[monthly.length - 1];
    return last.year === monthSel.year && last.month === monthSel.month;
  }, [monthly, monthSel]);

  if (loadErr) return h("div", { style: { margin: "48px auto", background: "var(--neg-bg)", border: "1px solid var(--neg)", padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", maxWidth: 480 } },
    h("div", { style: { color: "var(--neg)", fontSize: 14, fontWeight: 700 } }, "Falha ao carregar os dados."),
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "O servidor local não respondeu. Verifique se o BrokerShark está rodando."),
    h("button", { className: "px-btn px-btn--danger", onClick: () => setRetryTick(t => t + 1) }, "Tentar de novo"));

  const isFirstRun = available && available.checking_total === 0 && monthly.length === 0;
  if (isFirstRun) return h("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 } },
    h("div", { className: "fade-in", style: { padding: "56px 40px", width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 24, alignItems: "center", textAlign: "center", background: "var(--bg-1)", border: "1px solid var(--line-1)" } },
      h("div", { style: { display: "flex", justifyContent: "center", alignItems: "center", width: 64, height: 64, background: "var(--bg-2)", color: "var(--accent)", border: "1px solid var(--accent)" } },
        h("svg", { width: 32, height: 32, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
          h("path", { d: "M8 11 L8 2" }), h("path", { d: "M4 6 L8 2 L12 6" }), h("path", { d: "M2 14 L14 14" })
        )
      ),
      h("h1", { style: { fontFamily: "var(--ff-sans)", fontSize: 22, color: "var(--fg-0)", letterSpacing: "1px", textTransform: "uppercase", margin: 0, lineHeight: 1.3 } }, "Você no controle"),
      h("p", { style: { fontSize: 14, color: "var(--fg-2)", lineHeight: 1.6, maxWidth: 420, margin: 0 } },
        "Importe seus extratos (.csv) ou relatórios da B3 (.xlsx) para começar a responder à pergunta que importa: ",
        h("strong", { style: { color: "var(--fg-0)", fontWeight: 700 } }, "Quanto posso gastar agora?")
      ),
      h("button", { className: "px-btn px-btn--primary", style: { height: 34, marginTop: 8 }, onClick: onImport },
        h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
          h("path", { d: "M8 11 L8 2" }), h("path", { d: "M4 6 L8 2 L12 6" }), h("path", { d: "M2 14 L14 14" })
        ),
        "Importar meus arquivos"
      )
    )
  );

  const investTotal = investments.reduce((s, i) => s + (i.balance || 0), 0);
  const monthLabel = monthSel ? `${PT_SHORT[monthSel.month]}/${String(monthSel.year).slice(2)}` : "—";

  return h(React.Fragment, null,
    h(KpiStrip, { available, availErr, accounts, cashflow, investTotal, liquidityHistory, evolution, monthLabel, monthly }),
    h("div", { className: "dash-main fade-in" },
      h("div", { className: "widget-band" },
        h("div", { className: "widget-row" },
          h(GeneralWidget, { cashflow, liquidityHistory, monthly, monthSel, monthTx, uncatCount, backup }),
          h(TimelineWidget, { monthly, monthSel, onPickMonth }),
          h(AccountsWidget, { accounts, available, filter, onToggleFacet }),
          h(CategoriesWidget, { monthTx, uncatCount, onOpenBulk: () => setBulkOpen(true), filter, onToggleFacet,
            catsIndex, monthSel, onBudgetSaved: reloadBudgets,
            onManageCategories, onCreateCategory: onManageCategories }),
          h(InvestmentsWidget, { investments, evolution }),
        ),
        h("div", { className: "widget-row widget-row--soft" },
          h(FaturaWidget, { monthTx, filter, onToggleFacet }),
          h(ForwardWidget, { commitments }),
        ),
      ),
      h(window.BS.FilterBar, { filter, onRemove: (kind, value) => {
          if (kind === "flow" || kind === "method") setFilterField(kind, "all");
          else onToggleFacet(kind, value);
        }, onClear: clearFilter }),
      h(window.BS.TxTableWidget, {
        monthSel, refreshKey, onEditCategory,
        openBulk: bulkOpen, onBulkConsumed: () => setBulkOpen(false),
        monthTx, setMonthTx,
        filter, setFilterField, onToggleFacet,

        accounts, catsIndex, isLatestMonth,
      })
    )
  );
}

window.BS = window.BS || {};
window.BS.DashboardView = DashboardView;

})();
