/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/**
 * @file dashboard.js
 * @brief DashboardView e seus widgets — a tela única: faixa KPI, grid de
 *        widgets facetados e a tabela de lançamentos.
 *
 * UNIDADE: todo valor aqui é REAIS (float), como a API entrega.
 */
/* view-dashboard.js — DashboardView: a tela única do BrokerShark (1920×1080).
   Topbar + faixa KPI + UMA linha de widgets (visão geral, fluxo, contas,
   categorias, investimentos) + tabela full-width com scroll interno.
   Nada de navegação: tudo visível, detalhe é filtro/ordenação na tabela. */
/* global React, fetchAvailable, fetchAccounts, fetchMonthTransactions,
          fetchCashflowStatement, fetchInvestments, fetchLiquidityHistory,
          fetchInvestmentEvolution, fetchUncategorizedMerchants, fetchBackupStatus,
          fetchCommitments */

const { useState: _dSt, useEffect: _dEf, useMemo: _dMemo, useCallback: _dCb } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, PT_MONTHS, PT_SHORT,
        isConsumptionExpense } = window.BS;

const INV_TYPE_LABEL = {
  rdb: "Caixinha (RDB)", cdb: "CDB / Renda fixa", tesouro: "Tesouro Direto",
  lci: "LCI / Renda fixa", lca: "LCA / Renda fixa", savings: "Poupança",
};

/* Δ assinado (mono, pos/neg) — o vocabulário único de "variação vs mês" */
/**
 * @brief Renderiza uma variação assinada, verde quando é boa.
 * @param props.value variação em REAIS; null não renderiza nada
 * @param props.suffix texto após o número (padrão "vs mês anterior")
 * @param props.invert true quando cair é bom (ex.: despesa) — inverte a cor
 * @return Fragment React com o Δ e o sufixo, ou null
 */
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

/**
 * @brief Renderiza um sparkline SVG com a área preenchida.
 * @param props.data valores em REAIS, em ordem cronológica; < 2 pontos não rende
 * @param props.width largura do viewBox lógico (padrão 150) — o svg estica
 * @param props.height altura em px (padrão 36)
 * @param props.color cor da linha (padrão "var(--accent)")
 * @return elemento React <svg>, ou null quando não há série
 */
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
/**
 * @brief Renderiza a faixa de KPIs: disponível, patrimônio, resultado do mês e
 *        total investido.
 *
 * Disponível e patrimônio são POSIÇÃO — valem "agora", não seguem o seletor de
 * mês. Só o resultado líquido é do mês selecionado.
 *
 * @param props.available {available, checking_total} em REAIS; null enquanto carrega
 * @param props.availErr true quando /api/available falhou
 * @param props.accounts contas com `balance` em reais
 * @param props.cashflow DRE do mês {income_total, expense_total, investment_net} em reais
 * @param props.investTotal soma das posições abertas, em reais
 * @param props.liquidityHistory série de patrimônio {value} em reais — dá o Δ e o recorde
 * @param props.evolution série da carteira {cumulative} em reais — dá o Δ investido
 * @param props.monthLabel rótulo curto do mês selecionado ("jul/26")
 * @param props.monthly série mensal {income, expenses} em reais — dá o streak
 * @return elemento React da faixa de KPIs
 */
const KpiStrip = React.memo(function KpiStrip({ available, availErr, accounts, cashflow, investTotal,
                    liquidityHistory, evolution, monthLabel, monthly }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const monthlyNet = (monthly || []).map(m => m.income - m.expenses);
  const streak = window.BS.savingsStreak(monthlyNet);
  const ath = window.BS.isAllTimeHigh((liquidityHistory || []).map(s => s.value));

  const checkingTotal = available ? available.checking_total : 0;
  const patrimonio = checkingTotal + investTotal;
  /**
   * @brief Variação entre os dois últimos pontos de uma série.
   * @param s série com {value} em REAIS
   * @return diferença em reais, ou null quando não há dois pontos
   */
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
    // 1. Disponível pra gastar — o herói; posição, sempre "agora"
    h("div", { className: "kpi kpi-hero" },
      h("span", { className: "kpi-label" }, "Em Caixa (Disponível Agora)"),
      availErr
        ? h("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--neg)" } }, "falha ao carregar")
        : h("span", { className: "kpi-value", style: { color: availNeg ? "var(--neg)" : "var(--pos)" } },
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
      h("div", { style: { display: "flex", gap: 6, marginTop: 8 } },
        streak > 0 && h("span", { className: "filter-chip", style: { background: "var(--bg-2)", color: "var(--warn)" } }, `🔥 ${streak}`),
        ath && h("span", { className: "filter-chip", style: { background: "var(--bg-2)", color: "var(--accent)" } }, "🏆 recorde")
      ),
    ),
    // 2. Patrimônio total — caixa + investimentos, com Δ mensal
    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, "Patrimônio Consolidado"),
      h("span", { className: "kpi-value", title: `Caixa ${fmtBRL(checkingTotal)} + investimentos ${fmtBRL(investTotal)}` },
        (patrimonio < 0 ? "−" : "") + fmtBRL(Math.abs(patrimonio))),
      h("span", { className: "kpi-sub" }, h(Delta, { value: patDelta, suffix: "vs mês passado" }))
    ),
    // 3. Balanço do mês selecionado — saldo livre + composição
    h("div", { className: "kpi" },
      h("span", { className: "kpi-label" }, `Resultado Líquido do Mês (${monthLabel})`),
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
      h("span", { className: "kpi-label" }, "Total Investido"),
      h("span", { className: "kpi-value", style: { color: "var(--reserve)" } }, fmtBRL(investTotal)),
      h("span", { className: "kpi-sub" }, h(Delta, { value: invDelta, suffix: "vs mês passado" }))
    )
  );
});

/* ── GeneralWidget — visão geral: patrimônio+evolução, resumo, saúde ─────── */
/**
 * @brief Renderiza o resumo do mês em texto + a saúde dos dados (cobertura,
 *        pendências, última movimentação, backup).
 * @param props.cashflow DRE do mês {income_total, expense_total, investment_net} em REAIS
 * @param props.liquidityHistory série de patrimônio {value} em reais
 * @param props.monthly série mensal {year, month} — dá o período coberto
 * @param props.monthSel mês selecionado {month, year}
 * @param props.monthTx transações do mês (`amount` em reais)
 * @param props.uncatCount quantos lançamentos do mês seguem sem categoria
 * @param props.backup {exists, name, age_seconds}; null enquanto carrega
 * @return elemento React do widget
 */
const GeneralWidget = React.memo(function GeneralWidget({ cashflow, liquidityHistory, monthly, monthSel,
                         monthTx, uncatCount, backup }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  const inc = cashflow ? cashflow.income_total : 0;
  const exp = cashflow ? cashflow.expense_total : 0;
  const invNet = cashflow ? cashflow.investment_net : 0;
  const livre = inc - exp - invNet;
  const monName = monthSel ? PT_MONTHS[monthSel.month].toLowerCase() : "";

  // Resumo em texto — leitura de relance, números exatos, mais descritivo
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

  const target = (() => { const v = window.localStorage.getItem("bs.budgetCents"); return v ? parseInt(v) : null; })();
  const bp = window.BS.budgetProgress(exp, target);

  // Saúde dos dados
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
      backupStale = d > 40; // backup é mensal — atrasado só passando de ~1 mês
    }
  }

  return h("div", { className: "widget wg-3" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Visão Geral do Mês"),
      patDelta != null && h("span", { style: { marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "baseline" } },
        h("span", { className: "kpi-delta", style: { color: patDelta >= 0 ? "var(--pos)" : "var(--neg)" } },
          (patDelta >= 0 ? "+" : "−") + fmtBRLCompact(patDelta)),
        h("span", { style: { fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase" } }, "evolução patrimonial"))
    ),
    h("div", { className: "widget-body", style: { gap: 16 } },
      // Resumo do mês em texto
      h("div", { style: { fontSize: 12, lineHeight: 1.4, color: "var(--fg-1)" } },
        h("div", { style: { color: "var(--fg-0)", fontWeight: 700, textTransform: "capitalize", marginBottom: 8 } }, `Resumo de ${monName}`),
        ...parts,
        bp && h("div", { style: { marginTop: 8 } },
          h("div", { className: "label", style: { fontSize: 9, color: "var(--fg-3)", marginBottom: 4 } }, "Orçamento do mês"),
          h("div", { style: { height: 10, border: "2px solid var(--line-1)", background: "var(--bg-0)" } },
            h("div", { className: bp.pct >= 100 ? "dither-neg" : "dither-warn", style: { height: "100%", width: bp.pct + "%" } })),
          h("div", { className: "mono", style: { fontSize: 9, color: "var(--fg-3)", marginTop: 3 } },
            `${fmtBRL(exp)} / ${fmtBRL(target)} · ${100 - bp.pct >= 0 ? (100 - bp.pct) : 0}% restante`)
        )
      ),
      // Saúde dos dados
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

/* ── TimelineWidget — o controle de mês É o gráfico ──────────────────────── */
/**
 * @brief Renderiza o fluxo mês a mês; clicar num mês move o seletor global.
 *
 * Os 12 meses do ano navegado aparecem sempre, com ou sem dados: um buraco na
 * série é informação. Mês sem dados fica desabilitado.
 *
 * @param props.monthly série mensal {year, month, income, expenses} em REAIS,
 *        em ordem cronológica — a vizinhança na lista define o "mês anterior"
 * @param props.monthSel mês selecionado {month, year}
 * @param props.onPickMonth chamado com {year, month} do mês clicado
 * @return elemento React do widget
 */
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

  return h("div", { className: "widget wg-3" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Fluxo mês a mês"),
      h("button", { onClick: () => setCompare(c => !c), className: compare ? "filter-chip" : "filter-chip",
        style: { marginLeft: "auto", opacity: compare ? 1 : 0.6 }, title: "Comparar com o mês anterior" }, "vs ant."),
      h("span", { style: { display: "flex", gap: 10, fontSize: 9, color: "var(--fg-3)", alignItems: "center" } },
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

/* ── AccountsWidget — onde o caixa está ──────────────────────────────────── */
/**
 * @brief Renderiza os saldos das contas correntes como facetas clicáveis.
 * @param props.accounts contas (`balance` em REAIS); só as de type "checking" entram
 * @param props.available {checking_total} em reais — ausente, soma as contas
 * @param props.filter filtro facetado, pra marcar a conta ativa
 * @param props.onToggleFacet alterna a faceta "accounts" com o id da conta
 * @return elemento React do widget
 */
const AccountsWidget = React.memo(function AccountsWidget({ accounts, available, filter, onToggleFacet }) {
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
              total > 0 && h("span", { className: "mono", style: { fontSize: 9, color: "var(--fg-3)", marginLeft: "auto" } }, `${(((a.balance || 0) / total) * 100).toFixed(0)}%`)
            ),
            h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, paddingLeft: 16, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
          );
        })
      )
    )
  );
});

/* ── CategoriesWidget — pra onde o dinheiro foi no mês ───────────────────── */
/**
 * @brief Renderiza o gasto do mês por categoria, como facetas clicáveis.
 *
 * Só despesa de CONSUMO entra (isConsumptionExpense): transferência,
 * investimento e liquidação não são gasto, e somá-los aqui dobraria o total.
 *
 * @param props.monthTx transações do mês (`amount` em REAIS)
 * @param props.uncatCount quantos lançamentos seguem sem categoria
 * @param props.onOpenBulk abre a categorização em lote
 * @param props.filter filtro facetado, pra marcar a categoria ativa
 * @param props.onToggleFacet alterna a faceta "categories" com o nome da categoria
 * @return elemento React do widget
 */
const CategoriesWidget = React.memo(function CategoriesWidget({ monthTx, uncatCount, onOpenBulk, filter,
                                                               onToggleFacet, catsIndex, monthSel, onBudgetSaved }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const expenses = monthTx.filter(isConsumptionExpense);
  const totalExp = expenses.reduce((s, t) => s + t.amount, 0);
  const [editing, setEditing] = _dSt(null);   // category_id sendo editado

  /* Agrupa por ID, não por nome: o alvo mora no id, e duas categorias podem
     ter nomes parecidos. "Sem categoria" (id null) nunca tem alvo. */
  const byCat = _dMemo(() => {
    const g = new Map();
    expenses.forEach(t => {
      const id = t.category_id ?? null;
      if (!g.has(id)) g.set(id, { id, name: t.category || "Sem categoria", total: 0 });
      g.get(id).total += t.amount;
    });
    return [...g.values()].sort((a, b) => b.total - a.total);
  }, [monthTx]);

  return h("div", { className: "widget wg-2" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Categorias"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--neg)" } }, "−" + fmtBRL(totalExp))
    ),
    h("div", { className: "widget-body", style: { gap: 8 } },
      byCat.length === 0
        ? h("div", { style: { color: "var(--fg-3)", fontSize: 11, textAlign: "center", padding: "20px 0" } }, "Nenhuma despesa no mês.")
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
        onClick: onOpenBulk,
        style: {
          marginTop: "auto", alignSelf: "flex-start", padding: "3px 9px", borderRadius: 999, flexShrink: 0,
          fontSize: 10, fontWeight: 600, color: "var(--accent)", background: "var(--accent-bg)",
          border: "1px solid color-mix(in oklch, var(--accent) 35%, transparent)",
        }
      }, `Categorizar em lote · ${uncatCount}`)
    )
  );
});

/* ── CategoryRow — uma categoria com gasto, alvo e edição inline ───────────
   A barra significa UMA coisa: progresso contra o alvo. Categoria sem alvo não
   ganha barra — mostra "definir", porque "sem alvo" e "alvo de R$ 0,00" são
   estados diferentes e uma barra vazia sugeriria o segundo.

   Sem verde pra "dentro do alvo": verde já significa receita nas espécies
   (money.js), e reusar quebraria a semântica. Faixas em budgetState (tx-group.js). */
/**
 * @brief Renderiza uma categoria do widget: gasto, barra de alvo e edição.
 * @param props.c {id, name, total} — total do mês em REAIS
 * @param props.meta linha de /api/categories-full (budget_cents em CENTAVOS) ou null
 * @param props.monthSel mês selecionado — decide se a edição grava fixo ou override
 * @param props.onBudgetSaved recarrega os alvos após gravar
 * @return elemento React da linha
 */
function CategoryRow({ c, meta, active, onFacet, editing, onEdit, onEditDone, monthSel, onBudgetSaved }) {
  const h = (t, p, ...cc) => React.createElement(t, p, ...cc);
  const budget = meta && meta.budget_cents != null ? meta.budget_cents / 100 : null;
  const st = window.BS.budgetState(c.total, budget);
  const [draft, setDraft] = _dSt("");
  // Alvo só existe pra categoria de despesa real — "Sem categoria" (id null) não tem.
  const canBudget = c.id != null;

  const save = async () => {
    const reais = parseFloat(String(draft).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(reais) || reais < 0) { onEditDone(); return; }
    try {
      // Editar num mês que não é o corrente grava override DAQUELE mês; no mês
      // corrente, grava o alvo fixo. O rótulo ao lado diz qual está valendo.
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

    st && h("div", { style: { height: 3, background: "var(--bg-2)", overflow: "hidden" } },
      h("div", { style: { width: Math.min(100, st.ratio * 100) + "%", height: "100%", background: st.color } })),

    canBudget && h("div", { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 9 } },
      editing
        ? h(React.Fragment, null,
            h("input", {
              autoFocus: true, defaultValue: budget != null ? String(budget).replace(".", ",") : "",
              onChange: e => setDraft(e.target.value),
              onKeyDown: e => { if (e.key === "Enter") save(); if (e.key === "Escape") onEditDone(); },
              onBlur: save, placeholder: "0,00", "aria-label": `Alvo de ${c.name}`,
              style: { width: 70, height: 18, fontSize: 9, padding: "0 4px", background: "var(--bg-0)",
                border: "2px solid var(--accent)", color: "var(--fg-0)", fontFamily: "var(--ff-mono)" },
            }),
            h("span", { style: { color: "var(--fg-3)" } },
              refMonthOf(monthSel) ? `alvo de ${window.BS.PT_MONTHS[monthSel.month].toLowerCase()}` : "alvo fixo")
          )
        : h("button", {
            onClick: onEdit,
            title: budget != null
              ? `Alvo ${meta.budget_source === "month" ? "só deste mês" : "fixo"}: ${fmtBRL(budget)} — clique pra mudar`
              : "Definir um alvo de gasto pra esta categoria",
            style: { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 9,
              color: st ? st.color : "var(--fg-3)", fontWeight: st ? 700 : 400,
              borderBottom: "1px dashed var(--line-2)" },
          }, budget != null
              ? `${Math.round(st.ratio * 100)}% de ${fmtBRL(budget)}${meta.budget_source === "month" ? " · só este mês" : ""}`
              : "definir alvo")
    )
  );
}

/* ── FaturaWidget — Fatura de Cartão de Crédito do Mês ───────────────────── */
/**
 * @brief Renderiza o consumo no crédito do mês, quebrado por banco.
 *
 * Conta os ITENS do crédito e exclui as liquidações (`is_settlement`): o
 * pagamento da fatura é liquidação, e somá-lo aos itens dobraria o consumo.
 *
 * @param props.monthTx transações do mês (`amount` em REAIS)
 * @param props.filter filtro facetado, pra marcar o banco ativo
 * @param props.onToggleFacet alterna a faceta "banks" com o nome do banco
 * @return elemento React do widget
 */
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

  return h("div", { className: "widget wg-2" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Fatura do Cartão"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: totalFatura > 0 ? "var(--neg)" : "var(--fg-0)" } }, (totalFatura >= 0 ? "−" : "+") + fmtBRL(Math.abs(totalFatura)))
    ),
    h("div", { className: "widget-body", style: { gap: 10 } },
      faturaItems.length === 0
        ? h("div", { style: { color: "var(--fg-3)", fontSize: 11, textAlign: "center", padding: "20px 0" } }, "Nenhuma despesa no crédito neste mês.")
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
                    totalFatura > 0 && h("span", { className: "mono", style: { fontSize: 9, color: "var(--fg-3)", marginLeft: "auto" } }, `${((amt / totalFatura) * 100).toFixed(0)}%`)
                  ),
                  h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, paddingLeft: 16, color: "var(--neg)" } }, (amt >= 0 ? "−" : "+") + fmtBRL(Math.abs(amt)))
                );
              })
            )
          )
    )
  );
});

/* ── InvestmentsWidget — todas as posições no card (sem drill) ────────────── */
/**
 * @brief Renderiza as posições abertas e o Δ mensal da carteira.
 * @param props.investments posições abertas (`balance` em REAIS, `group_name`,
 *        `derived` marcando a posição derivada do ledger — a Caixinha)
 * @param props.evolution série da carteira {cumulative} em reais — dá o Δ do mês
 * @return elemento React do widget
 */
const InvestmentsWidget = React.memo(function InvestmentsWidget({ investments, evolution }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  /**
   * @brief Traduz o tipo da posição pro rótulo em pt-BR.
   * @param t tipo cru ("rdb", "cdb", "tesouro"…)
   * @return rótulo conhecido, ou o tipo capitalizado quando não mapeado
   */
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
});

/* ── ForwardWidget — visão de futuro: o que já está comprometido ─────────── */
/**
 * @brief Barras fantasma dos compromissos futuros (fatura aberta + parcelas
 *        projetadas). Display-only — nada aqui é fato do ledger.
 * @param props.commitments {open_invoices, series} em REAIS; null enquanto carrega
 * @return elemento React do widget
 */
const ForwardWidget = React.memo(function ForwardWidget({ commitments }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const series = (commitments && commitments.series) || [];
  const maxV = series.reduce((m, s) => Math.max(m, s.total), 0) || 1;

  return h("div", { className: "widget wg-3" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Compromissos Futuros"),
    ),
    h("div", { className: "widget-body", style: { gap: 8, overflow: "hidden" } },
      series.length === 0
        ? h("span", { style: { color: "var(--fg-2)", fontSize: 12 } }, "Nenhum compromisso futuro registrado.")
        : h("div", { style: { display: "flex", alignItems: "flex-end", gap: 8, height: 64 } },
            series.map(s => h("div", { key: s.month, style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 } },
              h(window.BS.ProjectedBar, { value: s.total, maxV }),
              h("span", { className: "mono", style: { fontSize: 9, color: "var(--fg-2)" } }, s.label),
            ))
          ),
      series.length > 0 && h("div", { style: { marginTop: 8, display: "flex", flexDirection: "column", gap: 2 } },
        series.map(s => h("div", { key: s.month, style: { display: "flex", justifyContent: "space-between", fontSize: 11 } },
          h("span", { style: { color: "var(--fg-2)" } }, s.label),
          h("span", { className: "mono", style: { color: "var(--warn)" } }, "− " + fmtBRL(s.total)),
        ))
      )
    )
  );
});

/* ── DashboardView ────────────────────────────────────────────────────────── */
/**
 * @brief Converte o seletor de mês no ref_month que a API espera.
 * @param monthSel mês selecionado {month, year}
 * @return "YYYY-MM", ou undefined quando não há mês selecionado
 */
const refMonthOf = (monthSel) =>
  monthSel ? `${monthSel.year}-${String(monthSel.month).padStart(2, "0")}` : undefined;
/**
 * @brief Renderiza a tela única: carrega os dados, mantém o filtro facetado e
 *        monta KPIs, widgets e tabela.
 *
 * Dois carregamentos separados de propósito: posição (contas, investimentos,
 * disponível) NÃO depende do mês selecionado; fluxo (DRE, lançamentos,
 * pendências) segue o seletor global.
 *
 * @param props.monthSel mês selecionado {month, year}
 * @param props.monthly série mensal {year, month, income, expenses} em REAIS
 * @param props.onPickMonth move o seletor global de mês
 * @param props.refreshKey muda para forçar a recarga de tudo
 * @param props.onEditCategory abre o editor de uma transação
 * @param props.onImport abre o modal de importação (usado no first-run)
 * @return Fragment React com a faixa de KPIs e o grid, ou a tela de erro/
 *         first-run quando é o caso
 */
function DashboardView({ monthSel, monthly, onPickMonth, refreshKey, onEditCategory, onImport }) {
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
  // Categorias COM alvo/gasto/Δ do mês — alimenta a barra de orçamento do widget
  // e o cabeçalho de grupo da tabela. Segue o seletor de mês: o alvo vigente é
  // resolvido no servidor (override do mês → fixo).
  const [expenseCats, setExpenseCats] = _dSt([]);
  const [filter, setFilter] = _dSt(() => window.BS.emptyFilter());
  /**
   * @brief Alterna um valor numa faceta de conjunto do filtro compartilhado.
   * @param kind "categories", "accounts" ou "banks"
   * @param value valor clicado no widget
   */
  const onToggleFacet = (kind, value) => setFilter(f => window.BS.toggleFacet(f, kind, value));
  /**
   * @brief Ajusta um campo escalar do filtro.
   * @param field "flow", "method" ou "search"
   * @param value novo valor do campo
   */
  const setFilterField = (field, value) => setFilter(f => Object.assign({}, f, { [field]: value }));
  /** @brief Limpa todas as facetas, voltando ao filtro neutro. */
  const clearFilter = () => setFilter(window.BS.emptyFilter());
  // Reset facets when the global month changes (stale facet values match nothing).
  _dEf(() => { setFilter(window.BS.emptyFilter()); }, [monthSel]);

  // Dados de posição (independem do mês selecionado)
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

  // Dados de fluxo (seguem o seletor de mês global)
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

  // Exclusão otimista (evento global disparado pelo shell)
  _dEf(() => {
    const handler = e => setMonthTx(prev => prev.filter(tx => tx.id !== e.detail.id));
    window.addEventListener("bs-tx-optimistic-delete", handler);
    return () => window.removeEventListener("bs-tx-optimistic-delete", handler);
  }, []);

  // Índice de categoria p/ a tabela: alvo vigente, gasto e gasto do mês anterior.
  // Chaveado por id — é o que buildGroups consulta.
  const catsIndex = _dMemo(
    () => new Map(expenseCats.map(c => [c.id, c])),
    [expenseCats],
  );

  /** @brief Recarrega os alvos após uma edição, sem recarregar a tela toda. */
  const reloadBudgets = _dCb(() => {
    if (!monthSel) return;
    fetchCategoriesFull("expense", refMonthOf(monthSel)).then(setExpenseCats).catch(() => {});
  }, [monthSel]);

  /* O saldo corrente parte do saldo ATUAL da conta e conta pra trás, então só
     fecha se não houver lançamento DEPOIS do mês exibido. `monthly` vem com
     present=1 e ordenado, e o último item é o mês mais recente com dados — a
     mesma fonte de verdade que o botão "Hoje" do MonthNav usa (app.js). */
  const isLatestMonth = _dMemo(() => {
    if (!monthSel || !monthly || !monthly.length) return false;
    const last = monthly[monthly.length - 1];
    return last.year === monthSel.year && last.month === monthSel.month;
  }, [monthly, monthSel]);

  if (loadErr) return h("div", { style: { margin: "48px auto", background: "color-mix(in oklch, var(--neg) 5%, transparent)", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", maxWidth: 480 } },
    h("div", { style: { color: "var(--neg)", fontSize: 14, fontWeight: 700 } }, "Falha ao carregar os dados."),
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "O servidor local não respondeu. Verifique se o BrokerShark está rodando."),
    h("button", { className: "btn btn-ghost", style: { color: "var(--neg)", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", fontWeight: 600 }, onClick: () => setRetryTick(t => t + 1) }, "Tentar de novo"));

  // First-run: nada importado → convite único, sem widgets zerados
  const isFirstRun = available && available.checking_total === 0 && monthly.length === 0;
  if (isFirstRun) return h("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 } },
    h("div", { className: "fade-in", style: { padding: "64px 40px", width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 32, alignItems: "center", textAlign: "center", background: "linear-gradient(180deg, color-mix(in oklch, var(--accent) 3%, transparent), transparent 100%)", border: "1px solid color-mix(in oklch, var(--accent) 10%, transparent)", borderRadius: 24, boxShadow: "0 24px 48px oklch(0% 0 0 / 0.2), inset 0 1px 0 color-mix(in oklch, white 5%, transparent)" } },
      h("div", { style: { display: "flex", justifyContent: "center", alignItems: "center", width: 88, height: 88, borderRadius: "50%", background: "linear-gradient(135deg, color-mix(in oklch, var(--info) 15%, transparent), color-mix(in oklch, var(--accent) 5%, transparent))", color: "var(--info)", marginBottom: 16, border: "1px solid color-mix(in oklch, var(--info) 20%, transparent)", boxShadow: "0 8px 32px color-mix(in oklch, var(--info) 10%, transparent)" } },
        h("svg", { width: 44, height: 44, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" },
          h("path", { d: "M8 11 L8 2" }), h("path", { d: "M4 6 L8 2 L12 6" }), h("path", { d: "M2 14 L14 14" })
        )
      ),
      h("h1", { style: { fontSize: 36, fontWeight: 800, color: "var(--fg-0)", letterSpacing: "-0.03em", margin: 0, lineHeight: 1.1, textShadow: "0 2px 8px oklch(0% 0 0 / 0.5)" } }, "Você no controle."),
      h("p", { style: { fontSize: 16, color: "var(--fg-2)", lineHeight: 1.6, maxWidth: 440, margin: 0 } },
        "Importe seus extratos (.csv) ou relatórios da B3 (.xlsx) para começar a responder à pergunta que importa: ",
        h("strong", { style: { color: "var(--fg-0)", fontWeight: 600 } }, "Quanto posso gastar agora?")
      ),
      h("button", { className: "btn btn-primary", style: { cursor: "pointer", fontSize: 15, fontWeight: 700, height: 52, padding: "0 32px", borderRadius: 26, display: "flex", alignItems: "center", gap: 10, marginTop: 16, border: "none", background: "var(--accent)", color: "var(--bg-0)", boxShadow: "0 8px 24px color-mix(in oklch, var(--accent) 35%, transparent), inset 0 1px 0 color-mix(in oklch, white 20%, transparent)", transition: "transform 0.2s, box-shadow 0.2s" }, onClick: onImport, onMouseEnter: e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 32px color-mix(in oklch, var(--accent) 45%, transparent), inset 0 1px 0 color-mix(in oklch, white 20%, transparent)"; }, onMouseLeave: e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 8px 24px color-mix(in oklch, var(--accent) 35%, transparent), inset 0 1px 0 color-mix(in oklch, white 20%, transparent)"; } },
        h("svg", { width: 18, height: 18, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
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
      h("div", { className: "widget-row" },
        h(GeneralWidget, { cashflow, liquidityHistory, monthly, monthSel, monthTx, uncatCount, backup }),
        h(TimelineWidget, { monthly, monthSel, onPickMonth }),
        h(AccountsWidget, { accounts, available, filter, onToggleFacet }),
        h(FaturaWidget, { monthTx, filter, onToggleFacet }),
        h(CategoriesWidget, { monthTx, uncatCount, onOpenBulk: () => setBulkOpen(true), filter, onToggleFacet,
          catsIndex, monthSel, onBudgetSaved: reloadBudgets }),
        h(InvestmentsWidget, { investments, evolution }),
        h(ForwardWidget, { commitments }),
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
        // Alimenta alvo/Δ no cabeçalho de grupo e a coluna de saldo corrente.
        accounts, catsIndex, isLatestMonth,
      })
    )
  );
}

window.BS = window.BS || {};
window.BS.DashboardView = DashboardView;

})();
