/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/* view-dashboard.js — DashboardView: a tela única do BrokerShark (1920×1080).
   Topbar + faixa KPI + UMA linha de widgets (visão geral, fluxo, contas,
   categorias, investimentos) + tabela full-width com scroll interno.
   Nada de navegação: tudo visível, detalhe é filtro/ordenação na tabela. */
/* global React, fetchAvailable, fetchAccounts, fetchMonthTransactions,
          fetchCashflowStatement, fetchInvestments, fetchLiquidityHistory,
          fetchInvestmentEvolution, fetchUncategorizedMerchants, fetchBackupStatus */

const { useState: _dSt, useEffect: _dEf, useMemo: _dMemo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, PT_MONTHS, PT_SHORT,
        isConsumptionExpense } = window.BS;

const INV_TYPE_LABEL = {
  rdb: "Caixinha (RDB)", cdb: "CDB / Renda fixa", tesouro: "Tesouro Direto",
  lci: "LCI / Renda fixa", lca: "LCA / Renda fixa", savings: "Poupança",
};

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

function Sparkline({ data, width = 150, height = 36, color = "var(--accent)" }) {
  const h = React.createElement;
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const coords = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);
  const points = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${coords[0][0]},${height} ${points} ${coords[coords.length - 1][0]},${height}`;
  // width = viewBox lógico; o svg estica pro contêiner (stroke não escala)
  return h("svg", { width: "100%", height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", style: { display: "block" }, "aria-hidden": true },
    h("polygon", { points: area, fill: "var(--accent-bg)", stroke: "none" }),
    h("polyline", { fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke", points })
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

/* ── GeneralWidget — visão geral: patrimônio+evolução, resumo, saúde ─────── */
function GeneralWidget({ cashflow, liquidityHistory, monthly, monthSel,
                         monthTx, uncatCount, backup }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const inc = cashflow ? cashflow.income_total : 0;
  const exp = cashflow ? cashflow.expense_total : 0;
  const invNet = cashflow ? cashflow.investment_net : 0;
  const livre = inc - exp - invNet;
  const monName = monthSel ? PT_MONTHS[monthSel.month].toLowerCase() : "";

  // Resumo em uma frase — leitura de relance, números exatos
  const parts = [];
  parts.push(h("span", { key: "i" }, "Recebeu ", h("b", { className: "mono", style: { color: "var(--pos)" } }, "+" + fmtBRL(inc))));
  parts.push(h("span", { key: "e" }, ", gastou ", h("b", { className: "mono", style: { color: "var(--neg)" } }, "−" + fmtBRL(exp))));
  if (invNet > 0) parts.push(h("span", { key: "v" }, ", aplicou ", h("b", { className: "mono", style: { color: "var(--reserve)" } }, fmtBRL(invNet))));
  if (invNet < 0) parts.push(h("span", { key: "v" }, ", resgatou ", h("b", { className: "mono", style: { color: "var(--info)" } }, fmtBRL(-invNet))));
  parts.push(h("span", { key: "s" }, " → sobrou ", h("b", { className: "mono", style: { color: livre >= 0 ? "var(--pos)" : "var(--neg)" } }, (livre >= 0 ? "+" : "−") + fmtBRL(Math.abs(livre))), "."));

  const patDelta = liquidityHistory.length > 1
    ? liquidityHistory[liquidityHistory.length - 1].value - liquidityHistory[liquidityHistory.length - 2].value : null;

  // Saúde dos dados
  const first = monthly[0], last = monthly[monthly.length - 1];
  const cobertura = first && last
    ? `${PT_SHORT[first.month]}/${first.year} → ${PT_SHORT[last.month]}/${last.year} · ${monthly.length} meses` : "—";
  const lastTxDate = monthTx.length
    ? monthTx.reduce((m, t) => (t.date > m ? t.date : m), monthTx[0].date) : null;
  let backupTxt = "—", backupStale = false;
  if (backup) {
    if (!backup.exists) { backupTxt = "sem backup"; backupStale = true; }
    else {
      const d = Math.floor((backup.age_seconds || 0) / 86400);
      backupTxt = d <= 0 ? "hoje" : d === 1 ? "há 1 dia" : `há ${d} dias`;
      backupStale = d > 7;
    }
  }

  return h("div", { className: "widget wg-3" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Visão geral"),
      patDelta != null && h("span", { style: { marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "baseline" } },
        h("span", { className: "kpi-delta", style: { color: patDelta >= 0 ? "var(--pos)" : "var(--neg)" } },
          (patDelta >= 0 ? "+" : "−") + fmtBRLCompact(patDelta)),
        h("span", { style: { fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase" } }, "patrimônio"))
    ),
    h("div", { className: "widget-body", style: { gap: 10 } },
      // Evolução do patrimônio (12 meses) — caixa + carteira, mesma composição do KPI
      h("div", { style: { flexShrink: 0 } },
        h(Sparkline, { data: liquidityHistory.slice(-12).map(p => p.value), height: 40 })
      ),
      // Resumo do mês em texto
      h("div", { style: { fontSize: 12, lineHeight: 1.55, color: "var(--fg-1)" } },
        h("span", { style: { color: "var(--fg-3)", textTransform: "capitalize" } }, monName, ": "), ...parts),
      // Saúde dos dados
      h("div", { style: { marginTop: "auto", display: "flex", flexDirection: "column" } },
        h("div", { className: "stat-row" }, h("span", { className: "k" }, "Cobertura"), h("span", { className: "v mono" }, cobertura)),
        h("div", { className: "stat-row" },
          h("span", { className: "k" }, "Lançamentos no mês"),
          h("span", { className: "v mono" }, `${monthTx.length}`,
            uncatCount > 0 && h("span", { style: { color: "var(--warn)", marginLeft: 6 } }, `· ${uncatCount} sem categoria`))),
        h("div", { className: "stat-row" },
          h("span", { className: "k" }, "Último lançamento"),
          h("span", { className: "v mono" }, lastTxDate ? fmtDateBR(lastTxDate) : "—")),
        h("div", { className: "stat-row" },
          h("span", { className: "k" }, "Backup"),
          h("span", { className: "v mono", style: backupStale ? { color: "var(--warn)" } : null, title: backup && backup.exists ? backup.name : "O HDD está montado?" }, backupTxt))
      )
    )
  );
}

/* ── TimelineWidget — o controle de mês É o gráfico ──────────────────────── */
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

  return h("div", { className: "widget wg-3" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Fluxo mês a mês"),
      h("span", { style: { marginLeft: "auto", display: "flex", gap: 10, fontSize: 9, color: "var(--fg-3)", alignItems: "center" } },
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
          const hInc = d ? Math.max((d.income / maxV) * 52, d.income > 0 ? 2 : 0) : 0;
          const hExp = d ? Math.max((d.expenses / maxV) * 52, d.expenses > 0 ? 2 : 0) : 0;
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
}

/* ── AccountsWidget — onde o caixa está ──────────────────────────────────── */
function AccountsWidget({ accounts, available }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const checking = (accounts || []).filter(a => a.type === "checking")
    .sort((a, b) => ((a.id || "").startsWith("nu") ? 1 : 2) - ((b.id || "").startsWith("nu") ? 1 : 2));
  const total = available ? available.checking_total : checking.reduce((s, a) => s + (a.balance || 0), 0);
  const colorOf = a => (a.id || "").startsWith("nu") ? "var(--nubank)" : "var(--inter)";

  return h("div", { className: "widget wg-2" },
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
        checking.map((a, i, arr) => h("div", {
          key: a.id,
          style: { display: "flex", flexDirection: "column", gap: 2, padding: "9px 0", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none" }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
            h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: colorOf(a), flexShrink: 0 } }),
            h("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
            total > 0 && h("span", { className: "mono", style: { fontSize: 9, color: "var(--fg-3)", marginLeft: "auto" } }, `${(((a.balance || 0) / total) * 100).toFixed(0)}%`)
          ),
          h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, paddingLeft: 16, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
        ))
      )
    )
  );
}

/* ── CategoriesWidget — pra onde o dinheiro foi no mês ───────────────────── */
function CategoriesWidget({ monthTx, uncatCount, onOpenBulk }) {
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

  return h("div", { className: "widget wg-2" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Categorias"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--neg)" } }, "−" + fmtBRL(totalExp))
    ),
    h("div", { className: "widget-body", style: { gap: 8 } },
      byCat.length === 0
        ? h("div", { style: { color: "var(--fg-3)", fontSize: 11, textAlign: "center", padding: "20px 0" } }, "Nenhuma despesa no mês.")
        : byCat.map((c, i) => {
            const pct = totalExp ? (c.total / totalExp) * 100 : 0;
            return h("div", { key: i, style: { display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 } },
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } },
                h("span", { style: { fontSize: 11, fontWeight: 600, color: c.name === "Sem categoria" ? "var(--fg-3)" : "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name),
                h("span", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: "var(--fg-0)", flexShrink: 0 } }, fmtBRL(c.total))
              ),
              h("div", { style: { height: 3, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" } },
                h("div", { style: { width: pct + "%", height: "100%", borderRadius: 2, background: c.name === "Sem categoria" ? "var(--line-2)" : i === 0 ? "var(--accent)" : "var(--fg-2)" } }))
            );
          }),
      uncatCount > 0 && h("button", {
        onClick: onOpenBulk,
        style: {
          marginTop: "auto", alignSelf: "flex-start", padding: "3px 9px", borderRadius: 999, flexShrink: 0,
          fontSize: 10, fontWeight: 600, color: "var(--accent)", background: "var(--accent-bg)",
          border: "1px solid color-mix(in oklch, var(--accent) 35%, transparent)",
        }
      }, `Categorizar em lote · ${uncatCount}`)
    )
  );
}

/* ── InvestmentsWidget — todas as posições no card (sem drill) ────────────── */
function InvestmentsWidget({ investments, evolution }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const typeLabel = t => INV_TYPE_LABEL[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Investimento");
  const total = investments.reduce((s, i) => s + (i.balance || 0), 0);
  const invDelta = (evolution && evolution.length > 1)
    ? evolution[evolution.length - 1].cumulative - evolution[evolution.length - 2].cumulative : null;

  // Posições individuais, maiores primeiro; CDBs do Porquinho agregados numa
  // linha (mesmo emissor, mesma natureza — o detalhe fino não muda decisão).
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

  return h("div", { className: "widget wg-2" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Investimentos"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--reserve)" } }, fmtBRL(total))
    ),
    h("div", { className: "widget-body", style: { gap: 0 } },
      investments.length === 0
        ? h("div", { style: { color: "var(--fg-3)", fontSize: 11, textAlign: "center", padding: "20px 0" } }, "Nenhum investimento — importe um relatório B3.")
        : rows.map((r, i, arr) => h("div", {
            key: i,
            style: { display: "flex", flexDirection: "column", gap: 1, padding: "7px 0", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none", flexShrink: 0 }
          },
            h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" } },
              h("span", { title: r.name, style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.name),
              h("span", { className: "mono", style: { fontSize: 12, fontWeight: 700, color: "var(--fg-0)", flexShrink: 0 } }, fmtBRL(r.balance))
            ),
            h("span", { style: { fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em" } },
              r.sub, total ? ` · ${((r.balance / total) * 100).toFixed(1)}%` : "",
              r.derived ? " · derivado" : "")
          )),
      invDelta != null && h("div", { style: { marginTop: "auto", paddingTop: 8, display: "flex", gap: 6, alignItems: "baseline", flexShrink: 0 } },
        h("span", { style: { fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.05em" } }, "Δ mês"),
        h("span", { className: "kpi-delta", style: { color: invDelta >= 0 ? "var(--pos)" : "var(--info)" } },
          (invDelta >= 0 ? "+" : "−") + fmtBRL(Math.abs(invDelta))),
        invDelta < 0 && h("span", { style: { fontSize: 9, color: "var(--fg-3)" } }, "(resgate)"))
    )
  );
}

/* ── DashboardView ────────────────────────────────────────────────────────── */
function DashboardView({ monthSel, monthly, onPickMonth, refreshKey, onEditCategory, onImport }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const [available, setAvailable] = _dSt(null);
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

  // Dados de posição (independem do mês selecionado)
  _dEf(() => {
    setAvailErr(false); setLoadErr(false);
    fetchAvailable().then(setAvailable).catch(() => setAvailErr(true));
    fetchBackupStatus().then(setBackup).catch(() => {});
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
    h("div", { className: "dash-main fade-in" },
      h("div", { className: "widget-row" },
        h(GeneralWidget, { cashflow, liquidityHistory, monthly, monthSel, monthTx, uncatCount, backup }),
        h(TimelineWidget, { monthly, monthSel, onPickMonth }),
        h(AccountsWidget, { accounts, available }),
        h(CategoriesWidget, { monthTx, uncatCount, onOpenBulk: () => setBulkOpen(true) }),
        h(InvestmentsWidget, { investments, evolution })
      ),
      h(window.BS.TxTableWidget, {
        monthSel, refreshKey, onEditCategory,
        openBulk: bulkOpen, onBulkConsumed: () => setBulkOpen(false),
      })
    )
  );
}

window.BS = window.BS || {};
window.BS.DashboardView = DashboardView;

})();
