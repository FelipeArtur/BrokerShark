/* view-history.js — InvestmentsView + HistoryView (tela Histórico/Análise) */
/* global React, fetchInvestments, fetchInvestmentMovements, patchInvestmentBalance,
          fetchMonthlyFull, fetchMonthTransactions, fetchPixTop, deleteTransaction */

const { useState: _s2St, useEffect: _s2Ef, useMemo: _s2Memo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, Sparkline, BarChart, DualLine, Donut, Progress, PT_MONTHS, PT_SHORT, fmtCycleDate } = window.BS;

/* ── InvestmentsView ─────────────────────────────────────────────────────── */
function InvestmentsView({ refreshKey, filterMonth }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [investments, setInvestments] = _s2St([]);
  const [editingId, setEditingId] = _s2St(null);
  const [editInput, setEditInput] = _s2St("");
  const [editErr, setEditErr] = _s2St("");
  const [periodMovements, setPeriodMovements] = _s2St([]);

  _s2Ef(() => { fetchInvestments().then(setInvestments); }, [refreshKey]);
  _s2Ef(() => {
    if (filterMonth && filterMonth !== "all") {
      const [year, month] = filterMonth.split("-").map(Number);
      fetchInvestmentMovements({ month, year }).then(setPeriodMovements);
    } else {
      setPeriodMovements([]);
    }
  }, [filterMonth, refreshKey]);

  async function saveBalance(inv) {
    const val = parseFloat(editInput.replace(",", "."));
    if (isNaN(val) || val < 0) { setEditErr("Valor inválido"); return; }
    setEditErr("");
    try {
      await patchInvestmentBalance(inv.id, val);
      setInvestments(prev => prev.map(i => i.id === inv.id ? { ...i, balance: val } : i));
      setEditingId(null);
    } catch (e) {
      setEditErr(e.message || "Erro");
    }
  }

  const total = investments.reduce((s, i) => s + (i.balance || 0), 0);
  const COLORS = ["oklch(72% 0.12 290)", "oklch(72% 0.13 230)", "oklch(72% 0.14 155)"];
  const donutData = investments.map(i => ({ ...i }));

  if (investments.length === 0) {
    return h("div", { className: "fade-in pane", style: { padding: 40, textAlign: "center", color: "var(--fg-3)" } },
      h("div", { style: { fontSize: 32, marginBottom: 10, opacity: 0.3 } }, "◈"),
      h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-2)", marginBottom: 6 } }, "Nenhum investimento cadastrado"),
      h("div", { style: { fontSize: 11 } }, "Registre movimentos de investimento pelo bot ou pelo formulário de entrada.")
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-inv)", gap: 14 } },
      h("div", { style: { paddingBottom: 24 } },
        h("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Patrimônio em investimentos"),
        h("div", { className: "num", style: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" } }, fmtBRL(total)),
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", marginTop: 18 } },
          h(Donut, { data: donutData, size: 200, thickness: 28, valueKey: "balance", colors: COLORS })
        ),
        h("div", { style: { marginTop: 16, display: "flex", flexDirection: "column", gap: 6 } },
          investments.map((inv, i) => {
            const bal = inv.balance || 0;
            const pct = total ? (bal / total) * 100 : 0;
            return h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11 } },
              h("span", { style: { width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length], display: "inline-block" } }),
              h("span", { style: { flex: 1, color: "var(--fg-1)" } }, inv.name),
              h("span", { className: "num", style: { color: "var(--fg-2)" } }, pct.toFixed(1), "%"),
              h("span", { className: "num", style: { width: 90, textAlign: "right", fontWeight: 600 } }, fmtBRL(bal))
            );
          })
        )
      ),
      h("div", { className: "pane" },
        h("div", { className: "pane-h" },
          h("div", { className: "pane-title" }, "Investimentos"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, "clique no valor para corrigir")
        ),
        h("div", { className: "pane-content", style: { display: "flex", flexDirection: "column", gap: 14 } },
          investments.map((inv, i) => {
            const bal = inv.balance || 0;
            const isEditing = editingId === inv.id;
            return h("div", { key: i, style: { padding: "10px 0", borderBottom: "1px solid var(--line-1)" } },
              h("div", { style: { display: "flex", alignItems: "center", gap: 14 } },
                h("div", { style: { flex: 1 } },
                  h("div", { style: { fontWeight: 600, fontSize: 13 } }, inv.name),
                  h(BankChip, { bank: inv.bank })
                ),
                !isEditing
                  ? h("button", {
                      onClick: () => { setEditingId(inv.id); setEditInput(bal.toFixed(2).replace(".", ",")); setEditErr(""); },
                      style: { textAlign: "right", background: "none", border: "none", cursor: "pointer", padding: 0 }
                    },
                      h("div", { className: "num", style: { fontSize: 18, fontWeight: 700, borderBottom: "1px dashed var(--line-2)" } }, fmtBRL(bal)),
                      h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2 } }, inv.type === "savings" ? "Poupança" : "Tesouro")
                    )
                  : h("div", { style: { display: "flex", gap: 4, alignItems: "center" } },
                      h("input", {
                        autoFocus: true, className: "input", value: editInput,
                        onChange: e => { setEditInput(e.target.value); setEditErr(""); },
                        onKeyDown: e => { if (e.key === "Enter") saveBalance(inv); if (e.key === "Escape") { setEditingId(null); setEditErr(""); } },
                        style: { height: 30, width: 100, padding: "0 6px", fontSize: 13, borderColor: editErr ? "var(--neg)" : undefined }
                      }),
                      h("button", { className: "btn btn-primary btn-sm", onClick: () => saveBalance(inv), style: { height: 30 } }, "✓"),
                      h("button", { className: "btn btn-ghost btn-sm", onClick: () => { setEditingId(null); setEditErr(""); }, style: { height: 30 } }, "✕")
                    )
              ),
              isEditing && editErr && h("div", { style: { fontSize: 10, color: "var(--neg)", marginTop: 4 } }, editErr)
            );
          })
        ),
        periodMovements.length > 0 && h("div", { style: { borderTop: "1px solid var(--line-1)", padding: "12px 14px" } },
          h("div", { style: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--fg-3)", marginBottom: 10 } }, "Movimentos no período"),
          h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
            periodMovements.map((m, i) => {
              const isDeposit = m.operation === "deposit";
              return h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11 } },
                h("span", { style: { fontSize: 9, color: "var(--fg-3)", width: 42, fontFamily: "var(--ff-mono)" } }, m.date.slice(5)),
                h("span", { style: { flex: 1, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, m.investment_name),
                h("span", { style: { fontSize: 9, padding: "1px 5px", borderRadius: 3, background: isDeposit ? "color-mix(in oklch, var(--pos) 15%, transparent)" : "color-mix(in oklch, var(--neg) 15%, transparent)", color: isDeposit ? "var(--pos)" : "var(--neg)", fontWeight: 600 } }, isDeposit ? "dep." : "res."),
                h("span", { className: "num", style: { fontWeight: 600, color: isDeposit ? "var(--pos)" : "var(--neg)" } },
                  isDeposit ? "+" : "−", fmtBRL(m.amount, { decimals: 0 }))
              );
            })
          ),
          (() => {
            const netMov = periodMovements.reduce((s, m) => s + (m.operation === "deposit" ? m.amount : -m.amount), 0);
            return h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line-1)" } },
              h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, `${periodMovements.length} movimento${periodMovements.length !== 1 ? "s" : ""}`),
              h("span", { className: "num", style: { fontSize: 11, fontWeight: 700, color: netMov >= 0 ? "var(--pos)" : "var(--neg)" } },
                netMov >= 0 ? "+" : "−", fmtBRL(Math.abs(netMov), { decimals: 0 }))
            );
          })()
        ),
        periodMovements.length === 0 && filterMonth && filterMonth !== "all" && h("div", { style: { borderTop: "1px solid var(--line-1)", padding: "14px", textAlign: "center", color: "var(--fg-3)", fontSize: 11 } },
          "Sem movimentos neste período"
        )
      )
    )
  );
}

/* ── HistoryView — Lupa do mês ───────────────────────────────────────────── */

function HistoryView({ refreshKey, onEditCategory, onDeleteTx, initialAccount, onAccountConsumed }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [monthly, setMonthly] = _s2St([]);
  const [pickedIdx, setPickedIdx] = _s2St(-1);
  const [monthTx, setMonthTx] = _s2St([]);
  const [filterFlow, setFilterFlow] = _s2St("all");
  const [filterMethod, setFilterMethod] = _s2St("all");
  const [filterCat, setFilterCat] = _s2St("all");
  const [filterAccount, setFilterAccount] = _s2St("all");
  const [search, setSearch] = _s2St("");
  const [pixTop, setPixTop] = _s2St([]);

  const pickedRef = React.useRef(null);
  const lastFetchedMonth = React.useRef(null);

  _s2Ef(() => {
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

  // Drill-down: a fatura/conta click on the Dinheiro screen lands here pre-filtered.
  _s2Ef(() => {
    if (initialAccount) {
      setFilterAccount(initialAccount);
      onAccountConsumed && onAccountConsumed();
    }
  }, [initialAccount]);

  const picked = monthly[pickedIdx] || null;
  const now = new Date();
  const monthLabel = picked ? `${PT_MONTHS[picked.month]} ${picked.year}` : "";
  const isCurrent = picked ? (picked.year === now.getFullYear() && picked.month === (now.getMonth() + 1)) : false;

  const expenses    = monthTx.filter(t => t.flow === "expense" && !t.is_third_party);
  const income      = monthTx.filter(t => t.flow === "income"  && !t.is_third_party);
  const totalExp    = expenses.reduce((s, t) => s + t.amount, 0);
  const totalInc    = income.reduce((s, t)  => s + t.amount, 0);
  const net         = totalInc - totalExp;
  const savingsRate = totalInc > 0 ? (net / totalInc) * 100 : 0;

  // 6 meses imediatamente anteriores ao selecionado (não inclui o próprio mês)
  const prevMonths = monthly.slice(Math.max(0, pickedIdx - 6), pickedIdx);
  const avgExp   = prevMonths.length ? prevMonths.reduce((s, m) => s + m.expenses, 0) / prevMonths.length : 0;
  const avgInc   = prevMonths.length ? prevMonths.reduce((s, m) => s + m.income,   0) / prevMonths.length : 0;
  const expVsAvg = avgExp > 0 ? ((totalExp - avgExp) / avgExp) * 100 : 0;
  const incVsAvg = avgInc > 0 ? ((totalInc - avgInc) / avgInc) * 100 : 0;

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
  const acctNames = (window.BS && window.BS.accountNames) || {};
  const acctIds = [...new Set(monthTx.map(t => t.account_id).filter(Boolean))].sort();
  const filteredTx = monthTx.filter(t => {
    if (filterFlow !== "all" && t.flow !== filterFlow) return false;
    if (filterMethod !== "all") {
      const m = METHOD_MAP[t.method] || t.method;
      if (m !== filterMethod) return false;
    }
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (filterAccount !== "all" && t.account_id !== filterAccount) return false;
    const label = (t.display_name || t.description || "").toLowerCase();
    if (search && !label.includes(search.toLowerCase())) return false;
    return true;
  });

  if (!picked) return h("div", { style: { padding: 24, color: "var(--fg-2)" } }, "Carregando…");

  const filtExp  = filteredTx.filter(t => t.flow === "expense" && !t.is_third_party).reduce((s, t) => s + t.amount, 0);
  const filtInc  = filteredTx.filter(t => t.flow === "income" && !t.is_third_party).reduce((s, t)  => s + t.amount, 0);
  const hasFilter = filterFlow !== "all" || filterMethod !== "all" || filterCat !== "all" || filterAccount !== "all" || search;

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    // A — Month picker strip
    h("div", { style: { padding: 0, overflow: "hidden" } },
      h("div", { style: { padding: "10px 0", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" } },
        h("div", null,
          h("div", { className: "eyebrow" }, "Análise do mês"),
          h("div", { style: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em", marginTop: 2, display: "flex", alignItems: "center", gap: 10 } },
            monthLabel,
            isCurrent && h("span", { className: "chip info", style: { fontSize: 10 } }, "mês atual")
          )
        ),
        h("div", { style: { display: "flex", gap: 4 } },
          h("button", { onClick: () => setPickedIdx(Math.max(0, pickedIdx - 1)), className: "btn", disabled: pickedIdx === 0, style: { width: 32, padding: 0, fontSize: 14 } }, "‹"),
          h("button", { onClick: () => setPickedIdx(monthly.length - 1), className: "btn", style: { fontSize: 11 } }, "Mês atual"),
          h("button", { onClick: () => setPickedIdx(Math.min(monthly.length - 1, pickedIdx + 1)), className: "btn", disabled: pickedIdx === monthly.length - 1, style: { width: 32, padding: 0, fontSize: 14 } }, "›")
        )
      ),
      h("div", { style: { display: "flex", alignItems: "flex-end", gap: 2, padding: "10px 0", height: 70, background: "var(--bg-0)" } },
        monthly.map((m, i) => {
          const maxH = Math.max(...monthly.map(x => x.expenses), 1);
          const barH = (m.expenses / maxH) * 100;
          const isPicked = i === pickedIdx;
          const isCur2 = m.year === now.getFullYear() && m.month === (now.getMonth() + 1);
          return h("button", {
            key: i, onClick: () => setPickedIdx(i),
            title: `${PT_MONTHS[m.month]} ${m.year}: ${fmtBRL(m.expenses, { decimals: 0 })}`,
            style: {
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: "transparent", borderRadius: 4, padding: "2px 1px",
              border: isPicked ? "1px solid var(--info)" : "1px solid transparent",
            },
          },
            h("div", { style: {
              width: "100%", height: `${barH}%`, minHeight: 3,
              background: isPicked ? "var(--info)" : isCur2 ? "var(--fg-2)" : "var(--line-2)",
              borderRadius: 2,
            } }),
            h("span", { style: { fontSize: 8, color: isPicked ? "var(--info)" : "var(--fg-3)", fontFamily: "var(--ff-mono)", fontWeight: isPicked ? 600 : 400 } },
              `${String(m.month).padStart(2, "0")}/${String(m.year).slice(2)}`
            )
          );
        })
      )
    ),

    // B — faixa de métricas (uma faixa única, não 4 cards soltos)
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-4)", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)", paddingTop: 4, paddingBottom: 4 } },
      [
        {
          l: "Receitas", v: fmtBRL(totalInc), c: "var(--pos)",
          sub: prevMonths.length ? (incVsAvg !== 0 ? `${incVsAvg >= 0 ? "▲" : "▼"} ${Math.abs(incVsAvg).toFixed(1)}% vs. ${prevMonths.length}M ant.` : "= média anterior") : "sem histórico",
          subColor: incVsAvg >= 0 ? "var(--pos)" : "var(--neg)",
        },
        {
          l: "Despesas", v: fmtBRL(totalExp), c: "var(--neg)",
          sub: prevMonths.length ? (expVsAvg !== 0 ? `${expVsAvg >= 0 ? "▲" : "▼"} ${Math.abs(expVsAvg).toFixed(1)}% vs. ${prevMonths.length}M ant.` : "= média anterior") : "sem histórico",
          subColor: expVsAvg >= 0 ? "var(--neg)" : "var(--pos)",
        },
        {
          l: "Saldo do mês", v: `${net >= 0 ? "+" : "−"}${fmtBRL(Math.abs(net))}`, c: net >= 0 ? "var(--pos)" : "var(--neg)",
          sub: `${monthTx.length} lançamentos`,
          subColor: "var(--fg-3)",
        },
        {
          l: "Taxa de poupança", v: `${savingsRate.toFixed(1)}%`, c: savingsRate >= 20 ? "var(--pos)" : savingsRate >= 0 ? "var(--warn)" : "var(--neg)",
          sub: savingsRate >= 20 ? "saudável" : savingsRate >= 0 ? "abaixo da meta" : "negativa",
          subColor: savingsRate >= 20 ? "var(--pos)" : savingsRate >= 0 ? "var(--warn)" : "var(--neg)",
        },
      ].map((s, i) =>
        h("div", { key: i, style: { padding: "14px 16px", paddingLeft: i === 0 ? 0 : 16, borderLeft: i === 0 ? "none" : "1px solid var(--line-1)" } },
          h("div", { className: "eyebrow" }, s.l),
          h("div", { className: "num", style: { fontSize: 24, fontWeight: 700, color: s.c, marginTop: 4, letterSpacing: "-0.02em" } }, s.v),
          h("div", { style: { marginTop: 6 } },
            h("span", { style: { fontSize: 10, color: s.subColor, fontWeight: 500 } }, s.sub)
          )
        )
      )
    ),

    // B2 — Fluxo de caixa (6 meses até o mês selecionado)
    h("div", { className: "pane" },
      h("div", { className: "pane-h" },
        h("div", { className: "pane-title" }, "Fluxo de caixa"),
        h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, `6 meses até ${monthLabel}`)
      ),
      h("div", { className: "pane-content" },
        h(DualLine, { data: monthly.slice(Math.max(0, pickedIdx - 5), pickedIdx + 1), height: 200 }))
    ),

    // B3 — Investimentos (resumo + donut + movimentos do mês)
    h(InvestmentsView, { refreshKey, filterMonth: picked ? `${picked.year}-${String(picked.month).padStart(2, "0")}` : "all" }),

    // Resumos do mês — Por categoria | Top PIX (lado a lado)
    h("div", { style: { display: "grid", gridTemplateColumns: pixTop.length > 0 ? "var(--col-2)" : "1fr", gap: 14, alignItems: "start" } },

        // C1a — By category
        h("div", { className: "pane" },
          h("div", { className: "pane-h" },
            h("div", { className: "pane-title" }, "Por categoria"),
            h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, `${byCat.length} categorias`)
          ),
          h("div", { className: "pane-content" },
            byCat.length === 0
              ? h("div", { style: { padding: 20, textAlign: "center", color: "var(--fg-3)", fontSize: 11 } }, "Sem despesas neste mês")
              : byCat.map((c, i) => {
                  const pct = totalExp > 0 ? (c.total / totalExp) * 100 : 0;
                  const barW = byCat[0]?.total > 0 ? (c.total / byCat[0].total) * 100 : 0;
                  const barColor = i === 0 ? "var(--neg)" : i === 1 ? "oklch(72% 0.13 30)" : "var(--info)";
                  return h("div", { key: i, style: { marginBottom: 10 } },
                    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, marginBottom: 3, gap: 6 } },
                      h("span", { style: { color: "var(--fg-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name),
                      h("span", { className: "num", style: { fontWeight: 600, flexShrink: 0 } },
                        fmtBRL(c.total),
                        h("span", { style: { color: "var(--fg-3)", fontWeight: 400, marginLeft: 5, fontSize: 10 } }, `${pct.toFixed(0)}%`)
                      )
                    ),
                    h("div", { style: { height: 5, background: "var(--bg-2)", borderRadius: 999 } },
                      h("div", { style: { width: `${barW}%`, height: "100%", background: barColor, borderRadius: 999 } })
                    )
                  );
                })
          )
        ),

        // C1b — Top PIX destinations (only when there are PIX expenses in the selected month)
        pixTop.length > 0 && h("div", { className: "pane" },
          h("div", { className: "pane-h" },
            h("div", { className: "pane-title" }, "Top PIX"),
            h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, `${pixTop.length} destinatários`)
          ),
          h("div", { className: "pane-content" },
            pixTop.map((p, i) => h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 11 } },
              h("span", { style: { color: "var(--fg-3)", fontFamily: "var(--ff-mono)", width: 14, textAlign: "right", flexShrink: 0 } }, `${i + 1}`),
              h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-1)" } }, p.label),
              h("span", { style: { color: "var(--fg-3)", fontSize: 10, flexShrink: 0 } }, `${p.count}×`),
              h("span", { className: "num", style: { fontWeight: 600, flexShrink: 0 } }, fmtBRL(p.total))
            ))
          )
        )
      ), // end resumos row

    // Tabela — largura total
    h("div", { className: "pane", style: { display: "flex", flexDirection: "column" } },
        h("div", { className: "pane-h" },
          h("div", { className: "pane-title" }, `Transações · ${filteredTx.length}`)
        ),
        h("div", { style: { padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line-1)", background: "var(--bg-1)" } },
          h("div", { style: { display: "flex", gap: 2, padding: 2, background: "var(--bg-2)", borderRadius: 5, border: "1px solid var(--line-2)" } },
            [["all", "Tudo"], ["expense", "Despesas"], ["income", "Receitas"]].map(([k, l]) =>
              h("button", { key: k, onClick: () => { setFilterFlow(k); if (k === "income") setFilterMethod("all"); }, style: {
                padding: "4px 10px", fontSize: 10, borderRadius: 4,
                background: filterFlow === k ? "var(--fg-2)" : "transparent",
                color: filterFlow === k ? "var(--bg-0)" : "var(--fg-2)",
                fontWeight: filterFlow === k ? 700 : 500,
                transition: "all 0.1s"
              } }, l)
            )
          ),
          h("div", { style: { display: "flex", gap: 2, padding: 2, background: "var(--bg-2)", borderRadius: 5, border: "1px solid var(--line-2)" } },
            [["all", "Método"], ["pix", "PIX"], ["credit", "Crédito"], ["ted", "TED"]].map(([k, l]) =>
              h("button", { key: k, onClick: () => setFilterMethod(k), style: {
                padding: "4px 10px", fontSize: 10, borderRadius: 4,
                background: filterMethod === k ? "var(--fg-2)" : "transparent",
                color: filterMethod === k ? "var(--bg-0)" : "var(--fg-2)",
                fontWeight: filterMethod === k ? 700 : 500,
                transition: "all 0.1s"
              } }, l)
            )
          ),
          h("select", {
            value: filterCat, onChange: e => setFilterCat(e.target.value),
            className: "select", style: { height: 28, fontSize: 11, padding: "0 24px 0 8px", width: "auto", borderRadius: 4 }
          },
            h("option", { value: "all" }, "Todas categorias"),
            cats.map(c => h("option", { key: c, value: c }, c))
          ),
          h("select", {
            value: filterAccount, onChange: e => setFilterAccount(e.target.value),
            className: "select", style: { height: 28, fontSize: 11, padding: "0 24px 0 8px", width: "auto", borderRadius: 4 }
          },
            h("option", { value: "all" }, "Todas contas"),
            acctIds.map(id => h("option", { key: id, value: id }, acctNames[id] || id))
          ),
          h("input", {
            value: search, onChange: e => setSearch(e.target.value),
            placeholder: "Buscar…", className: "input",
            style: { height: 28, fontSize: 11, padding: "0 10px", width: 140, borderRadius: 4 },
          }),
          hasFilter && h("button", {
            onClick: () => { setFilterFlow("all"); setFilterMethod("all"); setFilterCat("all"); setFilterAccount("all"); setSearch(""); },
            className: "btn btn-ghost", style: { height: 28, padding: "0 10px", fontSize: 10 },
          }, "Limpar"),
          h("div", { style: { flex: 1 } }),
          h("span", { style: { fontSize: 12, color: "var(--fg-2)", fontFamily: "var(--ff-mono)", display: "flex", gap: 12, alignItems: "center" } },
            h("span", { style: { color: "var(--pos)", fontWeight: 500 } }, `+${fmtBRL(filtInc, { decimals: 0 })}`),
            h("span", { style: { color: "var(--neg)", fontWeight: 500 } }, `−${fmtBRL(filtExp, { decimals: 0 })}`),
            h("div", { style: { width: 1, height: 12, background: "var(--line-2)" } }),
            h("span", { style: { color: (filtInc - filtExp) >= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 700 } },
              (filtInc - filtExp) >= 0 ? "+" : "−", fmtBRL(Math.abs(filtInc - filtExp), { decimals: 0 })
            )
          )
        ),
        h("div", { style: { display: "flex", flexDirection: "column" } },
          h("table", { className: "grid-table" },
            h("thead", null, h("tr", null,
              h("th", { style: { width: 70 } }, "Data"),
              h("th", null, "Descrição"),
              h("th", { style: { width: 110 } }, "Categoria"),
              h("th", { style: { width: 100 } }, "Conta"),
              h("th", { style: { textAlign: "right", width: 100 } }, "Valor")
            )),
            h("tbody", null,
              filteredTx.length === 0 && h("tr", null, h("td", { colSpan: 5, style: { textAlign: "center", padding: 30, color: "var(--fg-3)" } }, "Nenhuma transação.")),
              ...filteredTx.map(t => h(window.BS.TxRow, {
                key: t.id, t, cols: ["date", "desc", "cat", "account", "amount"],
                onEditCategory
              }))
            )
          )
        )
      )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { InvestmentsView, HistoryView });
