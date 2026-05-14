/* view-overview.js — OverviewView + CategoriesPanel */
/* global React, fetchSummary, fetchMonthly, fetchCategories, fetchFaturas,
          fetchPatrimonioHistory, fetchDailySpend, fetchRecentActivity, fetchBudgets,
          fetchExpenseCategoriesFull, patchBudget, postCategory, deleteCategory */

const { useState: _ovSt, useEffect: _ovEf, useMemo: _ovMemo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, Sparkline, BarChart, DualLine, Progress, Modal, PT_MONTHS, PT_SHORT, fmtCycleDate } = window.BS;

function OverviewView({ onJumpToAccount, onEditCategory, onDeleteTx, refreshKey, filterMonth }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  const isAllPeriod = filterMonth === "all";

  const [summary, setSummary]       = _ovSt(null);
  const [monthly, setMonthly]       = _ovSt([]);
  const [categories, setCategories] = _ovSt([]);
  const [faturas, setFaturas]       = _ovSt([]);
  const [patrimonio, setPatrimonio] = _ovSt([]);
  const [dailySpend, setDailySpend] = _ovSt([]);
  const [activity, setActivity]     = _ovSt([]);
  const [budgets, setBudgets]       = _ovSt([]);
  const [editBudget, setEditBudget] = _ovSt(null);
  const [budgetInput, setBudgetInput] = _ovSt("");
  const [budgetErr, setBudgetErr]   = _ovSt(null);
  const [deletingTxId, setDeletingTxId] = _ovSt(null);

  _ovEf(() => {
    const parts = (!isAllPeriod && filterMonth) ? filterMonth.split("-").map(Number) : [];
    const [year, month] = parts.length === 2 ? parts : [null, null];
    const monthlyFetch = isAllPeriod ? fetchMonthlyFull() : fetchMonthly();
    Promise.all([
      isAllPeriod ? fetchSummary({ period: "all" }) : fetchSummary({ month, year }),
      monthlyFetch,
      isAllPeriod ? fetchCategories({ period: "all" }) : fetchCategories({ month, year }),
      fetchFaturas(),
      fetchPatrimonioHistory(),
      isAllPeriod ? Promise.resolve([]) : fetchDailySpend({ month, year }),
      fetchRecentActivity(),
      fetchBudgets(),
    ]).then(([s, m, c, f, p, d, a, b]) => {
      setSummary(s); setMonthly(m); setCategories(c); setFaturas(f);
      setPatrimonio(p); setDailySpend(d); setActivity(a); setBudgets(b);
    });
  }, [refreshKey, filterMonth]);

  if (!summary) return h("div", { style: { padding: 24, color: "var(--fg-2)" } }, "Carregando…");

  const totalFaturas = faturas.reduce((s, f) => s + (f.total || 0), 0);
  // Find patrimônio entry for the selected month
  const _parts = (!isAllPeriod && filterMonth) ? filterMonth.split("-").map(Number) : [];
  const [_fYear, _fMonth] = _parts.length === 2 ? _parts : [null, null];
  const _patrLabel = _fMonth ? `${PT_SHORT[_fMonth]}/${String(_fYear).slice(-2)}` : null;
  const _patrIdx = _patrLabel
    ? patrimonio.findIndex(p => p.label === _patrLabel)
    : patrimonio.length - 1;
  const _effIdx  = _patrIdx >= 0 ? _patrIdx : patrimonio.length - 1;
  const patrNow   = _effIdx >= 0 ? patrimonio[_effIdx].value : 0;

  // Daily average: use elapsed days for current month, full month for past months
  const _now = new Date();
  const _isCurrentMonth = _fYear === _now.getFullYear() && _fMonth === _now.getMonth() + 1;
  const _daysElapsed = _isCurrentMonth
    ? (_now.getDate() || 1)
    : (_fYear && _fMonth ? new Date(_fYear, _fMonth, 0).getDate() : _now.getDate() || 1);
  const _expenses = isAllPeriod ? (summary.avg_expenses || 0) : (summary.expenses || 0);
  const _income   = isAllPeriod ? (summary.avg_income   || 0) : (summary.income   || 0);
  const dailyAvg  = isAllPeriod ? (_expenses / 30) : (_expenses / _daysElapsed);
  const projected = dailyAvg * (_fYear && _fMonth ? new Date(_fYear, _fMonth, 0).getDate() : 31);
  const catMax        = categories.length ? categories[0].total : 1;
  const totalReservas = summary.reservas || 0;

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
    if (isNaN(val) || val < 0) { setBudgetErr("Valor inválido."); return; }
    setBudgetErr(null);
    try {
      await patchBudget(editBudget.id, editBudget.category_id, val);
      setBudgets(prev => prev.map(b => b.id === editBudget.id ? { ...b, amount_limit: val } : b));
      setEditBudget(null);
    } catch (e) {
      setBudgetErr(e.message || "Erro ao salvar orçamento.");
    }
  }

  // Compute spent per category from current categories data, joined with budgets
  const budgetRows = budgets.map(b => {
    const cat = categories.find(c => c.name === b.category_name);
    return { ...b, spent: cat ? cat.total : 0 };
  }).filter(b => b.amount_limit > 0);

  // Patrimônio breakdown: contas = patrNow − investimentos + faturas
  const totalContas = patrNow - totalReservas + totalFaturas;

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    // Hero: patrimônio — 2-column card (sparkline left, breakdown right)
    h("div", { className: "card", style: { padding: 16, display: "grid", gridTemplateColumns: "var(--col-hero)", gap: 24 } },
      // Left: value + sparkline (no % delta)
      h("div", null,
        h("div", { className: "eyebrow", style: { marginBottom: 4 } }, "Patrimônio total"),
        h("div", { className: "num", style: { fontSize: 38, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em" } }, fmtBRL(patrNow)),
        h("div", { style: { marginTop: 14, height: 64 } },
          h(Sparkline, { data: patrimonio.map(p => p.value), width: "100%", height: 64, color: "var(--info)", strokeWidth: 1.8 })
        ),
        h("div", { style: { display: "flex", justifyContent: "space-between", fontFamily: "var(--ff-mono)", fontSize: 9, color: "var(--fg-3)", marginTop: 4 } },
          patrimonio.filter((_, i) => i % 3 === 0).map((p, i) => h("span", { key: i }, p.label))
        )
      ),
      // Right: breakdown rows
      h("div", { className: "hero-right-col" },
        h(BreakdownRow, { label: "Contas correntes", value: totalContas, pct: patrNow ? (totalContas / patrNow) * 100 : 0, color: "var(--pos)" }),
        h(BreakdownRow, { label: "Investimentos",    value: totalReservas, pct: patrNow ? (totalReservas / patrNow) * 100 : 0, color: "var(--reserve)" }),
        h(BreakdownRow, { label: "Faturas em aberto", value: totalFaturas, pct: patrNow ? (totalFaturas / (totalContas + totalReservas)) * 100 : 0, color: "var(--neg)", negative: true })
      )
    ),

    // Two-column: income vs expenses chart + categories
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-asym)", gap: 14 } },
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", null,
            h("div", { className: "card-title" }, "Fluxo de caixa"),
            h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2 } },
              isAllPeriod ? `${monthly.length} meses registrados` : "Últimos 6 meses"
            )
          ),
          h("div", { style: { display: "flex", gap: 12, fontSize: 10 } },
            h("span", { style: { display: "flex", alignItems: "center", gap: 4 } },
              h("span", { style: { width: 8, height: 8, borderRadius: 2, background: "var(--pos)", display: "inline-block" } }), "Receita"),
            h("span", { style: { display: "flex", alignItems: "center", gap: 4 } },
              h("span", { style: { width: 8, height: 8, borderRadius: 2, background: "var(--neg)", display: "inline-block" } }), "Despesa")
          )
        ),
        (() => {
          const withData = monthly.filter(m => m.income > 0 || m.expenses > 0);
          const avgIncome   = isAllPeriod ? (summary.avg_income   || 0) : (withData.length ? withData.reduce((s, m) => s + m.income,   0) / withData.length : 0);
          const avgExpenses = isAllPeriod ? (summary.avg_expenses || 0) : (withData.length ? withData.reduce((s, m) => s + m.expenses, 0) / withData.length : 0);
          const salaryInc   = summary.salary_income || 0;
          const otherInc    = summary.other_income  || 0;
          return h("div", null,
            h("div", { style: { padding: "6px 12px 0", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" } },
              h("span", { style: { fontSize: 10, fontFamily: "var(--ff-mono)", color: "var(--fg-2)" } },
                "média receita ", h("span", { style: { color: "var(--pos)", fontWeight: 600 } }, fmtBRLCompact(avgIncome))
              ),
              h("span", { style: { fontSize: 10, fontFamily: "var(--ff-mono)", color: "var(--fg-2)" } },
                "média despesa ", h("span", { style: { color: "var(--neg)", fontWeight: 600 } }, fmtBRLCompact(avgExpenses))
              ),
              !isAllPeriod && (salaryInc > 0 || otherInc > 0) && h("span", { style: { display: "flex", gap: 10, borderLeft: "1px solid var(--line-1)", paddingLeft: 14 } },
                salaryInc > 0 && h("span", { style: { fontSize: 10, fontFamily: "var(--ff-mono)" } },
                  h("span", { style: { color: "var(--fg-3)" } }, "salário "),
                  h("span", { style: { color: "var(--pos)", fontWeight: 600 } }, fmtBRLCompact(salaryInc))
                ),
                otherInc > 0 && h("span", { style: { fontSize: 10, fontFamily: "var(--ff-mono)" } },
                  h("span", { style: { color: "var(--fg-3)" } }, "outros "),
                  h("span", { style: { color: "var(--pos)", fontWeight: 600 } }, fmtBRLCompact(otherInc))
                )
              )
            ),
            h("div", { style: { padding: 12 } }, h(DualLine, { data: monthly, height: 220 }))
          );
        })()
      ),
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, "Top categorias"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, isAllPeriod ? "Todo período" : PT_MONTHS[summary.month])
        ),
        h("div", { style: { padding: "8px 12px 12px" } },
          (categories.length ? categories : []).slice(0, 7).map((c, i) =>
            h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: "var(--fz-7)" } },
              h("div", { style: { width: 16, textAlign: "right", fontFamily: "var(--ff-mono)", fontSize: 10, color: "var(--fg-3)", flexShrink: 0 } }, i + 1),
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

    // Three-column (or two-column in all-time mode): daily spend + faturas + budgets
    h("div", { style: { display: "grid", gridTemplateColumns: isAllPeriod ? "var(--col-2)" : "var(--col-3)", gap: 14 } },

      // Daily spend — hidden in all-time mode
      !isAllPeriod && h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", null,
            h("div", { className: "card-title" }, "Gasto diário"),
            h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2 } },
              _fMonth
                ? `${PT_MONTHS[_fMonth]} ${_fYear} · média ${fmtBRL(dailyAvg, { decimals: 0 })}/dia`
                : `${PT_MONTHS[_now.getMonth() + 1]} · média ${fmtBRL(dailyAvg, { decimals: 0 })}/dia`
            )
          ),
          h("div", { style: { fontFamily: "var(--ff-mono)", fontSize: 11, color: "var(--fg-2)" } },
            _isCurrentMonth ? `proj. ${fmtBRLCompact(projected)}` : fmtBRL(_expenses, { decimals: 0 })
          )
        ),
        dailySpend.length > 0
          ? h("div", { style: { padding: 10 } }, h(BarChart, {
              data: dailySpend,
              height: 130,
              valueKey: "value",
              labelKey: "day",
              color: "var(--info)",
              highlightMax: true,
              referenceValue: dailyAvg,
            }))
          : h("div", { style: { padding: "24px 12px", textAlign: "center", color: "var(--fg-3)", fontSize: 12 } }, "Sem gastos neste mês")
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
            const trend = (f.last_total > 0) ? ((f.total - f.last_total) / f.last_total) * 100 : null;
            const _bg0 = `color-mix(in oklch, ${color} 8%, var(--bg-0))`;
            const _bg1 = `color-mix(in oklch, ${color} 14%, var(--bg-1))`;
            return h("button", {
              key: i, onClick: () => onJumpToAccount && onJumpToAccount(f.accountId),
              className: "fatura-btn",
              style: { "--fatura-bg": _bg0, "--fatura-bg-hover": _bg1, display: "block", textAlign: "left", padding: 10, borderRadius: "var(--r-2)", border: `1px solid color-mix(in oklch, ${color} 28%, var(--line-1))`, cursor: "pointer" },
            },
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
                h(BankChip, { bank: f.label.toLowerCase().startsWith("nu") ? "nubank" : "inter" }),
                h("span", { style: { fontSize: 10, color, fontWeight: 600 } }, `vence ${due}`)
              ),
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
                h("span", { className: "num", style: { fontSize: 17, fontWeight: 600 } }, fmtBRL(f.total)),
                h("span", { style: { fontSize: 10, fontFamily: "var(--ff-mono)", color: trend !== null ? (trend >= 0 ? "var(--neg)" : "var(--pos)") : "var(--fg-3)" } },
                  trend !== null
                    ? `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(1)}%`
                    : `${fmtCycleDate(f.cycle_start)} → ${fmtCycleDate(f.cycle_end)}`
                )
              ),
              h("div", { style: { fontSize: 9, color: "var(--fg-3)", fontFamily: "var(--ff-mono)", marginTop: 2 } },
                `${fmtCycleDate(f.cycle_start)} → ${fmtCycleDate(f.cycle_end)}`
              )
            );
          })
        )
      ),

      // Budgets
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, "Orçamentos"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, isAllPeriod ? "Todo período" : PT_MONTHS[summary.month])
        ),
        h("div", { style: { padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 6 } },
          budgetRows.length === 0
            ? h("div", { style: { padding: "16px 0", textAlign: "center", color: "var(--fg-3)", fontSize: 11 } },
                "Sem limites definidos.",
                h("br", null),
                h("span", { style: { fontSize: 10 } }, "Clique nas categorias do histórico para definir tetos.")
              )
            : budgetRows.slice(0, 6).map((b, i) => {
              const over = b.spent > b.amount_limit;
              if (editBudget?.id === b.id) {
                return h("div", { key: i },
                  h("div", { style: { display: "flex", gap: 4, alignItems: "center", marginBottom: 2 } },
                    h("span", { style: { flex: 1, fontSize: 11, color: "var(--fg-1)" } }, b.category_name),
                    h("input", {
                      autoFocus: true, className: "input", value: budgetInput,
                      onChange: e => { setBudgetInput(e.target.value); setBudgetErr(null); },
                      onKeyDown: e => { if (e.key === "Enter") saveBudget(); if (e.key === "Escape") { setEditBudget(null); setBudgetErr(null); } },
                      style: { height: 24, padding: "0 6px", fontSize: 11, width: 80, borderColor: budgetErr ? "var(--neg)" : undefined }
                    }),
                    h("button", { className: "btn btn-primary btn-sm", onClick: saveBudget, style: { height: 24, padding: "0 8px" } }, "✓"),
                    h("button", { className: "btn btn-ghost btn-sm", "aria-label": "Fechar", onClick: () => { setEditBudget(null); setBudgetErr(null); }, style: { height: 24 } }, "✕")
                  ),
                  budgetErr && h("div", { style: { fontSize: 10, color: "var(--neg)", marginBottom: 2 } }, budgetErr),
                  h(Progress, { value: b.spent, max: b.amount_limit, color: "var(--info)" })
                );
              }
              return h("div", { key: i },
                h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3, cursor: "pointer" },
                  onClick: () => { setEditBudget(b); setBudgetInput(b.amount_limit.toFixed(0)); setBudgetErr(null); }
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
      h("div", { style: { maxHeight: 320, overflow: "auto" } },
        h("table", { className: "grid-table" },
          h("thead", null, h("tr", null,
            h("th", { style: { width: 70 } }, "Data"),
            h("th", null, "Descrição"),
            h("th", null, "Conta"),
            h("th", null, "Categoria"),
            h("th", { style: { textAlign: "right", width: 110 } }, "Valor"),
            h("th", { style: { width: 32 } })
          )),
          h("tbody", null,
            ...activity.map(t => h(window.BS.TxRow, {
              key: t.id, t, cols: ["date", "desc", "account", "cat", "amount", "actions"],
              deleting: deletingTxId === t.id,
              onEditCategory,
              onSetDeleting: setDeletingTxId,
              onDeleteTx
            }))
          )
        )
      )
    )
  );
}

// ── CategoriesPanel ───────────────────────────────────────────────────────────

function CategoriesPanel({ refreshKey, onRefresh }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [cats, setCats] = _ovSt([]);
  const [newName, setNewName] = _ovSt("");
  const [adding, setAdding] = _ovSt(false);
  const [err, setErr] = _ovSt("");
  const [deleteModal, setDeleteModal] = _ovSt(null); // {id, name, count}
  const [reassignTo, setReassignTo] = _ovSt("");
  const [deleting, setDeleting] = _ovSt(false);

  _ovEf(() => {
    fetchExpenseCategoriesFull().then(setCats);
  }, [refreshKey]);

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true); setErr("");
    try {
      await postCategory(name, "expense");
      setNewName("");
      fetchExpenseCategoriesFull().then(setCats);
      onRefresh && onRefresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete() {
    if (!deleteModal || !reassignTo) return;
    setDeleting(true); setErr("");
    try {
      await deleteCategory(deleteModal.id, parseInt(reassignTo));
      setDeleteModal(null); setReassignTo("");
      fetchExpenseCategoriesFull().then(setCats);
      onRefresh && onRefresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setDeleting(false);
    }
  }

  const otherCats = deleteModal ? cats.filter(c => c.id !== deleteModal.id) : cats;

  return h("div", { style: { padding: "20px 0" } },
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 } },
      h("span", { style: { fontWeight: 700, fontSize: "var(--fz-4)" } }, "Categorias de Gasto"),
    ),

    // Add new category
    h("form", { onSubmit: handleAdd, style: { display: "flex", gap: 8, marginBottom: 20 } },
      h("input", {
        type: "text", placeholder: "Nova categoria…", value: newName,
        onChange: e => setNewName(e.target.value),
        className: "input",
      }),
      h("button", {
        type: "submit", className: "btn btn-primary", disabled: adding || !newName.trim(),
      }, adding ? "…" : "+ Adicionar"),
    ),

    err ? h("p", { style: { color: "var(--neg)", fontSize: "var(--fz-8)", marginBottom: 12 } }, err) : null,

    // Category list
    h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
      cats.map(cat =>
        h("div", { key: cat.id, style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--bg-1)", borderRadius: "var(--r-3)", border: "1px solid var(--line-1)" } },
          h("span", { style: { fontSize: "var(--fz-6)", fontWeight: 500 } }, cat.name),
          h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
            h("span", { style: { fontSize: "var(--fz-8)", color: "var(--fg-2)" } }, `${cat.transaction_count} transações`),
            h("button", {
              className: "btn btn-ghost btn-sm",
              onClick: () => { setDeleteModal(cat); setReassignTo(""); setErr(""); },
              style: { color: "var(--neg)" },
            }, "×"),
          ),
        )
      ),
    ),

    // Delete confirmation modal
    h(Modal, { open: !!deleteModal, onClose: () => setDeleteModal(null), title: deleteModal ? `Deletar "${deleteModal.name}"?` : "", width: 360 },
      deleteModal && h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
        h("p", { style: { fontSize: "var(--fz-7)", color: "var(--fg-2)", margin: 0 } },
          deleteModal.transaction_count > 0
            ? `${deleteModal.transaction_count} transação(ões) serão reassignadas para:`
            : "Sem transações vinculadas."
        ),
        h("select", {
          value: reassignTo, onChange: e => setReassignTo(e.target.value),
          className: "select", style: { fontSize: "var(--fz-7)" },
        },
          h("option", { value: "" }, "Escolher categoria…"),
          otherCats.map(c => h("option", { key: c.id, value: c.id }, c.name)),
        ),
        err && h("p", { style: { color: "var(--neg)", fontSize: "var(--fz-8)", margin: 0 } }, err),
        h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
          h("button", { className: "btn", onClick: () => setDeleteModal(null) }, "Cancelar"),
          h("button", {
            className: "btn",
            onClick: handleDelete,
            disabled: deleting || (!reassignTo && deleteModal.transaction_count > 0),
            style: { background: "var(--neg)", color: "var(--fg-0)", borderColor: "var(--neg)" },
          }, deleting ? "…" : "Confirmar"),
        ),
      )
    ),
  );
}

window.BS = window.BS || {};
window.BS.OverviewView = OverviewView;
window.BS.CategoriesPanel = CategoriesPanel;
