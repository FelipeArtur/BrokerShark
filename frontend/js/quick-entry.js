/* quick-entry.js — Web-based transaction entry sidebar */
/* global React, postTransaction, postIncome, postInvestmentMovement */

const { useState: _qSt, useMemo: _qMemo } = React;
const { FieldRow, SegmentControl, CurrencyInput, DateChooser, todayISO, fmtBRL } = window.BS;

const ACCOUNT_OPTIONS = [
  { id: "nu-cc",    method: "credit", label: "Nubank · Crédito",  bank: "nubank" },
  { id: "inter-cc", method: "credit", label: "Inter · Crédito",   bank: "inter"  },
  { id: "nu-db",    method: "pix",    label: "Nubank · PIX",      bank: "nubank" },
  { id: "inter-db", method: "pix",    label: "Inter · PIX",       bank: "inter"  },
  { id: "nu-db",    method: "ted",    label: "Nubank · TED",      bank: "nubank" },
  { id: "inter-db", method: "ted",    label: "Inter · TED",       bank: "inter"  },
];
const INCOME_BANKS = [
  { id: "nu-db",    label: "Nubank Conta", bank: "nubank" },
  { id: "inter-db", label: "Inter Conta",  bank: "inter"  },
];
const INVESTMENTS_OPTIONS = [
  { name: "Caixinha Nubank", bank: "nubank" },
  { name: "Tesouro Direto",  bank: "nubank" },
  { name: "Porquinho Inter", bank: "inter"  },
];
const EXPENSE_CATS = [
  { id: 1,  name: "Alimentação",    icon: "🍽" },
  { id: 2,  name: "Carro",          icon: "🚗" },
  { id: 3,  name: "Jogos",          icon: "🎮" },
  { id: 4,  name: "Lazer",          icon: "🎬" },
  { id: 5,  name: "Atividade física", icon: "💪" },
  { id: 6,  name: "Eletrônicos",    icon: "💻" },
  { id: 7,  name: "Educação",       icon: "📚" },
  { id: 8,  name: "Igreja",         icon: "⛪" },
  { id: 9,  name: "Dízimo",         icon: "🙏" },
  { id: 10, name: "Outro",          icon: "•"  },
];

/* ── ExpenseForm ──────────────────────────────────────────────────────────── */
function ExpenseForm({ onSubmit, onCancel }) {
  const [accountKey, setAccountKey] = _qSt("nu-cc_credit");
  const [amount, setAmount] = _qSt(0);
  const [installments, setInstallments] = _qSt(1);
  const [description, setDescription] = _qSt("");
  const [date, setDate] = _qSt(todayISO());
  const [categoryId, setCategoryId] = _qSt(1);
  const [saving, setSaving] = _qSt(false);

  const account = ACCOUNT_OPTIONS.find(a => `${a.id}_${a.method}` === accountKey);
  const isCredit = account?.method === "credit";

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!amount || !description || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        account_id: account.id,
        method: account.method,
        amount,
        installments: isCredit ? installments : 1,
        description,
        date,
        category_id: categoryId,
      });
    } finally { setSaving(false); }
  }

  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);
  const installHint = isCredit && installments > 1 ? `${installments}× ${fmtBRL(amount / installments)}` : null;

  return h("form", { onSubmit: handleSubmit, style: { display: "flex", flexDirection: "column", gap: 14 } },
    h(FieldRow, { label: "Pagamento" },
      h("select", { className: "select", value: accountKey, onChange: e => setAccountKey(e.target.value), style: { height: 32 } },
        h("optgroup", { label: "Crédito" },
          h("option", { value: "nu-cc_credit" }, "Nubank · Crédito"),
          h("option", { value: "inter-cc_credit" }, "Inter · Crédito")
        ),
        h("optgroup", { label: "PIX" },
          h("option", { value: "nu-db_pix" }, "Nubank · PIX"),
          h("option", { value: "inter-db_pix" }, "Inter · PIX")
        ),
        h("optgroup", { label: "TED" },
          h("option", { value: "nu-db_ted" }, "Nubank · TED"),
          h("option", { value: "inter-db_ted" }, "Inter · TED")
        )
      )
    ),
    h(FieldRow, { label: "Valor", hint: installHint },
      h(CurrencyInput, { value: amount, onChange: setAmount, autoFocus: true, large: true })
    ),
    isCredit && h(FieldRow, { label: "Parcelas" },
      h(SegmentControl, {
        columns: 6, value: installments, onChange: setInstallments,
        options: [1, 2, 3, 4, 6, 12].map(n => ({ value: n, label: n === 1 ? "à vista" : `${n}×` })),
      })
    ),
    h(FieldRow, { label: "Descrição" },
      h("input", { className: "input", placeholder: "Ex.: iFood, PS Store", value: description, onChange: e => setDescription(e.target.value), style: { height: 36 } })
    ),
    h(FieldRow, { label: "Data" }, h(DateChooser, { value: date, onChange: setDate })),
    h(FieldRow, { label: "Categoria" },
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4 } },
        EXPENSE_CATS.map(c => {
          const active = c.id === categoryId;
          return h("button", {
            key: c.id, type: "button", onClick: () => setCategoryId(c.id),
            style: {
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
              borderRadius: 6, fontSize: "var(--fz-7)", textAlign: "left",
              background: active ? "var(--info-bg)" : "var(--bg-0)",
              border: active ? "1px solid var(--info)" : "1px solid var(--line-1)",
              color: active ? "var(--fg-0)" : "var(--fg-1)", fontWeight: active ? 600 : 400,
            }
          }, h("span", null, c.icon), h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name));
        })
      )
    ),
    h("div", { style: { display: "flex", gap: 6, marginTop: 4 } },
      h("button", { type: "button", className: "btn", onClick: onCancel, style: { flex: 1 } }, "Cancelar"),
      h("button", { type: "submit", className: "btn btn-primary", disabled: !amount || !description || saving, style: { flex: 2 } },
        saving ? "Salvando…" : "Lançar despesa")
    )
  );
}

/* ── IncomeForm ───────────────────────────────────────────────────────────── */
function IncomeForm({ onSubmit, onCancel }) {
  const [type, setType] = _qSt("salary");
  const [bankId, setBankId] = _qSt("nu-db");
  const [transferTo, setTransferTo] = _qSt("inter-db");
  const [amount, setAmount] = _qSt(0);
  const [description, setDescription] = _qSt("");
  const [date, setDate] = _qSt(todayISO());
  const [saving, setSaving] = _qSt(false);

  const isTransfer = type === "transfer";
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!amount || saving) return;
    setSaving(true);
    try {
      if (isTransfer) {
        await onSubmit({ kind: "transfer", type: "transfer", from_account: bankId, to_account: transferTo, amount, date });
      } else {
        await onSubmit({ kind: "income", type, account_id: bankId, amount, description: description || type, date });
      }
    } finally { setSaving(false); }
  }

  return h("form", { onSubmit: handleSubmit, style: { display: "flex", flexDirection: "column", gap: 14 } },
    h(FieldRow, { label: "Tipo" },
      h(SegmentControl, {
        columns: 4, value: type, onChange: setType,
        options: [
          { value: "salary", label: "Salário" }, { value: "freelance", label: "Freela" },
          { value: "pix", label: "PIX" }, { value: "transfer", label: "Transf." },
        ],
      })
    ),
    h(FieldRow, { label: isTransfer ? "De" : "Banco" },
      h(SegmentControl, {
        columns: 2, value: bankId, onChange: setBankId,
        options: INCOME_BANKS.map(b => ({ value: b.id, label: b.label })),
      })
    ),
    isTransfer && h(FieldRow, { label: "Para" },
      h(SegmentControl, {
        columns: 2, value: transferTo, onChange: setTransferTo,
        options: INCOME_BANKS.filter(b => b.id !== bankId).map(b => ({ value: b.id, label: b.label })),
      })
    ),
    h(FieldRow, { label: "Valor" }, h(CurrencyInput, { value: amount, onChange: setAmount, autoFocus: true, large: true })),
    !isTransfer && h(FieldRow, { label: "Descrição (opcional)" },
      h("input", { className: "input", placeholder: type === "salary" ? "Salário maio" : "Detalhe da entrada", value: description, onChange: e => setDescription(e.target.value), style: { height: 36 } })
    ),
    h(FieldRow, { label: "Data" }, h(DateChooser, { value: date, onChange: setDate })),
    h("div", { style: { display: "flex", gap: 6, marginTop: 4 } },
      h("button", { type: "button", className: "btn", onClick: onCancel, style: { flex: 1 } }, "Cancelar"),
      h("button", { type: "submit", className: "btn btn-primary", disabled: !amount || saving, style: { flex: 2 } },
        saving ? "Salvando…" : "Lançar receita")
    )
  );
}

/* ── InvestmentForm ───────────────────────────────────────────────────────── */
function InvestmentForm({ onSubmit, onCancel }) {
  const [op, setOp] = _qSt("deposit");
  const [destination, setDestination] = _qSt("Caixinha Nubank");
  const [amount, setAmount] = _qSt(0);
  const [date, setDate] = _qSt(todayISO());
  const [desc, setDesc] = _qSt("");
  const [saving, setSaving] = _qSt(false);

  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!amount || saving) return;
    setSaving(true);
    try {
      await onSubmit({ kind: "investment", investment_name: destination, operation: op, amount, date, description: desc || null });
    } finally { setSaving(false); }
  }

  return h("form", { onSubmit: handleSubmit, style: { display: "flex", flexDirection: "column", gap: 14 } },
    h(FieldRow, { label: "Operação" },
      h(SegmentControl, {
        columns: 2, value: op, onChange: setOp,
        options: [{ value: "deposit", label: "Aporte" }, { value: "withdrawal", label: "Resgate" }],
      })
    ),
    h(FieldRow, { label: "Destino" },
      h("select", { className: "select", value: destination, onChange: e => setDestination(e.target.value), style: { height: 32 } },
        INVESTMENTS_OPTIONS.map(o => h("option", { key: o.name, value: o.name }, o.name))
      )
    ),
    h(FieldRow, { label: "Valor" }, h(CurrencyInput, { value: amount, onChange: setAmount, autoFocus: true, large: true })),
    h(FieldRow, { label: "Observação (opcional)" },
      h("input", { className: "input", placeholder: "Ex.: aporte mensal", value: desc, onChange: e => setDesc(e.target.value), style: { height: 36 } })
    ),
    h(FieldRow, { label: "Data" }, h(DateChooser, { value: date, onChange: setDate })),
    h("div", { style: { display: "flex", gap: 6, marginTop: 4 } },
      h("button", { type: "button", className: "btn", onClick: onCancel, style: { flex: 1 } }, "Cancelar"),
      h("button", { type: "submit", className: "btn btn-primary", disabled: !amount || saving, style: { flex: 2 } },
        saving ? "Salvando…" : op === "deposit" ? "Aportar" : "Resgatar")
    )
  );
}

/* ── QuickEntry shell ─────────────────────────────────────────────────────── */
function QuickEntry({ kind, onChangeKind, onSubmit, onCancel }) {
  const tabs = [
    { id: "expense",    label: "Despesa",  icon: "−", color: "var(--neg)" },
    { id: "income",     label: "Receita",  icon: "+", color: "var(--pos)" },
    { id: "investment", label: "Reserva",  icon: "↑", color: "var(--reserve)" },
  ];
  const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  return h("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
    h("div", { style: { padding: "12px 14px 0", display: "flex", alignItems: "center", justifyContent: "space-between" } },
      h("div", { style: { fontSize: "var(--fz-5)", fontWeight: 600 } }, "Novo lançamento"),
      h("button", { onClick: onCancel, className: "btn btn-ghost btn-sm" }, "✕")
    ),
    h("div", { style: { padding: "10px 14px", borderBottom: "1px solid var(--line-1)" } },
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, padding: 3, background: "var(--bg-0)", border: "1px solid var(--line-1)", borderRadius: 8 } },
        tabs.map(t => {
          const active = t.id === kind;
          return h("button", {
            key: t.id, type: "button", onClick: () => onChangeKind(t.id),
            style: {
              padding: "8px 4px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontSize: "var(--fz-7)", fontWeight: active ? 600 : 500,
              color: active ? "var(--fg-0)" : "var(--fg-2)",
              background: active ? "var(--bg-2)" : "transparent",
              border: active ? "1px solid var(--line-2)" : "1px solid transparent",
              borderRadius: 5,
            }
          },
            h("span", { style: { color: t.color, fontFamily: "var(--ff-mono)", fontWeight: 700 } }, t.icon),
            t.label
          );
        })
      )
    ),
    h("div", { style: { flex: 1, overflowY: "auto", padding: 14 } },
      kind === "expense"    && h(ExpenseForm,    { onSubmit, onCancel }),
      kind === "income"     && h(IncomeForm,     { onSubmit, onCancel }),
      kind === "investment" && h(InvestmentForm, { onSubmit, onCancel })
    ),
    h("div", { style: { padding: "8px 14px", borderTop: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--fg-3)" } },
      h("div", null, h("span", { className: "kbd" }, "E"), " despesa · ", h("span", { className: "kbd" }, "R"), " receita · ", h("span", { className: "kbd" }, "I"), " investimento"),
      h("div", null, h("span", { className: "kbd" }, "Esc"), " fechar")
    )
  );
}

window.BS = window.BS || {};
window.BS.QuickEntry = QuickEntry;
