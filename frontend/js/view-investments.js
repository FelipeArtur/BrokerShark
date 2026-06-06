/* view-investments.js — InvestmentsView (aba "Investimentos") */
/* global React, fetchInvestments, fetchInvestmentMovements, patchInvestmentBalance, fetchInvestmentEvolution, postInvestmentMovement */

const { useState: _s3St, useEffect: _s3Ef, useMemo: _s3Memo } = React;
const { fmtBRL, BankChip, SingleAreaChart, Modal, Donut } = window.BS;

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

/* Parse a BRL amount the way the backend parse_money does — so "1.000,50"
   (dot thousands + comma decimal) becomes 1000.5 instead of parseFloat's 1.0.
   Returns NaN on empty/garbage. */
function _parseMoneyBR(raw) {
  let s = String(raw == null ? "" : raw).trim().replace(/\s/g, "");
  if (!s) return NaN;
  if (s.includes(",")) {                 // comma = decimal → dots are thousands
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {  // multiple dots → all thousands
    s = s.replace(/\./g, "");
  } else if (/\.\d{3}$/.test(s)) {        // single dot + exactly 3 trailing → thousands
    s = s.replace(/\./g, "");
  }
  return parseFloat(s);
}


/* ── AssetDetailsModal ───────────────────────────────────────────────────── */
function AssetDetailsModal({ asset, onClose }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [movements, setMovements] = _s3St([]);
  _s3Ef(() => {
    fetchInvestmentMovements({ investment_id: asset.id }).then(setMovements);
  }, [asset.id]);

  return h(window.BS.Modal, { open: true, onClose, title: "Detalhes do Ativo", width: 500 },
    h("div", { style: { display: "flex", flexDirection: "column", gap: 24, padding: "8px 0" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
        h("div", null,
          h("div", { style: { fontSize: 20, fontWeight: 800, color: "var(--fg-0)", marginBottom: 4 } }, asset.name),
          h("div", { style: { fontSize: 13, color: "var(--fg-3)" } }, _INV_TYPE_LABEL[asset.type] || "Investimento")
        ),
        h("div", { style: { textAlign: "right" } },
          h("div", { style: { fontSize: 12, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 } }, "Saldo Atual"),
          h("div", { className: "num", style: { fontSize: 24, fontWeight: 800, color: "var(--fg-1)" } }, window.BS.fmtBRL ? window.BS.fmtBRL(asset.balance || 0) : asset.balance)
        )
      ),
      h("div", null,
        h("div", { style: { fontSize: 14, fontWeight: 700, color: "var(--fg-2)", marginBottom: 12 } }, "Histórico de Movimentos"),
        movements.length === 0 ? h("div", { style: { color: "var(--fg-3)", fontSize: 13 } }, "Nenhum movimento registrado.") :
        h("div", { style: { display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto", paddingRight: 8 } },
          movements.map(m => {
            const isDeposit = m.operation === "deposit";
            return h("div", { key: m.id, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", background: "var(--bg-2)", borderRadius: 8 } },
              h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
                h("span", { style: { display: "inline-block", padding: "4px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: isDeposit ? "var(--reserve)" : "var(--info)", background: "color-mix(in oklch, " + (isDeposit ? "var(--reserve)" : "var(--info)") + " 15%, transparent)" } }, isDeposit ? "Aplicação" : "Resgate"),
                h("span", { className: "mono", style: { color: "var(--fg-3)", fontSize: 12 } }, window.BS.fmtDateBR ? window.BS.fmtDateBR(m.date) : m.date.slice(0, 10))
              ),
              h("div", { className: "num", style: { display: "flex", alignItems: "center", gap: 6 } },
                h("span", { style: { color: "var(--fg-3)", fontSize: 11 } }, isDeposit ? "+" : "−"),
                h("span", { style: { color: isDeposit ? "var(--fg-0)" : "var(--fg-1)", fontWeight: 700, fontSize: 14 } }, window.BS.fmtBRL ? window.BS.fmtBRL(m.amount) : m.amount)
              )
            );
          })
        )
      )
    )
  );
}

/* ── InvestmentsView ─────────────────────────────────────────────────────── */
function InvestmentsView({ refreshKey, filterMonth }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [investments, setInvestments] = _s3St([]);
  const [periodMovements, setPeriodMovements] = _s3St([]);
  const [evolution, setEvolution] = _s3St([]);
  const [bankFilter, setBankFilter] = _s3St("all");
  const [categoryFilter, setCategoryFilter] = _s3St(null);
  const [historyMode, setHistoryMode] = _s3St("month");
  const [detailsAsset, setDetailsAsset] = _s3St(null);

  _s3Ef(() => { 
    fetchInvestments().then(setInvestments); 
    fetchInvestmentEvolution().then(setEvolution);
  }, [refreshKey]);
  
  _s3Ef(() => {
    if (historyMode === "all" || !filterMonth || filterMonth === "all") {
      fetchInvestmentMovements({}).then(setPeriodMovements);
    } else {
      const [year, month] = filterMonth.split("-").map(Number);
      fetchInvestmentMovements({ month, year }).then(setPeriodMovements);
    }
  }, [filterMonth, historyMode, refreshKey]);

  const typeLabel = (t) => _INV_TYPE_LABEL[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Investimento");

  const filteredInvestments = _s3Memo(() => investments.filter(inv => {
    if (bankFilter !== "all" && inv.bank !== bankFilter) return false;
    if (categoryFilter && typeLabel(inv.type) !== categoryFilter) return false;
    return true;
  }), [investments, bankFilter, categoryFilter]);

  const total = filteredInvestments.reduce((sum, inv) => sum + (inv.balance || 0), 0);

  const grouped = _s3Memo(() => {
    const g = {};
    filteredInvestments.forEach(inv => {
      const t = typeLabel(inv.type);
      if (!g[t]) g[t] = [];
      g[t].push(inv);
    });
    return Object.entries(g).sort((a, b) => b[1].reduce((s, x) => s + x.balance, 0) - a[1].reduce((s, x) => s + x.balance, 0));
  }, [filteredInvestments]);

  const summaryByCategory = grouped.map(([name, invs], idx) => {
    return {
      name,
      balance: invs.reduce((s, x) => s + (x.balance || 0), 0),
      color: _INV_COLORS[idx % _INV_COLORS.length]
    };
  });

  const displayedMovements = _s3Memo(() => periodMovements.filter(m => {
    if (bankFilter !== "all" && m.bank !== bankFilter) return false;
    if (categoryFilter) {
      const inv = investments.find(i => i.id === m.investment_id);
      if (inv && typeLabel(inv.type) !== categoryFilter) return false;
    }
    return true;
  }), [periodMovements, bankFilter, categoryFilter, investments]);

  if (investments.length === 0) {
    return h("div", { className: "fade-in pane", style: { padding: 40, textAlign: "center", color: "var(--fg-3)" } },
      h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-2)", marginBottom: 6 } }, "Nenhum investimento cadastrado"),
      h("div", { style: { fontSize: 11 } }, "Importe um Relatório B3 (.xlsx) pelo botão Importar.")
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 32, paddingBottom: 40 } },
    
    h("div", { style: { display: "flex", justifyContent: "flex-end" } },
      h("div", { className: "filter-pills" },
        [{ id: "all", label: "Todas Instituições" }, { id: "nubank", label: "Nubank" }, { id: "inter", label: "Banco Inter" }, { id: "b3", label: "B3 / Outras" }].map(b => h("button", {
          key: b.id, onClick: () => { setBankFilter(b.id); setCategoryFilter(null); },
          className: `filter-pill${bankFilter === b.id ? " active" : ""}`
        }, b.label))
      )
    ),

    // Top Section: 2 columns (Summary vs Ledger)
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 32 } },
      
      // Left: Overview & Donut
      h("div", { style: { background: "var(--bg-1)", padding: 32, borderRadius: 16, border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "start" } },
        h("div", { style: { width: "100%", textAlign: "left" } },
          h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 16 } }, "Total investido"),
          h("div", { className: "num", style: { fontSize: 56, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--fg-0)", lineHeight: 1 } }, fmtBRL(total))
        ),
        
        h("div", { style: { display: "flex", justifyContent: "center", marginTop: 40, marginBottom: 40 } },
          h(Donut, { data: summaryByCategory, size: 220, thickness: 32, valueKey: "balance", colors: summaryByCategory.map(s => s.color) })
        ),
        
        h("div", { style: { display: "flex", flexDirection: "column", gap: 12, width: "100%" } },
          summaryByCategory.map((cat, i) => {
            const pct = total ? (cat.balance / total) * 100 : 0;
            return h("div", { key: i, onClick: () => setCategoryFilter(categoryFilter === cat.name ? null : cat.name), className: "row-hover", style: { display: "flex", alignItems: "center", gap: 12, fontSize: 13, padding: "8px 12px", margin: "0 -12px", borderRadius: 8, cursor: "pointer", background: categoryFilter === cat.name ? "var(--bg-2)" : undefined } },
              h("span", { style: { width: 12, height: 12, borderRadius: 4, background: cat.color, display: "inline-block", flexShrink: 0 } }),
              h("span", { style: { flex: 1, color: "var(--fg-1)", fontWeight: 600 } }, cat.name),
              h("span", { className: "num", style: { color: "var(--fg-3)", width: 44, textAlign: "right", fontWeight: 500 } }, pct.toFixed(1), "%"),
              h("span", { className: "num", style: { width: 90, textAlign: "right", color: "var(--fg-0)", fontWeight: 700 } }, fmtBRL(cat.balance))
            );
          })
        )
      ),

      // Right: Full Ledger
      h("div", { style: { background: "var(--bg-1)", padding: 32, borderRadius: 16, border: "1px solid var(--line-1)", display: "flex", flexDirection: "column" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--line-1)", paddingBottom: 16, marginBottom: 24 } },
          h("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--fg-1)" } }, "Ativos em carteira")
        ),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 32 } },
          grouped.map(([groupName, groupInvs], gIdx) => h("div", { key: groupName },
            h("div", { style: { display: "flex", alignItems: "baseline", borderBottom: "1px solid var(--line-1)", paddingBottom: 8, marginBottom: 12 } },
              h("div", { style: { flex: 1, fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, groupName)
            ),
            h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
              groupInvs.map((inv) => {
                const bal = inv.balance || 0;
                const pct = total ? (bal / total) * 100 : 0;
                const color = summaryByCategory[gIdx].color;
                return h("div", { key: inv.id, onClick: () => setDetailsAsset(inv), className: "row-hover", style: { display: "flex", alignItems: "center", padding: "10px 12px", margin: "0 -12px", borderRadius: 8, cursor: "pointer" } },
                  h("div", { style: { display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0 } },
                    h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 } }),
                    h("div", { style: { fontWeight: 600, fontSize: 14, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, inv.name),
                    h(BankChip, { bank: inv.bank })
                  ),
                  h("div", { style: { display: "flex", alignItems: "center", gap: 24 } },
                    h("span", { className: "num", style: { fontSize: 12, color: "var(--fg-3)", width: 44, textAlign: "right" } }, pct.toFixed(1), "%"),
                    h("div", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--fg-1)", width: 120, textAlign: "right" } }, fmtBRL(bal))
                  )
                );
              })
            )
          ))
        )
      )
    ),

    // Grid for Period Movements & Evolution
    h("div", { style: { display: "grid", gridTemplateColumns: displayedMovements.length > 0 ? "1fr 1.5fr" : "1fr", gap: 32, marginTop: 16 } },
      
      // Movimentos
      displayedMovements.length > 0 && h("div", { style: { background: "var(--bg-1)", padding: 32, borderRadius: 16, border: "1px solid var(--line-1)", overflowX: "auto" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--line-1)", paddingBottom: 16, marginBottom: 24 } },
          h("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--fg-1)" } }, "Histórico de Movimentos"),
          h("div", { className: "filter-pills" },
            [{ id: "month", label: "Neste Mês" }, { id: "all", label: "Histórico Completo" }].map(hm => h("button", {
              key: hm.id, onClick: () => setHistoryMode(hm.id),
              className: `filter-pill${historyMode === hm.id ? " active" : ""}`
            }, hm.label))
          )
        ),
        h("table", { className: "grid-table" },
          h("thead", null, h("tr", null,
            h("th", { style: { width: 90 } }, "Data"),
            h("th", { style: { width: 140 } }, "Operação"),
            h("th", null, "Posição"),
            h("th", { style: { width: 120 } }, "Corretora"),
            h("th", { style: { textAlign: "right", width: 140 } }, "Valor")
          )),
          h("tbody", null,
            displayedMovements.map((m, i) => {
              const isDeposit = m.operation === "deposit";
              return h("tr", { key: i },
                h("td", { className: "mono", style: { color: "var(--fg-3)", fontSize: 11 } }, window.BS.fmtDateBR ? window.BS.fmtDateBR(m.date) : m.date.slice(0, 10)),
                h("td", null, h("span", { style: { display: "inline-block", padding: "4px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: isDeposit ? "var(--reserve)" : "var(--info)", background: "color-mix(in oklch, " + (isDeposit ? "var(--reserve)" : "var(--info)") + " 15%, transparent)" } }, isDeposit ? "Aplicação" : "Resgate")),
                h("td", { style: { fontWeight: 600, color: "var(--fg-1)" } }, (investments.find(inv => inv.id === m.investment_id) || {}).name || "Ativo desconhecido"),
                h("td", null, h(BankChip, { bank: m.bank })),
                h("td", { className: "num", style: { textAlign: "right" } },
                  h("div", { style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 } },
                    h("span", { style: { color: "var(--fg-3)", fontSize: 11 } }, isDeposit ? "+" : "−"),
                    h("span", { style: { color: isDeposit ? "var(--fg-0)" : "var(--fg-1)", fontWeight: 700, fontSize: 14 } }, fmtBRL(m.amount))
                  )
                )
              );
            })
          )
        )
      ),

      // Evolução chart
      evolution.length > 0 && h("div", { style: { background: "var(--bg-1)", padding: 32, borderRadius: 16, border: "1px solid var(--line-1)" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--line-1)", paddingBottom: 16, marginBottom: 24 } },
          h("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--fg-1)" } }, "Evolução do Patrimônio"),
          h("span", { style: { fontSize: 12, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 } }, "12 meses")
        ),
        h("div", { style: { height: 260, paddingBottom: 16 } },
          h(SingleAreaChart, { data: evolution.map(e => ({ label: e.label, value: e.cumulative })), height: 240, color: "var(--info)" })
        )
      )
    ),


    detailsAsset && h(AssetDetailsModal, {
      asset: detailsAsset,
      onClose: () => setDetailsAsset(null)
    })
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { InvestmentsView });
