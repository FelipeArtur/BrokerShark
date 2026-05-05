/* view-secondary.js — CardsView, AccountsView, InvestmentsView, HistoryView */
/* global React, fetchFaturas, fetchRecentTransactions, fetchMonthlyByAccount,
          fetchCategoriesByAccount, fetchAccounts, fetchMonthly, fetchInvestments,
          fetchAccountHistory */

const { useState: _s2St, useEffect: _s2Ef, useMemo: _s2Memo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, Sparkline, DualLine, Donut } = window.BS;

const PT_MONTHS_FULL = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const PT_SHORT = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/* ── CardsView ───────────────────────────────────────────────────────────── */
function CardsView({ onEditCategory, refreshKey }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [faturas, setFaturas] = _s2St([]);
  const [activeAcc, setActiveAcc] = _s2St("nu-cc");
  const [txs, setTxs] = _s2St([]);
  const [monthly, setMonthly] = _s2St([]);
  const [catData, setCatData] = _s2St([]);
  const [filterCat, setFilterCat] = _s2St("");
  const now = new Date();
  const [filterMonth, setFilterMonth] = _s2St(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);

  _s2Ef(() => { fetchFaturas().then(setFaturas); }, [refreshKey]);
  _s2Ef(() => {
    const [y, m] = filterMonth.split("-").map(Number);
    fetchRecentTransactions(activeAcc, { limit: 200, month: m, year: y }).then(setTxs);
    fetchMonthlyByAccount(activeAcc).then(setMonthly);
    fetchCategoriesByAccount(activeAcc).then(setCatData);
  }, [activeAcc, filterMonth, refreshKey]);

  const filteredTxs = filterCat ? txs.filter(t => t.category === filterCat) : txs;
  const cats = [...new Set(txs.map(t => t.category).filter(Boolean))].sort();
  const catMax = catData.length ? catData[0].total : 1;

  const months6 = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { v: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, d };
  });

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    // Fatura cards
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } },
      faturas.map(f => {
        const active = f.accountId === activeAcc;
        const tone = f.days_until_due <= 3 ? "neg" : f.days_until_due <= 7 ? "warn" : "ok";
        const toneColor = tone === "neg" ? "var(--neg)" : tone === "warn" ? "var(--warn)" : "var(--pos)";
        const isNu = (f.label || "").toLowerCase().includes("nubank");
        const bg = isNu
          ? "linear-gradient(135deg, oklch(40% 0.18 305), oklch(28% 0.12 305))"
          : "linear-gradient(135deg, oklch(60% 0.16 55), oklch(48% 0.13 55))";
        const due = f.days_until_due > 0 ? `vence ${f.days_until_due}d` : f.days_until_due === 0 ? "vence hoje" : `vencida`;
        return h("button", {
          key: f.accountId,
          onClick: () => setActiveAcc(f.accountId),
          style: {
            display: "block", textAlign: "left", padding: 18,
            background: bg, borderRadius: 10,
            border: active ? "2px solid var(--fg-0)" : "2px solid transparent",
            color: "white", position: "relative", overflow: "hidden", cursor: "pointer",
            transition: "transform 0.15s, border-color 0.15s",
            transform: active ? "translateY(-1px)" : "none",
          }
        },
          h("div", { style: { position: "absolute", top: -40, right: -40, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.06)" } }),
          h("div", { style: { position: "relative" } },
            h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 } },
              h("div", null,
                h("div", { style: { fontSize: 10, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 } }, f.label),
                h("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 2 } }, `Ciclo ${f.cycle_start} – ${f.cycle_end}`)
              ),
              h("div", { style: { fontSize: 9, padding: "3px 7px", borderRadius: 4, background: "rgba(255,255,255,0.18)", fontWeight: 600, textTransform: "uppercase" } }, due)
            ),
            h("div", { className: "num", style: { fontSize: 32, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" } }, fmtBRL(f.total)),
            h("div", { style: { display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 11 } },
              h("div", null,
                h("div", { style: { opacity: 0.7, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" } }, "Vencimento"),
                h("div", { className: "num", style: { fontWeight: 600 } }, f.due_date)
              ),
              h("div", { style: { textAlign: "right" } },
                h("div", { style: { opacity: 0.7, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" } }, "Dias restantes"),
                h("div", { className: "num", style: { fontWeight: 600, color: toneColor } }, `${f.days_until_due}d`)
              )
            )
          )
        );
      })
    ),

    // Transactions + chart
    h("div", { style: { display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14 } },
      h("div", { className: "card", style: { display: "flex", flexDirection: "column" } },
        h("div", { className: "card-h" },
          h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            h("div", { className: "card-title" }, "Lançamentos"),
            h(BankChip, { accountId: activeAcc }),
            h("span", { style: { fontSize: 10, color: "var(--fg-2)" } }, `· ${filteredTxs.length} itens`)
          ),
          h("div", { style: { display: "flex", gap: 6 } },
            h("select", {
              className: "select", value: filterMonth, onChange: e => setFilterMonth(e.target.value),
              style: { height: 26, padding: "0 8px", fontSize: 11, width: "auto" }
            },
              months6.map(({ v, d }) => h("option", { key: v, value: v }, `${PT_MONTHS_FULL[d.getMonth() + 1]} ${d.getFullYear()}`))
            ),
            h("select", {
              className: "select", value: filterCat, onChange: e => setFilterCat(e.target.value),
              style: { height: 26, padding: "0 8px", fontSize: 11, width: "auto" }
            },
              h("option", { value: "" }, "Todas categorias"),
              cats.map(c => h("option", { key: c, value: c }, c))
            )
          )
        ),
        h("div", { style: { overflowY: "auto", maxHeight: 460 } },
          h("table", { className: "grid-table" },
            h("thead", null, h("tr", null,
              h("th", { style: { width: 60 } }, "Data"), h("th", null, "Descrição"),
              h("th", null, "Categoria"), h("th", { style: { textAlign: "right", width: 110 } }, "Valor")
            )),
            h("tbody", null, filteredTxs.map(t =>
              h("tr", { key: t.id },
                h("td", { className: "mono", style: { color: "var(--fg-2)" } }, fmtDateBR(t.date)),
                h("td", null, t.description),
                h("td", null,
                  h("button", { onClick: () => onEditCategory && onEditCategory(t), style: { fontSize: 10, color: "var(--fg-2)", borderBottom: "1px dashed var(--line-2)", paddingBottom: 1 } }, t.category || "—")
                ),
                h("td", { className: "num", style: { color: t.flow === "expense" ? "var(--neg)" : "var(--pos)", fontWeight: 600 } },
                  t.flow === "expense" ? "−" : "+", fmtBRL(t.amount))
              )
            ))
          )
        )
      ),
      h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
        h("div", { className: "card" },
          h("div", { className: "card-h" }, h("div", { className: "card-title" }, "Evolução da fatura")),
          h("div", { style: { padding: 12 } }, h(DualLine, { data: monthly, height: 180 }))
        ),
        h("div", { className: "card" },
          h("div", { className: "card-h" }, h("div", { className: "card-title" }, "Categorias do cartão")),
          h("div", { style: { padding: 12 } },
            catData.slice(0, 6).map((c, i) =>
              h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 11 } },
                h("div", { style: { flex: 1, color: "var(--fg-1)" } }, c.name),
                h("div", { style: { width: 80, height: 4, background: "var(--bg-2)", borderRadius: 999 } },
                  h("div", { style: { width: `${(c.total / catMax) * 100}%`, height: "100%", background: "var(--info)", borderRadius: 999 } })
                ),
                h("div", { className: "num", style: { width: 70, textAlign: "right" } }, fmtBRL(c.total, { decimals: 0 }))
              )
            )
          )
        )
      )
    )
  );
}

/* ── AccountsView ────────────────────────────────────────────────────────── */
function AccountsView({ onEditCategory, refreshKey }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [accounts, setAccounts] = _s2St([]);
  const [activeAcc, setActiveAcc] = _s2St("nu-db");
  const [txs, setTxs] = _s2St([]);

  _s2Ef(() => {
    fetchAccounts().then(all => {
      const checking = all.filter(a => a.type === "checking");
      setAccounts(checking);
    });
  }, [refreshKey]);

  _s2Ef(() => {
    if (!activeAcc) return;
    fetchRecentTransactions(activeAcc, { limit: 100 }).then(setTxs);
  }, [activeAcc, refreshKey]);

  const monthIncome = txs.filter(t => t.flow === "income").reduce((s, t) => s + t.amount, 0);
  const monthExp    = txs.filter(t => t.flow === "expense").reduce((s, t) => s + t.amount, 0);

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    h("div", { style: { display: "grid", gridTemplateColumns: `repeat(${accounts.length || 2}, 1fr)`, gap: 14 } },
      accounts.map(a =>
        h("button", {
          key: a.id, onClick: () => setActiveAcc(a.id), className: "card",
          style: { padding: 16, textAlign: "left", cursor: "pointer", borderColor: a.id === activeAcc ? "var(--info)" : "var(--line-1)", background: a.id === activeAcc ? "var(--bg-2)" : "var(--bg-1)", transition: "all 0.15s" }
        },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
            h("div", null,
              h(BankChip, { accountId: a.id }),
              h("div", { className: "num", style: { fontSize: 24, fontWeight: 700, marginTop: 8, color: a.balance >= 0 ? "var(--fg-0)" : "var(--neg)" } }, fmtBRL(a.balance)),
              h("div", { style: { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 } }, "Saldo disponível")
            )
          ),
          h("div", { style: { display: "flex", gap: 14, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line-1)" } },
            h("div", null,
              h("div", { style: { fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Entradas"),
              h("div", { className: "num", style: { fontSize: 13, color: "var(--pos)", fontWeight: 600 } }, `+${fmtBRL(txs.filter(t => t.flow === "income" && t.account_id === a.id).reduce((s, t) => s + t.amount, 0), { decimals: 0 })}`)
            ),
            h("div", null,
              h("div", { style: { fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Saídas"),
              h("div", { className: "num", style: { fontSize: 13, color: "var(--neg)", fontWeight: 600 } }, `−${fmtBRL(txs.filter(t => t.flow === "expense" && t.account_id === a.id).reduce((s, t) => s + t.amount, 0), { decimals: 0 })}`)
            )
          )
        )
      )
    ),

    h("div", { className: "card", style: { display: "flex", flexDirection: "column" } },
      h("div", { className: "card-h" },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
          h("div", { className: "card-title" }, "Extrato"), h(BankChip, { accountId: activeAcc })
        ),
        h("span", { style: { fontSize: 11, color: "var(--fg-2)", fontFamily: "var(--ff-mono)" } },
          h("span", { style: { color: "var(--pos)" } }, `+${fmtBRL(monthIncome, { decimals: 0 })}`), " · ",
          h("span", { style: { color: "var(--neg)" } }, `−${fmtBRL(monthExp, { decimals: 0 })}`), " · ",
          h("span", { style: { color: "var(--fg-0)" } }, fmtBRL(monthIncome - monthExp))
        )
      ),
      h("div", { style: { maxHeight: 480, overflowY: "auto" } },
        h("table", { className: "grid-table" },
          h("thead", null, h("tr", null,
            h("th", { style: { width: 70 } }, "Data"), h("th", null, "Descrição"),
            h("th", null, "Categoria"), h("th", { style: { textAlign: "right", width: 110 } }, "Valor")
          )),
          h("tbody", null, txs.map(t =>
            h("tr", { key: t.id },
              h("td", { className: "mono", style: { color: "var(--fg-2)" } }, fmtDateBR(t.date)),
              h("td", null, t.description),
              h("td", null,
                t.flow === "expense"
                  ? h("button", { onClick: () => onEditCategory && onEditCategory(t), style: { fontSize: 10, color: "var(--fg-2)", borderBottom: "1px dashed var(--line-2)" } }, t.category || "—")
                  : h("span", { className: "chip pos" }, t.category || "Receita")
              ),
              h("td", { className: "num", style: { color: t.flow === "expense" ? "var(--neg)" : "var(--pos)", fontWeight: 600 } },
                t.flow === "expense" ? "−" : "+", fmtBRL(t.amount))
            )
          ))
        )
      )
    )
  );
}

/* ── InvestmentsView ─────────────────────────────────────────────────────── */
function InvestmentsView({ refreshKey }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [investments, setInvestments] = _s2St([]);

  _s2Ef(() => { fetchInvestments().then(setInvestments); }, [refreshKey]);

  const total = investments.reduce((s, i) => s + (i.balance || i.current_balance || 0), 0);
  const COLORS = ["oklch(72% 0.12 290)", "oklch(72% 0.13 230)", "oklch(72% 0.14 155)"];
  const donutData = investments.map(i => ({ ...i, balance: i.balance || i.current_balance || 0 }));

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14 } },
      h("div", { className: "card", style: { padding: 16 } },
        h("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Patrimônio em investimentos"),
        h("div", { className: "num", style: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" } }, fmtBRL(total)),
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", marginTop: 18 } },
          h(Donut, { data: donutData, size: 200, thickness: 28, valueKey: "balance", colors: COLORS })
        ),
        h("div", { style: { marginTop: 16, display: "flex", flexDirection: "column", gap: 6 } },
          investments.map((inv, i) => {
            const bal = inv.balance || inv.current_balance || 0;
            const pct = total ? (bal / total) * 100 : 0;
            return h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11 } },
              h("span", { style: { width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length], display: "inline-block" } }),
              h("span", { style: { flex: 1, color: "var(--fg-1)" } }, inv.name),
              h("span", { className: "num", style: { color: "var(--fg-2)" } }, pct.toFixed(1), "%"),
              h("span", { className: "num", style: { width: 90, textAlign: "right", fontWeight: 600 } }, fmtBRL(bal, { decimals: 0 }))
            );
          })
        )
      ),
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, "Investimentos"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, "saldo atual")
        ),
        h("div", { style: { padding: 14, display: "flex", flexDirection: "column", gap: 14 } },
          investments.map((inv, i) => {
            const bal = inv.balance || inv.current_balance || 0;
            return h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 14, padding: "10px 12px", background: "var(--bg-0)", border: "1px solid var(--line-1)", borderRadius: 6 } },
              h("div", { style: { flex: 1 } },
                h("div", { style: { fontWeight: 600, fontSize: 13 } }, inv.name),
                h(BankChip, { bank: inv.bank })
              ),
              h("div", { style: { textAlign: "right" } },
                h("div", { className: "num", style: { fontSize: 18, fontWeight: 700 } }, fmtBRL(bal)),
                h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2 } }, inv.type === "savings" ? "Poupança" : "Tesouro")
              )
            );
          })
        )
      )
    )
  );
}

/* ── HistoryView ─────────────────────────────────────────────────────────── */
function HistoryView({ refreshKey }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [bank, setBank] = _s2St("all");
  const [monthly, setMonthly] = _s2St([]);

  _s2Ef(() => {
    const b = bank === "all" ? undefined : bank;
    fetchMonthly(b).then(setMonthly);
  }, [bank, refreshKey]);

  const totalIn  = monthly.reduce((s, d) => s + d.income, 0);
  const totalEx  = monthly.reduce((s, d) => s + d.expenses, 0);
  const now = new Date();

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    h("div", { className: "card" },
      h("div", { className: "card-h" },
        h("div", { className: "card-title" }, "Histórico — receitas × despesas"),
        h("div", { style: { display: "flex", gap: 4, padding: 3, background: "var(--bg-0)", borderRadius: 6, border: "1px solid var(--line-1)" } },
          [["all", "Todos"], ["nubank", "Nubank"], ["inter", "Inter"]].map(([k, l]) =>
            h("button", {
              key: k, onClick: () => setBank(k),
              style: {
                padding: "4px 12px", fontSize: 11, borderRadius: 4,
                background: bank === k ? "var(--bg-2)" : "transparent",
                color: bank === k ? "var(--fg-0)" : "var(--fg-2)",
                fontWeight: bank === k ? 600 : 500,
                border: bank === k ? "1px solid var(--line-2)" : "1px solid transparent",
              }
            }, l)
          )
        )
      ),
      h("div", { style: { padding: 14 } },
        h(DualLine, { data: monthly, height: 240 }),
        h("div", { style: { display: "flex", gap: 24, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line-1)", fontSize: 11 } },
          [
            { label: "Total receitas", value: fmtBRL(totalIn), color: "var(--pos)" },
            { label: "Total despesas", value: fmtBRL(totalEx), color: "var(--neg)" },
            { label: "Saldo acumulado", value: fmtBRL(totalIn - totalEx, { sign: "always" }), color: (totalIn - totalEx) >= 0 ? "var(--pos)" : "var(--neg)" },
            { label: "Taxa de poupança", value: totalIn ? `${((totalIn - totalEx) / totalIn * 100).toFixed(1)}%` : "—", color: "var(--reserve)" },
          ].map((item, i) =>
            h("div", { key: i },
              h("span", { className: "muted", style: { textTransform: "uppercase", fontSize: 9, letterSpacing: "0.06em", display: "block" } }, item.label),
              h("div", { className: "num", style: { fontSize: 16, fontWeight: 600, color: item.color } }, item.value)
            )
          )
        )
      )
    ),

    h("div", { className: "card" },
      h("div", { className: "card-h" }, h("div", { className: "card-title" }, "Mês a mês")),
      h("table", { className: "grid-table" },
        h("thead", null, h("tr", null,
          h("th", null, "Mês"),
          h("th", { style: { textAlign: "right" } }, "Receitas"),
          h("th", { style: { textAlign: "right" } }, "Despesas"),
          h("th", { style: { textAlign: "right" } }, "Saldo"),
          h("th", { style: { textAlign: "right" } }, "% poupado"),
          h("th", { style: { width: 160 } }, "Distribuição")
        )),
        h("tbody", null,
          [...monthly].reverse().map((d, i) => {
            const net = d.income - d.expenses;
            const sav = d.income > 0 ? (net / d.income) * 100 : 0;
            const isCur = d.year === now.getFullYear() && d.month === (now.getMonth() + 1);
            return h("tr", { key: i, className: isCur ? "row-active" : "" },
              h("td", { style: { fontWeight: isCur ? 600 : 500 } },
                d.label || `${PT_MONTHS_FULL[d.month]} ${d.year}`,
                isCur && h("span", { className: "chip info", style: { marginLeft: 6, padding: "1px 5px", fontSize: 9 } }, "atual")
              ),
              h("td", { className: "num", style: { color: "var(--pos)", fontWeight: 600 } }, fmtBRL(d.income, { decimals: 0 })),
              h("td", { className: "num", style: { color: "var(--neg)", fontWeight: 600 } }, fmtBRL(d.expenses, { decimals: 0 })),
              h("td", { className: "num", style: { color: net >= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 700 } },
                net >= 0 ? "+" : "−", fmtBRL(Math.abs(net), { decimals: 0 })),
              h("td", { className: "num", style: { color: sav >= 20 ? "var(--pos)" : sav >= 0 ? "var(--warn)" : "var(--neg)" } }, sav.toFixed(0), "%"),
              h("td", null,
                h("div", { style: { display: "flex", gap: 1, height: 12, borderRadius: 3, overflow: "hidden" } },
                  h("div", { style: { flex: d.income, background: "var(--pos)", opacity: 0.6 } }),
                  h("div", { style: { flex: d.expenses, background: "var(--neg)", opacity: 0.6 } })
                )
              )
            );
          })
        )
      )
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { CardsView, AccountsView, InvestmentsView, HistoryView });
