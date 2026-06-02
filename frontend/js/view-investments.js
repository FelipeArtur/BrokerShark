/* view-investments.js — InvestmentsView (aba "Investimentos") */
/* global React, fetchInvestments, fetchInvestmentMovements, patchInvestmentBalance */

const { useState: _s3St, useEffect: _s3Ef } = React;
const { fmtBRL, BankChip, Donut } = window.BS;

const _INV_TYPE_LABEL = {
  savings:  "Poupança",
  treasury: "Tesouro Direto",
  cdb:      "CDB / Renda fixa",
  lci:      "LCI / Renda fixa",
  lca:      "LCA / Renda fixa",
};

const _INV_COLORS = [
  "oklch(72% 0.12 290)", "oklch(72% 0.13 230)", "oklch(72% 0.14 155)",
  "oklch(74% 0.13 60)",  "oklch(70% 0.15 20)",  "oklch(72% 0.10 330)",
];

/* ── InvestmentsView ─────────────────────────────────────────────────────── */
function InvestmentsView({ refreshKey, filterMonth }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [investments, setInvestments] = _s3St([]);
  const [editingId, setEditingId] = _s3St(null);
  const [editInput, setEditInput] = _s3St("");
  const [editErr, setEditErr] = _s3St("");
  const [periodMovements, setPeriodMovements] = _s3St([]);

  _s3Ef(() => { fetchInvestments().then(setInvestments); }, [refreshKey]);
  _s3Ef(() => {
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
  const typeLabel = (t) => _INV_TYPE_LABEL[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Investimento");
  const donutData = investments.map(i => ({ ...i }));

  if (investments.length === 0) {
    return h("div", { className: "fade-in pane", style: { padding: 40, textAlign: "center", color: "var(--fg-3)" } },
      h("div", { style: { fontSize: 32, marginBottom: 10, opacity: 0.3 } }, "◈"),
      h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-2)", marginBottom: 6 } }, "Nenhum investimento cadastrado"),
      h("div", { style: { fontSize: 11 } }, "Importe um Relatório B3 (.xlsx) ou registre movimentos pelo bot.")
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 14 } },
    h("div", { style: { display: "grid", gridTemplateColumns: "var(--col-inv)", gap: 14 } },
      h("div", { style: { paddingBottom: 24 } },
        h("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Patrimônio em investimentos"),
        h("div", { className: "num", style: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" } }, fmtBRL(total)),
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", marginTop: 18 } },
          h(Donut, { data: donutData, size: 200, thickness: 28, valueKey: "balance", colors: _INV_COLORS })
        ),
        h("div", { style: { marginTop: 16, display: "flex", flexDirection: "column", gap: 6 } },
          investments.map((inv, i) => {
            const bal = inv.balance || 0;
            const pct = total ? (bal / total) * 100 : 0;
            return h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11 } },
              h("span", { style: { width: 10, height: 10, borderRadius: 2, background: _INV_COLORS[i % _INV_COLORS.length], display: "inline-block" } }),
              h("span", { style: { flex: 1, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, inv.name),
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
                      h("div", { style: { fontSize: 10, color: "var(--fg-3)", marginTop: 2 } }, typeLabel(inv.type))
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
          )
        )
      )
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { InvestmentsView });
