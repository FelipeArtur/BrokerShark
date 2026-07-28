(function () {

const { useState: _ivSt, useEffect: _ivEf } = React;

// Drill-down de posição: a promessa do Produto.md ("resumo no widget, posições
// em drill-down") não existia — as linhas do widget eram div sem onClick e não
// havia overlay nenhum. Clicar num investimento não fazia nada.
//
// Uma linha do widget pode representar MAIS DE UMA posição: posições do mesmo
// grupo vêm agregadas (×2). Por isso o painel recebe uma lista de ids e mostra
// um seletor quando há mais de uma.

function InvestmentPanel({ ids, title, onClose }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  // Toda data aqui atravessa anos (medição e vencimento), então nunca fmtDateBR.
  const { fmtBRL, fullDateBR } = window.BS;

  const [sel, setSel] = _ivSt(ids && ids.length ? ids[0] : null);
  const [pos, setPos] = _ivSt(null);
  const [names, setNames] = _ivSt({});
  const [err, setErr] = _ivSt("");

  _ivEf(() => {
    if (sel == null) return;
    setPos(null); setErr("");
    fetchInvestment(sel)
      .then(p => { setPos(p); setNames(n => ({ ...n, [p.id]: p.name })); })
      .catch(e => setErr(e.message || "Falha ao carregar a posição."));
  }, [sel]);

  // Carrega os nomes das irmãs pro seletor não mostrar id cru.
  _ivEf(() => {
    (ids || []).filter(id => id !== sel).forEach(id => {
      fetchInvestment(id).then(p => setNames(n => ({ ...n, [p.id]: p.name }))).catch(() => {});
    });
  }, []);

  const snaps = (pos && pos.snapshots) || [];
  const last = snaps.length ? snaps[snaps.length - 1] : null;
  const first = snaps.length ? snaps[0] : null;

  // Escala comum entre as barras: o maior líquido da série. Sem isso, um mês
  // ruim desenharia igual a um bom.
  const maxNet = snaps.reduce((m, s) => Math.max(m, s.net || 0), 0);

  const ficha = [
    pos && pos.code && ["Código", pos.code],
    pos && pos.type && ["Tipo", String(pos.type).toUpperCase()],
    pos && pos.indexer && ["Indexador", pos.indexer],
    pos && pos.rate_text && ["Taxa", pos.rate_text],
    pos && pos.maturity_date && ["Vencimento", fullDateBR(pos.maturity_date)],
    pos && pos.bank && ["Custódia", String(pos.bank).toUpperCase()],
    pos && pos.source && ["Origem", pos.source === "ledger" ? "derivada do extrato" : pos.source.toUpperCase()],
    pos && pos.closed_at && ["Encerrada em", fullDateBR(pos.closed_at)],
  ].filter(Boolean);

  return h("div", { className: "fade-in", style: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" } },

    h("div", { style: { padding: "20px 28px", borderBottom: "1px solid var(--line-1)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 } },
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("h2", { style: { margin: 0, fontFamily: "var(--ff-sans)", fontSize: 15, letterSpacing: "1px", textTransform: "uppercase", color: "var(--fg-0)" } },
          (pos && pos.name) || title || "Posição"),
        onClose && h("button", { className: "px-btn px-btn--ghost px-btn--sm", onClick: onClose, title: "Fechar (Esc)", "aria-label": "Fechar" }, "✕"),
      ),

      ids && ids.length > 1 && h(window.BS.SegmentControl, {
        options: ids.map(id => ({ value: id, label: names[id] || `#${id}` })),
        value: sel, onChange: setSel, columns: Math.min(ids.length, 3), fill: true,
      }),

      last && h("div", { style: { display: "flex", gap: 28, alignItems: "baseline", flexWrap: "wrap" } },
        h("div", null,
          h("div", { style: { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontFamily: "var(--ff-sans)" } }, "Valor líquido"),
          h("div", { className: "mono", style: { fontSize: 24, fontWeight: 700, color: "var(--reserve)" } }, fmtBRL(last.net)),
          h("div", { style: { fontSize: 11, color: "var(--fg-3)" } }, `em ${fullDateBR(last.ref_date)}`)),
        last.yield != null && h("div", null,
          h("div", { style: { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontFamily: "var(--ff-sans)" } }, "Rendimento"),
          h("div", { className: "mono", style: { fontSize: 18, fontWeight: 700, color: last.yield >= 0 ? "var(--pos)" : "var(--neg)" } },
            (last.yield >= 0 ? "+" : "−") + fmtBRL(Math.abs(last.yield))),
          h("div", { style: { fontSize: 11, color: "var(--fg-3)" } }, `${last.yield_pct >= 0 ? "+" : "−"}${Math.abs(last.yield_pct).toFixed(2)}% sobre o aplicado`)),
        first && snaps.length > 1 && h("div", null,
          h("div", { style: { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontFamily: "var(--ff-sans)" } }, "Acompanhada desde"),
          h("div", { className: "mono", style: { fontSize: 18, fontWeight: 700, color: "var(--fg-1)" } }, fullDateBR(first.ref_date)),
          h("div", { style: { fontSize: 11, color: "var(--fg-3)" } }, `${snaps.length} medições`)),
      ),

      err && h("div", { style: { color: "var(--neg)", fontSize: 12 } }, err),
    ),

    h("div", { style: { flex: 1, overflowY: "auto", padding: "0 28px 24px" } },

      ficha.length > 0 && h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px 24px", padding: "14px 0", borderBottom: "1px dashed var(--line-1)" } },
        ficha.map(([k, v]) => h("span", { key: k, style: { fontSize: 11, color: "var(--fg-3)" } },
          k, ": ", h("span", { className: "mono", style: { color: "var(--fg-1)" } }, v)))),

      !pos && !err && h("div", { className: "px-empty" }, "Carregando…"),

      pos && snaps.length === 0 && h("div", { className: "px-empty" },
        "Sem medição registrada. Um relatório B3 mais novo traz o histórico."),

      snaps.length > 0 && h(React.Fragment, null,
        h("div", { style: { padding: "14px 0 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--fg-3)", fontFamily: "var(--ff-sans)" } },
          "Histórico de medições"),

        h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
          h("thead", null, h("tr", null,
            ["Data", "Aplicado", "Líquido", "Rendimento", ""].map((c, i) => h("th", {
              key: c + i,
              style: { textAlign: i === 0 || i === 4 ? "left" : "right", padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--fg-3)", borderBottom: "1px solid var(--line-1)", fontFamily: "var(--ff-sans)", fontWeight: 700 },
            }, c)))),
          h("tbody", null, snaps.slice().reverse().map((s, i) => h("tr", { key: s.ref_date + i },
            h("td", { className: "mono", style: { padding: "7px 8px", color: "var(--fg-2)", borderBottom: "1px solid var(--line-1)" } }, fullDateBR(s.ref_date)),
            h("td", { className: "mono", style: { padding: "7px 8px", textAlign: "right", color: "var(--fg-2)", borderBottom: "1px solid var(--line-1)" } },
              s.applied > 0 ? fmtBRL(s.applied) : "—"),
            h("td", { className: "mono", style: { padding: "7px 8px", textAlign: "right", color: "var(--fg-0)", fontWeight: 700, borderBottom: "1px solid var(--line-1)" } }, fmtBRL(s.net)),
            h("td", { className: "mono", style: { padding: "7px 8px", textAlign: "right", borderBottom: "1px solid var(--line-1)", color: s.yield == null ? "var(--fg-3)" : (s.yield >= 0 ? "var(--pos)" : "var(--neg)") } },
              s.yield == null ? "—" : (s.yield >= 0 ? "+" : "−") + fmtBRL(Math.abs(s.yield))),
            // Barra dithered do líquido: a mesma linguagem do fluxo mês a mês.
            h("td", { style: { padding: "7px 8px", width: "34%", borderBottom: "1px solid var(--line-1)" } },
              h("div", { className: "dither-pos", style: { height: 8, width: maxNet > 0 ? `${Math.max((s.net / maxNet) * 100, 1)}%` : 0, opacity: 0.85 } })),
          ))),
        ),
      ),
    ),
  );
}

window.BS = window.BS || {};
window.BS.InvestmentPanel = InvestmentPanel;

})();
