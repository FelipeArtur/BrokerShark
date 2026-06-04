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

/* ── MovementModal — register an application/withdrawal on a position ─────── */
function MovementModal({ investments, onClose, onDone }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [invName, setInvName] = _s3St(investments[0] ? investments[0].name : "");
  const [operation, setOperation] = _s3St("deposit");
  const [amount, setAmount] = _s3St("");
  const [dateStr, setDateStr] = _s3St(new Date().toISOString().slice(0, 10));
  const [err, setErr] = _s3St("");
  const [busy, setBusy] = _s3St(false);

  async function save() {
    const val = _parseMoneyBR(amount);
    if (isNaN(val) || val <= 0) { setErr("Valor inválido"); return; }
    if (!invName) { setErr("Selecione a posição"); return; }
    setErr(""); setBusy(true);
    try {
      await postInvestmentMovement({ investment_name: invName, operation, amount: val, date: dateStr });
      onDone(operation === "deposit" ? "Aplicação registrada" : "Resgate registrado");
    } catch (e) {
      setErr(e.message || "Erro ao registrar"); setBusy(false);
    }
  }

  const fieldStyle = { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--fg-3)" };

  return h(Modal, { open: true, onClose, title: "Registrar movimento", width: 420 },
    h("div", { style: { padding: 4 } },
      h("div", { style: fieldStyle },
        h("label", { style: labelStyle }, "Posição"),
        h("select", { className: "select", value: invName, onChange: e => setInvName(e.target.value), style: { height: 34 } },
          investments.map(inv => h("option", { key: inv.id, value: inv.name }, inv.name)))
      ),
      h("div", { style: fieldStyle },
        h("label", { style: labelStyle }, "Tipo"),
        h("div", { style: { display: "flex", gap: 6 } },
          [["deposit", "Aplicação"], ["withdrawal", "Resgate"]].map(([op, lbl]) => h("button", {
            key: op, type: "button", onClick: () => setOperation(op),
            className: `btn btn-sm ${operation === op ? "btn-primary" : "btn-ghost"}`,
            style: { flex: 1, height: 32 }
          }, lbl)))
      ),
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
        h("div", { style: fieldStyle },
          h("label", { style: labelStyle }, "Valor (R$)"),
          h("input", { className: "input", autoFocus: true, value: amount, inputMode: "decimal",
            onChange: e => { setAmount(e.target.value); setErr(""); },
            onKeyDown: e => { if (e.key === "Enter") save(); },
            placeholder: "0,00", style: { height: 34 } })
        ),
        h("div", { style: fieldStyle },
          h("label", { style: labelStyle }, "Data"),
          h("input", { className: "input", type: "date", value: dateStr,
            onChange: e => setDateStr(e.target.value), style: { height: 34 } })
        )
      ),
      err && h("div", { style: { fontSize: 11, color: "var(--neg)", marginBottom: 10 } }, err),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 } },
        h("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "Cancelar"),
        h("button", { className: "btn btn-primary btn-sm", onClick: save, disabled: busy, style: { minWidth: 80 } },
          busy ? "Salvando…" : "Salvar")
      )
    )
  );
}

/* ── InvestmentsView ─────────────────────────────────────────────────────── */
function InvestmentsView({ refreshKey, filterMonth }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const [investments, setInvestments] = _s3St([]);
  const [editingId, setEditingId] = _s3St(null);
  const [editInput, setEditInput] = _s3St("");
  const [editErr, setEditErr] = _s3St("");
  const [periodMovements, setPeriodMovements] = _s3St([]);
  const [evolution, setEvolution] = _s3St([]);
  const [movementOpen, setMovementOpen] = _s3St(false);
  const [toast, setToast] = _s3St("");

  _s3Ef(() => { 
    fetchInvestments().then(setInvestments); 
    fetchInvestmentEvolution().then(setEvolution);
  }, [refreshKey]);
  _s3Ef(() => {
    if (filterMonth && filterMonth !== "all") {
      const [year, month] = filterMonth.split("-").map(Number);
      fetchInvestmentMovements({ month, year }).then(setPeriodMovements);
    } else {
      setPeriodMovements([]);
    }
  }, [filterMonth, refreshKey]);

  async function saveBalance(inv) {
    const val = _parseMoneyBR(editInput);
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

  const total = investments.reduce((sum, inv) => sum + (inv.balance || 0), 0);
  const typeLabel = (t) => _INV_TYPE_LABEL[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Investimento");

  const grouped = _s3Memo(() => {
    const g = {};
    investments.forEach(inv => {
      const t = typeLabel(inv.type);
      if (!g[t]) g[t] = [];
      g[t].push(inv);
    });
    return Object.entries(g).sort((a, b) => b[1].reduce((s, x) => s + x.balance, 0) - a[1].reduce((s, x) => s + x.balance, 0));
  }, [investments]);

  const summaryByCategory = grouped.map(([name, invs], idx) => {
    return {
      name,
      balance: invs.reduce((s, x) => s + (x.balance || 0), 0),
      color: _INV_COLORS[idx % _INV_COLORS.length]
    };
  });

  if (investments.length === 0) {
    return h("div", { className: "fade-in pane", style: { padding: 40, textAlign: "center", color: "var(--fg-3)" } },
      h("div", { style: { fontSize: 32, marginBottom: 10, opacity: 0.3 } }, "◈"),
      h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--fg-2)", marginBottom: 6 } }, "Nenhum investimento cadastrado"),
      h("div", { style: { fontSize: 11 } }, "Importe um Relatório B3 (.xlsx) pelo botão Importar.")
    );
  }

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", gap: 32, paddingBottom: 40 } },
    
    // Top Section: 2 columns (Summary vs Ledger)
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 32 } },
      
      // Left: Overview & Donut
      h("div", { style: { background: "var(--bg-1)", padding: 32, borderRadius: 16, border: "1px solid var(--line-1)", display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "start" } },
        h("div", { style: { width: "100%", textAlign: "left" } },
          h("div", { style: { fontSize: 13, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 16 } }, "Total investido"),
          h("div", { className: "num", style: { fontSize: 48, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--fg-0)" } }, fmtBRL(total))
        ),
        
        h("div", { style: { display: "flex", justifyContent: "center", marginTop: 40, marginBottom: 40 } },
          h(Donut, { data: summaryByCategory, size: 220, thickness: 32, valueKey: "balance", colors: summaryByCategory.map(s => s.color) })
        ),
        
        h("div", { style: { display: "flex", flexDirection: "column", gap: 12, width: "100%" } },
          summaryByCategory.map((cat, i) => {
            const pct = total ? (cat.balance / total) * 100 : 0;
            return h("div", { key: i, style: { display: "flex", alignItems: "center", gap: 12, fontSize: 13 } },
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
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--line-0)", paddingBottom: 12, marginBottom: 24 } },
          h("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--fg-1)" } }, "Ativos em carteira"),
          h("div", { style: { display: "flex", alignItems: "center", gap: 16 } },
            h("span", { style: { fontSize: 11, color: "var(--fg-3)" } }, "clique no valor para corrigir"),
            h("button", { className: "btn btn-ghost btn-sm", onClick: () => setMovementOpen(true),
              style: { height: 30, padding: "0 12px", fontSize: 12, fontWeight: 600 } }, "+ Movimento")
          )
        ),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 32 } },
          grouped.map(([groupName, groupInvs], gIdx) => h("div", { key: groupName },
            h("div", { style: { display: "flex", alignItems: "baseline", borderBottom: "1px solid var(--line-0)", paddingBottom: 8, marginBottom: 12 } },
              h("div", { style: { flex: 1, fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" } }, groupName)
            ),
            h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
              groupInvs.map((inv) => {
                const bal = inv.balance || 0;
                const pct = total ? (bal / total) * 100 : 0;
                const isEditing = editingId === inv.id;
                const color = summaryByCategory[gIdx].color;

                return h("div", { key: inv.id, style: { display: "flex", alignItems: "center", padding: "10px 0", transition: "background 0.1s" } },
                  h("div", { style: { display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0 } },
                    h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 } }),
                    h("div", { style: { fontWeight: 600, fontSize: 14, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, inv.name),
                    h(BankChip, { bank: inv.bank })
                  ),
                  !isEditing
                    ? h("div", { style: { display: "flex", alignItems: "center", gap: 24 } },
                        h("span", { className: "num", style: { fontSize: 12, color: "var(--fg-3)", width: 44, textAlign: "right" } }, pct.toFixed(1), "%"),
                        h("button", {
                          onClick: () => { setEditingId(inv.id); setEditInput(bal.toFixed(2).replace(".", ",")); setEditErr(""); },
                          style: { textAlign: "right", background: "none", border: "none", cursor: "pointer", padding: 0 }
                        },
                          h("div", { className: "num", style: { fontSize: 16, fontWeight: 700, color: "var(--fg-1)", borderBottom: "1px dashed var(--line-2)" } }, fmtBRL(bal))
                        )
                      )
                    : h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
                        h("input", {
                          autoFocus: true, className: "input", value: editInput,
                          onChange: e => { setEditInput(e.target.value); setEditErr(""); },
                          onKeyDown: e => { if (e.key === "Enter") saveBalance(inv); if (e.key === "Escape") { setEditingId(null); setEditErr(""); } },
                          style: { width: 120, textAlign: "right", fontSize: 15, height: 30, padding: "0 8px" }
                        }),
                        h("button", { className: "btn btn-primary btn-sm", onClick: () => saveBalance(inv), style: { height: 30, padding: "0 10px" } }, "✓"),
                        h("button", { className: "btn btn-ghost btn-sm", onClick: () => { setEditingId(null); setEditErr(""); }, style: { height: 30, padding: "0 10px" } }, "✕")
                      ),
                  isEditing && editErr && h("div", { style: { fontSize: 11, color: "var(--neg)", marginTop: 4, width: "100%", textAlign: "right" } }, editErr)
                );
              })
            )
          ))
        )
      )
    ),

    // Grid for Period Movements & Evolution
    h("div", { style: { display: "grid", gridTemplateColumns: periodMovements.length > 0 ? "1fr 1.5fr" : "1fr", gap: 32, marginTop: 16 } },
      
      // Movimentos
      periodMovements.length > 0 && h("div", { style: { background: "var(--bg-1)", padding: 32, borderRadius: 16, border: "1px solid var(--line-1)", overflowX: "auto" } },
        h("div", { style: { fontSize: 15, fontWeight: 700, color: "var(--fg-1)", borderBottom: "1px solid var(--line-0)", paddingBottom: 16, marginBottom: 24 } }, "Histórico de Movimentos"),
        h("table", { className: "grid-table" },
          h("thead", null, h("tr", null,
            h("th", { style: { width: 90 } }, "Data"),
            h("th", { style: { width: 140 } }, "Operação"),
            h("th", null, "Posição"),
            h("th", { style: { width: 120 } }, "Corretora"),
            h("th", { style: { textAlign: "right", width: 140 } }, "Valor")
          )),
          h("tbody", null,
            periodMovements.map((m, i) => {
              const isDeposit = m.operation === "deposit";
              return h("tr", { key: i },
                h("td", { className: "mono", style: { color: "var(--fg-3)", fontSize: 11 } }, window.BS.fmtDateBR ? window.BS.fmtDateBR(m.date) : m.date.slice(0, 10)),
                h("td", null, h("span", { className: "data-tag", style: { color: isDeposit ? "var(--reserve)" : "var(--info)", borderColor: `color-mix(in oklch, ${isDeposit ? "var(--reserve)" : "var(--info)"} 30%, transparent)` } }, isDeposit ? "Aplicação" : "Resgate")),
                h("td", { style: { fontWeight: 500, color: "var(--fg-0)" } }, m.investment_name),
                h("td", null, h(window.BS.BankChip, { bank: m.bank })),
                h("td", { className: "num", style: { textAlign: "right" } },
                  h("div", { style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 } },
                    h("span", { style: { color: "var(--fg-3)", fontSize: 10 } }, isDeposit ? "+" : "−"),
                    h("span", { style: { color: isDeposit ? "var(--pos)" : "var(--neg)", fontWeight: 600 } }, fmtBRL(m.amount))
                  )
                )
              );
            })
          )
        )
      ),

      // Evolução chart
      evolution.length > 0 && h("div", { style: { background: "var(--bg-1)", padding: 32, borderRadius: 16, border: "1px solid var(--line-1)" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--line-0)", paddingBottom: 16, marginBottom: 24 } },
          h("div", { style: { fontSize: 15, fontWeight: 700, color: "var(--fg-1)" } }, "Evolução do Patrimônio"),
          h("span", { style: { fontSize: 12, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 } }, "12 meses")
        ),
        h("div", { style: { height: 260, paddingBottom: 16 } },
          h(SingleAreaChart, { data: evolution.map(e => ({ label: e.label, value: e.cumulative })), height: 240, color: "var(--info)" })
        )
      )
    ),

    movementOpen && h(MovementModal, {
      investments,
      onClose: () => setMovementOpen(false),
      onDone: (msg) => {
        setMovementOpen(false);
        setToast(msg);
        setTimeout(() => setToast(""), 2500);
        // SSE will refresh balances; nudge local state immediately too
        fetchInvestments().then(setInvestments);
      }
    }),

    toast && h("div", {
      style: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        background: "var(--pos)", color: "#fff", padding: "10px 20px", borderRadius: 8,
        fontSize: 13, fontWeight: 600, zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }
    }, toast)
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { InvestmentsView });
