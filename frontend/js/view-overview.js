/* view-overview.js — OverviewView (tela "Dinheiro") + CategoriesPanel */
/* global React, fetchSummary, fetchFaturas, fetchAvailable, fetchAccounts,
          fetchMonthTransactions, fetchCashflowStatement,
          fetchExpenseCategoriesFull, postCategory, deleteCategory */

const { useState: _ovSt, useEffect: _ovEf, useMemo: _ovMemo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, DualLine, Modal, PT_MONTHS, PT_SHORT, fmtCycleDate } = window.BS;

function OverviewView({ onJumpToAccount, onEditCategory, onDeleteTx, refreshKey, filterMonth, onImport }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  const [summary, setSummary]       = _ovSt(null);
  const [available, setAvailable]   = _ovSt(null);
  const [availErr, setAvailErr]     = _ovSt(false);
  const [loadErr, setLoadErr]       = _ovSt(false);
  const [retryTick, setRetryTick]   = _ovSt(0);
  const [faturas, setFaturas]       = _ovSt([]);
  const [accounts, setAccounts]     = _ovSt([]);
  const [activity, setActivity]     = _ovSt([]);
  const [cashflow, setCashflow]     = _ovSt(null);

  _ovEf(() => {
    const parts = filterMonth ? filterMonth.split("-").map(Number) : [];
    const [year, month] = parts.length === 2 ? parts : [null, null];
    setAvailErr(false); setLoadErr(false);
    fetchAvailable().then(setAvailable).catch(() => setAvailErr(true));
    Promise.all([
      fetchSummary({ month, year }),
      fetchFaturas(),
      fetchAccounts(),
      fetchMonthTransactions((month && year) ? { month, year } : {}),
      fetchCashflowStatement((month && year) ? { month, year } : {}),
    ]).then(([s, f, ac, a, cf]) => {
      setSummary(s); setFaturas(f);
      setAccounts(ac); setActivity(a); setCashflow(cf);
    }).catch(() => setLoadErr(true));
  }, [refreshKey, filterMonth, retryTick]);

  if (loadErr) return h("div", { style: { background: "color-mix(in oklch, var(--neg) 5%, transparent)", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", maxWidth: 480 } },
    h("div", { style: { color: "var(--neg)", fontSize: 14, fontWeight: 700 } }, "Falha ao carregar os dados do mês."),
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "O servidor local não respondeu. Verifique se o BrokerShark está rodando."),
    h("button", { className: "btn btn-ghost", style: { color: "var(--neg)", padding: "6px 12px", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", borderRadius: 6, fontWeight: 600 }, onClick: () => setRetryTick(t => t + 1) }, "Tentar de novo")
  );

  if (!summary) return h("div", { style: { padding: 24, color: "var(--fg-2)" } }, "Carregando…");

  // Checking accounts only, for the "Contas correntes" card.
  const checkingAccounts = accounts.filter(a => a.type === "checking");

  const totalFaturas    = faturas.reduce((s, f) => s + (f.total || 0), 0);
  const totalReservas   = summary.reservas || 0;
  // Use the same checking number as the hero (investment-adjusted) for consistency.
  const checkingTotal   = available ? available.checking_total : checkingAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  // Patrimônio líquido = o que sobra se você quitar todas as faturas em aberto agora.
  const patrimonioLiquido = checkingTotal + totalReservas - totalFaturas;

  // First-run: nothing imported yet → single invite, no ghost zero-cards.
  const isFirstRun = !availErr && available
    && available.checking_total === 0 && available.faturas_total === 0
    && activity.length === 0;

  const availValue = available ? available.available : 0;
  const availNeg   = available ? available.available < 0 : false;

  function LedgerRow({ label, value, color, negative, strong, sub }) {
    return h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: sub ? "6px 0" : "8px 0", borderBottom: sub ? "none" : "1px solid var(--line-0)" } },
      h("span", { style: { fontSize: sub ? 12 : 13, color: sub ? "var(--fg-2)" : "var(--fg-1)", fontWeight: strong ? 600 : 500 } }, label),
      h("span", { className: "num", style: { fontWeight: strong ? 700 : 600, fontSize: strong ? 16 : 14, color: color || "var(--fg-0)" } },
        (negative ? "−" : "") + fmtBRL(Math.abs(value)))
    );
  }

  function HeroStat({ label, value, color, negative }) {
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
      h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 } }, label),
      h("span", { className: "num", style: { fontSize: 15, fontWeight: 700, color: color || "var(--fg-1)" } }, (negative ? "−" : "") + fmtBRL(Math.abs(value)))
    );
  }

  if (isFirstRun) {
    const SourceRow = (bank, format, type) => h("tr", { style: { borderBottom: "1px solid var(--line-1)", fontFamily: "var(--ff-mono)", fontSize: 12 } },
      h("td", { style: { padding: "8px 0", color: "var(--fg-1)", fontWeight: 600 } }, bank),
      h("td", { style: { padding: "8px 0", color: "var(--fg-3)" } }, type),
      h("td", { style: { padding: "8px 0", color: "var(--fg-2)", textAlign: "right" } }, format)
    );

    return h("div", { className: "fade-in", style: { width: "100%", maxWidth: 640 } },
      h("div", { className: "pane" },
        h("div", { className: "pane-h", style: { background: "var(--bg-2)" } },
          h("div", { className: "pane-title", style: { fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11, color: "var(--fg-1)" } }, "SYS_INIT :: DB_EMPTY"),
          h("span", { style: { fontSize: 10, color: "var(--pos)", fontFamily: "var(--ff-mono)" } }, "READY")
        ),
        h("div", { className: "pane-content", style: { padding: "32px" } },
          h("div", { style: { fontFamily: "var(--ff-mono)", fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6, marginBottom: 32 } },
            "O banco de dados local SQLite está vazio.",
            h("br"),
            "É necessário injetar dados estruturados para habilitar o painel de análise."
          ),

          h("div", { style: { marginBottom: 12, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontWeight: 700 } }, "Formatos Suportados"),
          h("table", { style: { width: "100%", borderCollapse: "collapse", marginBottom: 32 } },
            h("tbody", null,
              SourceRow("Nubank", "*.csv", "Conta Corrente / Fatura"),
              SourceRow("Inter", "*.csv", "Conta Corrente / Fatura"),
              SourceRow("B3 (Bolsa)", "*.xlsx", "Relatório de Posições")
            )
          ),

          onImport && h("div", { style: { display: "flex", gap: 12, alignItems: "center" } },
            h("button", {
              className: "btn btn-primary", 
              style: { fontFamily: "var(--ff-mono)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 12, padding: "8px 16px", borderRadius: 4 },
              onClick: onImport
            }, "> IMPORTAR_DADOS"),
            h("span", { style: { fontFamily: "var(--ff-mono)", fontSize: 11, color: "var(--fg-3)" } }, "Atalho: i")
          )
        )
      )
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 32, flex: 1, height: "100%" } },

    // ── 1. THE MONTH AT A GLANCE (Hero Panel) ──
    h("div", { style: { display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 32, background: "var(--bg-1)", padding: 40, borderRadius: 16, border: "1px solid var(--line-1)" } },
      
      // Left: Disponível
      h("div", { style: { display: "flex", flexDirection: "column", justifyContent: "center" } },
        h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 16 } }, "Disponível pra gastar"),
        availErr
          ? h("div", { style: { color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)", padding: "12px 16px", borderRadius: 8, border: "1px dashed color-mix(in oklch, var(--neg) 30%, transparent)", fontSize: 13, fontWeight: 600 } }, "Falha ao carregar liquidez")
          : !available
            ? h("div", { className: "num", style: { fontSize: 48, fontWeight: 800, color: "var(--fg-0)" } }, "R$ 0,00")
            : h("div", null,
                h("div", { className: "num", style: { fontSize: 56, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: availNeg ? "var(--neg)" : "var(--pos)", marginBottom: 24 } },
                  (availNeg ? "−" : "") + fmtBRL(Math.abs(availValue))
                ),
                h("div", { style: { display: "flex", gap: 24 } },
                  h(HeroStat, { label: "Saldo nas Contas", value: available.checking_total, color: "var(--fg-1)" }),
                  h("div", { style: { width: 1, background: "var(--line-2)" } }),
                  h(HeroStat, { label: "Faturas Acumuladas", value: available.faturas_total, color: available.faturas_total > 0 ? "var(--neg)" : "var(--fg-2)", negative: available.faturas_total > 0 })
                )
              )
      ),

      // Right: Balanço do Mês
      cashflow && h("div", { style: { display: "flex", flexDirection: "column" } },
        h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 16 } }, "Balanço deste mês"),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 12, flex: 1, justifyContent: "center" } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
            h("span", { style: { fontSize: 14, color: "var(--fg-2)", fontWeight: 600 } }, "↓ Despesas"),
            h("div", { style: { display: "flex", alignItems: "baseline", gap: 8 } },
              (cashflow.expense_by_source.cc > 0 || cashflow.expense_by_source.direct > 0) && h("span", { style: { fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--ff-mono)" } }, 
                `${fmtBRL(cashflow.expense_by_source.cc)} cart · ${fmtBRL(cashflow.expense_by_source.direct)} deb`),
              h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--neg)" } }, "−" + fmtBRL(cashflow.expense_total))
            )
          ),
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
            h("span", { style: { fontSize: 14, color: "var(--fg-2)", fontWeight: 600 } }, "↑ Receitas"),
            h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--pos)" } }, "+" + fmtBRL(cashflow.income_total))
          ),
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
            h("span", { style: { fontSize: 14, color: "var(--fg-2)", fontWeight: 600 } }, cashflow.investment_net < 0 ? "← Resgatado" : "→ Investido"),
            h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: cashflow.investment_net === 0 ? "var(--fg-3)" : (cashflow.investment_net > 0 ? "var(--reserve)" : "var(--warn)") } }, fmtBRL(Math.abs(cashflow.investment_net)))
          ),
          h("div", { style: { height: 1, background: "var(--line-2)", margin: "4px 0" } }),
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
            h("span", { style: { fontSize: 15, color: "var(--fg-1)", fontWeight: 700 } }, "Saldo do Mês"),
            h("span", { className: "num", style: { fontSize: 20, fontWeight: 800, color: cashflow.free_balance >= 0 ? "var(--pos)" : (cashflow.income_total === 0 ? "var(--warn)" : "var(--neg)") } }, 
              (cashflow.free_balance >= 0 ? "+" : "−") + fmtBRL(Math.abs(cashflow.free_balance))
            )
          ),
          (() => {
            const now = new Date();
            const isCur = cashflow.month === now.getMonth() + 1 && cashflow.year === now.getFullYear();
            const daysElapsed = now.getDate();
            const daysInMonth = new Date(cashflow.year, cashflow.month, 0).getDate();
            const projExpense = cashflow.expense_total / daysElapsed * daysInMonth;
            const projFree = cashflow.income_total - projExpense - cashflow.investment_net;
            const hasData = isCur && cashflow.expense_total > 0;
            return h("div", { style: { marginTop: 4, paddingTop: 12, borderTop: "1px dashed var(--line-2)", display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
              h("span", { style: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontWeight: 700 } }, "Estimativa fechamento"),
              h("span", { className: "num", style: { color: hasData ? "var(--fg-2)" : "var(--fg-3)", fontWeight: 600, fontSize: 14 } }, 
                hasData ? ("~ " + (projFree >= 0 ? "+" : "−") + fmtBRL(Math.abs(projFree))) : "—"
              )
            );
          })()
        )
      )
    ),

    // ── 2. PATRIMÔNIO (Global State) ──
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-1)", padding: "24px 32px", borderRadius: 16, border: "1px solid var(--line-1)", flexShrink: 0 } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 } }, "Patrimônio líquido global"),
        h("div", { style: { display: "flex", alignItems: "center", gap: 24 } },
          h("div", { className: "num", style: { fontSize: 24, fontWeight: 800, color: patrimonioLiquido < 0 ? "var(--neg)" : "var(--fg-0)" } },
             (patrimonioLiquido < 0 ? "−" : "") + fmtBRL(Math.abs(patrimonioLiquido))
          ),
          h("div", { style: { display: "flex", gap: 16, fontSize: 12, color: "var(--fg-2)" } },
            h("span", null, "Caixa: ", h("strong", { style: { color: "var(--fg-1)" } }, fmtBRL(checkingTotal))),
            h("span", null, "Investimentos: ", h("strong", { style: { color: "var(--reserve)" } }, fmtBRL(totalReservas))),
            totalFaturas > 0 && h("span", null, "Faturas: ", h("strong", { style: { color: "var(--neg)" } }, "−" + fmtBRL(totalFaturas)))
          )
        )
      )
    ),

    // ── 3. FATURAS & CONTAS (2 columns) ──
    h("div", { style: { display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 32, flex: 1, minHeight: 0 } },
      
      // Faturas em Aberto
      h("div", { style: { background: "var(--bg-1)", padding: 24, borderRadius: 16, border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", minHeight: 0 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 } },
          h("div", { style: { fontSize: 13, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Faturas em aberto"),
          h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(totalFaturas))
        ),
        faturas.length === 0
          ? h("div", { style: { padding: "16px 0", color: "var(--fg-3)", fontSize: 13, fontStyle: "italic", flex: 1 } }, "Nenhuma fatura em aberto.")
          : h("div", { className: "custom-scrollbar", style: { display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1, paddingRight: 8, marginRight: -8 } },
              faturas.map((f, i) => {
                const tone = f.days_until_due <= 3 ? "neg" : f.days_until_due <= 7 ? "warn" : "ok";
                const color = tone === "neg" ? "var(--neg)" : tone === "warn" ? "var(--warn)" : "var(--pos)";
                const due = f.days_until_due > 0 ? `em ${f.days_until_due}d` : f.days_until_due === 0 ? "hoje" : `há ${Math.abs(f.days_until_due)}d`;
                const trend = (f.last_total > 0) ? ((f.total - f.last_total) / f.last_total) * 100 : null;
                
                const _parseBR = s => { const p = (s || "").split("/").map(Number); return (p.length === 3 && p[0] && p[1] && p[2]) ? new Date(p[2], p[1] - 1, p[0]) : null; };
                let cycleProj = null;
                const _cs = _parseBR(f.cycle_start), _ce = _parseBR(f.cycle_end);
                if (_cs && _ce && f.total > 0) {
                  const _today = new Date(); _today.setHours(0, 0, 0, 0);
                  const _len  = Math.round((_ce - _cs) / 86400000);
                  const _into = Math.round((_today - _cs) / 86400000);
                  if (_into >= 5 && _into < _len) cycleProj = f.total / _into * _len;
                }
                const _bg0 = `color-mix(in oklch, ${color} 8%, var(--bg-1))`;
                
                return h("button", {
                  key: i, onClick: () => onJumpToAccount && onJumpToAccount(f.accountId),
                  className: "fatura-btn",
                  style: { background: _bg0, display: "block", textAlign: "left", padding: "12px 16px", borderRadius: 8, border: "none", cursor: "pointer", transition: "transform 0.1s, background 0.1s" },
                },
                  h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 } },
                    h(BankChip, { bank: f.label.toLowerCase().startsWith("nu") ? "nubank" : "inter" }),
                    h("span", { style: { fontSize: 11, color, fontWeight: 600 } }, `vence ${due}`)
                  ),
                  h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
                    h("span", { className: "num", style: { fontSize: 20, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(f.total)),
                    trend !== null && h("span", { style: { fontSize: 11, fontFamily: "var(--ff-mono)", color: trend >= 0 ? "var(--neg)" : "var(--pos)" } },
                      `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(1)}%`)
                  ),
                  h("div", { style: { fontSize: 10, color: "var(--fg-2)", fontFamily: "var(--ff-mono)", marginTop: 4 } },
                    `${fmtCycleDate(f.cycle_start)} → ${fmtCycleDate(f.cycle_end)}`
                  ),
                  cycleProj !== null && h("div", { style: { marginTop: 8, paddingTop: 8, borderTop: "1px dashed color-mix(in oklch, var(--line-2) 70%, transparent)", display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "var(--ff-mono)" } },
                    h("span", { style: { color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em" } }, "estimativa fechamento"),
                    h("span", { style: { color: "var(--fg-2)" } }, `~ ${fmtBRL(cycleProj)}`)
                  )
                );
              })
            )
      ),

      // Contas Correntes
      h("div", { style: { background: "var(--bg-1)", padding: 24, borderRadius: 16, border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", minHeight: 0 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 } },
          h("div", { style: { fontSize: 13, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, "Contas correntes"),
          h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(checkingTotal))
        ),
        h("div", { className: "custom-scrollbar", style: { display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1, paddingRight: 8, marginRight: -8 } },
          checkingAccounts.length === 0
            ? h("div", { style: { padding: "16px 0", color: "var(--fg-3)", fontSize: 13, fontStyle: "italic" } }, "Nenhuma conta corrente.")
            : checkingAccounts.map(a => h("button", {
                key: a.id, onClick: () => onJumpToAccount && onJumpToAccount(a.id),
                className: "fatura-btn",
                style: { background: "var(--bg-1)", border: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "10px 14px", borderRadius: 8, cursor: "pointer", transition: "background 0.1s, border-color 0.1s", textAlign: "left" },
                onMouseEnter: e => { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.borderColor = "var(--line-2)"; },
                onMouseLeave: e => { e.currentTarget.style.background = "var(--bg-1)"; e.currentTarget.style.borderColor = "var(--line-1)"; }
              },
                h("span", { style: { display: "flex", alignItems: "center", gap: 10 } },
                  h(BankChip, { bank: a.bank }),
                  h("span", { style: { fontSize: 13, fontWeight: 500, color: "var(--fg-1)" } }, a.name)
                ),
                h("span", { className: "num", style: { fontSize: 16, fontWeight: 700, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
              ))
        )
      )
    )
  );
}

// ── CategoriesPanel ───────────────────────────────────────────────────────────

function CategoriesPanel({ refreshKey, onRefresh }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [flow, setFlow] = _ovSt("expense");
  const [cats, setCats] = _ovSt([]);
  const [newName, setNewName] = _ovSt("");
  const [adding, setAdding] = _ovSt(false);
  const [err, setErr] = _ovSt("");
  const [deleteModal, setDeleteModal] = _ovSt(null); // {id, name, count}
  const [reassignTo, setReassignTo] = _ovSt("");
  const [deleting, setDeleting] = _ovSt(false);

  _ovEf(() => {
    fetchCategoriesFull(flow).then(setCats);
  }, [flow, refreshKey]);

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true); setErr("");
    try {
      await postCategory(name, flow);
      setNewName("");
      fetchCategoriesFull(flow).then(setCats);
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
      fetchCategoriesFull(flow).then(setCats);
      onRefresh && onRefresh();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setDeleting(false);
    }
  }

  const otherCats = deleteModal ? cats.filter(c => c.id !== deleteModal.id) : cats;

  return h("div", { className: "fade-in", style: { padding: "20px 0", maxWidth: 640, margin: "0 auto" } },
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 } },
      h("span", { style: { fontWeight: 700, fontSize: "var(--fz-4)" } }, "Gerenciar Categorias"),
      h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2,
      })
    ),

    // Add new category
    h("div", { style: { background: "var(--bg-1)", padding: 24, borderRadius: 16, border: "1px solid var(--line-1)", marginBottom: 24 } },
      h("form", { onSubmit: handleAdd, style: { display: "flex", gap: 12, alignItems: "center" } },
        h("input", {
          type: "text", placeholder: `Nova categoria de ${flow === 'expense' ? 'despesa' : 'receita'}…`, value: newName,
          onChange: e => setNewName(e.target.value),
          className: "input",
          style: { flex: 1, padding: "8px 12px", border: "1px solid var(--line-1)", borderRadius: 6, background: "var(--bg-0)" }
        }),
        h("button", {
          type: "submit", className: "btn btn-primary", disabled: adding || !newName.trim(),
          style: { padding: "8px 16px", borderRadius: 6 }
        }, adding ? "Processando…" : "Adicionar")
      ),
      err && h("div", { style: { marginTop: 12, color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err)
    ),

    // Category list
    h("div", { style: { background: "var(--bg-1)", borderRadius: 16, border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", overflow: "hidden" } },
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 100px 80px", padding: "16px 24px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-1)", fontSize: 12, color: "var(--fg-2)" } },
        h("span", null, "Nome"),
        h("span", { style: { textAlign: "right" } }, "Lançamentos"),
        h("span", null)
      ),
      h("div", { style: { display: "flex", flexDirection: "column" } },
        cats.map(cat => h("div", { key: cat.id, style: { display: "grid", gridTemplateColumns: "1fr 100px 80px", padding: "16px 24px", borderBottom: "1px solid var(--line-0)", alignItems: "center", fontSize: 13 } },
          h("div", { style: { fontWeight: 500, color: "var(--fg-1)", display: "flex", alignItems: "center", gap: 8 } }, 
            h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: flow === 'expense' ? "var(--neg)" : "var(--pos)" } }),
            cat.name
          ),
          h("div", { className: "num", style: { textAlign: "right", color: "var(--fg-2)" } }, cat.transaction_count),
          h("div", { style: { textAlign: "right" } },
            h("button", {
              className: "btn btn-ghost btn-sm",
              style: { color: "var(--neg)", fontSize: 11, padding: "4px 8px" },
              onClick: () => { setDeleteModal(cat); setReassignTo(cat.transaction_count > 0 ? "" : "0"); setErr(""); }
            }, "Excluir")
          )
        ))
      ),
      cats.length === 0 && h("div", { style: { padding: 32, textAlign: "center", color: "var(--fg-3)", fontSize: 13 } }, "Nenhuma categoria cadastrada.")
    ),

    // Delete confirmation modal
    h(window.BS.Modal, { open: !!deleteModal, onClose: () => setDeleteModal(null), title: "Excluir Categoria", width: 400 },
      deleteModal && h("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
        h("p", { style: { fontSize: 14, color: "var(--fg-1)", margin: 0 } }, 
          "Tem certeza que deseja excluir a categoria ", h("strong", null, deleteModal.name), "?"
        ),
        deleteModal.transaction_count > 0 && h("div", { style: { background: "var(--bg-1)", padding: 16, borderRadius: 8, border: "1px solid var(--line-1)" } },
          h("p", { style: { fontSize: 13, color: "var(--warn)", margin: "0 0 12px 0", fontWeight: 500 } },
            `Há ${deleteModal.transaction_count} lançamento(s) usando esta categoria.`
          ),
          h("label", { style: { fontSize: 11, color: "var(--fg-2)", marginBottom: 6, display: "block", textTransform: "uppercase", letterSpacing: "0.05em" } }, "Reatribuir para:"),
          h("select", {
            value: reassignTo, onChange: e => setReassignTo(e.target.value),
            className: "select", style: { width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line-1)", background: "var(--bg-0)" }
          },
            h("option", { value: "", disabled: true }, "Escolher categoria destino…"),
            otherCats.map(c => h("option", { key: c.id, value: c.id }, c.name))
          )
        ),
        err && h("div", { style: { color: "var(--neg)", fontSize: 12, padding: "8px 12px", background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderRadius: 6 } }, err),
        h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 } },
          h("button", { className: "btn btn-ghost", onClick: () => setDeleteModal(null) }, "Cancelar"),
          h("button", {
            className: "btn",
            onClick: handleDelete,
            disabled: deleting || (!reassignTo && deleteModal.transaction_count > 0),
            style: { background: "var(--neg)", color: "var(--fg-0)", borderColor: "var(--neg)", padding: "8px 16px", borderRadius: 6 }
          }, deleting ? "Excluindo…" : "Excluir Definitivamente")
        )
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.OverviewView = OverviewView;
window.BS.CategoriesPanel = CategoriesPanel;
