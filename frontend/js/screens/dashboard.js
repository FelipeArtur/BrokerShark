(function () {

const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

const { useState: _dSt, useEffect: _dEf, useMemo: _dMemo, useCallback: _dCb } = React;
const { fmtBRL, fmtBRLCompact, fmtCompact, fmtDateBR, PT_MONTHS, PT_SHORT,
        isConsumptionExpense, bankColor, bankShortLabel, fullDateBR } = window.BS;

const INV_TYPE_LABEL = {
  rdb: "Reserva (RDB)", cdb: "CDB / Renda fixa", tesouro: "Tesouro Direto",
  lci: "LCI / Renda fixa", lca: "LCA / Renda fixa", savings: "Poupança",
};

function Delta({ value, suffix = "vs mês anterior", invert = false }) {
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

  // Ordem estável e independente de quem são os bancos: maior saldo primeiro,
  // desempate por nome. A ordenação anterior casava um prefixo de id de conta
  // de um banco específico — no-op pra qualquer outra config.
  const checking = (accounts || []).filter(a => a.type === "checking")
    .sort((a, b) => (b.balance || 0) - (a.balance || 0) || String(a.name || "").localeCompare(String(b.name || "")));

  return h("div", { className: "kpi-strip" },

    h("div", { className: "kpi kpi-hero" },
      h("span", { className: "kpi-label" }, "Em Caixa (Disponível Agora)"),
      availErr
        ? h("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--neg)" } }, "falha ao carregar")
        : h("span", { className: "kpi-value", style: { color: availNeg ? "var(--neg)" : "var(--fg-0)" } },
            availValue == null ? "—" : (availNeg ? "−" : "") + fmtBRL(Math.abs(availValue))),
      h("span", { className: "kpi-sub" },
        checking.map(a => h("span", { key: a.id, style: { display: "inline-flex", gap: 5, alignItems: "baseline" } },
          h("span", { style: { color: bankColor(a.bank, a.id), fontWeight: 700 } }, bankShortLabel(a.bank, a.id)),
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

const GeneralWidget = React.memo(function GeneralWidget({ cashflow, liquidityHistory, monthSel,
                         monthTx, uncatCount, onOpenBulk }) {

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
        h("div", { className: "stat-row" },
          h("span", { className: "k" }, "Lançamentos no mês"),
          h("span", { className: "v mono" }, `${monthTx.length}`)),
        uncatCount > 0 && h("button", {
          className: "stat-row",
          onClick: onOpenBulk,
          title: "Abrir a categorização em lote",
          style: { width: "100%", textAlign: "left", cursor: "pointer", color: "var(--warn)" },
        },
          h("span", { className: "k", style: { color: "var(--warn)" } }, "Esperando categoria"),
          h("span", { className: "v mono", style: { color: "var(--warn)" } }, `${uncatCount} →`)),
      )
    )
  );
});

// Balão do mês sob o ponteiro — o que o `title=` do navegador dizia, na
// linguagem da tela.
//
// Mora DENTRO da coluna, e é isso que o mantém inteiro sem ninguém medir
// largura: o balão cresce pro lado onde há espaço (da metade esquerda pra
// direita, da direita pra esquerda), então nunca sai pela borda da fileira; o
// rabicho fica a 50% da coluna, que é o centro exato dela. Balão centrado na
// fileira com rabicho móvel foi a primeira tentativa e desanexou os dois nas
// pontas — rabicho apontando janeiro com a caixa parada no meio da tela.
function TimelineTip({ slot, year, alinhaDireita }) {
  const d = slot.data;

  return h(React.Fragment, null,
    h("div", { className: "tl-tip", style: alinhaDireita ? { right: 0 } : { left: 0 } },
      h("span", { className: "tl-tip-h" }, `${PT_MONTHS[slot.month]} ${year}`),
      d
        ? h("span", { style: { display: "inline-flex", gap: 10, marginLeft: 12 } },
            h("span", { style: { color: "var(--pos)" } }, "+" + fmtBRL(d.income)),
            h("span", { style: { color: "var(--neg)" } }, "−" + fmtBRL(d.expenses)))
        : h("span", { style: { color: "var(--fg-3)", marginLeft: 12 } }, "sem lançamentos"),
    ),
    h("div", { className: "tl-tip-tail" }),
  );
}

const TimelineWidget = React.memo(function TimelineWidget({ monthly, monthSel, onPickMonth }) {
  const now = new Date();
  const [browsingYear, setBrowsingYear] = _dSt(null);
  const [compare, setCompare] = _dSt(false);
  const [hover, setHover] = _dSt(null);
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
      h("button", { onClick: () => setCompare(c => !c), className: "px-seg-btn" + (compare ? " active" : ""),
        style: { marginLeft: "auto" }, title: "Comparar com o mês anterior" }, "vs ant."),
      h("span", { style: { display: "flex", gap: 10, fontSize: 11, color: "var(--fg-3)", alignItems: "center" } },
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 3 } },
          h("span", { style: { width: 7, height: 7, background: "var(--pos)" } }), "rec"),
        h("span", { style: { display: "inline-flex", alignItems: "center", gap: 3 } },
          h("span", { style: { width: 7, height: 7, background: "var(--neg)" } }), "desp"))
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
      h("div", {
        style: { display: "flex", gap: 2, alignItems: "stretch", flex: 1, minHeight: 0 },
        onMouseLeave: () => setHover(null),
      },
        slots.map((slot, i) => {
          const d = slot.data;
          const isPicked = d && monthSel && d.year === monthSel.year && d.month === monthSel.month;
          const isCur = activeYear === now.getFullYear() && slot.month === now.getMonth() + 1;
          const net = d ? d.income - d.expenses : 0;
          // `aria-disabled` no lugar de `disabled`: botão desligado não dispara
          // evento de mouse nenhum no Chrome, então o balão do mês anterior
          // ficava preso na tela ao passar por cima de um mês vazio.
          return h("button", {
            key: slot.month,
            className: `tl-slot${isPicked ? " picked" : ""}${d ? "" : " tl-slot--empty"}`,
            "aria-disabled": d ? undefined : "true",
            onClick: () => d && onPickMonth({ year: d.year, month: d.month }),
            onMouseEnter: () => setHover(i),
            onFocus: () => setHover(i),
          },
            hover === i && h(TimelineTip, { slot, year: activeYear, alinhaDireita: i >= slots.length / 2 }),
            h(window.BS.PixelBars, { slot, maxV, isPicked, compare }),
            h("span", { className: "tl-mon", style: isCur && !isPicked ? { color: "var(--fg-1)", fontWeight: 700 } : null },
              PT_SHORT[slot.month]),
            h("span", { className: "tl-net", style: { color: !d ? "transparent" : net >= 0 ? "var(--pos)" : "var(--neg)" } },
              d ? (net >= 0 ? "+" : "−") + fmtCompact(net) : "·")
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

const AccountsWidget = React.memo(function AccountsWidget({ accounts, available, monthTx, monthSel,
                                                           filter, onToggleFacet, onManageAccounts }) {
  const grupos = window.BS.groupByBank(accounts, true);

  // Gasto no crédito do mês selecionado, por cartão. Era o único número que o
  // widget de fatura mostrava — e é o que sempre existe: fatura em aberto só
  // aparece enquanto não foi paga, então sem isto um ledger em dia deixaria o
  // cartão mudo.
  const gastoNoMes = _dMemo(() => {
    const m = new Map();
    (monthTx || []).forEach(t => {
      if (t.method !== "credit" || t.is_settlement) return;
      m.set(t.account_id, (m.get(t.account_id) || 0) + (t.flow === "expense" ? t.amount : -t.amount));
    });
    return m;
  }, [monthTx]);
  const checking = (accounts || []).filter(a => a.type === "checking");
  const total = available ? available.checking_total : checking.reduce((s, a) => s + (a.balance || 0), 0);
  const colorOf = a => bankColor(a.bank, a.id);

  // A fatia é sobre o dinheiro que EXISTE, não sobre o líquido: uma conta no
  // vermelho encolhe o total e faria as outras passarem de 100% ("315%" e
  // "−215%" lado a lado). Conta negativa não tem fatia — é dívida, não parcela
  // do que você tem — e aparece sem percentual, com o valor em vermelho.
  const positiveTotal = checking.reduce((s, a) => s + Math.max(0, a.balance || 0), 0);
  const shareOf = a => ((a.balance || 0) > 0 && positiveTotal > 0
    ? ((a.balance || 0) / positiveTotal) * 100
    : null);

  const emAberto = (accounts || []).reduce((s, a) => s + (a.open_invoice ? a.open_invoice.total : 0), 0);

  const linhaConta = (a) => h("button", {
    key: a.id, onClick: () => onToggleFacet && onToggleFacet("accounts", a.id),
    className: (filter && filter.accounts.has(a.id)) ? "facet-row facet-active" : "facet-row",
    title: "Filtrar os lançamentos desta conta",
    style: { display: "flex", flexDirection: "column", gap: 1, padding: "5px 6px", textAlign: "left",
      cursor: "pointer", background: "none", border: "none", width: "100%" },
  },
    h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
      h("span", { style: { width: 8, height: 8, background: colorOf(a), flexShrink: 0 } }),
      h("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
      shareOf(a) != null && h("span", { className: "mono", style: { fontSize: 11, color: "var(--fg-3)", marginLeft: "auto" } }, `${shareOf(a).toFixed(0)}%`)
    ),
    h("span", { className: "mono", style: { fontSize: 14, fontWeight: 700, paddingLeft: 16, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
  );

  // Fatura em aberto manda: é dinheiro com data pra sair. Sem ela em aberto, o
  // cartão reporta o que rodou nele no mês — informação, não compromisso, e por
  // isso em tom neutro.
  const linhaCartao = (a) => {
    const fat = a.open_invoice;
    const gasto = gastoNoMes.get(a.id) || 0;
    return h("button", {
      key: a.id, onClick: () => onToggleFacet && onToggleFacet("accounts", a.id),
      className: (filter && filter.accounts.has(a.id)) ? "acct-card facet-active" : "acct-card",
      title: fat
        ? "Fatura ainda não paga — filtrar os lançamentos deste cartão"
        : "Filtrar os lançamentos deste cartão",
    },
      h("span", { className: "acct-card-tree" }, "└"),
      h("span", { style: { fontSize: 11, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
      fat
        ? h(React.Fragment, null,
            h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--warn)" } },
              "−" + fmtBRL(Math.abs(fat.total))),
            h("span", { style: { fontSize: 10, color: "var(--fg-3)", flexShrink: 0 } },
              fat.due_date ? "a pagar · vence " + fmtDateBR(fat.due_date) : "a pagar"))
        : gasto !== 0
          ? h(React.Fragment, null,
              h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--fg-1)" } },
                (gasto >= 0 ? "−" : "+") + fmtBRL(Math.abs(gasto))),
              h("span", { style: { fontSize: 10, color: "var(--fg-3)", flexShrink: 0 } }, "no mês"))
          : h("span", { style: { marginLeft: "auto", fontSize: 10, color: "var(--fg-3)" } }, "sem uso no mês"),
    );
  };

  return h("div", { className: "widget wg-4" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Contas"),
      h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(total)),
      h("button", { className: "px-btn px-btn--ghost px-btn--sm", title: "Gerenciar contas e cartões", onClick: onManageAccounts }, "⚙")
    ),
    h("div", { className: "widget-body", style: { gap: 10 } },
      positiveTotal > 0 && checking.length > 1 && h("div", { style: { display: "flex", gap: 3, height: 5, flexShrink: 0 } },
        checking.map(a => {
          const pct = shareOf(a);
          return pct != null && pct > 0.5 && h("div", { key: a.id, title: `${a.name}: ${pct.toFixed(0)}%`, style: { width: pct + "%", background: colorOf(a), opacity: 0.85 } });
        })
      ),
      h("div", { style: { display: "flex", flexDirection: "column" } },
        grupos.map((g, i) => h("div", {
          key: g.bank,
          style: { borderBottom: i < grupos.length - 1 ? "1px dashed var(--line-1)" : "none", paddingBottom: 3, marginBottom: 3 },
        },
          g.contas.map(linhaConta),
          g.cartoes.map(linhaCartao),
        ))
      ),
      emAberto > 0 && h("div", { style: { marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexShrink: 0, fontSize: 11 } },
        h("span", { style: { color: "var(--fg-3)" } }, "Faturas a pagar"),
        h("span", { className: "mono", style: { fontWeight: 700, color: "var(--warn)" } }, "−" + fmtBRL(emAberto))),
    )
  );
});

const CategoriesWidget = React.memo(function CategoriesWidget({ monthTx, uncatCount, onOpenBulk, filter,
                                                               onToggleFacet, catsIndex, monthSel, onBudgetSaved,
                                                               onManageCategories }) {
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
      h("button", { className: "px-btn px-btn--ghost px-btn--sm", title: "Criar, renomear e apagar categorias", onClick: onManageCategories }, "⚙")
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

const InvestmentsWidget = React.memo(function InvestmentsWidget({ investments, evolution, onOpenPosition }) {

  const typeLabel = t => INV_TYPE_LABEL[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Investimento");
  const total = investments.reduce((s, i) => s + (i.balance || 0), 0);
  const invDelta = (evolution && evolution.length > 1)
    ? evolution[evolution.length - 1].cumulative - evolution[evolution.length - 2].cumulative : null;

  // Posição avulsa vira uma linha; posição com `group_name` entra numa linha
  // agregada por grupo. Quais são os grupos é decisão da config
  // (`positionGroups`) — o rótulo vem do dado, nunca de um literal aqui: com um
  // nome cravado, quem usasse outra config não veria agrupamento nenhum.
  const rows = _dMemo(() => {
    const out = [];
    const grouped = new Map();
    investments.forEach(i => {
      if (!i.group_name) {
        out.push({ name: i.name, sub: typeLabel(i.type), balance: i.balance || 0,
                   derived: !!i.derived, ids: [i.id] });
        return;
      }
      const g = grouped.get(i.group_name) || { balance: 0, ids: [], types: new Set() };
      g.balance += i.balance || 0;
      g.ids.push(i.id);
      g.types.add(i.type);
      grouped.set(i.group_name, g);
    });
    grouped.forEach((g, name) => out.push({
      name: `${name}${g.ids.length > 1 ? ` ×${g.ids.length}` : ""}`,
      sub: [...g.types].map(typeLabel).join(" · "),
      balance: g.balance, ids: g.ids,
    }));
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
        : rows.map((r, i, arr) => h("button", {
            key: i,
            className: "facet-row",
            onClick: () => onOpenPosition && onOpenPosition(r.ids, r.name),
            title: `Ver histórico de ${r.name}`,
            style: { display: "flex", flexDirection: "column", gap: 1, padding: "7px 6px", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none", flexShrink: 0, textAlign: "left", background: "none", border: "none", cursor: "pointer", width: "100%" }
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

// O que está comprometido no mês selecionado. Duas fontes, as duas ancoradas em
// dado real: parcela que o banco declarou na fatura ("2 de 3") e recorrência que
// VOCÊ apontou na ficha de um lançamento. Nada é deduzido do histórico.
const ForwardWidget = React.memo(function ForwardWidget({ commitments, monthSel, onEditCategory, monthTx }) {

  const parcelas = (commitments && commitments.installments) || [];
  const recorrentes = (commitments && commitments.recurring) || [];
  const totalSaida = (commitments && commitments.total_out) || 0;
  const mesNome = monthSel ? `${PT_MONTHS[monthSel.month].toLowerCase()}` : "";
  const vazio = parcelas.length === 0 && recorrentes.length === 0;

  // Clicar abre a ficha do lançamento — é de lá que a recorrência se declara e
  // se desfaz, então a linha leva de volta à sua própria origem.
  const abrir = (id) => {
    const tx = (monthTx || []).find(t => t.id === id);
    if (tx && onEditCategory) onEditCategory(tx);
  };

  const linha = ({ key, id, quando, titulo, selo, seloCor, valor, flow, esmaecido }) =>
    h("button", {
      key,
      className: "cmt-row",
      onClick: id ? () => abrir(id) : undefined,
      disabled: !id,
      style: esmaecido ? { opacity: 0.65 } : null,
    },
      h("span", { className: "mono cmt-quando" }, quando),
      h("span", { className: "cmt-titulo", title: titulo }, titulo),
      selo && h("span", { className: "cmt-selo", style: { color: seloCor, borderColor: seloCor } }, selo),
      h("span", { className: "mono cmt-valor", style: { color: flow === "income" ? "var(--pos)" : "var(--warn)" } },
        (flow === "income" ? "+" : "−") + fmtBRL(Math.abs(valor))),
    );

  return h("div", { className: "widget wg-14" },
    h("div", { className: "widget-h" },
      h("span", { className: "widget-title" }, "Comprometido"),
      h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "capitalize" } }, mesNome),
      totalSaida > 0 && h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--warn)" } },
        "−" + fmtBRL(totalSaida)),
    ),
    h("div", { className: "widget-body", style: { gap: 4 } },
      vazio
        ? h("div", { className: "px-empty", style: { lineHeight: 1.6 } },
            "Nenhuma parcela nem recorrente neste mês.",
            h("br"),
            h("span", { style: { fontSize: 11 } },
              "Parcela aparece sozinha quando a fatura traz uma. Recorrente você marca na ficha do lançamento."))
        : h(React.Fragment, null,

            parcelas.length > 0 && h(React.Fragment, null,
              h("div", { className: "cmt-secao" }, "Parcelas"),
              parcelas.map(p => linha({
                key: "p" + p.transaction_id,
                id: p.transaction_id,
                quando: fmtDateBR(p.date),
                titulo: window.BS.prettifyDesc(p.label),
                selo: `${p.seq}/${p.total}`,
                seloCor: "var(--fg-3)",
                valor: p.amount,
                flow: p.flow,
              })),
              parcelas.some(p => p.remaining > 0) && h("div", { className: "cmt-nota" },
                (() => {
                  const n = parcelas.reduce((s, p) => s + p.remaining, 0);
                  return `${n} ${n === 1 ? "parcela ainda vem" : "parcelas ainda vêm"} depois deste mês.`;
                })()),
            ),

            recorrentes.length > 0 && h(React.Fragment, null,
              h("div", { className: "cmt-secao" }, "Recorrentes"),
              recorrentes.map(r => linha({
                key: "r" + r.transaction_id,
                id: r.transaction_id,
                quando: r.confirmed ? fmtDateBR(r.date) : `dia ${String(r.day).padStart(2, "0")}`,
                titulo: window.BS.prettifyDesc(r.label),
                selo: r.confirmed ? "já caiu" : "previsto",
                seloCor: r.confirmed ? "var(--fg-3)" : "var(--warn)",
                valor: r.amount,
                flow: r.flow,
                esmaecido: r.duplicate_of_installment,
              })),
            ),
          ),
    ),
  );
});

const refMonthOf = (monthSel) =>
  monthSel ? `${monthSel.year}-${String(monthSel.month).padStart(2, "0")}` : undefined;

function DashboardView({ monthSel, monthly, onPickMonth, refreshKey, onEditCategory, onImport, onManageCategories, onManageAccounts, onOpenPosition }) {
  const [available, setAvailable] = _dSt(null);
  const [commitments, setCommitments] = _dSt(null);
  const [availErr, setAvailErr] = _dSt(false);
  const [loadErr, setLoadErr] = _dSt(false);
  const [retryTick, setRetryTick] = _dSt(0);
  const [accounts, setAccounts] = _dSt([]);
  const [investments, setInvestments] = _dSt([]);
  const [liquidityHistory, setLiquidityHistory] = _dSt([]);
  const [evolution, setEvolution] = _dSt([]);
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
    Promise.all([fetchAccounts(), fetchInvestments(), fetchLiquidityHistory(), fetchInvestmentEvolution()])
      .then(([ac, invs, lh, ev]) => {
        setAccounts(ac); setInvestments(invs);
        setLiquidityHistory(lh || []); setEvolution(ev || []);
      }).catch(() => setLoadErr(true));
  }, [refreshKey, retryTick]);

  _dEf(() => {
    if (!monthSel) return;
    const { month, year } = monthSel;
    fetchCommitments({ month, year }).then(setCommitments).catch(() => {});
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
          h(GeneralWidget, { cashflow, liquidityHistory, monthSel, monthTx, uncatCount,
            onOpenBulk: () => setBulkOpen(true) }),
          h(TimelineWidget, { monthly, monthSel, onPickMonth }),
          h(AccountsWidget, { accounts, available, monthTx, monthSel, filter, onToggleFacet, onManageAccounts }),
          h(CategoriesWidget, { monthTx, uncatCount, onOpenBulk: () => setBulkOpen(true), filter, onToggleFacet,
            catsIndex, monthSel, onBudgetSaved: reloadBudgets, onManageCategories }),
          h(InvestmentsWidget, { investments, evolution, onOpenPosition }),
        ),
        h("div", { className: "widget-row widget-row--soft" },
          h(ForwardWidget, { commitments, monthSel, monthTx, onEditCategory }),
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
