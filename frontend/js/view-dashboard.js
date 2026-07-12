/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/* view-dashboard.js — DashboardView: a tela única do BrokerShark.
   Faixa KPI fixa (Disponível · Patrimônio · Balanço do mês · Investido) +
   grid de widgets (timeline, contas, categorias, investimentos, PIX,
   atividade). Detalhe abre em drill-down (Overlay) — nunca navegação. */
/* global React, fetchAvailable, fetchAccounts, fetchMonthTransactions,
          fetchCashflowStatement, fetchInvestments, fetchLiquidityHistory,
          fetchInvestmentEvolution, fetchPixTop, fetchUncategorizedMerchants */

const { useState: _dSt, useEffect: _dEf, useMemo: _dMemo } = React;
const { fmtBRL, fmtBRLCompact, PT_MONTHS, PT_SHORT, Donut,
        isConsumptionExpense, isRevenue, isSelf } = window.BS;

const INV_TYPE_LABEL = {
  rdb: "Caixinha (RDB)", cdb: "CDB / Renda fixa", tesouro: "Tesouro Direto",
  lci: "LCI / Renda fixa", lca: "LCA / Renda fixa", savings: "Poupança",
};
const INV_COLORS = [
  "oklch(78% 0.13 200)", "oklch(67% 0.17 305)", "oklch(74% 0.13 172)",
  "oklch(63% 0.16 270)", "oklch(72% 0.14 240)", "oklch(58% 0.13 255)",
];

/* Δ assinado (mono, pos/neg) — o vocabulário único de "variação vs mês" */
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

/* ── KpiStrip — os 4 números que respondem "como estou" ─────────────────── */
function KpiStrip({ available, availErr, accounts, cashflow, investTotal,
                    liquidityHistory, evolution, monthLabel }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const checkingTotal = available ? available.checking_total : 0;
  const patrimonio = checkingTotal + investTotal;
  const seriesDelta = s => (s && s.length > 1) ? s[s.length - 1].value - s[s.length - 2].value : null;
  const patDelta = seriesDelta(liquidityHistory);
  const invDelta = (evolution && evolution.length > 1)
    ? evolution[evolution.length - 1].cumulative - evolution[evolution.length - 2].cumulative : null;

  const availValue = available ? available.available : null;
  const availNeg = availValue != null && availValue < 0;

  const inc = cashflow ? cashflow.income_total : 0;
  const exp = cashflow ? cashflow.expense_total : 0;
  const invNet = cashflow ? cashflow.investment_net : 0;
  const livre = inc - exp - invNet;

  const checking = (accounts || []).filter(a => a.type === "checking")
    .sort((a, b) => ((a.id || "").startsWith("nu") ? 1 : 2) - ((b.id || "").startsWith("nu") ? 1 : 2));

  return h("div", { className: "kpi-strip" },
    // 1. Disponível pra gastar — o herói; posição, sempre "agora"
    h("div", { className: "kpi kpi-hero" },
      h("span", { className: "kpi-label" }, "Disponível pra gastar · agora"),
      availErr
        ? h("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--neg)" } }, "falha ao carregar")
        : h("span", { className: "kpi-value", style: { color: availNeg ? "var(--neg)" : "var(--pos)" } },
            availValue == null ? "—" : (availNeg ? "−" : "") + fmtBRL(Math.abs(availValue))),
      h("span", { className: "kpi-sub" },
        checking.map(a => h("span", { key: a.id, style: { display: "inline-flex", gap: 5, alignItems: "baseline" } },
          h("span", { style: { color: (a.id || "").startsWith("nu") ? "var(--nubank)" : "var(--inter)", fontWeight: 700 } },
            (a.id || "").startsWith("nu") ? "Nu" : "Inter"),
          h("span", { className: "mono", style: { color: "var(--fg-1)", fontSize: 11 } }, fmtBRL(a.balance || 0))
        ))
      )
    ),
    // 2. Patrimônio total — caixa + investimentos, com Δ mensal
    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, "Patrimônio total"),
      h("span", { className: "kpi-value", title: `Caixa ${fmtBRL(checkingTotal)} + investimentos ${fmtBRL(investTotal)}` },
        (patrimonio < 0 ? "−" : "") + fmtBRL(Math.abs(patrimonio))),
      h("span", { className: "kpi-sub" }, h(Delta, { value: patDelta, suffix: "vs mês passado" }))
    ),
    // 3. Balanço do mês selecionado — saldo livre + composição
    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, `Saldo livre · ${monthLabel}`),
      h("span", { className: "kpi-value", style: { color: livre >= 0 ? "var(--pos)" : (inc === 0 ? "var(--warn)" : "var(--neg)") } },
        (livre >= 0 ? "+" : "−") + fmtBRL(Math.abs(livre))),
      h("span", { className: "kpi-sub" },
        h("span", { className: "mono", style: { color: "var(--pos)" } }, "+" + fmtBRL(inc)),
        h("span", { className: "mono", style: { color: "var(--neg)" } }, "−" + fmtBRL(exp)),
        invNet !== 0 && h("span", { className: "mono", style: { color: invNet > 0 ? "var(--reserve)" : "var(--info)" }, title: invNet > 0 ? "aplicado líquido" : "resgatado líquido" },
          (invNet > 0 ? "→inv " : "←inv ") + fmtBRL(Math.abs(invNet)))
      )
    ),
    // 4. Total investido — com Δ mensal da carteira
    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, "Investido"),
      h("span", { className: "kpi-value", style: { color: "var(--reserve)" } }, fmtBRL(investTotal)),
      h("span", { className: "kpi-sub" }, h(Delta, { value: invDelta, suffix: "vs mês passado" }))
    )
  );
}

/* ── TimelineWidget — o controle de mês É o gráfico ──────────────────────
   12 slots por ano, barras receita×despesa; clique seleciona o mês global. */
function TimelineWidget({ monthly, monthSel, onPickMonth }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const now = new Date();
  const [browsingYear, setBrowsingYear] = _dSt(null);
  const activeYear = browsingYear || (monthSel ? monthSel.year : now.getFullYear());
  const years = [...new Set(monthly.map(m => m.year))].sort((a, b) => a - b);

  const slots = [];
  for (let m = 1; m <= 12; m++) slots.push({ month: m, data: monthly.find(x => x.year === activeYear && x.month === m) });
  const maxV = Math.max(...slots.map(s => s.data ? Math.max(s.data.income, s.data.expenses) : 0), 1);

  const sel = monthSel && monthly.find(x => x.year === monthSel.year && x.month === monthSel.month);

  return h("div", { className: "widget wg-8" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Fluxo mês a mês"),
      h("div", { style: { display: "flex", gap: 14, marginLeft: 12 } },
        years.map(y => h("button", {
          key: y, onClick: () => setBrowsingYear(y),
          style: {
            fontSize: 11, fontFamily: "var(--ff-mono)", fontWeight: activeYear === y ? 700 : 500,
            color: activeYear === y ? "var(--fg-0)" : "var(--fg-3)", padding: "2px 0",
            borderBottom: activeYear === y ? "2px solid var(--accent)" : "2px solid transparent",
          }
        }, y))
      ),
      h("span", { style: { marginLeft: "auto", display: "flex", gap: 12, fontSize: 10, color: "var(--fg-3)", alignItems: "center" } },
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 } },
          h("span", { style: { width: 8, height: 8, borderRadius: 2, background: "var(--pos)" } }), "receita"),
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 } },
          h("span", { style: { width: 8, height: 8, borderRadius: 2, background: "var(--neg)" } }), "despesa"))
    ),
    h("div", { className: "widget-body", style: { gap: 10 } },
      h("div", { style: { display: "flex", gap: 4, alignItems: "stretch" } },
        slots.map(slot => {
          const d = slot.data;
          const isPicked = d && monthSel && d.year === monthSel.year && d.month === monthSel.month;
          const isCur = activeYear === now.getFullYear() && slot.month === now.getMonth() + 1;
          const hInc = d ? Math.max((d.income / maxV) * 54, d.income > 0 ? 2 : 0) : 0;
          const hExp = d ? Math.max((d.expenses / maxV) * 54, d.expenses > 0 ? 2 : 0) : 0;
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
            h("div", { className: "tl-bars" },
              h("div", { className: "tl-bar", style: { height: hInc, background: "var(--pos)", opacity: isPicked ? 1 : 0.75 } }),
              h("div", { className: "tl-bar", style: { height: hExp, background: "var(--neg)", opacity: isPicked ? 1 : 0.75 } })
            ),
            h("span", { className: "tl-mon", style: isCur && !isPicked ? { color: "var(--fg-1)", fontWeight: 700 } : null },
              PT_SHORT[slot.month]),
            h("span", { className: "tl-net", style: { color: !d ? "transparent" : net >= 0 ? "var(--pos)" : "var(--neg)" } },
              d ? (net >= 0 ? "+" : "−") + fmtBRLCompact(net) : "·")
          );
        })
      ),
      // Resumo do mês selecionado — números exatos (as barras dão a forma)
      sel && h("div", { style: { display: "flex", gap: 24, alignItems: "baseline", borderTop: "1px solid var(--line-1)", paddingTop: 10 } },
        h("span", { style: { fontSize: 12, fontWeight: 700, color: "var(--fg-1)" } }, `${PT_MONTHS[sel.month]} ${sel.year}`),
        h("span", { className: "mono", style: { fontSize: 12, color: "var(--pos)" } }, "+" + fmtBRL(sel.income)),
        h("span", { className: "mono", style: { fontSize: 12, color: "var(--neg)" } }, "−" + fmtBRL(sel.expenses)),
        h("span", { className: "mono", title: "receitas − despesas do mês (investimentos contam à parte)", style: { fontSize: 12, fontWeight: 700, color: (sel.income - sel.expenses) >= 0 ? "var(--pos)" : "var(--neg)" } },
          "= " + ((sel.income - sel.expenses) >= 0 ? "+" : "−") + fmtBRL(Math.abs(sel.income - sel.expenses))),
        (() => {  // Δ despesas vs mês anterior — a "modificação mês a mês" em uma frase
          const idx = monthly.indexOf(sel);
          const prev = idx > 0 ? monthly[idx - 1] : null;
          if (!prev) return null;
          const d = sel.expenses - prev.expenses;
          return h("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--fg-3)" } },
            "despesas ",
            h("span", { className: "mono", style: { fontWeight: 700, color: d <= 0 ? "var(--pos)" : "var(--neg)" } },
              (d >= 0 ? "+" : "−") + fmtBRL(Math.abs(d))),
            ` vs ${PT_SHORT[prev.month]}/${String(prev.year).slice(2)}`);
        })()
      )
    )
  );
}

/* ── AccountsWidget — onde o caixa está ──────────────────────────────────── */
function AccountsWidget({ accounts, available }) {
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
      total > 0 && checking.length > 1 && h("div", { style: { display: "flex", gap: 3, height: 5 } },
        checking.map(a => {
          const pct = ((a.balance || 0) / total) * 100;
          return pct > 0.5 && h("div", { key: a.id, title: `${a.name}: ${pct.toFixed(0)}%`, style: { width: pct + "%", background: colorOf(a), borderRadius: 2, opacity: 0.85 } });
        })
      ),
      h("div", { style: { display: "flex", flexDirection: "column" } },
        checking.map((a, i, arr) => h("div", {
          key: a.id,
          style: { display: "flex", justifyContent: "space-between", alignItems: "center", height: 38, borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none" }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: 9 } },
            h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: colorOf(a) } }),
            h("span", { style: { fontSize: 12, fontWeight: 600, color: "var(--fg-1)" } }, a.name),
            total > 0 && h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-3)" } }, `${(((a.balance || 0) / total) * 100).toFixed(0)}%`)
          ),
          h("span", { className: "mono", style: { fontSize: 13, fontWeight: 600, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
        ))
      )
    )
  );
}

/* ── CategoriesWidget — pra onde o dinheiro foi no mês ───────────────────── */
function CategoriesWidget({ monthTx, uncatCount, onOpenTx }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const expenses = monthTx.filter(isConsumptionExpense);
  const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
  const byCat = _dMemo(() => {
    const g = {};
    expenses.forEach(t => {
      const k = t.category || "Sem categoria";
      if (!g[k]) g[k] = { name: k, total: 0 };
      g[k].total += t.amount;
    });
    return Object.values(g).sort((a, b) => b.total - a.total);
  }, [monthTx]);

  const limit = 7;
  let items = byCat.slice(0, limit);
  if (byCat.length > limit) {
    const rest = byCat.slice(limit);
    items = [...items, { name: `Outras (${rest.length})`, total: rest.reduce((s, x) => s + x.total, 0), isOther: true }];
  }

  return h("div", { className: "widget wg-4" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Despesas por categoria"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--neg)" } }, "−" + fmtBRL(totalExp))
    ),
    h("div", { className: "widget-body", style: { gap: 9 } },
      byCat.length === 0
        ? h("div", { style: { color: "var(--fg-3)", fontSize: 12, textAlign: "center", padding: "24px 0" } }, "Nenhuma despesa no mês.")
        : items.map((c, i) => {
            const pct = totalExp ? (c.total / totalExp) * 100 : 0;
            return h("div", { key: i, style: { display: "flex", flexDirection: "column", gap: 4 } },
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } },
                h("span", { style: { fontSize: 12, fontWeight: 600, color: c.name === "Sem categoria" ? "var(--fg-3)" : "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name),
                h("div", { style: { display: "flex", gap: 8, alignItems: "baseline", flexShrink: 0 } },
                  h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-3)" } }, pct.toFixed(1) + "%"),
                  h("span", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(c.total)))
              ),
              h("div", { style: { height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" } },
                h("div", { style: { width: pct + "%", height: "100%", borderRadius: 2, background: c.isOther ? "var(--line-2)" : i === 0 ? "var(--accent)" : "var(--fg-2)" } }))
            );
          }),
      uncatCount > 0 && h("button", {
        onClick: () => onOpenTx({ bulk: true }),
        style: {
          marginTop: 2, alignSelf: "flex-start", padding: "4px 10px", borderRadius: 999,
          fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "var(--accent-bg)",
          border: "1px solid color-mix(in oklch, var(--accent) 35%, transparent)",
        }
      }, `Categorizar em lote · ${uncatCount}`)
    )
  );
}

/* ── InvestmentsWidget — resumo + drill (posições ficam no overlay) ──────── */
function InvestmentsWidget({ investments, onOpenInv }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const typeLabel = t => INV_TYPE_LABEL[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Investimento");
  const total = investments.reduce((s, i) => s + (i.balance || 0), 0);
  const groups = _dMemo(() => {
    // Agrupa como o usuário pensa: group_name (Porquinho) primeiro, tipo depois.
    const g = {};
    investments.forEach(inv => {
      const k = inv.group_name || typeLabel(inv.type);
      g[k] = (g[k] || 0) + (inv.balance || 0);
    });
    return Object.entries(g).map(([name, balance]) => ({ name, balance }))
      .sort((a, b) => b.balance - a.balance)
      .map((x, i) => ({ ...x, color: INV_COLORS[i % INV_COLORS.length] }));
  }, [investments]);

  return h("div", { className: "widget wg-4" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Investimentos"),
      h("button", { className: "widget-open", onClick: () => onOpenInv() }, "posições ", h("span", { className: "kbd" }, "3"))
    ),
    h("div", { className: "widget-body", style: { gap: 12 } },
      investments.length === 0
        ? h("div", { style: { color: "var(--fg-3)", fontSize: 12, textAlign: "center", padding: "24px 0" } }, "Nenhum investimento — importe um relatório B3.")
        : h("div", { style: { display: "flex", gap: 16, alignItems: "center" } },
            h(Donut, { data: groups, size: 108, thickness: 16, valueKey: "balance", colors: groups.map(g => g.color) }),
            h("div", { style: { display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 } },
              groups.map((g, i) => h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8 } },
                h("span", { style: { width: 8, height: 8, borderRadius: 2, background: g.color, flexShrink: 0 } }),
                h("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, g.name),
                h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-3)" } }, total ? ((g.balance / total) * 100).toFixed(0) + "%" : ""),
                h("span", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(g.balance))
              ))
            )
          )
    )
  );
}

/* ── PixTopWidget — maiores contrapartes PIX do mês ──────────────────────── */
function PixTopWidget({ pixTop }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  return h("div", { className: "widget wg-4" },
    h("div", { className: "widget-h" }, h("span", { className: "widget-title" }, "Top PIX do mês")),
    h("div", { className: "widget-body", style: { gap: 8 } },
      pixTop.length === 0
        ? h("div", { style: { color: "var(--fg-3)", fontSize: 12, textAlign: "center", padding: "24px 0" } }, "Nenhum PIX no mês.")
        : pixTop.slice(0, 6).map((p, i) => h("div", { key: i, style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 } },
            h("span", { style: { fontSize: 12, color: "var(--fg-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              window.BS.prettifyDesc(p.counterpart)),
            h("div", { style: { display: "flex", gap: 8, alignItems: "baseline", flexShrink: 0 } },
              h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-3)" } }, `${p.count}×`),
              h("span", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: "var(--fg-1)" } }, fmtBRL(p.total)))
          ))
    )
  );
}

/* ── ActivityWidget — últimos lançamentos do mês, drill pra tabela cheia ─── */
function ActivityWidget({ monthTx, onOpenTx, onEditCategory }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const rows = _dMemo(() =>
    [...monthTx].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id - a.id)).slice(0, 9),
  [monthTx]);
  return h("div", { className: "widget wg" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Atividade do mês"),
      h("span", { className: "mono", style: { fontSize: 10, color: "var(--fg-3)" } },
        `${monthTx.length} ${monthTx.length === 1 ? "lançamento" : "lançamentos"}`),
      h("button", { className: "widget-open", onClick: () => onOpenTx() }, "tabela completa ", h("span", { className: "kbd" }, "2"))
    ),
    monthTx.length === 0
      ? h("div", { style: { padding: "28px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 12 } }, "Nenhum lançamento neste mês.")
      : h("table", { className: "grid-table" },
          h("tbody", null,
            rows.map(t => h(window.BS.TxRow, { key: t.id, t, cols: ["date", "desc", "cat", "account", "amount"], onEditCategory }))
          )
        )
  );
}

/* ── DashboardView ────────────────────────────────────────────────────────── */
function DashboardView({ monthSel, monthly, onPickMonth, refreshKey,
                         onOpenTx, onOpenInv, onEditCategory, onImport, footer }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const [available, setAvailable] = _dSt(null);
  const [availErr, setAvailErr] = _dSt(false);
  const [loadErr, setLoadErr] = _dSt(false);
  const [retryTick, setRetryTick] = _dSt(0);
  const [accounts, setAccounts] = _dSt([]);
  const [investments, setInvestments] = _dSt([]);
  const [liquidityHistory, setLiquidityHistory] = _dSt([]);
  const [evolution, setEvolution] = _dSt([]);
  const [cashflow, setCashflow] = _dSt(null);
  const [monthTx, setMonthTx] = _dSt([]);
  const [pixTop, setPixTop] = _dSt([]);
  const [uncatCount, setUncatCount] = _dSt(0);

  // Dados de posição (independem do mês selecionado)
  _dEf(() => {
    setAvailErr(false); setLoadErr(false);
    fetchAvailable().then(setAvailable).catch(() => setAvailErr(true));
    Promise.all([fetchAccounts(), fetchInvestments(), fetchLiquidityHistory(), fetchInvestmentEvolution()])
      .then(([ac, invs, lh, ev]) => {
        setAccounts(ac); setInvestments(invs);
        setLiquidityHistory(lh || []); setEvolution(ev || []);
      }).catch(() => setLoadErr(true));
  }, [refreshKey, retryTick]);

  // Dados de fluxo (seguem o seletor de mês global)
  _dEf(() => {
    if (!monthSel) return;
    const { month, year } = monthSel;
    fetchCashflowStatement({ month, year }).then(setCashflow).catch(() => {});
    fetchMonthTransactions({ month, year }).then(setMonthTx).catch(() => {});
    fetchPixTop({ month, year }).then(setPixTop).catch(() => setPixTop([]));
    fetchUncategorizedMerchants({ year, month })
      .then(gs => setUncatCount(gs.reduce((s, g) => s + g.count, 0)))
      .catch(() => setUncatCount(0));
  }, [monthSel, refreshKey, retryTick]);

  // Exclusão otimista (evento global disparado pelo shell)
  _dEf(() => {
    const handler = e => setMonthTx(prev => prev.filter(tx => tx.id !== e.detail.id));
    window.addEventListener("bs-tx-optimistic-delete", handler);
    return () => window.removeEventListener("bs-tx-optimistic-delete", handler);
  }, []);

  if (loadErr) return h("div", { style: { margin: "48px auto", background: "color-mix(in oklch, var(--neg) 5%, transparent)", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", maxWidth: 480 } },
    h("div", { style: { color: "var(--neg)", fontSize: 14, fontWeight: 700 } }, "Falha ao carregar os dados."),
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "O servidor local não respondeu. Verifique se o BrokerShark está rodando."),
    h("button", { className: "btn btn-ghost", style: { color: "var(--neg)", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", fontWeight: 600 }, onClick: () => setRetryTick(t => t + 1) }, "Tentar de novo"));

  // First-run: nada importado → convite único, sem widgets zerados
  const isFirstRun = available && available.checking_total === 0 && monthly.length === 0;
  if (isFirstRun) return h("div", { className: "fade-in", style: { margin: "64px auto", maxWidth: 560 } },
    h("div", { className: "panel", style: { padding: 32, display: "flex", flexDirection: "column", gap: 20 } },
      h("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--fg-0)" } }, "Sem dados ainda"),
      h("div", { style: { fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6 } },
        "Importe extratos (Nubank/Inter .csv) e relatórios B3 (.xlsx) para ver quanto você pode gastar."),
      h("button", { className: "btn btn-primary", style: { alignSelf: "flex-start" }, onClick: onImport }, "Importar arquivos")));

  const investTotal = investments.reduce((s, i) => s + (i.balance || 0), 0);
  const monthLabel = monthSel ? `${PT_SHORT[monthSel.month]}/${String(monthSel.year).slice(2)}` : "—";

  return h(React.Fragment, null,
    h(KpiStrip, { available, availErr, accounts, cashflow, investTotal, liquidityHistory, evolution, monthLabel }),
    h("div", { className: "dash-main" },
      h("div", { className: "dash-grid fade-in" },
        h(TimelineWidget, { monthly, monthSel, onPickMonth }),
        h(AccountsWidget, { accounts, available }),
        h(CategoriesWidget, { monthTx, uncatCount, onOpenTx }),
        h(InvestmentsWidget, { investments, onOpenInv }),
        h(PixTopWidget, { pixTop }),
        h(ActivityWidget, { monthTx, onOpenTx, onEditCategory })
      ),
      footer || null
    )
  );
}

window.BS = window.BS || {};
window.BS.DashboardView = DashboardView;

})();
