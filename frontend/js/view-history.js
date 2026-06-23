/* view-history.js — HistoryView (tela Histórico/Análise) */
/* global React, fetchMonthlyFull, fetchMonthTransactions, fetchPixTop, deleteTransaction, fetchCategoriesFull, patchTransactionCategory */

const { useState: _s2St, useEffect: _s2Ef, useMemo: _s2Memo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, DualLine, PT_MONTHS, PT_SHORT, fmtCycleDate } = window.BS;

/* ── HistoryView — Lupa do mês ───────────────────────────────────────────── */

function HistoryView({ refreshKey, onEditCategory, onDeleteTx, initialAccount, onAccountConsumed }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [monthly, setMonthly] = _s2St([]);
  const [pickedIdx, setPickedIdx] = _s2St(-1);
  const [browsingYear, setBrowsingYear] = _s2St(null);
  const [monthTx, setMonthTx] = _s2St([]);
  const [filterFlow, setFilterFlow] = _s2St("all");
  const [filterMethod, setFilterMethod] = _s2St("all");
  const [filterCat, setFilterCat] = _s2St("all");
  const [filterAccount, setFilterAccount] = _s2St("all");
  const [search, setSearch] = _s2St("");
  const [pixTop, setPixTop] = _s2St([]);
  // Categorias por flow — a edição inline mostra a lista certa pra despesa/receita.
  const [catsByFlow, setCatsByFlow] = _s2St({ expense: [], income: [] });

  const pickedRef = React.useRef(null);
  const lastFetchedMonth = React.useRef(null);

  _s2Ef(() => {
    Promise.all([fetchCategoriesFull("expense"), fetchCategoriesFull("income")])
      .then(([exp, inc]) => setCatsByFlow({ expense: exp, income: inc }));
    fetchMonthlyFull().then(data => {
      setMonthly(data);
      if (pickedRef.current) {
        const idx = data.findIndex(m => `${m.year}-${m.month}` === pickedRef.current);
        if (idx >= 0) {
          setPickedIdx(idx);
          return;
        }
      }
      setPickedIdx(data.length - 1);
    });
  }, [refreshKey]);

  _s2Ef(() => {
    if (monthly[pickedIdx]) {
      pickedRef.current = `${monthly[pickedIdx].year}-${monthly[pickedIdx].month}`;
    }
  }, [pickedIdx, monthly]);

  _s2Ef(() => {
    const handler = e => setMonthTx(prev => prev.filter(tx => tx.id !== e.detail.id));
    window.addEventListener('bs-tx-optimistic-delete', handler);
    return () => window.removeEventListener('bs-tx-optimistic-delete', handler);
  }, []);

  _s2Ef(() => {
    if (!monthly.length || pickedIdx < 0) return;
    const { month, year } = monthly[pickedIdx];
    fetchMonthTransactions({ month, year }).then(setMonthTx);
    fetchPixTop({ month, year }).then(setPixTop).catch(() => setPixTop([]));
    
    const monthStr = `${year}-${month}`;
    if (lastFetchedMonth.current !== monthStr) {
      setFilterFlow("all"); setFilterMethod("all"); setFilterCat("all"); setSearch("");
      lastFetchedMonth.current = monthStr;
    }
  }, [pickedIdx, monthly, refreshKey]);

  // Drill-down: a conta click on the Dinheiro screen lands here pre-filtered.
  // bank's bill); a checking account just pre-filters the month table by bank.
  _s2Ef(() => {
    if (initialAccount) {
      const bankName = initialAccount.startsWith("nu") ? "Nubank" : (initialAccount.startsWith("inter") ? "Inter" : initialAccount);
      setFilterAccount(bankName);
      onAccountConsumed && onAccountConsumed();
    }
  }, [initialAccount]);

  const now = new Date();
  const pickedMonthObj = monthly[pickedIdx] || null;
  const activeYear = browsingYear || (pickedMonthObj ? pickedMonthObj.year : now.getFullYear());
  const availableYears = [...new Set(monthly.map(m => m.year))].sort((a,b) => a - b);
  const maxH = Math.max(...monthly.map(x => x.expenses), 1);
  const yearSlots = [];
  for (let m = 1; m <= 12; m++) {
    yearSlots.push({ month: m, data: monthly.find(x => x.year === activeYear && x.month === m) });
  }

  const picked = monthly[pickedIdx] || null;
  const monthLabel = picked ? `${PT_MONTHS[picked.month]} ${picked.year}` : "";
  const isCurrent = picked ? (picked.year === now.getFullYear() && picked.month === (now.getMonth() + 1)) : false;

  // Same consumption/income rule as every analytics function (Visão do Mês, gráfico de
  // fluxo, resumo): pernas de transferência (aplicações) e entradas is_revenue=0
  // (resgates) NÃO são despesa/receita — são fluxo de investimento, contado à parte.
  // counterpart='SELF' = auto-Pix entre as contas do usuário: nem despesa, nem receita,
  // nem investimento — só trânsito, fica fora de todos os totais.
  const isSelf      = t => t.counterpart === "SELF";
  const expenses    = monthTx.filter(t => t.flow === "expense" && t.method !== "transfer" && !t.is_third_party);
  const income      = monthTx.filter(t => t.flow === "income"  && t.is_revenue === 1 && !t.is_third_party);
  const totalExp    = expenses.reduce((s, t) => s + t.amount, 0);
  const totalInc    = income.reduce((s, t)  => s + t.amount, 0);
  const investOut   = monthTx.filter(t => t.flow === "expense" && t.method === "transfer" && !isSelf(t) && !t.is_third_party).reduce((s, t) => s + t.amount, 0);
  const investIn    = monthTx.filter(t => t.flow === "income"  && t.is_revenue !== 1 && !isSelf(t) && !t.is_third_party).reduce((s, t) => s + t.amount, 0);
  const investNet   = investOut - investIn;          // + = aplicou líquido, − = resgatou líquido
  const net         = totalInc - totalExp - investNet; // saldo livre (igual à Visão do Mês)

  const daysInMonth = picked ? new Date(picked.year, picked.month, 0).getDate() : 30;
  const daysPassed  = isCurrent ? Math.max(1, now.getDate()) : daysInMonth;
  const dailyAvg    = totalExp / daysPassed;

  // 6 meses imediatamente anteriores ao selecionado (não inclui o próprio mês)
  const prevMonths = monthly.slice(Math.max(0, pickedIdx - 6), pickedIdx);
  const avgExp   = prevMonths.length ? prevMonths.reduce((s, m) => s + m.expenses, 0) / prevMonths.length : 0;
  const avgInc   = prevMonths.length ? prevMonths.reduce((s, m) => s + m.income,   0) / prevMonths.length : 0;
  const expVsAvg = avgExp > 0 ? ((totalExp - avgExp) / avgExp) * 100 : 0;
  const incVsAvg = avgInc > 0 ? ((totalInc - avgInc) / avgInc) * 100 : 0;

  const targetTodayIdx = React.useMemo(() => {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const idx = monthly.findIndex(x => x.year === y && x.month === m);
    return idx !== -1 ? idx : Math.max(0, monthly.length - 1);
  }, [monthly, now]);

  const byCat = (() => {
    const g = {};
    expenses.forEach(t => {
      const k = t.category || "Outro";
      if (!g[k]) g[k] = { name: k, total: 0 };
      g[k].total += t.amount;
    });
    return Object.values(g).sort((a, b) => b.total - a.total);
  })();

  const METHOD_MAP = { pix: "pix", "pix_received": "pix", credit: "credit", ted: "ted" };
  const METHOD_LABELS_H = { pix: "PIX", credit: "Crédito", ted: "TED" };
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
      // "Sem categoria" = linhas categorizáveis (consumo/receita real) ainda sem categoria.
      // Transferências/investimentos (method='transfer' ou income não-revenue) não contam.
      const categorizable = !t.is_third_party && (
        (t.flow === "expense" && t.method !== "transfer") ||
        (t.flow === "income" && t.is_revenue === 1)
      );
      if (!categorizable || t.category_id) return false;
    } else if (filterCat !== "all" && t.category !== filterCat) return false;
    if (filterAccount !== "all") {
      const bName = (t.bank === "nubank" || (t.account_id && t.account_id.startsWith("nu"))) ? "Nubank" :
                    (t.bank === "inter" || (t.account_id && t.account_id.startsWith("inter"))) ? "Inter" : (t.bank || t.account_id);
      if (bName !== filterAccount) return false;
    }
    // Search both the cleaned display text AND the raw description, so the hidden
    // routing tail (bank/agency/account) stays findable even though it's not shown.
    const label = [t.display_name, window.BS.prettifyDesc(t.description), t.description]
      .filter(Boolean).join(" ").toLowerCase();
    if (search && !label.includes(search.toLowerCase())) return false;
    return true;
  });

  if (!picked) return h("div", { style: { padding: 24, color: "var(--fg-2)" } }, "Carregando…");

  const filtExp  = filteredTx.filter(t => t.flow === "expense" && t.method !== "transfer" && !t.is_third_party).reduce((s, t) => s + t.amount, 0);
  const filtInc  = filteredTx.filter(t => t.flow === "income" && t.is_revenue === 1 && !t.is_third_party).reduce((s, t)  => s + t.amount, 0);
  const hasFilter = filterFlow !== "all" || filterMethod !== "all" || filterCat !== "all" || filterAccount !== "all" || search;

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 32, paddingBottom: 40 } },

    // A1 — Month picker strip (Sticky correctly aligned)
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: -1, background: "var(--bg-0)", zIndex: 10, padding: "16px 0", marginBottom: 24, borderBottom: "1px solid var(--line-1)", boxShadow: "0 0 0 32px var(--bg-0)", clipPath: "inset(0 -32px)" } },
        h("div", { style: { display: "flex", alignItems: "baseline", gap: 16 } },
          h("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em" } }, "Análise do mês"),
          h("div", { style: { fontSize: 12, color: "var(--fg-3)" } }, `${monthTx.length} lançamentos processados`)
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
          (pickedIdx !== targetTodayIdx && monthly.length > 0) && h("button", {
            onClick: () => {
              setPickedIdx(targetTodayIdx);
              setBrowsingYear(null);
            },
            className: "btn btn-ghost btn-sm",
            style: { fontSize: 12, fontWeight: 700, color: "var(--info)", padding: "4px 12px", borderRadius: 999, border: "1px solid color-mix(in oklch, var(--info) 30%, transparent)", background: "color-mix(in oklch, var(--info) 10%, transparent)", marginRight: 8, transition: "all 0.1s" },
            onMouseEnter: e => e.currentTarget.style.background = "color-mix(in oklch, var(--info) 15%, transparent)",
            onMouseLeave: e => e.currentTarget.style.background = "color-mix(in oklch, var(--info) 10%, transparent)"
          }, "Hoje"),
          h("button", { onClick: () => { setPickedIdx(Math.max(0, pickedIdx - 1)); setBrowsingYear(null); }, className: "btn btn-ghost", disabled: pickedIdx === 0, style: { padding: "0 8px", fontSize: 18 } }, "‹"),
          h("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--fg-0)", minWidth: 160, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 } },
            monthLabel,
            isCurrent && h("span", { className: "chip info", style: { fontSize: 10, fontWeight: 700 } }, "mês atual")
          ),
          h("button", { onClick: () => { setPickedIdx(Math.min(monthly.length - 1, pickedIdx + 1)); setBrowsingYear(null); }, className: "btn btn-ghost", disabled: pickedIdx === monthly.length - 1, style: { padding: "0 8px", fontSize: 18 } }, "›")
        )
    ),
      
      // Interactive Timeline (Years + Months)
      h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
        // Year Tabs
        h("div", { style: { display: "flex", gap: 24 } },
          availableYears.map(y => 
            h("button", {
              key: y, onClick: () => setBrowsingYear(y),
              style: {
                background: "none", border: "none", cursor: "pointer", padding: "0 0 6px 0",
                fontSize: 13, fontWeight: activeYear === y ? 700 : 500,
                color: activeYear === y ? "var(--fg-1)" : "var(--fg-3)",
                borderBottom: activeYear === y ? "2px solid var(--info)" : "2px solid transparent",
                transition: "all 0.1s"
              }
            }, y)
          )
        ),
        // Month Strip (12 slots)
        h("div", { style: { display: "flex", alignItems: "flex-end", gap: 8, height: 60 } },
          yearSlots.map((slot) => {
            const d = slot.data;
            const barH = d ? Math.max((d.expenses / maxH) * 100, 4) : 0;
            const isPicked = d && pickedMonthObj && d.year === pickedMonthObj.year && d.month === pickedMonthObj.month;
            const isCur2 = activeYear === now.getFullYear() && slot.month === (now.getMonth() + 1);
            
            return h("button", {
              key: slot.month, 
              onClick: () => {
                if (d) {
                  const idx = monthly.indexOf(d);
                  setPickedIdx(idx);
                  setBrowsingYear(null);
                }
              },
              disabled: !d,
              title: d ? `${PT_MONTHS[slot.month]} ${activeYear}: ${fmtBRL(d.expenses)}` : `${PT_MONTHS[slot.month]} (sem dados)`,
              style: {
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 6,
                background: isPicked ? "color-mix(in oklch, var(--info) 10%, transparent)" : "transparent",
                borderRadius: 6, padding: "8px 4px 6px 4px",
                border: isPicked ? "1px solid color-mix(in oklch, var(--info) 40%, transparent)" : "1px solid transparent",
                cursor: d ? "pointer" : "default",
                opacity: d ? 1 : 0.3,
                transition: "all 0.1s"
              },
            },
              h("div", { style: {
                width: "100%", height: `${barH}%`, minHeight: 3,
                background: isPicked ? "var(--info)" : isCur2 ? "var(--fg-2)" : "var(--line-2)",
                borderRadius: 3
              } }),
              h("span", { style: { fontSize: 10, color: isPicked ? "var(--info)" : "var(--fg-3)", fontFamily: "var(--ff-mono)", textTransform: "uppercase", fontWeight: isPicked ? 700 : 500 } },
                PT_MONTHS[slot.month].substring(0,3)
              )
            );
          })
        )
      ),

    // B — faixa de métricas (Borderless hero numbers)
    (() => {
      const cards = [
        { l: "Receitas", v: fmtBRL(totalInc), c: "var(--pos)" },
        { l: "Despesas", v: fmtBRL(totalExp), c: "var(--neg)" },
        { l: "Aplicações", v: fmtBRL(investOut), c: investOut > 0 ? "var(--reserve)" : "var(--fg-3)" },
        { l: "Resgates", v: fmtBRL(investIn), c: investIn > 0 ? "var(--info)" : "var(--fg-3)" },
        { l: "Saldo livre", v: `${net >= 0 ? "+" : "−"}${fmtBRL(Math.abs(net))}`, c: net >= 0 ? "var(--pos)" : "var(--neg)" }
      ];
      return h("div", { style: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 24, padding: "16px 0", borderBottom: "1px solid var(--line-1)" } },
        cards.map((s, i) =>
          h("div", { key: i, style: { flex: 1, minWidth: 140 } },
            h("div", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 8 } }, s.l),
            h("div", { className: "num", style: { fontSize: 20, fontWeight: 800, color: s.c, letterSpacing: "-0.02em", lineHeight: 1 } }, s.v)
          )
        )
      );
    })(),

    // C — Analíticos: Fluxo de Caixa + Distribuição
    h("div", { style: { display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, marginTop: 16, marginBottom: 32 } },

      // Fluxo de caixa (Bar Chart)
      h("div", { style: { background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 } },
          h("div", { style: { fontSize: 12, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Fluxo de Caixa"),
          h("span", { style: { fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--ff-mono)" } }, "6 meses")
        ),
        h("div", { style: { flex: 1, minHeight: 220 } },
          h(DualLine, { data: monthly.slice(Math.max(0, pickedIdx - 5), pickedIdx + 1), height: 260 })
        )
      ),

      // Composição de Despesas (Waterfall / Progress Bars)
      h("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: 12, padding: 24 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 } },
          h("div", { style: { fontSize: 12, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Despesas"),
          h("span", { style: { fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--ff-mono)" } }, `${byCat.length} categorias`)
        ),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
          (() => {
            if (byCat.length === 0) return h("div", { style: { color: "var(--fg-3)", fontSize: 13, textAlign: "center", padding: "40px 0" } }, "Nenhuma despesa no período.");
            
            const limit = 8;
            let items = byCat.slice(0, limit);
            if (byCat.length > limit) {
              const others = byCat.slice(limit);
              items.push({ name: `Outros (${others.length})`, total: others.reduce((s, x) => s + x.total, 0), isOther: true });
            }
            
            const maxVal = Math.max(...items.map(i => i.total));
            
            return items.map((c, i) => {
              const globalPct = totalExp ? (c.total / totalExp) * 100 : 0;
              
              return h("div", { key: i, style: { display: "flex", flexDirection: "column", gap: 6 } },
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
                  h("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-0)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, c.name || c.label),
                  h("div", { style: { display: "flex", gap: 12, alignItems: "baseline" } },
                    h("span", { className: "num", style: { fontSize: 11, color: "var(--fg-3)", fontWeight: 500 } }, globalPct.toFixed(1), "%"),
                    h("span", { className: "num", style: { fontSize: 14, fontWeight: 700, color: "var(--fg-1)" } }, fmtBRL(c.total))
                  )
                ),
                h("div", { style: { width: "100%", height: 6, background: "var(--bg-2)", borderRadius: 3, overflow: "hidden" } },
                  h("div", { style: { width: `${globalPct}%`, height: "100%", background: c.isOther ? "var(--line-2)" : (i === 0 ? "var(--info)" : "var(--fg-2)"), borderRadius: 3 } })
                )
              );
            });
          })()
        )
      )
    ),

    // Tabela — largura total, borderless toolbar
    h("div", { style: { display: "flex", flexDirection: "column" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line-1)", paddingBottom: 20, marginBottom: 20 } },
          h("div", null,
            h("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--fg-1)" } }, "Lançamentos"),
            h("div", { style: { fontSize: 12, color: "var(--fg-3)", marginTop: 4, fontFamily: "var(--ff-mono)" } }, `${filteredTx.length} itens exibidos`)
          ),
          h("div", { style: { display: "flex", gap: 32, alignItems: "center" } },
            h("div", { style: { display: "flex", flexDirection: "column", minWidth: 90, textAlign: "right" } },
              h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 } }, "Receitas"),
              h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--pos)" } }, `+${fmtBRL(filtInc)}`)
            ),
            h("div", { style: { display: "flex", flexDirection: "column", minWidth: 90, textAlign: "right" } },
              h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 } }, "Despesas"),
              h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--neg)" } }, `−${fmtBRL(filtExp)}`)
            ),
            h("div", { style: { width: 1, height: 28, background: "var(--line-1)" } }),
            h("div", { style: { display: "flex", flexDirection: "column", minWidth: 110, textAlign: "right" } },
              h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 4 } }, "Saldo Listado"),
              h("span", { className: "num", style: { fontSize: 18, fontWeight: 800, color: (filtInc - filtExp) >= 0 ? "var(--pos)" : "var(--neg)" } },
                (filtInc - filtExp) >= 0 ? "+" : "−", fmtBRL(Math.abs(filtInc - filtExp))
              )
            )
          )
        ),
        h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 } },
          h("div", { className: "filter-pills" },
            [["all", "Tudo"], ["expense", "Despesas"], ["income", "Receitas"]].map(([k, l]) =>
              h("button", { key: k, className: `filter-pill${filterFlow === k ? " active" : ""}`,
                onClick: () => { setFilterFlow(k); if (k === "income") setFilterMethod("all"); } }, l)
            )
          ),
          h("div", { className: "filter-pills" },
            [["all", "Todos"], ["pix", "PIX"], ["credit", "Crédito"], ["ted", "TED"]].map(([k, l]) =>
              h("button", { key: k, className: `filter-pill${filterMethod === k ? " active" : ""}`,
                onClick: () => setFilterMethod(k) }, l)
            )
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
            value: filterAccount,
            onChange: e => setFilterAccount(e.target.value),
            className: "select", style: { height: 26, fontSize: 11, padding: "0 24px 0 10px", width: "auto", borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500, cursor: "pointer" }
          },
            h("option", { value: "all" }, "Banco ▾"),
            bankNames.length > 0 && h("optgroup", { label: "Filtrar mês por banco" }, bankNames.map(b => h("option", { key: b, value: b }, b)))
          ),
          h("div", { style: { flex: 1, minWidth: 16 } }),
          h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
            h("input", {
              value: search, onChange: e => setSearch(e.target.value),
              placeholder: "Buscar…", className: "input",
              style: { height: 26, fontSize: 11, padding: "0 10px", width: 140, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500 },
            }),
            hasFilter && h("button", {
              onClick: () => { setFilterFlow("all"); setFilterMethod("all"); setFilterCat("all"); setFilterAccount("all"); setSearch(""); },
              className: "btn btn-ghost", style: { height: 26, padding: "0 8px", fontSize: 11, fontWeight: 600, color: "var(--neg)" },
            }, "Limpar")
          )
        ),
        h("div", { style: { display: "flex", flexDirection: "column" } },
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
              ...filteredTx.map(t => {
                const rowCats = catsByFlow[t.flow] || [];
                return h(window.BS.TxRow, {
                  key: t.id, t, cols: ["date", "desc", "cat", "account", "amount"],
                  onEditCategory, cats: rowCats,
                  onInlineCategoryChange: async (txId, catId) => {
                    const id = parseInt(catId);
                    try {
                      await patchTransactionCategory(txId, id);
                      window.dispatchEvent(new CustomEvent('bs-toast', { detail: { msg: "Categoria atualizada", kind: "success" } }));
                      const name = rowCats.find(c => c.id === id)?.name || t.category;
                      setMonthTx(prev => prev.map(x => x.id === txId ? { ...x, category_id: id, category: name } : x));
                    } catch (e) {
                      window.dispatchEvent(new CustomEvent('bs-toast', { detail: { msg: "Erro ao atualizar", kind: "error" } }));
                    }
                  }
                });
              })
            )
          )
        )
      )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { HistoryView });
