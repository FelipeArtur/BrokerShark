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

  if (loadErr) return h("div", { className: "pane", style: { padding: 24, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" } },
    h("div", { style: { color: "var(--neg)", fontSize: 13, fontWeight: 600 } }, "Falha ao carregar os dados do mês."),
    h("div", { style: { color: "var(--fg-3)", fontSize: 12 } }, "O servidor local não respondeu. Verifique se o BrokerShark está rodando."),
    h("button", { className: "btn btn-sm", onClick: () => setRetryTick(t => t + 1) }, "Tentar de novo")
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
    return h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: sub ? "2px 0" : "4px 0" } },
      h("span", { style: { fontSize: sub ? 12 : 13, color: sub ? "var(--fg-3)" : "var(--fg-2)", textTransform: strong ? "uppercase" : "none", letterSpacing: strong ? "0.04em" : "0", fontWeight: strong ? 600 : 400, paddingLeft: sub ? 10 : 0 } }, label),
      h("span", { className: "num", style: { fontWeight: strong ? 700 : 600, fontSize: strong ? 18 : 15, color: color || "var(--fg-0)" } },
        (negative ? "−" : "") + fmtBRL(Math.abs(value)))
    );
  }

  if (isFirstRun) {
    const Source = (color, name, ...lines) => h("div", { style: { borderLeft: `2px solid ${color}`, paddingLeft: 16 } },
      h("div", { style: { color: "var(--fg-1)", fontWeight: 700, fontSize: 13, marginBottom: 8 } }, name),
      ...lines.map((t, i) => h("div", { key: i, style: { fontSize: 11, color: "var(--fg-3)", marginBottom: 4 } }, "· ", t))
    );
    return h("div", { className: "fade-in" },
      h("div", { className: "pane" },
        h("div", { className: "pane-h" },
          h("div", { className: "pane-title" }, "Começar"),
          h("span", { style: { fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--ff-mono)" } }, "100% local · SQLite")
        ),
        h("div", { className: "pane-content", style: { padding: "32px 28px" } },
          h("div", { style: { fontSize: 20, fontWeight: 700, color: "var(--fg-0)", letterSpacing: "-0.01em" } }, "Nenhum dado ainda"),
          h("div", { style: { fontSize: 13, lineHeight: 1.6, maxWidth: 560, color: "var(--fg-2)", marginTop: 8 } },
            "O BrokerShark analisa seus dados localmente. Para começar, importe os extratos e faturas dos bancos ou o relatório de posições da corretora."
          ),

          // Fontes de dados (informação real, não decoração)
          h("div", { style: { marginTop: 28, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, borderTop: "1px solid var(--line-1)", paddingTop: 28 } },
            Source("#8A05BE", "Nubank", "Extrato da conta (CSV)", "Fatura do cartão (CSV)"),
            Source("#FF7A00", "Inter", "Extrato da conta (CSV)", "Fatura do cartão (CSV)"),
            Source("#0047BB", "B3", "Posições (XLSX)", "Exportado da Área do Investidor")
          ),

          onImport && h("button", {
            className: "btn btn-primary btn-lg", style: { marginTop: 32 }, onClick: onImport
          }, "Importar dados")
        )
      )
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },

    // Hero: Disponível pra gastar (liquidez) — 2 cards pane
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-hero)", gap: 14, marginBottom: 14 } },
      // Left: número herói + equação + sparkline de liquidez (now converted to Ledger UI)
      h("div", { className: "pane" },
        h("div", { className: "pane-h" },
          h("div", { className: "pane-title" }, "Disponível pra gastar")
        ),
        h("div", { className: "pane-content" },
          availErr
            ? h("div", { style: { padding: "8px 0", color: "var(--neg)", fontSize: 12 } }, "Falha ao carregar liquidez")
            : !available
              ? h(LedgerRow, { label: "Disponível", value: 0, strong: true })
              : h("div", null,
                  h(LedgerRow, { 
                    label: "Disponível", 
                    value: Math.abs(availValue), 
                    color: availNeg ? "var(--neg)" : "var(--pos)", 
                    negative: availNeg, 
                    strong: true 
                  }),
                  h(LedgerRow, { label: "Caixa (Contas)", value: available.checking_total, sub: true }),
                  h(LedgerRow, { label: "Faturas", value: available.faturas_total, sub: true, color: available.faturas_total > 0 ? "var(--neg)" : "var(--fg-3)", negative: available.faturas_total > 0 })
                )
        )
      ),
      // Right: patrimônio líquido — contas + investimentos − faturas em aberto
      h("div", { className: "pane" },
        h("div", { className: "pane-h" },
          h("div", { className: "pane-title" }, "Patrimônio líquido")
        ),
        h("div", { className: "pane-content" },
          h(LedgerRow, { label: "Patrimônio líquido", value: Math.abs(patrimonioLiquido), color: patrimonioLiquido < 0 ? "var(--neg)" : "var(--fg-0)", negative: patrimonioLiquido < 0, strong: true }),
          h(LedgerRow, { label: "Contas", value: checkingTotal, sub: true }),
          h(LedgerRow, { label: "Investimentos", value: totalReservas, sub: true, color: "var(--reserve)" }),
          h(LedgerRow, { label: "− Faturas em aberto", value: totalFaturas, sub: true, color: totalFaturas > 0 ? "var(--neg)" : "var(--fg-3)", negative: totalFaturas > 0 })
        )
      )
    ),

    // Faturas em aberto — o que vence (cards lado a lado)
    h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 2px 8px" } },
        h("div", { className: "pane-title" }, "Faturas em aberto"),
        h("span", { className: "num", style: { fontSize: "var(--fz-4)", fontWeight: 600 } }, fmtBRL(totalFaturas))
      ),
      faturas.length === 0
        ? h("div", { className: "pane", style: { padding: "20px 12px", textAlign: "center", color: "var(--fg-2)", fontSize: 12 } }, "Nenhuma fatura em aberto.")
        : h("div", { style: { display: "grid", gridTemplateColumns: faturas.length > 1 ? "1fr 1fr" : "1fr", gap: 14 } },
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
              const _bg1 = `color-mix(in oklch, ${color} 14%, var(--bg-2))`;
              
              return h("button", {
                key: i, onClick: () => onJumpToAccount && onJumpToAccount(f.accountId),
                className: "fatura-btn pane",
                style: { "--fatura-bg": _bg0, "--fatura-bg-hover": _bg1, display: "block", textAlign: "left", padding: 14, border: `1px solid color-mix(in oklch, ${color} 28%, var(--line-1))`, cursor: "pointer", minHeight: 44 },
              },
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 } },
                  h(BankChip, { bank: f.label.toLowerCase().startsWith("nu") ? "nubank" : "inter" }),
                  h("span", { style: { fontSize: 11, color, fontWeight: 600 } }, `vence ${due}`)
                ),
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
                  h("span", { className: "num", style: { fontSize: 22, fontWeight: 700 } }, fmtBRL(f.total)),
                  trend !== null && h("span", { style: { fontSize: 10, fontFamily: "var(--ff-mono)", color: trend >= 0 ? "var(--neg)" : "var(--pos)" } },
                    `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend).toFixed(1)}%`)
                ),
                h("div", { style: { fontSize: 9, color: "var(--fg-2)", fontFamily: "var(--ff-mono)", marginTop: 4 } },
                  `${fmtCycleDate(f.cycle_start)} → ${fmtCycleDate(f.cycle_end)}`
                ),
                cycleProj !== null && h("div", { style: { marginTop: 6, paddingTop: 5, borderTop: "1px dashed color-mix(in oklch, var(--line-2) 70%, transparent)", display: "flex", justifyContent: "space-between", fontSize: 9, fontFamily: "var(--ff-mono)" } },
                  h("span", { style: { color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em" } }, "estimativa fechamento"),
                  h("span", { style: { color: "var(--fg-2)" } }, `~ ${fmtBRL(cycleProj, { decimals: 0 })}`)
                )
              );
            })
          )
    ),

    // Este mês + Contas correntes (2 colunas, sem empilhar)
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-2)", gap: 14 } },
    // Este mês — cash flow statement
    cashflow && h("div", { className: "pane" },
      h("div", { className: "pane-h" },
        h("div", { className: "pane-title" }, "Este mês")
      ),
      h("div", { className: "pane-content", style: { display: "flex", flexDirection: "column", gap: 7 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
          h("span", { style: { color: "var(--neg)", fontSize: 13 } }, "↓ Despesas"),
          h("span", { className: "num", style: { color: "var(--neg)", fontWeight: 700, fontSize: 16 } }, fmtBRL(cashflow.expense_total))
        ),
        (cashflow.expense_by_source.cc > 0 || cashflow.expense_by_source.direct > 0) && h("div", {
          style: { textAlign: "right", fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--ff-mono)", marginTop: -4 }
        }, `${fmtBRL(cashflow.expense_by_source.cc, { decimals: 0 })} cartão · ${fmtBRL(cashflow.expense_by_source.direct, { decimals: 0 })} débito`),
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
          h("span", { style: { color: "var(--pos)", fontSize: 13 } }, "↑ Receitas"),
          h("span", { className: "num", style: { color: "var(--pos)", fontWeight: 700, fontSize: 16 } }, fmtBRL(cashflow.income_total))
        ),
        cashflow.investment_net !== 0 && h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
          h("span", { style: { color: cashflow.investment_net > 0 ? "var(--reserve)" : "var(--info)", fontSize: 13 } },
            cashflow.investment_net > 0 ? "→ Investido" : "← Resgatado"),
          h("span", { className: "num", style: { color: cashflow.investment_net > 0 ? "var(--reserve)" : "var(--info)", fontWeight: 700, fontSize: 16 } },
            fmtBRL(Math.abs(cashflow.investment_net)))
        ),
        h("div", { style: { borderTop: "1px solid var(--line-1)", paddingTop: 8, marginTop: 2, display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
          h("span", { style: { fontSize: 13, color: "var(--fg-1)", fontWeight: 600 } }, "Saldo livre"),
          h("span", { className: "num", style: { fontSize: 20, fontWeight: 700, color: cashflow.free_balance >= 0 ? "var(--pos)" : (cashflow.income_total === 0 ? "var(--warn)" : "var(--neg)") } }, fmtBRL(cashflow.free_balance))
        ),
        // Projeção de fechamento (run-rate) — só no mês atual. Bloco de ESTIMATIVA,
        // visualmente separado dos números reais acima (régua tracejada + cor atenuada),
        // para nunca ser confundido com fato.
        (() => {
          const now = new Date();
          const isCur = cashflow.month === now.getMonth() + 1 && cashflow.year === now.getFullYear();
          if (!isCur || cashflow.expense_total <= 0) return null;
          const daysElapsed = now.getDate();
          const daysInMonth = new Date(cashflow.year, cashflow.month, 0).getDate();
          const projExpense = cashflow.expense_total / daysElapsed * daysInMonth;
          const projFree = cashflow.income_total - projExpense - cashflow.investment_net;
          return h("div", { style: { marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--line-2)", display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
            h("span", { style: { fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--fg-3)", fontWeight: 600 } },
              "Estimativa · no ritmo atual"),
            h("span", { className: "num", style: { color: "var(--fg-2)", fontWeight: 600, fontSize: 13 } },
              "~ ", (projFree >= 0 ? "" : "−") + fmtBRL(Math.abs(projFree), { decimals: 0 }))
          );
        })()
      )
    ),

    // Contas correntes — onde está o caixa
    h("div", { className: "pane" },
      h("div", { className: "pane-h" },
        h("div", { className: "pane-title" }, "Contas correntes"),
        h("span", { className: "num", style: { fontSize: "var(--fz-4)", fontWeight: 600 } }, fmtBRL(checkingTotal))
      ),
      h("div", { className: "pane-content", style: { display: "flex", flexDirection: "column", gap: 2 } },
        checkingAccounts.length === 0
          ? h("div", { style: { padding: "16px 12px", textAlign: "center", color: "var(--fg-2)", fontSize: 12 } }, "Nenhuma conta corrente.")
          : checkingAccounts.map(a => h("button", {
              key: a.id, onClick: () => onJumpToAccount && onJumpToAccount(a.id),
              className: "fatura-btn",
              style: { "--fatura-bg": "transparent", "--fatura-bg-hover": "var(--bg-2)", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "6px 8px", borderRadius: "var(--r-2)", cursor: "pointer", minHeight: 36, textAlign: "left" },
            },
              h("span", { style: { display: "flex", alignItems: "center", gap: 8 } },
                h(BankChip, { bank: a.bank }),
                h("span", { style: { fontSize: 14, color: "var(--fg-1)" } }, a.name)
              ),
              h("span", { className: "num", style: { fontSize: 17, fontWeight: 600, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
            ))
      )
    ),
    ),

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
    h("div", { style: { overflow: "auto", borderBottomLeftRadius: 4, borderBottomRightRadius: 4 } },
      h("table", { className: "grid-table" },
        h("thead", null,
          h("tr", null,
            h("th", null, "Nome da Categoria"),
            h("th", { style: { width: 120, textAlign: "right" } }, "Lançamentos"),
            h("th", { style: { width: 80 } })
          )
        ),
        h("tbody", null,
          cats.map(cat => h("tr", { key: cat.id },
            h("td", { style: { fontWeight: 500, color: "var(--fg-1)" } }, cat.name),
            h("td", { className: "num", style: { textAlign: "right", color: "var(--fg-2)" } }, cat.transaction_count),
            h("td", { style: { textAlign: "right", paddingRight: 8 } },
              h("button", {
                className: "btn btn-ghost btn-sm",
                style: { color: "var(--neg)", padding: "2px 6px", fontSize: 11, minHeight: 24 },
                onClick: () => { setDeleteModal(cat); setReassignTo(""); setErr(""); }
              }, "Excluir")
            )
          ))
        )
      )
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
