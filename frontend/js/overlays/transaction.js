(function () {

const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

const { useState, useEffect } = React;

const METHOD_LABELS = {
  pix: "PIX", pix_received: "PIX recebido", credit: "Crédito", ted: "TED",
  transfer: "Transferência", debit: "Débito", salary: "Salário",
  freelance: "Freelance", other: "Outro",
};

// Ficha do lançamento. É a única tela do app que mostra a linha inteira — o que
// o banco mandou, o que o BrokerShark deduziu e o que você renomeou — então ela
// separa as três coisas em vez de misturar tudo num bloco de texto.
function CategoryEditor({ tx, onClose, onSave }) {
  const { Modal, BankChip, fmtDateBR, fullDateBR, fmtBRL, isSelf, isInvest, prettifyDesc } = window.BS;

  const [cats, setCats] = useState([]);
  const [selected, setSelected] = useState(tx?.category_id || null);
  const [displayName, setDisplayName] = useState(tx?.display_name || "");
  const [isThirdParty, setIsThirdParty] = useState(!!(tx?.is_third_party));
  const [recorrente, setRecorrente] = useState(!!(tx?.is_recurring));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!tx) return;
    fetchCategoriesFull(tx.flow === "income" ? "income" : "expense").then(setCats).catch(() => setCats([]));
    setSelected(tx.category_id);
    setDisplayName(tx.display_name || "");
    setIsThirdParty(!!(tx.is_third_party));
    setRecorrente(!!(tx.is_recurring));
    setErr(null);
  }, [tx]);

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
      const recorrenteVal = recorrente ? 1 : 0;
      if (recorrenteVal !== (tx.is_recurring || 0)) fields.recurring = recorrenteVal;
      if (Object.keys(fields).length > 0) {
        await window.patchTransaction(tx.id, fields);
      }
      const catName = cats.find(c => c.id === selected)?.name || tx.category || "";
      onSave({ ...fields, category: catName });
    }
    catch (e) { setErr(e.message || "Erro ao salvar."); }
    finally { setSaving(false); }
  }

  const flowIsExpense = tx?.flow === "expense";
  const _self = isSelf(tx);
  const _invest = isInvest(tx);
  const amtColor = isThirdParty ? "var(--warn)"
    : _self ? "var(--fg-3)" : _invest ? "var(--reserve)"
    : (flowIsExpense ? "var(--neg)" : "var(--pos)");
  const especie = isThirdParty ? "Em nome de terceiros"
    : _self ? "Transferência entre suas contas" : _invest ? "Movimento de investimento"
    : flowIsExpense ? "Despesa" : "Receita";

  const rotulo = (text) => h("span", {
    style: { fontSize: 10, color: "var(--fg-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" },
  }, text);

  const ficha = tx ? [
    ["Método", METHOD_LABELS[tx.method] || tx.method || null],
    ["Parcela", tx.installment_total ? `${tx.installment_seq} de ${tx.installment_total}` : null],
    ["Categoria no banco", tx.bank_category],
    ["Valor original", tx.original_amount != null && tx.original_amount !== tx.amount ? fmtBRL(tx.original_amount) : null],
    ["Veio do arquivo", tx.source_file],
    //> `external_id` fora: UUID de dedup do import, não responde pergunta nenhuma.
  ].filter(([, v]) => v != null && v !== "") : [];

  return h(Modal, { open: !!tx, onClose, title: "Lançamento", width: 620 },
    tx && h("div", { style: { display: "flex", flexDirection: "column", gap: 18 } },

      h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
          h("span", { style: { fontSize: 11, color: amtColor, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 } },
            especie),
          h("span", { className: "mono", style: { fontSize: 11, color: "var(--fg-3)" } }, fullDateBR(tx.date)),
          h("span", { style: { marginLeft: "auto" } }, h(BankChip, { accountId: tx.account_id, bank: tx.bank }))
        ),
        h("span", { className: "mono", style: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.025em", color: amtColor, lineHeight: 1 } },
          (flowIsExpense ? "−" : "+") + fmtBRL(tx.amount)),
        h("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--fg-0)", wordBreak: "break-word", lineHeight: 1.3 } },
          displayName || prettifyDesc(tx.description))
      ),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 5, paddingTop: 14, borderTop: "1px dashed var(--line-1)" } },
        rotulo("Como o banco mandou"),
        h("span", { className: "mono ficha-bruto", style: { color: "var(--fg-2)", fontSize: 11, lineHeight: 1.5 } },
          tx.description)),

      ficha.length > 0 && h("div", { className: "ficha" },
        ficha.map(([k, v]) => h("div", { key: k, className: "ficha-campo" },
          rotulo(k),
          h("span", { className: "mono", style: { color: "var(--fg-1)", fontSize: 12, wordBreak: "break-word" } }, v)))),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 6, paddingTop: 14, borderTop: "1px dashed var(--line-1)" } },
        rotulo("Apelido"),
        h("input", {
          className: "input", type: "text", maxLength: 100,
          placeholder: prettifyDesc(tx.description)?.slice(0, 50) || "Como você chama isso",
          value: displayName,
          onChange: e => setDisplayName(e.target.value),
          style: { height: 34, fontSize: 13 }
        }),
        h("span", { style: { fontSize: 11, color: "var(--fg-3)" } },
          "Substitui o texto do banco na tabela. O original continua guardado.")
      ),

      h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
        rotulo(flowIsExpense ? "Categoria" : "Categoria da receita"),
        cats.length === 0
          ? h("span", { style: { fontSize: 11, color: "var(--fg-3)" } },
              "Nenhuma categoria criada ainda — crie pela engrenagem do widget Categorias.")
          : h("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 } },
              cats.map(c => h("button", {
                key: c.id, type: "button",
                onClick: () => setSelected(selected === c.id ? null : c.id),
                "aria-pressed": selected === c.id,
                title: c.name,
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

      //> Não escolhe categoria por você: qual rotula o dinheiro dos outros é decisão
      //> de quem usa, e nome fixo aqui era um clique que não fazia nada.
      h("button", {
        type: "button",
        onClick: () => setIsThirdParty(v => !v),
        style: {
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "10px 12px", textAlign: "left",
          background: isThirdParty ? "var(--warn-bg)" : "var(--bg-0)",
          border: `1px solid ${isThirdParty ? "color-mix(in oklch, var(--warn) 45%, transparent)" : "var(--line-1)"}`,
          color: isThirdParty ? "var(--warn)" : "var(--fg-2)",
          fontSize: 11, cursor: "pointer", transition: "all 0.12s"
        }
      },
        h("span", { style: { display: "flex", flexDirection: "column", gap: 3 } },
          h("span", { style: { fontWeight: 700 } },
            isThirdParty ? "Em nome de terceiros" : "Marcar como em nome de terceiros"),
          h("span", { style: { color: "var(--fg-3)", lineHeight: 1.5 } },
            isThirdParty
              ? "Fora dos seus gastos, receitas e investimentos. A categoria acima vira o rótulo do projeto, e a tabela mostra a etiqueta na linha."
              : "Para dinheiro que passou pela sua conta sem ser seu — arrecadação, reembolso, compra por outra pessoa.")),
        h(window.BS.IconLock, { size: 16, open: !isThirdParty })
      ),

      h("button", {
        type: "button",
        onClick: () => setRecorrente(v => !v),
        style: {
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "10px 12px", textAlign: "left",
          background: recorrente ? "var(--accent-bg)" : "var(--bg-0)",
          border: `1px solid ${recorrente ? "color-mix(in oklch, var(--accent) 45%, transparent)" : "var(--line-1)"}`,
          color: recorrente ? "var(--accent)" : "var(--fg-2)",
          fontSize: 11, cursor: "pointer", transition: "all 0.12s"
        }
      },
        h("span", { style: { display: "flex", flexDirection: "column", gap: 3 } },
          h("span", { style: { fontWeight: 700 } },
            recorrente ? "Se repete todo mês" : "Marcar como recorrente"),
          h("span", { style: { color: "var(--fg-3)", lineHeight: 1.5 } },
            recorrente
              ? `Aparece nos compromissos de cada mês, no dia ${String(tx.date).slice(8, 10)}, enquanto você não desmarcar.`
              : "Para conta que chega todo mês. Passa a contar nos compromissos, com o valor e o dia deste lançamento.")),
        h("span", { className: "mono", style: { fontSize: 16, flexShrink: 0 } }, recorrente ? "◉" : "○")
      ),

      err && h("div", { style: { fontSize: 12, color: "var(--neg)", background: "color-mix(in oklch, var(--neg) 10%, transparent)", padding: "10px 12px" } }, err),

      h("div", { style: { display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", paddingTop: 4 } },
        h("button", {
          className: "px-btn px-btn--ghost px-btn--sm",
          onClick: () => onSave({ deleted: true, _tx: tx }),
          style: { color: "var(--neg)", fontWeight: 600, marginLeft: -8 }
        }, "Excluir"),
        h("button", { className: "px-btn px-btn--primary", onClick: save, disabled: saving },
          saving ? "Salvando…" : "Salvar")
      )
    )
  );
}

window.BS = window.BS || {};
window.BS.CategoryEditor = CategoryEditor;

})();
