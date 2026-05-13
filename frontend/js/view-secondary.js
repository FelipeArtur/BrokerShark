/* view-secondary.js — CardsView, AccountsView, InvestmentsView, HistoryView */
/* global React, fetchFaturas, fetchRecentTransactions, fetchMonthlyByAccount,
          fetchCategoriesByAccount, fetchAccounts, fetchMonthly, fetchMonthlyFull,
          fetchInvestments, fetchAccountHistory, fetchMonthTransactions, deleteTransaction,
          ImportModal, fetchExpenseCategories */

const { useState: _s2St, useEffect: _s2Ef, useMemo: _s2Memo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, Sparkline, BarChart, DualLine, Donut, PT_MONTHS, PT_SHORT, fmtCycleDate } = window.BS;

/* ── CardsView ───────────────────────────────────────────────────────────── */
function CardsView({ onEditCategory, onDeleteTx, refreshKey, filterMonth, onImportCsv }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [faturas, setFaturas] = _s2St([]);
  const [activeAcc, setActiveAcc] = _s2St("nu-cc");
  const [txs, setTxs] = _s2St([]);
  const [monthly, setMonthly] = _s2St([]);
  const [catData, setCatData] = _s2St([]);
  const [filterCat, setFilterCat] = _s2St("");
  const [deletingTxId, setDeletingTxId] = _s2St(null);

  _s2Ef(() => { fetchFaturas().then(setFaturas); }, [refreshKey]);
  _s2Ef(() => {
    if (!activeAcc) return;
    const parts = filterMonth ? filterMonth.split("-").map(Number) : [];
    const [y, m] = parts.length === 2 ? parts : [new Date().getFullYear(), new Date().getMonth() + 1];
    fetchRecentTransactions(activeAcc, { limit: 200, month: m, year: y }).then(data => setTxs(Array.isArray(data) ? data : []));
    fetchMonthlyByAccount(activeAcc).then(setMonthly);
    fetchCategoriesByAccount(activeAcc).then(setCatData);
  }, [activeAcc, filterMonth, refreshKey]);

  const safeTxsCards = Array.isArray(txs) ? txs : [];
  const filteredTxs  = filterCat ? safeTxsCards.filter(t => t.category === filterCat) : safeTxsCards;
  const cats    = [...new Set(safeTxsCards.map(t => t.category).filter(Boolean))].sort();
  const catMax  = catData.length ? catData[0].total : 1;

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
          "aria-pressed": f.accountId === activeAcc,
          style: {
            display: "block", textAlign: "left", padding: 18,
            background: bg, borderRadius: 10,
            border: active ? "2px solid var(--fg-0)" : "2px solid transparent",
            color: "oklch(97% 0.003 250)", position: "relative", overflow: "hidden", cursor: "pointer",
            transition: "transform 0.15s, border-color 0.15s",
            transform: active ? "translateY(-1px)" : "none",
          }
        },
          h("div", { style: { position: "absolute", top: -40, right: -40, width: 140, height: 140, borderRadius: "50%", background: "oklch(100% 0 0 / 0.06)" } }),
          h("div", { style: { position: "relative" } },
            h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 } },
              h("div", null,
                h("div", { style: { fontSize: 10, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 } }, f.label),
                h("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 2 } }, `${fmtCycleDate(f.cycle_start)} → ${fmtCycleDate(f.cycle_end)}`)
              ),
              h("div", { style: { fontSize: 9, padding: "3px 7px", borderRadius: 4, background: "oklch(100% 0 0 / 0.18)", fontWeight: 600, textTransform: "uppercase" } }, due)
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
            ),
            onImportCsv && h("button", {
              onClick: e => { e.stopPropagation(); onImportCsv(f.accountId); },
              style: {
                marginTop: 12, width: "100%", padding: "5px 10px",
                background: "oklch(100% 0 0 / 0.14)", border: "1px solid oklch(100% 0 0 / 0.25)",
                borderRadius: 5, color: "oklch(100% 0 0 / 0.9)", fontSize: 10, fontWeight: 600,
                cursor: "pointer", letterSpacing: "0.04em",
              }
            }, "⤓ Importar CSV")
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
              h("th", null, "Categoria"), h("th", { style: { textAlign: "right", width: 110 } }, "Valor"),
              h("th", { style: { width: 32 } })
            )),
            h("tbody", null,
              ...filteredTxs.flatMap(t => {
                const rows = [
                  h("tr", { key: t.id },
                    h("td", { className: "mono", style: { color: "var(--fg-2)" } }, fmtDateBR(t.date)),
                    h("td", null, t.description),
                    h("td", null,
                      h("button", { onClick: () => onEditCategory && onEditCategory(t), style: { fontSize: 10, color: "var(--fg-2)", borderBottom: "1px dashed var(--line-2)", paddingBottom: 1 } }, t.category || "—")
                    ),
                    h("td", { className: "num", style: { color: t.flow === "expense" ? "var(--neg)" : "var(--pos)", fontWeight: 600 } },
                      t.flow === "expense" ? "−" : "+", fmtBRL(t.amount)),
                    h("td", { style: { width: 32, textAlign: "center", padding: "0 4px" } },
                      h("button", {
                        className: "btn btn-ghost btn-sm",
                        "aria-label": `Excluir ${t.description}`,
                        onClick: () => setDeletingTxId(deletingTxId === t.id ? null : t.id),
                        style: { width: 24, height: 24, padding: 0, fontSize: 14, opacity: 0.3, color: "var(--neg)" }
                      }, "×")
                    )
                  )
                ];
                if (deletingTxId === t.id) {
                  rows.push(h("tr", { key: `${t.id}-del`, style: { background: "color-mix(in oklch, var(--neg) 10%, transparent)" } },
                    h("td", { colSpan: 5, style: { padding: "6px 12px" } },
                      h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                        h("span", { style: { flex: 1, fontSize: "var(--fz-7)", color: "var(--fg-1)" } },
                          "Excluir ", h("strong", null, t.description), "?"
                        ),
                        h("button", { className: "btn btn-ghost btn-sm", onClick: () => setDeletingTxId(null) }, "Cancelar"),
                        h("button", {
                          className: "btn btn-sm",
                          onClick: async () => { await onDeleteTx(t.id); setDeletingTxId(null); },
                          style: { background: "var(--neg)", color: "var(--fg-0)", borderColor: "var(--neg)" }
                        }, "Excluir")
                      )
                    )
                  ));
                }
                return rows;
              })
            )
          )
        )
      ),
      h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
        h("div", { className: "card" },
          h("div", { className: "card-h" },
            h("div", { className: "card-title" }, "Gastos mensais no cartão"),
            h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, "últimos 6 meses")
          ),
          monthly.some(m => m.expenses > 0)
            ? h("div", { style: { padding: 10 } }, h(BarChart, {
                data: monthly.map(m => ({ label: m.label, value: m.expenses })),
                height: 140, valueKey: "value", labelKey: "label", color: "var(--neg)",
              }))
            : h("div", { style: { padding: "30px 12px", textAlign: "center", color: "var(--fg-3)", fontSize: 11 } },
                "Sem lançamentos individuais registrados neste cartão"
              )
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
function AccountsView({ onEditCategory, onDeleteTx, refreshKey, filterMonth }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [accounts, setAccounts] = _s2St([]);
  const [activeAcc, setActiveAcc] = _s2St("nu-db");
  const [txs, setTxs] = _s2St([]);
  const [deletingTxId, setDeletingTxId] = _s2St(null);

  _s2Ef(() => {
    fetchAccounts().then(all => {
      const checking = all.filter(a => a.type === "checking");
      setAccounts(checking);
    });
  }, [refreshKey]);

  _s2Ef(() => {
    if (!activeAcc) return;
    const parts = filterMonth ? filterMonth.split("-").map(Number) : [];
    const [y, m] = parts.length === 2 ? parts : [null, null];
    fetchRecentTransactions(activeAcc, { limit: 200, month: m, year: y }).then(data => setTxs(Array.isArray(data) ? data : []));
  }, [activeAcc, filterMonth, refreshKey]);

  const safeTxs = Array.isArray(txs) ? txs : [];
  const monthIncome = safeTxs.filter(t => t.flow === "income").reduce((s, t) => s + t.amount, 0);
  const monthExp    = safeTxs.filter(t => t.flow === "expense").reduce((s, t) => s + t.amount, 0);

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
              h("div", { className: "num", style: { fontSize: 13, color: "var(--pos)", fontWeight: 600 } }, `+${fmtBRL(safeTxs.filter(t => t.flow === "income" && t.account_id === a.id).reduce((s, t) => s + t.amount, 0), { decimals: 0 })}`)
            ),
            h("div", null,
              h("div", { style: { fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Saídas"),
              h("div", { className: "num", style: { fontSize: 13, color: "var(--neg)", fontWeight: 600 } }, `−${fmtBRL(safeTxs.filter(t => t.flow === "expense" && t.account_id === a.id).reduce((s, t) => s + t.amount, 0), { decimals: 0 })}`)
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
            h("th", null, "Categoria"), h("th", { style: { textAlign: "right", width: 110 } }, "Valor"),
            h("th", { style: { width: 32 } })
          )),
          h("tbody", null,
            ...safeTxs.flatMap(t => {
              const rows = [
                h("tr", { key: t.id },
                  h("td", { className: "mono", style: { color: "var(--fg-2)" } }, fmtDateBR(t.date)),
                  h("td", null, t.description),
                  h("td", null,
                    t.flow === "expense"
                      ? h("button", { onClick: () => onEditCategory && onEditCategory(t), style: { fontSize: 10, color: "var(--fg-2)", borderBottom: "1px dashed var(--line-2)" } }, t.category || "—")
                      : h("span", { className: "chip pos" }, t.category || "Receita")
                  ),
                  h("td", { className: "num", style: { color: t.flow === "expense" ? "var(--neg)" : "var(--pos)", fontWeight: 600 } },
                    t.flow === "expense" ? "−" : "+", fmtBRL(t.amount)),
                  h("td", { style: { width: 32, textAlign: "center", padding: "0 4px" } },
                    h("button", {
                      className: "btn btn-ghost btn-sm",
                      "aria-label": `Excluir ${t.description}`,
                      onClick: () => setDeletingTxId(deletingTxId === t.id ? null : t.id),
                      style: { width: 24, height: 24, padding: 0, fontSize: 14, opacity: 0.3, color: "var(--neg)" }
                    }, "×")
                  )
                )
              ];
              if (deletingTxId === t.id) {
                rows.push(h("tr", { key: `${t.id}-del`, style: { background: "color-mix(in oklch, var(--neg) 10%, transparent)" } },
                  h("td", { colSpan: 5, style: { padding: "6px 12px" } },
                    h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                      h("span", { style: { flex: 1, fontSize: "var(--fz-7)", color: "var(--fg-1)" } },
                        "Excluir ", h("strong", null, t.description), "?"
                      ),
                      h("button", { className: "btn btn-ghost btn-sm", onClick: () => setDeletingTxId(null) }, "Cancelar"),
                      h("button", {
                        className: "btn btn-sm",
                        onClick: async () => { await onDeleteTx(t.id); setDeletingTxId(null); },
                        style: { background: "var(--neg)", color: "var(--fg-0)", borderColor: "var(--neg)" }
                      }, "Excluir")
                    )
                  )
                ));
              }
              return rows;
            })
          )
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

  if (investments.length === 0) {
    return h("div", { className: "fade-in card", style: { padding: 40, textAlign: "center", color: "var(--fg-3)" } },
      h("div", { style: { fontSize: 32, marginBottom: 10, opacity: 0.3 } }, "◈"),
      h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-2)", marginBottom: 6 } }, "Nenhum investimento cadastrado"),
      h("div", { style: { fontSize: 11 } }, "Registre movimentos de investimento pelo bot ou pelo formulário de entrada.")
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-inv)", gap: 14 } },
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

/* ── HistoryView — Lupa do mês ───────────────────────────────────────────── */

function HistoryView({ refreshKey, onEditCategory, onDeleteTx }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [monthly, setMonthly] = _s2St([]);
  const [pickedIdx, setPickedIdx] = _s2St(-1);
  const [monthTx, setMonthTx] = _s2St([]);
  const [filterFlow, setFilterFlow] = _s2St("all");
  const [filterCat, setFilterCat] = _s2St("all");
  const [search, setSearch] = _s2St("");
  const [deletingTxId, setDeletingTxId] = _s2St(null);

  _s2Ef(() => {
    fetchMonthlyFull().then(data => {
      setMonthly(data);
      setPickedIdx(data.length - 1);
    });
  }, [refreshKey]);

  _s2Ef(() => {
    if (!monthly.length || pickedIdx < 0) return;
    const { month, year } = monthly[pickedIdx];
    fetchMonthTransactions({ month, year }).then(setMonthTx);
    setFilterFlow("all"); setFilterCat("all"); setSearch("");
  }, [pickedIdx, monthly, refreshKey]);

  const picked = monthly[pickedIdx] || null;
  const now = new Date();
  const monthLabel = picked ? `${PT_MONTHS[picked.month]} ${picked.year}` : "";
  const isCurrent = picked ? (picked.year === now.getFullYear() && picked.month === (now.getMonth() + 1)) : false;

  const expenses    = monthTx.filter(t => t.flow === "expense");
  const income      = monthTx.filter(t => t.flow === "income");
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

  // Janela de até 12 meses terminando no mês selecionado — atualiza ao trocar de mês
  const sparkWindow = monthly.slice(Math.max(0, pickedIdx - 11), pickedIdx + 1);

  const byCat = (() => {
    const g = {};
    expenses.forEach(t => {
      const k = t.category || "Outro";
      if (!g[k]) g[k] = { name: k, total: 0 };
      g[k].total += t.amount;
    });
    return Object.values(g).sort((a, b) => b.total - a.total);
  })();

  const cats = [...new Set(monthTx.map(t => t.category).filter(Boolean))].sort();
  const filteredTx = monthTx.filter(t => {
    if (filterFlow !== "all" && t.flow !== filterFlow) return false;
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (search && !(t.description || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (!picked) return h("div", { style: { padding: 24, color: "var(--fg-2)" } }, "Carregando…");

  const filtExp  = filteredTx.filter(t => t.flow === "expense").reduce((s, t) => s + t.amount, 0);
  const filtInc  = filteredTx.filter(t => t.flow === "income").reduce((s, t)  => s + t.amount, 0);
  const hasFilter = filterFlow !== "all" || filterCat !== "all" || search;

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    // A — Month picker strip
    h("div", { className: "card", style: { padding: 0, overflow: "hidden" } },
      h("div", { style: { padding: "10px 14px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" } },
        h("div", null,
          h("div", { className: "eyebrow", style: { fontSize: 9 } }, "Lupa do mês"),
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
      h("div", { style: { display: "flex", alignItems: "flex-end", gap: 2, padding: "10px 14px", height: 70, background: "var(--bg-0)" } },
        monthly.map((m, i) => {
          const maxH = Math.max(...monthly.map(x => x.expenses), 1);
          const barH = (m.expenses / maxH) * 100;
          const isPicked = i === pickedIdx;
          const isCur2 = m.year === now.getFullYear() && m.month === (now.getMonth() + 1);
          return h("button", {
            key: i, onClick: () => setPickedIdx(i),
            title: `${PT_MONTHS[m.month]} ${m.year} — ${fmtBRL(m.expenses, { decimals: 0 })}`,
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

    // B — 4 headline metric cards
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-4)", gap: 10 } },
      [
        {
          l: "Receitas", v: fmtBRL(totalInc), c: "var(--pos)",
          sub: prevMonths.length ? (incVsAvg !== 0 ? `${incVsAvg >= 0 ? "▲" : "▼"} ${Math.abs(incVsAvg).toFixed(1)}% vs. ${prevMonths.length}M ant.` : "= média anterior") : "sem histórico",
          subColor: incVsAvg >= 0 ? "var(--pos)" : "var(--neg)",
          sparkData: sparkWindow.map(m => m.income),
        },
        {
          l: "Despesas", v: fmtBRL(totalExp), c: "var(--neg)",
          sub: prevMonths.length ? (expVsAvg !== 0 ? `${expVsAvg >= 0 ? "▲" : "▼"} ${Math.abs(expVsAvg).toFixed(1)}% vs. ${prevMonths.length}M ant.` : "= média anterior") : "sem histórico",
          subColor: expVsAvg >= 0 ? "var(--neg)" : "var(--pos)",
          sparkData: sparkWindow.map(m => m.expenses),
        },
        {
          l: "Saldo do mês", v: `${net >= 0 ? "+" : "−"}${fmtBRL(Math.abs(net))}`, c: net >= 0 ? "var(--pos)" : "var(--neg)",
          sub: `${monthTx.length} lançamentos`,
          subColor: "var(--fg-3)",
          sparkData: sparkWindow.map(m => m.income - m.expenses),
        },
        {
          l: "Taxa de poupança", v: `${savingsRate.toFixed(1)}%`, c: savingsRate >= 20 ? "var(--pos)" : savingsRate >= 0 ? "var(--warn)" : "var(--neg)",
          sub: savingsRate >= 20 ? "saudável" : savingsRate >= 0 ? "abaixo da meta" : "negativa",
          subColor: savingsRate >= 20 ? "var(--pos)" : savingsRate >= 0 ? "var(--warn)" : "var(--neg)",
          sparkData: sparkWindow.map(m => m.income > 0 ? ((m.income - m.expenses) / m.income) * 100 : 0),
        },
      ].map((s, i) =>
        h("div", { key: i, className: "card", style: { padding: 14 } },
          h("div", { className: "eyebrow", style: { fontSize: 9 } }, s.l),
          h("div", { className: "num", style: { fontSize: 24, fontWeight: 700, color: s.c, marginTop: 4, letterSpacing: "-0.02em" } }, s.v),
          h("div", { style: { marginTop: 6 } },
            h("span", { style: { fontSize: 10, color: s.subColor, fontWeight: 500 } }, s.sub)
          ),
          s.sparkData && s.sparkData.length > 1 && h("div", { style: { marginTop: 10 } },
            h(Sparkline, { data: s.sparkData, color: s.c, height: 28, fill: true, strokeWidth: 1.5 })
          )
        )
      )
    ),

    // C — 2-column: categories | filterable table
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-hist)", gap: 14 } },

      // C1 — By category
      h("div", { className: "card" },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, "Por categoria"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)" } }, `${byCat.length} categorias`)
        ),
        h("div", { style: { padding: 12 } },
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
                      fmtBRL(c.total, { decimals: 0 }),
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

      // C2 — Filterable transaction table
      h("div", { className: "card", style: { display: "flex", flexDirection: "column" } },
        h("div", { className: "card-h" },
          h("div", { className: "card-title" }, `Transações · ${filteredTx.length}`)
        ),
        h("div", { style: { padding: "8px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line-1)", background: "var(--bg-0)" } },
          h("div", { style: { display: "flex", gap: 2, padding: 2, background: "var(--bg-1)", borderRadius: 5, border: "1px solid var(--line-1)" } },
            [["all", "Tudo"], ["expense", "Despesas"], ["income", "Receitas"]].map(([k, l]) =>
              h("button", { key: k, onClick: () => setFilterFlow(k), style: {
                padding: "3px 10px", fontSize: 10, borderRadius: 3,
                background: filterFlow === k ? "var(--bg-2)" : "transparent",
                color: filterFlow === k ? "var(--fg-0)" : "var(--fg-2)",
                fontWeight: filterFlow === k ? 600 : 500,
              } }, l)
            )
          ),
          h("select", {
            value: filterCat, onChange: e => setFilterCat(e.target.value),
            className: "select", style: { height: 26, fontSize: 11, padding: "0 8px", width: "auto" },
          },
            h("option", { value: "all" }, "Todas categorias"),
            cats.map(c => h("option", { key: c, value: c }, c))
          ),
          h("input", {
            value: search, onChange: e => setSearch(e.target.value),
            placeholder: "Buscar…", className: "input",
            style: { height: 26, fontSize: 11, padding: "0 10px", width: 160 },
          }),
          hasFilter && h("button", {
            onClick: () => { setFilterFlow("all"); setFilterCat("all"); setSearch(""); },
            className: "btn", style: { height: 26, padding: "0 10px", fontSize: 10 },
          }, "Limpar"),
          h("div", { style: { flex: 1 } }),
          h("span", { style: { fontSize: 11, color: "var(--fg-2)", fontFamily: "var(--ff-mono)" } },
            h("span", { style: { color: "var(--pos)" } }, `+${fmtBRL(filtInc, { decimals: 0 })}`),
            " · ",
            h("span", { style: { color: "var(--neg)" } }, `−${fmtBRL(filtExp, { decimals: 0 })}`),
            " · ",
            h("span", { style: { color: (filtInc - filtExp) >= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 600 } },
              (filtInc - filtExp) >= 0 ? "+" : "−", fmtBRL(Math.abs(filtInc - filtExp), { decimals: 0 })
            )
          )
        ),
        h("div", { style: { maxHeight: 480, overflowY: "auto" } },
          h("table", { className: "grid-table" },
            h("thead", null, h("tr", null,
              h("th", { style: { width: 70 } }, "Data"),
              h("th", null, "Descrição"),
              h("th", { style: { width: 110 } }, "Categoria"),
              h("th", { style: { width: 100 } }, "Conta"),
              h("th", { style: { textAlign: "right", width: 100 } }, "Valor"),
              h("th", { style: { width: 32 } })
            )),
            h("tbody", null,
              filteredTx.length === 0 && h("tr", null, h("td", { colSpan: 6, style: { textAlign: "center", padding: 30, color: "var(--fg-3)" } }, "Nenhuma transação.")),
              ...filteredTx.flatMap(t => {
                const rows = [
                  h("tr", { key: t.id },
                    h("td", { className: "mono", style: { color: "var(--fg-2)" } }, fmtDateBR(t.date)),
                    h("td", { style: { maxWidth: 260 } },
                      h("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t.description)
                    ),
                    h("td", null,
                      t.flow === "expense"
                        ? h("button", { onClick: () => onEditCategory && onEditCategory(t), style: { fontSize: 10, color: "var(--fg-2)", borderBottom: "1px dashed var(--line-2)", paddingBottom: 1 } }, t.category || "—")
                        : h("span", { className: "chip pos" }, t.category || "Receita")
                    ),
                    h("td", null, h(BankChip, { accountId: t.account_id, bank: t.bank })),
                    h("td", { className: "num", style: { color: t.flow === "expense" ? "var(--neg)" : "var(--pos)", fontWeight: 600 } },
                      t.flow === "expense" ? "−" : "+", fmtBRL(t.amount)
                    ),
                    h("td", { style: { width: 32, textAlign: "center", padding: "0 4px" } },
                      h("button", {
                        className: "btn btn-ghost btn-sm",
                        "aria-label": `Excluir ${t.description}`,
                        onClick: () => setDeletingTxId(deletingTxId === t.id ? null : t.id),
                        style: { width: 24, height: 24, padding: 0, fontSize: 14, opacity: 0.3, color: "var(--neg)" }
                      }, "×")
                    )
                  )
                ];
                if (deletingTxId === t.id) {
                  rows.push(h("tr", { key: `${t.id}-del`, style: { background: "color-mix(in oklch, var(--neg) 10%, transparent)" } },
                    h("td", { colSpan: 6, style: { padding: "6px 12px" } },
                      h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                        h("span", { style: { flex: 1, fontSize: "var(--fz-7)", color: "var(--fg-1)" } },
                          "Excluir ", h("strong", null, t.description), "?"
                        ),
                        h("button", { className: "btn btn-ghost btn-sm", onClick: () => setDeletingTxId(null) }, "Cancelar"),
                        h("button", {
                          className: "btn btn-sm",
                          onClick: async () => { await onDeleteTx(t.id); setDeletingTxId(null); },
                          style: { background: "var(--neg)", color: "var(--fg-0)", borderColor: "var(--neg)" }
                        }, "Excluir")
                      )
                    )
                  ));
                }
                return rows;
              })
            )
          )
        )
      )
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { CardsView, AccountsView, InvestmentsView, HistoryView });
