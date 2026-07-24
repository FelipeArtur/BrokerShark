(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  const KIND = {
    SETTLEMENT:  "settlement",
    TRANSFER:    "transfer",
    INVEST:      "invest",
    THIRD_PARTY: "third_party",
    REVENUE:     "revenue",
    EXPENSE:     "expense",
  };

  function moneyKind(t) {
    if (!t) return null;
    if (t.is_settlement) return KIND.SETTLEMENT;
    if (t.counterpart === "SELF" || t.dest_account_id != null) return KIND.TRANSFER;
    if (t.method === "transfer" || (t.flow === "income" && !t.is_revenue)) return KIND.INVEST;
    if (t.is_third_party) return KIND.THIRD_PARTY;
    return t.flow === "income" ? KIND.REVENUE : KIND.EXPENSE;
  }

  const KIND_COLOR = {
    [KIND.SETTLEMENT]:  "var(--fg-3)",
    [KIND.TRANSFER]:    "var(--fg-3)",
    [KIND.INVEST]:      "var(--reserve)",
    [KIND.THIRD_PARTY]: "var(--warn)",
    [KIND.REVENUE]:     "var(--pos)",
    [KIND.EXPENSE]:     "var(--neg)",
  };

  const KIND_LABEL = {
    [KIND.SETTLEMENT]:  "Liquidações",
    [KIND.TRANSFER]:    "Transferências",
    [KIND.INVEST]:      "Investimentos",
    [KIND.THIRD_PARTY]: "De terceiros",
    [KIND.REVENUE]:     "Receitas",
    [KIND.EXPENSE]:     "Despesas",
  };

  const KIND_HINT = {
    [KIND.SETTLEMENT]:  "liquidação de fatura — os gastos reais são os itens da fatura; contar o pagamento dobraria o consumo",
    [KIND.TRANSFER]:    "transferência entre suas contas — não conta como despesa nem receita",
    [KIND.INVEST]:      "movimento de investimento — não conta como despesa nem receita",
    [KIND.THIRD_PARTY]: "gasto de terceiro — fora dos seus totais",
    [KIND.REVENUE]:     "receita real",
    [KIND.EXPENSE]:     "despesa de consumo",
  };

  const COUNTS_AS = { [KIND.REVENUE]: "in", [KIND.EXPENSE]: "out", [KIND.INVEST]: "invest" };

  function kindSign(t) {
    return (t && t.flow === "income") ? "+" : "−";
  }

  function fmtParts(v, opts = {}) {
    const { decimals = 2 } = opts;
    const n = Math.abs(v ?? 0);
    const full = n.toLocaleString("pt-BR", {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
    const cut = full.lastIndexOf(",");
    return cut < 0 ? { int: full, cents: "" }
                   : { int: full.slice(0, cut), cents: full.slice(cut) };
  }

  return { KIND, moneyKind, kindSign, KIND_COLOR, KIND_LABEL, KIND_HINT, COUNTS_AS, fmtParts };
});
