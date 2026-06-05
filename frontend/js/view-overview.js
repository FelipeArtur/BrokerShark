/* view-overview.js — OverviewView (tela "Dinheiro") + CategoriesPanel */
/* global React, fetchSummary, fetchFaturas, fetchAvailable, fetchAccounts,
          fetchMonthTransactions, fetchCashflowStatement, fetchInvestments,
          fetchPatrimonioHistory, fetchExpenseCategoriesFull, postCategory, deleteCategory,
          fetchRecentTransactions */

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
  const [investments, setInvestments] = _ovSt([]);
  const [patrimonioHistory, setPatrimonioHistory] = _ovSt([]);

  const [faturaReceipt, setFaturaReceipt] = _ovSt(null);
  const [faturaTxs, setFaturaTxs] = _ovSt(null);

  _ovEf(() => {
    if (faturaReceipt) {
      setFaturaTxs(null);
      fetchRecentTransactions(faturaReceipt.accountId, { limit: 200 }).then(txs => {
        const s = faturaReceipt.start.split("/").reverse().join("-");
        const e = faturaReceipt.end.split("/").reverse().join("-");
        const filtered = txs.filter(t => t.date >= s && t.date <= e).sort((a,b) => a.date > b.date ? -1 : 1);
        setFaturaTxs(filtered);
      });
    }
  }, [faturaReceipt]);

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
      fetchInvestments(),
      fetchPatrimonioHistory()
    ]).then(([s, f, ac, a, cf, invs, ph]) => {
      setSummary(s); setFaturas(f);
      setAccounts(ac); setActivity(a); setCashflow(cf);
      setInvestments(invs);
      setPatrimonioHistory(ph || []);
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
  const totalReservas   = investments.reduce((s, inv) => s + (inv.balance || 0), 0);
  // Use the same checking number as the hero (investment-adjusted) for consistency.
  const checkingTotal   = available ? available.checking_total : checkingAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  // Patrimônio líquido = o que sobra se você quitar todas as faturas em aberto agora.
  const patrimonioLiquido = checkingTotal + totalReservas - totalFaturas;

  const now = new Date();
  const isCur = cashflow && cashflow.month === now.getMonth() + 1 && cashflow.year === now.getFullYear();
  const displayExpense = cashflow 
    ? (isCur && cashflow.expense_by_source ? (cashflow.expense_by_source.direct + totalFaturas) : cashflow.expense_total) 
    : 0;
  const displayFree = cashflow 
    ? (cashflow.income_total - displayExpense - cashflow.investment_net)
    : 0;

  const lastMonthPatrimonio = patrimonioHistory.length > 1 ? patrimonioHistory[patrimonioHistory.length - 2].value : null;
  const deltaPatrimonio = lastMonthPatrimonio !== null ? patrimonioLiquido - lastMonthPatrimonio : null;
  const deltaPercent = lastMonthPatrimonio ? (deltaPatrimonio / Math.abs(lastMonthPatrimonio)) * 100 : null;

  function Sparkline({ data, width = 120, height = 40, color = "var(--reserve)" }) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(" ");
    return h("svg", { width, height, viewBox: `0 0 ${width} ${height}`, style: { overflow: "visible" } },
      h("polyline", { fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", points })
    );
  }

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

  function BreakdownPopover({ children, items, totalLabel, totalValue, position = "bottom" }) {
    const [isHovered, setIsHovered] = _ovSt(false);
    return h("div", {
      style: { position: "relative", display: "inline-block" },
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false)
    },
      children,
      isHovered && h("div", {
        className: "fade-in",
        style: {
          position: "absolute",
          [position === "bottom" ? "top" : "bottom"]: "100%",
          left: "50%",
          transform: `translateX(-50%) translateY(${position === "bottom" ? "12px" : "-12px"})`,
          background: "var(--bg-0)",
          border: "1px solid var(--line-1)",
          boxShadow: "0 12px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
          borderRadius: 12,
          padding: "16px",
          minWidth: 260,
          zIndex: 100,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          whiteSpace: "nowrap"
        }
      },
        items.filter(Boolean).map((it, idx) => h("div", { key: idx, style: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, gap: 16 } },
          h("span", { style: { color: "var(--fg-2)" } }, it.label),
          h("span", { style: { color: it.negative ? "var(--neg)" : "var(--fg-1)", fontWeight: 600, fontFamily: "monospace" } }, (it.negative ? "−" : "") + fmtBRL(Math.abs(it.value)))
        )),
        (totalLabel !== undefined) && h("div", { style: { borderTop: "1px dashed var(--line-2)", marginTop: 4, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 700 } },
          h("span", { style: { color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 11 } }, totalLabel),
          h("span", { style: { color: totalValue < 0 ? "var(--neg)" : "var(--pos)", fontFamily: "monospace" } }, (totalValue < 0 ? "−" : "") + fmtBRL(Math.abs(totalValue)))
        )
      )
    );
  }

  function HeroStat({ label, value, color, negative, items, totalLabel, position }) {
    const stat = h("div", { style: { display: "flex", flexDirection: "column", gap: 4, cursor: items ? "help" : "inherit" } },
      h("span", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 } }, label),
      h("span", { className: "num", style: { fontSize: 15, fontWeight: 700, color: color || "var(--fg-1)" } }, (negative ? "−" : "") + fmtBRL(Math.abs(value)))
    );
    if (!items) return stat;
    return h(BreakdownPopover, { items, totalLabel, totalValue: value, position }, stat);
  }

  if (isFirstRun) {
    const SourceRow = (bank, format, type) => h("tr", { style: { borderBottom: "1px solid var(--line-1)", fontSize: 13 } },
      h("td", { style: { padding: "8px 0", color: "var(--fg-1)", fontWeight: 600 } }, bank),
      h("td", { style: { padding: "8px 0", color: "var(--fg-3)" } }, type),
      h("td", { style: { padding: "8px 0", color: "var(--fg-2)", textAlign: "right", fontFamily: "var(--ff-mono)" } }, format)
    );

    return h("div", { className: "fade-in", style: { width: "100%", maxWidth: 640 } },
      h("div", { className: "pane" },
        h("div", { className: "pane-h", style: { background: "var(--bg-2)" } },
          h("div", { className: "pane-title" }, "Banco de Dados Vazio")
        ),
        h("div", { className: "pane-content", style: { padding: "32px" } },
          h("div", { style: { fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6, marginBottom: 32 } },
            "O banco de dados local SQLite está vazio.",
            h("br"),
            "É necessário importar extratos e faturas para iniciar as análises."
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
              style: { fontSize: 13, padding: "8px 16px", borderRadius: 4, fontWeight: 600 },
              onClick: onImport
            }, "Importar Arquivos"),
            h("span", { style: { fontSize: 12, color: "var(--fg-3)" } }, "Atalho: i")
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
                h(BreakdownPopover, {
                  position: "bottom",
                  totalLabel: "Disponível",
                  totalValue: availValue,
                  items: [
                    { label: "Saldo nas Contas", value: available.checking_total },
                    { label: "Faturas Acumuladas", value: available.faturas_total, negative: true }
                  ]
                },
                  h("div", { className: "num", style: { fontSize: 56, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: availNeg ? "var(--neg)" : "var(--pos)", marginBottom: 24, cursor: "help", display: "inline-block" } },
                    (availNeg ? "−" : "") + fmtBRL(Math.abs(availValue))
                  )
                ),
                h("div", { style: { display: "flex", gap: 24 } },
                  h(HeroStat, { 
                    label: "Saldo nas Contas", value: available.checking_total, color: "var(--fg-1)",
                    items: checkingAccounts.map(a => ({ label: a.name, value: a.balance })), totalLabel: "Total Caixa", position: "bottom"
                  }),
                  h("div", { style: { width: 1, background: "var(--line-2)" } }),
                  h(HeroStat, { 
                    label: "Faturas Acumuladas", value: available.faturas_total, color: available.faturas_total > 0 ? "var(--neg)" : "var(--fg-2)", negative: available.faturas_total > 0,
                    items: faturas.map(f => ({ label: f.label, value: f.total, negative: true })), totalLabel: "Total Dívida", position: "bottom"
                  })
                )
              )
      ),

      // Right: Balanço do Mês
      cashflow && h("div", { style: { display: "flex", flexDirection: "column" } },
        h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 16 } }, "Balanço deste mês"),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, flex: 1, alignContent: "center" } },
          h("div", null,
            h("div", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 8 } }, "Receitas"),
            h(BreakdownPopover, { items: [{ label: "Total Receitas", value: cashflow.income_total }] },
              h("div", { className: "num", style: { fontSize: 24, fontWeight: 800, color: "var(--pos)", letterSpacing: "-0.02em", lineHeight: 1, cursor: "help", display: "inline-block" } }, "+" + fmtBRL(cashflow.income_total))
            )
          ),
          h("div", null,
            h("div", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 8 } }, "Despesas"),
            h(BreakdownPopover, {
              items: [
                { label: "Gastos em Conta (Débito/PIX/TED)", value: cashflow.expense_by_source ? cashflow.expense_by_source.direct : cashflow.expense_total, negative: true },
                (isCur && totalFaturas > 0) ? { label: "Faturas Acumuladas (Crédito)", value: totalFaturas, negative: true } : (cashflow.expense_by_source && { label: "Faturas do Cartão (Crédito)", value: cashflow.expense_by_source.cc, negative: true })
              ],
              totalLabel: "Total Despesas",
              totalValue: -displayExpense
            },
              h("div", { className: "num", style: { fontSize: 24, fontWeight: 800, color: "var(--neg)", letterSpacing: "-0.02em", lineHeight: 1, cursor: "help", display: "inline-block" } }, "−" + fmtBRL(displayExpense))
            )
          ),
          h("div", null,
            h("div", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 8 } }, "Investimentos"),
            h(BreakdownPopover, { items: [{ label: "Movimento Líquido", value: cashflow.investment_net, negative: cashflow.investment_net < 0 }] },
              h("div", { className: "num", style: { fontSize: 24, fontWeight: 800, color: cashflow.investment_net === 0 ? "var(--fg-3)" : (cashflow.investment_net > 0 ? "var(--reserve)" : "var(--info)"), letterSpacing: "-0.02em", lineHeight: 1, cursor: "help", display: "inline-block" } }, fmtBRL(Math.abs(cashflow.investment_net)))
            )
          ),
          h("div", null,
            h("div", { style: { fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 8 } }, "Saldo livre"),
            h(BreakdownPopover, {
              items: [
                { label: "Receitas", value: cashflow.income_total },
                { label: "Despesas", value: displayExpense, negative: true },
                { label: "Investimentos", value: cashflow.investment_net, negative: cashflow.investment_net > 0 }
              ],
              totalLabel: "Saldo Livre",
              totalValue: displayFree
            },
              h("div", { className: "num", style: { fontSize: 24, fontWeight: 800, color: displayFree >= 0 ? "var(--pos)" : (cashflow.income_total === 0 ? "var(--warn)" : "var(--neg)"), letterSpacing: "-0.02em", lineHeight: 1, cursor: "help", display: "inline-block" } }, (displayFree >= 0 ? "+" : "−") + fmtBRL(Math.abs(displayFree)))
            )
          )
        )
      )
    ),

    // ── 2. PATRIMÔNIO (Vault Card) ──
    h("div", { style: { position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", background: "linear-gradient(135deg, var(--bg-1) 0%, color-mix(in oklch, var(--bg-1) 90%, var(--reserve)) 100%)", padding: "32px 40px", borderRadius: 16, border: "1px solid var(--line-1)", flexShrink: 0, boxShadow: "0 8px 32px rgba(0,0,0,0.12)" } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: 16, position: "relative", zIndex: 1, width: "100%" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
            h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
              h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 } }, "Patrimônio líquido global"),
              deltaPatrimonio !== null && h("div", { title: "Diferença do patrimônio global vs. mês passado", style: { cursor: "help", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--fg-2)", padding: "4px 10px", background: "color-mix(in oklch, var(--fg-0) 4%, transparent)", borderRadius: 100 } },
                h("span", { style: { color: deltaPatrimonio >= 0 ? "var(--pos)" : "var(--neg)", fontSize: 14 } }, deltaPatrimonio >= 0 ? "▲" : "▼"),
                h("span", null, `${fmtBRL(Math.abs(deltaPatrimonio))} este mês`)
              )
            ),
            h(BreakdownPopover, {
              position: "top",
              items: [
                { label: "Caixa (Contas Correntes)", value: checkingTotal },
                { label: "Investimentos", value: totalReservas },
                { label: "Faturas Acumuladas", value: totalFaturas, negative: true }
              ],
              totalLabel: "Patrimônio",
              totalValue: patrimonioLiquido
            },
              h("div", { className: "num", style: { fontSize: 36, fontWeight: 800, color: patrimonioLiquido < 0 ? "var(--neg)" : "var(--fg-0)", cursor: "help", display: "inline-block", letterSpacing: "-0.02em", lineHeight: 1 } },
                 (patrimonioLiquido < 0 ? "−" : "") + fmtBRL(Math.abs(patrimonioLiquido))
              )
            )
          ),
          h("div", { style: { display: "flex", flexDirection: "column", gap: 12, minWidth: 280 } },
            (() => {
              const assets = checkingTotal + totalReservas;
              const liabilities = totalFaturas;
              const total = assets + liabilities || 1;
              const pctAssets = (assets / total) * 100;
              const pctLiabs = (liabilities / total) * 100;
              return h("div", { style: { display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--line-1)" } },
                h("div", { style: { width: `${pctAssets}%`, background: "var(--reserve)" } }),
                h("div", { style: { width: `${pctLiabs}%`, background: "var(--neg)" } })
              );
            })(),
            h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12 } },
              h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                h("div", { style: { width: 8, height: 8, borderRadius: "50%", background: "var(--reserve)" } }),
                h("span", { style: { color: "var(--fg-2)" } }, "Seu Dinheiro "),
                h("strong", { style: { color: "var(--fg-1)" } }, fmtBRL(checkingTotal + totalReservas))
              ),
              h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                h("div", { style: { width: 8, height: 8, borderRadius: "50%", background: "var(--neg)" } }),
                h("span", { style: { color: "var(--fg-2)" } }, "Dívidas "),
                h("strong", { style: { color: "var(--fg-1)" } }, fmtBRL(totalFaturas))
              )
            )
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
          : h("div", { className: "custom-scrollbar", style: { display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1, paddingRight: 8, marginRight: -8 } },
              faturas.map((f, i) => {
                const tone = f.days_until_due <= 3 ? "neg" : f.days_until_due <= 7 ? "warn" : "ok";
                const color = tone === "neg" ? "var(--neg)" : tone === "warn" ? "var(--warn)" : "var(--pos)";
                const due = f.days_until_due > 0 ? `em ${f.days_until_due}d` : f.days_until_due === 0 ? "hoje" : `há ${Math.abs(f.days_until_due)}d`;
                const trend = (f.last_total > 0) ? ((f.total - f.last_total) / f.last_total) * 100 : null;
                const _bg0 = `color-mix(in oklch, ${color} 10%, transparent)`;
                
                const isNu = f.label.toLowerCase().includes("nu");
                const bankColor = isNu ? "var(--nubank, #8a05be)" : "var(--inter, #ff7a00)";
                
                return h("button", {
                  key: i, onClick: () => setFaturaReceipt({ accountId: f.accountId, label: f.label, start: f.cycle_start, end: f.cycle_end, total: f.total, bankColor }),
                  className: "fatura-btn",
                  style: { position: "relative", background: "var(--bg-0)", display: "block", textAlign: "left", padding: "16px 20px", borderRadius: 12, border: "1px solid var(--line-1)", cursor: "pointer", transition: "transform 0.1s, box-shadow 0.1s", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
                },
                  h("div", { style: { position: "absolute", top: -1, left: -1, bottom: -1, width: 4, background: bankColor, borderRadius: "12px 0 0 12px" } }),
                  h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
                    h("span", { style: { fontSize: 13, fontWeight: 700, color: "var(--fg-1)", display: "flex", alignItems: "center", gap: 8 } }, 
                      h("div", { style: { width: 12, height: 12, borderRadius: 3, background: bankColor } }), 
                      f.label
                    ),
                    h("span", { style: { fontSize: 11, color, fontWeight: 700, background: _bg0, padding: "4px 8px", borderRadius: 100, textTransform: "uppercase", letterSpacing: "0.04em" } }, `vence ${due}`)
                  ),
                  h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
                    h("span", { className: "num", style: { fontSize: 24, fontWeight: 800, color: "var(--fg-0)", letterSpacing: "-0.02em" } }, fmtBRL(f.total)),
                    trend !== null && h("span", { title: "Crescimento vs Mês Passado", style: { cursor: "help", fontSize: 12, fontWeight: 700, color: trend >= 0 ? "var(--neg)" : "var(--pos)", display: "flex", gap: 4, alignItems: "center" } },
                      trend >= 0 ? "↗" : "↘", `${Math.abs(trend).toFixed(1)}%`)
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
        h("div", { className: "custom-scrollbar", style: { display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1, paddingRight: 8, marginRight: -8 } },
          checkingAccounts.length === 0
            ? h("div", { style: { padding: "16px 0", color: "var(--fg-3)", fontSize: 13, fontStyle: "italic" } }, "Nenhuma conta corrente.")
            : checkingAccounts.map(a => {
                const isNu = a.name.toLowerCase().includes("nu");
                const bankColor = isNu ? "var(--nubank, #8a05be)" : "var(--inter, #ff7a00)";
                const pct = checkingTotal > 0 ? ((a.balance || 0) / checkingTotal) * 100 : 0;
                
                return h("button", {
                  key: a.id, onClick: () => onJumpToAccount && onJumpToAccount(a.id),
                  className: "fatura-btn",
                  style: { position: "relative", background: "var(--bg-0)", border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 16, padding: "16px 20px", borderRadius: 12, cursor: "pointer", transition: "transform 0.1s, box-shadow 0.1s", textAlign: "left", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
                },
                  h("div", { style: { position: "absolute", top: -1, left: -1, bottom: -1, width: 4, background: bankColor, borderRadius: "12px 0 0 12px" } }),
                  h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" } },
                    h("span", { style: { fontSize: 13, fontWeight: 700, color: "var(--fg-1)", display: "flex", alignItems: "center", gap: 8 } }, 
                      h("div", { style: { width: 12, height: 12, borderRadius: 3, background: bankColor } }), 
                      a.name
                    ),
                    h("span", { className: "num", style: { fontSize: 20, fontWeight: 800, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)", letterSpacing: "-0.02em" } }, fmtBRL(a.balance || 0))
                  ),
                  h("div", { title: `Representa ${pct.toFixed(1)}% do seu Caixa`, style: { width: "100%", height: 4, background: "var(--line-1)", borderRadius: 2, overflow: "hidden" } },
                    h("div", { style: { width: `${pct}%`, height: "100%", background: bankColor } })
                  )
                );
              })
        )
      )
    ),

    faturaReceipt && h(Modal, {
      open: true,
      title: `Fatura ${faturaReceipt.label}`,
      onClose: () => setFaturaReceipt(null),
      width: 500
    },
      h("div", { style: { padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 24 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-1)", padding: 16, borderRadius: 12, border: "1px solid var(--line-1)" } },
          h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
            h("div", { style: { fontSize: 12, color: "var(--fg-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" } }, "Total da fatura"),
            h("div", { className: "num", style: { fontSize: 28, fontWeight: 800, color: "var(--fg-0)", letterSpacing: "-0.02em" } }, fmtBRL(faturaReceipt.total))
          ),
          h("div", { style: { textAlign: "right" } },
             h("div", { style: { fontSize: 12, color: "var(--fg-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 } }, "Período"),
             h("div", { style: { fontSize: 13, color: "var(--fg-1)", fontFamily: "var(--ff-mono)" } }, `${faturaReceipt.start} - ${faturaReceipt.end}`)
          )
        ),
        
        !faturaTxs ? h("div", { style: { padding: 32, textAlign: "center", color: "var(--fg-3)" } }, "Carregando compras...") :
        faturaTxs.length === 0 ? h("div", { style: { padding: 32, textAlign: "center", color: "var(--fg-3)", fontStyle: "italic" } }, "Nenhuma compra importada para este período.") :
        h("div", { className: "custom-scrollbar", style: { display: "flex", flexDirection: "column", maxHeight: 400, overflowY: "auto", paddingRight: 8, marginRight: -8 } },
          faturaTxs.map((t, i) => h("div", {
            key: t.id,
            style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < faturaTxs.length - 1 ? "1px dashed var(--line-1)" : "none" }
          },
            h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
              h("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--fg-1)" } }, t.description),
              h("div", { style: { fontSize: 11, color: "var(--fg-3)", display: "flex", gap: 8, fontFamily: "var(--ff-mono)" } },
                h("span", null, fmtDateBR(t.date)),
                t.category && h("span", { style: { background: "var(--bg-2)", padding: "2px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em" } }, t.category)
              )
            ),
            h("div", { className: "num", style: { fontSize: 15, fontWeight: 700, color: "var(--fg-0)" } }, fmtBRL(t.amount))
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
