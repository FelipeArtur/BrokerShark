(function () {

const { useState, useEffect } = React;

function CategoryEditor({ tx, onClose, onSave }) {
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const { Modal, BankChip, fmtDateBR, fmtBRL, isSelf, isInvest, prettifyDesc } = window.BS;

  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(tx?.category_id || null);
  const [displayName, setDisplayName] = useState(tx?.display_name || "");
  const [isThirdParty, setIsThirdParty] = useState(!!(tx?.is_third_party));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (tx) {
      window.fetchExpenseCategories().then(cats => {
        setCats(cats);
      });
      setSelected(tx.category_id);
      setDisplayName(tx.display_name || "");
      setIsThirdParty(!!(tx.is_third_party));
      setErr(null);
    }
  }, [tx]);

  async function handleToggleThirdParty() {
    const next = !isThirdParty;
    setIsThirdParty(next);
    if (next && !selected) {
      const evtCat = cats.find(c => c.name === "Eventos / Terceiros");
      if (evtCat) setSelected(evtCat.id);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const fields = {};
      if (selected !== tx.category_id) fields.category_id = selected;
      const trimmed = displayName.trim() || null;
      if (trimmed !== (tx.display_name || null)) fields.display_name = trimmed;
      const thirdPartyVal = isThirdParty ? 1 : 0;
      if (thirdPartyVal !== (tx.is_third_party || 0)) fields.is_third_party = thirdPartyVal;
      if (Object.keys(fields).length > 0) {
        await window.patchTransaction(tx.id, fields);
      }
      const catName = cats.find(c => c.id === selected)?.name || tx.category || "";
      onSave({ ...fields, category: catName });
    }
    catch (e) { setErr(e.message || "Erro ao salvar."); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (deleting) return;
    onSave({ deleted: true, _tx: tx });
  }

  const METHOD_LABELS = { pix: "PIX", pix_received: "PIX", credit: "Crédito", ted: "TED", transfer: "Transfer.", other: "Outro" };
  const methodLabel = tx ? (METHOD_LABELS[tx.method] || tx.method || "") : "";
  const flowIsExpense = tx?.flow === "expense";

  const _self = isSelf(tx);
  const _invest = isInvest(tx);
  const amtColor = _self ? "var(--info)" : _invest ? "var(--reserve)" : (flowIsExpense ? "var(--neg)" : "var(--pos)");
  const sign = flowIsExpense ? "−" : "+";

  const fieldLabel = (text) => h("span", {
    style: { fontSize: 11, color: "var(--fg-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }
  }, text);

  return h(Modal, { open: !!tx, onClose, title: "Lançamento", width: 440 },
    tx && h("div", { style: { display: "flex", flexDirection: "column", gap: 20 } },

      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
          h("span", { style: { fontSize: 11, color: amtColor, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 } },
            _self ? "Transferência própria" : _invest ? "Investimento" : flowIsExpense ? "Despesa" : "Receita"),
          h("span", { className: "mono", style: { fontSize: 11, color: "var(--fg-3)" } }, fmtDateBR(tx.date)),
          h("span", { style: { marginLeft: "auto" } }, h(BankChip, { accountId: tx.account_id, bank: tx.bank }))
        ),
        h("span", { className: "mono", style: { fontSize: 30, fontWeight: 700, letterSpacing: "-0.025em", color: amtColor, lineHeight: 1 } },
          sign + fmtBRL(tx.amount)),
        h("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--fg-0)", wordBreak: "break-word", lineHeight: 1.3 } },
          displayName || prettifyDesc(tx.description))
      ),

      h("div", { style: { display: "flex", gap: 24, paddingTop: 12, borderTop: "1px dashed var(--line-1)" } },
        h("div", { style: { display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 } },
          fieldLabel("Nome original"),
          h("span", { className: "mono", title: tx.description, style: { color: "var(--fg-2)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, tx.description)),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 } },
          fieldLabel("Método"),
          h("span", { className: "mono", style: { color: "var(--fg-2)", fontSize: 11, textTransform: "uppercase" } }, methodLabel || "—"))
      ),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        fieldLabel("Apelido"),
        h("input", {
          className: "input", type: "text", maxLength: 100,
          placeholder: prettifyDesc(tx.description)?.slice(0, 50) || "Ex: Almoço padaria…",
          value: displayName,
          onChange: e => setDisplayName(e.target.value),
          style: { height: 34, fontSize: 13 }
        })
      ),

      flowIsExpense && h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        fieldLabel("Categoria"),
        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 } },
          cats.map(c => h("button", {
            key: c.id, type: "button",
            onClick: () => setSelected(c.id),
            "aria-pressed": selected === c.id,
            style: {
              padding: "7px 8px", textAlign: "center",
              fontSize: 11, fontWeight: selected === c.id ? 700 : 500,
              background: selected === c.id ? "var(--accent-bg)" : "var(--bg-0)",
              border: `1px solid ${selected === c.id ? "color-mix(in oklch, var(--accent) 45%, transparent)" : "var(--line-1)"}`,
              color: selected === c.id ? "var(--accent)" : "var(--fg-1)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "all 0.12s", cursor: "pointer"
            }
          }, c.name))
        )
      ),

      h("button", {
        type: "button",
        onClick: handleToggleThirdParty,
        style: {
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "9px 12px", textAlign: "left",
          background: isThirdParty ? "var(--warn-bg)" : "var(--bg-0)",
          border: `1px solid ${isThirdParty ? "color-mix(in oklch, var(--warn) 45%, transparent)" : "var(--line-1)"}`,
          color: isThirdParty ? "var(--warn)" : "var(--fg-2)",
          fontSize: 11, fontWeight: isThirdParty ? 600 : 500, cursor: "pointer", transition: "all 0.12s"
        }
      },
        h("span", {}, isThirdParty ? "Transação de terceiros — fora dos gastos" : "Marcar como transação de terceiros"),
        h(window.BS.IconLock, { size: 14, open: !isThirdParty })
      ),

      err && h("div", { style: { fontSize: 12, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)", padding: "10px 12px",} }, err),

      h("div", { style: { display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", paddingTop: 4 } },
        h("button", {
          className: "px-btn px-btn--ghost px-btn--sm",
          onClick: handleDelete, disabled: deleting,
          style: { color: "var(--neg)", fontWeight: 600, marginLeft: -8 }
        }, deleting ? "Excluindo…" : "Excluir"),
        h("button", { className: "px-btn px-btn--primary", onClick: save, disabled: saving },
          saving ? "Salvando…" : "Salvar")
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.CategoryEditor = CategoryEditor;

})();
