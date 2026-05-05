/* view-overview.js — OverviewView */
/* global React, fetchSummary, fetchMonthly, fetchCategories, fetchFaturas,
          fetchPatrimonioHistory, fetchDailySpend, fetchRecentActivity, fetchBudgets,
          patchBudget */

const { useState: _ovSt, useEffect: _ovEf } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, Sparkline, BarChart, DualLine, Progress } = window.BS;

const PT_MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function OverviewView({ onJumpToAccount, onEditCategory, refreshKey }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  const [summary, setSummary]     = _ovSt(null);
  const [monthly, setMonthly]     = _ovSt([]);
  const [categories, setCategories] = _ovSt([]);
  const [faturas, setFaturas]     = _ovSt([]);
  const [patrimonio, setPatrimonio] = _ovSt([]);
  const [dailySpend, setDailySpend] = _ovSt([]);
  const [activity, setActivity]   = _ovSt([]);
  const [budgets, setBudgets]     = _ovSt([]);
  const [editBudget, setEditBudget] = _ovSt(null); // {id, category_id, category_name, amount_limit}
  const [budgetInput, setBudgetInput] = _ovSt("");

  _ovEf(() => {
    Promise.all([
      fetchSummary(), fetchMonthly(), fetchCategories(), fetchFaturas(),
      fetchPatrimonioHistory(), fetchDailySpend(), fetchRecentActivity(), fetchBudgets(),
    ]).then(([s, m, c, f, p, d, a, b]) => {
      setSummary(s); setMonthly(m); setCategories(c); setFaturas(f);
      setPatrimonio(p); setDailySpend(d); setActivity(a); setBudgets(b);
    });
  }, [refreshKey]);

  if (!summary) return h("div", { style: { padding: 24, color: "var(--fg-2)" } }, "Carregando…");

  const totalFaturas = faturas.reduce((s, f) => s + (f.total || 0), 0);
  const patrNow  = patrimonio.length ? patrimonio[patrimonio.length - 1].value : 0;
  const patrPrev = patrimonio.length > 1 ? patrimonio[patrimonio.length - 2].value : patrNow;
  const patrTrend = patrPrev ? ((patrNow - patrPrev) / patrPrev) * 100 : 0;
  const dailyAvg = summary.expenses / (new Date().getDate() || 1);
  const projected = dailyAvg * 31;
  const catMax = categories.length ? categories[0].total : 1;

  // Patrimônio breakdown rows
  const totalChecking = summary.balance + summary.expenses - summary.income; // approx from summary
  const totalReservas = summary.reservas;

  function BreakdownRow({ label, value, pct, color, negative }) {
    return h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 } },
        h("span", { style: { fontSize: 11, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 } }, label),
        h("span", { className: "num", style: { fontWeight: 600, fontSize: 14, color: negative ? "var(--neg)" : "var(--fg-0)" } },
          negative && "−", fmtBRL(Math.abs(value)))
      ),
      h(Progress, { value: Math.min(Math.abs(value), Math.abs(patrNow)), max: Math.abs(patrNow), color }),
      h("div", { style: { fontSize: 9, color: "var(--fg-3)", marginTop: 2, fontFamily: "var(--ff-mono)" } }, `${Math.abs(pct).toFixed(1)}% do total`)
    );
  }

  async function saveBudget() {
    if (!editBudget) return;
    const val = parseFloat(budgetInput.replace(",", "."));
    if (isNaN(val) || val < 0) return;
    await patchBudget(editBudget.id, editBudget.category_id, val);
    setBudgets(prev => prev.map(b => b.id === editBudget.id ? { ...b, amount_limit: val } : b));
    setEditBudget(null);
  }

  // Compute spent per category from current categories data, joined with budgets
  const budgetRows = budgets.map(b => {
    const cat = categories.find(c => c.name === b.category_name);
    return { ...b, spent: cat ? cat.total : 0 };
  }).filter(b => b.amount_limit > 0);

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    // Hero: patrimônio + breakdown
    h("div", { className: "card", style: { padding: 16, display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 } },
      h("div", null,
        h("div", { className: "eyebrow", style: { marginBottom: 4 } }, "Patrimônio total"),
        h("div", { style: { display: "flex", alignItems: "baseline", gap: 12 } },
          h("div", { className: "num", style: { fontSize: 38, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" } }, fmtBRL(patrNow)),
          h("div", { style: { display: "flex", alignItems: "center", gap: 4, color: patrTrend >= 0 ? "var(--pos)" : "var(--neg)", fontFamily: "var(--ff-mono)", fontSize: 13 } },
            patrTrend >= 0 ? "▲" : "▼", " ", Math.abs(patrTrend).toFixed(1), "%",
            h("span", { style: { color: "var(--fg-3)" } }, " vs. mês passado")
          )
        ),
        h("div", { style: { marginTop: 14, height: 64 } },
          h(Sparkline, { data: patrimonio.map(p => p.value), width: 520, height: 64, color: "var(--info)", strokeWidth: 1.8 })
        ),
        patrimonio.length > 0 && h("div", { style: { display: "flex", justifyContent: "space-between", fontFamily: "var(--ff-mono)", fontSize: 9, color: "var(--fg-3)", marginTop: 4 } },
          patrimonio.filter((_, i) => i % Math.max(1, Math.floor(patrimonio.length / 6)) === 0).map((p, i) => h("span", { key: i }, p.label))
        )
      ),
      h("div", { style: { display: "flex", flexDirection: "column", gap: 12, borderLeft: "1px solid var(--line-1)", paddingLeft: 24 } },
        h(BreakdownRow, { label: "Saldo do mês", value: summary.balance, pct: (summary.balance / (patrNow || 1)) * 100, color: summary.balance >= 0 ? "var(--pos)" : "var(--neg)", negative: summary.balance < 0 }),
        h(BreakdownRow, { label: "Investimentos", value: totalReservas, pct: (totalReservas / (patrNow || 1)) * 100, color: "var(--reserve)" }),
        h(BreakdownRow, { label: "Faturas abertas", value: totalFaturas, pct: (totalFaturas / (patrNow || 1)) * 100, color: "var(--neg)", negative: true })
      )
    ),

    // Two-column: income vs expenses chart + categories
    h("div", { style: { display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 } },
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", null,
            h("div", { className: "card-title" }, "Receitas × Despesas"),
            h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2 } }, "Últimos 6 meses")
          ),
          h("div", { style: { display: "flex", gap: 12, fontSize: 10 } },
            h("span", { style: { display: "flex", alignItems: "center", gap: 4 } }, h("span", { style: { width: 8, height: 8, borderRadius: 2, background: "var(--pos)", display: "inline-block" } }), "Receita"),
            h("span", { style: { display: "flex", alignItems: "center", gap: 4 } }, h("span", { style: { width: 8, height: 8, borderRadius: 2, background: "var(--neg)", display: "inline-block" } }), "Despesa")
          )
        ),
        h("div", { style: { padding: 12 } }, h(DualLine, { data: monthly, height: 200 }))
      ),
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, "Top categorias"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, PT_MONTHS[summary.month])
        ),
        h("div", { style: { padding: "8px 12px 12px" } },
          (categories.length ? categories : []).slice(0, 7).map((c, i) =>
            h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: "var(--fz-7)" } },
              h("div", { style: { width: 4, height: 14, background: "var(--info)", borderRadius: 2 } }),
              h("div", { style: { flex: 1, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name),
              h("div", { style: { width: 80, height: 4, background: "var(--bg-2)", borderRadius: 999 } },
                h("div", { style: { width: `${(c.total / catMax) * 100}%`, height: "100%", background: "var(--info)", borderRadius: 999 } })
              ),
              h("div", { className: "num", style: { width: 70, textAlign: "right", color: "var(--fg-0)" } }, fmtBRL(c.total, { decimals: 0 }))
            )
          )
        )
      )
    ),

    // Three-column: daily spend + faturas + budgets
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 } },

      // Daily spend
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", null,
            h("div", { className: "card-title" }, "Gasto diário"),
            h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2 } }, `30 dias · média ${fmtBRL(dailyAvg, { decimals: 0 })}/dia`)
          ),
          h("div", { style: { fontFamily: "var(--ff-mono)", fontSize: 11, color: "var(--fg-2)" } }, `proj. ${fmtBRLCompact(projected)}`)
        ),
        h("div", { style: { padding: 10 } }, h(BarChart, { data: dailySpend, height: 120, valueKey: "value", labelKey: "day", color: "var(--info)" }))
      ),

      // Faturas
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, "Faturas em aberto"),
          h("span", { className: "num", style: { fontSize: 12, fontWeight: 600 } }, fmtBRL(totalFaturas))
        ),
        h("div", { style: { padding: 8, display: "flex", flexDirection: "column", gap: 6 } },
          faturas.map((f, i) => {
            const tone = f.days_until_due <= 3 ? "neg" : f.days_until_due <= 7 ? "warn" : "ok";
            const color = tone === "neg" ? "var(--neg)" : tone === "warn" ? "var(--warn)" : "var(--pos)";
            const due = f.days_until_due > 0 ? `em ${f.days_until_due}d` : f.days_until_due === 0 ? "hoje" : `há ${Math.abs(f.days_until_due)}d`;
            return h("button", {
              key: i, onClick: () => onJumpToAccount && onJumpToAccount(f.accountId),
              style: { display: "block", textAlign: "left", padding: 10, borderRadius: 6, background: "var(--bg-0)", border: `1px solid var(--line-1)`, borderLeft: `3px solid ${color}`, cursor: "pointer" }
            },
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
                h(BankChip, { bank: f.label.toLowerCase().startsWith("nu") ? "nubank" : "inter" }),
                h("span", { style: { fontSize: 10, color, fontWeight: 600 } }, `vence ${due}`)
              ),
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
                h("span", { className: "num", style: { fontSize: 17, fontWeight: 600 } }, fmtBRL(f.total)),
                h("span", { style: { fontSize: 10, fontFamily: "var(--ff-mono)", color: "var(--fg-3)" } }, `${f.cycle_start} – ${f.cycle_end}`)
              )
            );
          })
        )
      ),

      // Budgets
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, "Orçamentos"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, PT_MONTHS[summary.month])
        ),
        h("div", { style: { padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 6 } },
          budgetRows.slice(0, 6).map((b, i) => {
            const over = b.spent > b.amount_limit;
            if (editBudget?.id === b.id) {
              return h("div", { key: i },
                h("div", { style: { display: "flex", gap: 4, alignItems: "center", marginBottom: 2 } },
                  h("span", { style: { flex: 1, fontSize: 11, color: "var(--fg-1)" } }, b.category_name),
                  h("input", {
                    autoFocus: true, className: "input", value: budgetInput,
                    onChange: e => setBudgetInput(e.target.value),
                    onKeyDown: e => { if (e.key === "Enter") saveBudget(); if (e.key === "Escape") setEditBudget(null); },
                    style: { height: 24, padding: "0 6px", fontSize: 11, width: 80 }
                  }),
                  h("button", { className: "btn btn-primary btn-sm", onClick: saveBudget, style: { height: 24, padding: "0 8px" } }, "✓"),
                  h("button", { className: "btn btn-ghost btn-sm", onClick: () => setEditBudget(null), style: { height: 24 } }, "✕")
                ),
                h(Progress, { value: b.spent, max: b.amount_limit, color: "var(--info)" })
              );
            }
            return h("div", { key: i },
              h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3, cursor: "pointer" },
                onClick: () => { setEditBudget(b); setBudgetInput(b.amount_limit.toFixed(0)); }
              },
                h("span", { style: { color: "var(--fg-1)" } }, b.category_name),
                h("span", { className: "num", style: { color: over ? "var(--neg)" : "var(--fg-2)" } },
                  fmtBRL(b.spent, { decimals: 0 }), " / ", fmtBRL(b.amount_limit, { decimals: 0 }))
              ),
              h(Progress, { value: b.spent, max: b.amount_limit, color: "var(--info)" })
            );
          })
        )
      )
    ),

    // Recent activity
    h("div", { className: "card" },
      h("div", { className: "card-h" },
        h("div", { className: "card-title" }, "Atividade recente"),
        h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, `${activity.length} últimos lançamentos`)
      ),
      h("div", { style: { maxHeight: 320, overflowY: "auto" } },
        h("table", { className: "grid-table" },
          h("thead", null, h("tr", null,
            h("th", { style: { width: 70 } }, "Data"),
            h("th", null, "Descrição"),
            h("th", null, "Conta"),
            h("th", null, "Categoria"),
            h("th", { style: { textAlign: "right", width: 110 } }, "Valor")
          )),
          h("tbody", null,
            activity.map(t =>
              h("tr", { key: t.id },
                h("td", { className: "mono", style: { color: "var(--fg-2)" } }, fmtDateBR(t.date)),
                h("td", { style: { color: "var(--fg-0)" } }, t.description),
                h("td", null, h(BankChip, { accountId: t.account_id, bank: t.bank })),
                h("td", null,
                  t.flow === "expense"
                    ? h("button", { onClick: () => onEditCategory && onEditCategory(t), style: { fontSize: 10, color: "var(--fg-2)", borderBottom: "1px dashed var(--line-2)", paddingBottom: 1 } }, t.category || "—")
                    : h("span", { className: "chip pos" }, t.category || "—")
                ),
                h("td", { className: "num", style: { color: t.flow === "expense" ? "var(--neg)" : "var(--pos)", fontWeight: 600 } },
                  t.flow === "expense" ? "−" : "+", fmtBRL(t.amount))
              )
            )
          )
        )
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.OverviewView = OverviewView;
