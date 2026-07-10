/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/* view-overview.js — OverviewView (tela "Dinheiro") + CategoriesPanel */
/* global React, fetchAvailable, fetchAccounts,
          fetchMonthTransactions, fetchCashflowStatement, fetchInvestments,
          fetchLiquidityHistory, fetchExpenseCategoriesFull, postCategory, deleteCategory,
          fetchRecentTransactions, patchTransaction, fetchMonthlyFull */

const { useState: _ovSt, useEffect: _ovEf, useMemo: _ovMemo } = React;
const { fmtBRL, fmtBRLCompact, fmtDateBR, BankChip, DualLine, Modal, PT_MONTHS, PT_SHORT, fmtCycleDate } = window.BS;

/* ── OverviewView — tela "Dinheiro" ──────────────────────────────────────────
   "Como estou agora": herói Disponível pra gastar (/api/available = contas).
   ledger Patrimônio líquido, contas, atividade recente e projeções advisory. Sempre mês atual. */
function OverviewView({ onJumpToAccount, onEditCategory, onDeleteTx, refreshKey, filterMonth, onImport }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  const [available, setAvailable]   = _ovSt(null);
  const [availErr, setAvailErr]     = _ovSt(false);
  const [loadErr, setLoadErr]       = _ovSt(false);
  const [retryTick, setRetryTick]   = _ovSt(0);
  const [accounts, setAccounts]     = _ovSt([]);
  const [activity, setActivity]     = _ovSt([]);
  const [cashflow, setCashflow]     = _ovSt(null);
  const [investments, setInvestments] = _ovSt([]);
  const [liquidityHistory, setLiquidityHistory] = _ovSt([]);

  _ovEf(() => {
    const parts = filterMonth ? filterMonth.split("-").map(Number) : [];
    const [year, month] = parts.length === 2 ? parts : [null, null];
    setAvailErr(false); setLoadErr(false);
    fetchAvailable().then(setAvailable).catch(() => setAvailErr(true));
    Promise.all([
      fetchAccounts(),
      fetchMonthTransactions((month && year) ? { month, year } : {}),
      fetchCashflowStatement((month && year) ? { month, year } : {}),
      fetchInvestments(),
      fetchLiquidityHistory()
    ]).then(([ac, a, cf, invs, lh]) => {
      setAccounts(ac); setActivity(a); setCashflow(cf);
      setInvestments(invs);
      setLiquidityHistory(lh || []);
    }).catch(() => setLoadErr(true));
  }, [refreshKey, filterMonth, retryTick]);

  if (loadErr) return h("div", { style: { background: "color-mix(in oklch, var(--neg) 5%, transparent)", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", maxWidth: 480 } },
    h("div", { style: { color: "var(--neg)", fontSize: 14, fontWeight: 700 } }, "Falha ao carregar os dados do mês."),
    h("div", { style: { color: "var(--fg-2)", fontSize: 13 } }, "O servidor local não respondeu. Verifique se o BrokerShark está rodando."),
    h("button", { className: "btn btn-ghost", style: { color: "var(--neg)", padding: "6px 12px", border: "1px solid color-mix(in oklch, var(--neg) 30%, transparent)", borderRadius: 6, fontWeight: 600 }, onClick: () => setRetryTick(t => t + 1) }, "Tentar de novo")
  );

  if (!cashflow) return h("div", { style: { padding: 24, color: "var(--fg-2)" } }, "Carregando…");

  // Checking accounts only, for the "Contas correntes" card.
  const checkingAccounts = accounts.filter(a => a.type === "checking");
  const bankColorOf = a => (a.bank === "nubank" || (a.id || "").startsWith("nu")) ? "var(--nubank)" : "var(--inter)";
  // Nubank first, then Inter — stable order for the split bar + ledger.
  const sortedAccounts = [...checkingAccounts].sort(
    (a, b) => ((a.id || "").startsWith("nu") ? 1 : 2) - ((b.id || "").startsWith("nu") ? 1 : 2));

  const totalReservas   = investments.reduce((s, inv) => s + (inv.balance || 0), 0);
  // Use the same checking number as the hero (investment-adjusted) for consistency.
  const checkingTotal   = available ? available.checking_total : checkingAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  // Patrimônio líquido = saldo de todas as contas + investimentos.
  const patrimonioLiquido = checkingTotal + totalReservas;

  const now = new Date();
  const isCur = cashflow && cashflow.month === now.getMonth() + 1 && cashflow.year === now.getFullYear();
  const displayExpense = cashflow ? cashflow.expense_total : 0;
  const displayFree = cashflow 
    ? (cashflow.income_total - displayExpense - cashflow.investment_net)
    : 0;

  // Trend do patrimônio = /api/liquidity-history: caixa mensal + carteira de
  // investimentos com carry-forward de snapshots — MESMA composição do headline
  // (caixa + investimentos), então o delta "vs mês passado" compara igual com igual.
  const _seriesDelta = (hist) => hist.length > 1
    ? hist[hist.length - 1].value - hist[hist.length - 2].value : null;
  const deltaLiquidez = _seriesDelta(liquidityHistory);

  function Sparkline({ data, width = 120, height = 40, color = "var(--accent)", fill = "var(--accent-bg)" }) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const coords = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;  // 2px breathing room top/bottom
      return [x, y];
    });
    const points = coords.map(([x, y]) => `${x},${y}`).join(" ");
    const area = `${coords[0][0]},${height} ${points} ${coords[coords.length - 1][0]},${height}`;
    return h("svg", { width, height, viewBox: `0 0 ${width} ${height}`, style: { overflow: "visible", display: "block" } },
      fill && h("polygon", { points: area, fill, stroke: "none" }),
      h("polyline", { fill: "none", stroke: color, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", points })
    );
  }

  // Sparkline of a 12-month series + a signed month-over-month delta caption.
  // No axis labels: it conveys direction (the actual question), not absolute values.
  function TrendLine({ history, delta, color, width = 132 }) {
    if (!history || history.length < 2) return null;
    const up = (delta || 0) >= 0;
    return h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
      h(Sparkline, { data: history.map(p => p.value), width, height: 44, color: color || "var(--accent)" }),
      delta !== null && h("div", { style: { display: "flex", flexDirection: "column", lineHeight: 1.25 } },
        h("span", { className: "mono", style: { fontSize: 13, fontWeight: 700, color: up ? "var(--pos)" : "var(--neg)" } },
          (up ? "+" : "−") + fmtBRL(Math.abs(delta))),
        h("span", { style: { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 } }, "vs mês passado")
      )
    );
  }

  // First-run: nothing imported yet → single invite, no ghost zero-cards.
  const isFirstRun = !availErr && available
    && available.checking_total === 0
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
    const [open, setOpen] = _ovSt(false);
    // Reveals on hover AND keyboard focus (Esc closes), so the breakdown — which IS
    // the answer on a data tool — is reachable without a mouse and selectable.
    return h("div", {
      style: { position: "relative", display: "inline-block" },
      tabIndex: 0,
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
      onKeyDown: e => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }
    },
      children,
      open && h("div", {
        className: "fade-in",
        style: {
          position: "absolute",
          [position === "bottom" ? "top" : "bottom"]: "100%",
          left: "50%",
          transform: `translateX(-50%) translateY(${position === "bottom" ? "12px" : "-12px"})`,
          background: "var(--bg-0)",
          border: "1px solid var(--line-1)",
          boxShadow: "0 12px 24px oklch(0% 0 0 / 0.4)",
          borderRadius: 12,
          padding: "16px",
          minWidth: 260,
          zIndex: 100,
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

  if (isFirstRun) {
    const SourceRow = (bank, format, type) => h("tr", { style: { borderBottom: "1px solid var(--line-1)", fontSize: 13 } },
      h("td", { style: { padding: "8px 0", color: "var(--fg-1)", fontWeight: 600 } }, bank),
      h("td", { style: { padding: "8px 0", color: "var(--fg-3)" } }, type),
      h("td", { style: { padding: "8px 0", color: "var(--fg-2)", textAlign: "right", fontFamily: "var(--ff-mono)" } }, format)
    );

    return h("div", { className: "fade-in", style: { width: "100%", maxWidth: 640 } },
      h("div", { className: "pane" },
        h("div", { className: "pane-h", style: { background: "var(--bg-2)" } },
          h("div", { className: "pane-title" }, "Sem dados ainda")
        ),
        h("div", { className: "pane-content", style: { padding: "32px" } },
          h("div", { style: { fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6, marginBottom: 32 } },
            "Importe extratos para ver quanto você pode gastar."
          ),

          h("div", { style: { marginBottom: 12, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontWeight: 700 } }, "Formatos Suportados"),
          h("table", { style: { width: "100%", borderCollapse: "collapse", marginBottom: 32 } },
            h("tbody", null,
              SourceRow("Nubank", "*.csv", "Conta Corrente"),
              SourceRow("Inter", "*.csv", "Conta Corrente"),
              SourceRow("B3 (Bolsa)", "*.xlsx", "Relatório de Posições")
            )
          ),

          onImport && h("div", { style: { display: "flex", gap: 12, alignItems: "center" } },
            h("button", {
              className: "btn btn-primary", 
              style: { fontSize: 13, padding: "8px 16px", borderRadius: 4, fontWeight: 600 },
              onClick: onImport
            }, "Importar Arquivos"),
            h("span", { style: { fontSize: 12, color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 6 } }, "Atalho", h("span", { className: "kbd" }, "i"))
          )
        )
      )
    );
  }

  // mono number used across the balanço grid — single source of the style.
  const balNum = (value, color, extra = {}) => h("div", {
    className: "mono",
    style: { fontSize: 22, fontWeight: 700, color, letterSpacing: "-0.02em", lineHeight: 1, ...extra }
  }, value);

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 16 } },

    // ── 1. THE MONTH AT A GLANCE (Hero Panel) ──
    // Left = the answer ("quanto posso gastar") + where the cash sits, one block.
    // Right = the month's flow. A 1px rule separates the two, no decorative gap.
    h("div", { className: "panel", style: { display: "grid", gridTemplateColumns: "1.25fr 1fr", alignItems: "stretch" } },

      // Left: Disponível pra gastar + caixa por conta
      h("div", { style: { display: "flex", flexDirection: "column", gap: 16, padding: 28 } },
        h("div", { className: "eyebrow", style: { fontSize: 12 } }, "Disponível pra gastar"),
        availErr
          ? h("div", { style: { color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)", padding: "12px 16px", borderRadius: 8, border: "1px dashed color-mix(in oklch, var(--neg) 30%, transparent)", fontSize: 13, fontWeight: 600 } }, "Falha ao carregar liquidez")
          : !available
            ? h("div", { style: { height: 56, width: 240, borderRadius: 8, background: "var(--bg-2)", opacity: 0.5 } })
            : h(BreakdownPopover, {
                position: "bottom",
                totalLabel: "Disponível",
                totalValue: availValue,
                items: [{ label: "Saldo nas Contas", value: available.checking_total }]
              },
                h("div", { className: "mono", style: { fontSize: 52, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 0.95, color: availNeg ? "var(--neg)" : "var(--pos)", cursor: "help", display: "inline-block" } },
                  (availNeg ? "−" : "") + fmtBRL(Math.abs(availValue)))
              ),

        // Split bar — proporção do caixa por banco (cores de banco = identidade visual)
        checkingTotal > 0 && sortedAccounts.length > 1 && h("div", { style: { display: "flex", gap: 3, height: 5 } },
          sortedAccounts.map(a => {
            const pct = ((a.balance || 0) / checkingTotal) * 100;
            return pct > 0.5 && h("div", { key: a.id, title: `${a.name}: ${pct.toFixed(0)}%`, style: { width: pct + "%", background: bankColorOf(a), borderRadius: 2, opacity: 0.85 } });
          })
        ),

        // Ledger de contas — clicável → Histórico filtrado pela conta
        checkingAccounts.length > 0 && h("div", { style: { display: "flex", flexDirection: "column", marginTop: 2 } },
          sortedAccounts.map((a, i, arr) => h("button", {
            key: a.id, className: "row-hover",
            onClick: () => onJumpToAccount && onJumpToAccount(a.id),
            title: "Ver no Histórico",
            style: { display: "flex", justifyContent: "space-between", alignItems: "center", height: 42, padding: "0 10px", margin: "0 -10px", background: "transparent", border: "none", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none", cursor: "pointer", textAlign: "left", borderRadius: 6 }
          },
            h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
              h("div", { style: { width: 8, height: 8, borderRadius: "50%", background: bankColorOf(a) } }),
              h("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-1)" } }, a.name)),
            h("span", { className: "mono", title: checkingTotal > 0 ? `${(((a.balance || 0) / checkingTotal) * 100).toFixed(0)}% do caixa` : "", style: { fontSize: 14, fontWeight: 600, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
          ))
        )
      ),

      // Right: Balanço do Mês — separated by a 1px rule
      cashflow && h("div", { style: { display: "flex", flexDirection: "column", gap: 20, padding: 28, borderLeft: "1px solid var(--line-1)" } },
        h("div", { className: "eyebrow", style: { fontSize: 12 } }, "Balanço deste mês"),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px 20px" } },
          h("div", null,
            h("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Receitas"),
            balNum("+" + fmtBRL(cashflow.income_total), "var(--pos)")
          ),
          h("div", null,
            h("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Despesas"),
            h(BreakdownPopover, {
              items: [{ label: "Gastos em Conta (Débito/PIX/TED)", value: cashflow.expense_total, negative: true }],
              totalLabel: "Total Despesas",
              totalValue: -displayExpense
            }, balNum("−" + fmtBRL(displayExpense), "var(--neg)", { cursor: "help", display: "inline-block" }))
          ),
          h("div", null,
            h("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Investimentos"),
            balNum(fmtBRL(Math.abs(cashflow.investment_net)), cashflow.investment_net === 0 ? "var(--fg-3)" : (cashflow.investment_net > 0 ? "var(--reserve)" : "var(--info)"))
          ),
          h("div", null,
            h("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Saldo livre"),
            h(BreakdownPopover, {
              items: [
                { label: "Receitas", value: cashflow.income_total },
                { label: "Despesas", value: displayExpense, negative: true },
                { label: "Investimentos", value: cashflow.investment_net, negative: cashflow.investment_net > 0 }
              ],
              totalLabel: "Saldo Livre",
              totalValue: displayFree
            }, balNum((displayFree >= 0 ? "+" : "−") + fmtBRL(Math.abs(displayFree)), displayFree >= 0 ? "var(--pos)" : (cashflow.income_total === 0 ? "var(--warn)" : "var(--neg)"), { cursor: "help", display: "inline-block" }))
          )
        )
      )
    ),

    // ── 2. PATRIMÔNIO ──
    // Headline = patrimônio atual preciso (caixa + investimentos), breakdown real no
    // popover. Trend/delta = liquidity-history (mesma composição, mês a mês).
    h("div", { className: "panel", style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, padding: "20px 28px", flexShrink: 0 } },
      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 } }, "Patrimônio líquido global"),
        h(BreakdownPopover, {
          position: "top",
          items: [
            { label: "Caixa (Contas Correntes)", value: checkingTotal },
            { label: "Investimentos", value: totalReservas }
          ],
          totalLabel: "Patrimônio",
          totalValue: patrimonioLiquido
        },
          h("div", { className: "mono", style: { fontSize: 28, fontWeight: 700, color: patrimonioLiquido < 0 ? "var(--neg)" : "var(--fg-0)", cursor: "help", display: "inline-block", letterSpacing: "-0.025em", lineHeight: 1 } },
             (patrimonioLiquido < 0 ? "−" : "") + fmtBRL(Math.abs(patrimonioLiquido))
          )
        )
      ),
      h(TrendLine, { history: liquidityHistory, delta: deltaLiquidez, color: "var(--accent)", width: 180 })
    ),

    // ── 3. ATIVIDADE DO MÊS ──
    // The home's "o que aconteceu" peek. Uses month-transactions (carries
    // counterpart + is_revenue), so TxRow tags SELF / investimento correctly —
    // recent-activity omits those fields and would mislabel transfers.
    h("div", { className: "panel", style: { display: "flex", flexDirection: "column", overflow: "hidden" } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--line-1)" } },
        h("div", { className: "eyebrow", style: { fontSize: 12 } }, "Atividade do mês"),
        h("div", { style: { flex: 1 } }),
        h("span", { className: "mono", style: { fontSize: 11, color: "var(--fg-3)" } },
          `${activity.length} ${activity.length === 1 ? "lançamento" : "lançamentos"}`)
      ),
      activity.length === 0
        ? h("div", { style: { padding: "32px 24px", textAlign: "center", color: "var(--fg-3)", fontSize: 13 } }, "Nenhum lançamento neste mês.")
        : h("div", { style: { maxHeight: 460, overflowY: "auto" } },
            h("table", { className: "grid-table" },
              h("tbody", null,
                [...activity]
                  .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id - a.id))
                  .map(t => h(window.BS.TxRow, { key: t.id, t, cols: ["date", "desc", "cat", "account", "amount"], onEditCategory }))
              )
            )
          )
    )
  );
}

/* ── CategoriesPanel — gerenciar categorias (Drawer via TweaksPanel) ──────────
   Restaurada após o pivot ter apagado a declaração da função mas deixado o corpo
   (form + lista + modal de exclusão) preso dentro de OverviewView, que quebrava
   a tela Dinheiro com dados (`handleAdd`/`CategoriesPanel is not defined`). */
function CategoriesPanel({ refreshKey, onRefresh, onClose }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [flow, setFlow] = _ovSt("expense");
  const [cats, setCats] = _ovSt([]);
  const [newName, setNewName] = _ovSt("");
  const [adding, setAdding] = _ovSt(false);
  const [err, setErr] = _ovSt("");
  const [deleteModal, setDeleteModal] = _ovSt(null); // {id, name, transaction_count}
  const [reassignTo, setReassignTo] = _ovSt("");
  const [deleting, setDeleting] = _ovSt(false);

  _ovEf(() => { fetchCategoriesFull(flow).then(setCats); }, [flow, refreshKey]);

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
    } catch (ex) { setErr(ex.message); } finally { setAdding(false); }
  }

  async function handleDelete() {
    if (!deleteModal || !reassignTo) return;
    setDeleting(true); setErr("");
    try {
      await deleteCategory(deleteModal.id, parseInt(reassignTo));
      setDeleteModal(null); setReassignTo("");
      fetchCategoriesFull(flow).then(setCats);
      onRefresh && onRefresh();
    } catch (ex) { setErr(ex.message); } finally { setDeleting(false); }
  }

  const otherCats = deleteModal ? cats.filter(c => c.id !== deleteModal.id) : cats;

  return h("div", { className: "fade-in", style: { padding: "20px 0", maxWidth: 640, margin: "0 auto" } },
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
        onClose && h("button", {
          onClick: onClose, title: "Voltar",
          style: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "var(--bg-1)", border: "1px solid var(--line-1)", color: "var(--fg-2)", cursor: "pointer", transition: "all 0.1s" },
          onMouseEnter: e => { e.currentTarget.style.color = "var(--fg-0)"; e.currentTarget.style.background = "var(--bg-2)"; },
          onMouseLeave: e => { e.currentTarget.style.color = "var(--fg-2)"; e.currentTarget.style.background = "var(--bg-1)"; }
        }, "←"),
        h("span", { style: { fontWeight: 700, fontSize: "var(--fz-4)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-2)" } }, "Gerenciar Categorias")
      ),
      h(window.BS.SegmentControl, {
        options: [{ value: "expense", label: "Despesas" }, { value: "income", label: "Receitas" }],
        value: flow, onChange: setFlow, columns: 2,
      })
    ),

    h("div", { className: "panel", style: { display: "flex", flexDirection: "column", overflow: "hidden" } },

      // Inline Add Form (First Row)
      h("form", { onSubmit: handleAdd, style: { display: "flex", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-0)" } },
        h("div", { style: { width: 8, height: 8, borderRadius: "50%", background: "transparent", border: "1px dashed var(--fg-3)", marginRight: 12 } }),
        h("input", {
          type: "text", placeholder: `Adicionar nova categoria de ${flow === 'expense' ? 'despesa' : 'receita'}...`, value: newName,
          onChange: e => setNewName(e.target.value),
          style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--fg-1)", fontSize: 14, fontWeight: 500, padding: 0 }
        }),
        h("button", {
          type: "submit", disabled: adding || !newName.trim(),
          style: { fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 8px", background: "var(--bg-2)", borderRadius: 4, cursor: newName.trim() ? "pointer" : "default", opacity: newName.trim() ? 1 : 0.5 }
        }, adding ? "..." : "ENTER ↵")
      ),
      err && h("div", { style: { padding: "12px 24px", color: "var(--neg)", fontSize: 12, background: "color-mix(in oklch, var(--neg) 10%, transparent)", borderBottom: "1px solid var(--line-1)" } }, err),

      // Categories List
      h("div", { style: { display: "flex", flexDirection: "column" } },
        cats.length === 0 
          ? h("div", { style: { padding: 32, textAlign: "center", color: "var(--fg-3)", fontSize: 13, fontStyle: "italic" } }, "Nenhuma categoria cadastrada.")
          : cats.map((cat, i) => h("div", { 
              key: cat.id, 
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", borderBottom: i < cats.length - 1 ? "1px dashed var(--line-1)" : "none", transition: "background 0.1s" },
              onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-2)",
              onMouseLeave: (e) => e.currentTarget.style.background = "transparent",
            },
              h("div", { style: { fontWeight: 500, color: "var(--fg-1)", display: "flex", alignItems: "center", gap: 12, fontSize: 14 } }, 
                h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: flow === 'expense' ? "var(--neg)" : "var(--pos)" } }),
                cat.name
              ),
              h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
                h("div", { className: "num", style: { color: "var(--fg-3)", fontSize: 13 } }, `${cat.transaction_count} lançamentos`),
                h("button", {
                  title: "Excluir",
                  style: { color: "var(--fg-3)", fontSize: 16, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", cursor: "pointer", transition: "color 0.1s, background 0.1s" },
                  onMouseEnter: (e) => { e.currentTarget.style.color = "var(--neg)"; e.currentTarget.style.background = "color-mix(in oklch, var(--neg) 10%, transparent)"; },
                  onMouseLeave: (e) => { e.currentTarget.style.color = "var(--fg-3)"; e.currentTarget.style.background = "transparent"; },
                  onClick: () => { setDeleteModal(cat); setReassignTo(cat.transaction_count > 0 ? "" : "0"); setErr(""); }
                }, "×")
              )
            ))
      )
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

})();
