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

  /**
   * @brief   A espécie de uma linha de dinheiro — exatamente uma das seis.
   * @warning A ORDEM é load-bearing: liquidação antes de despesa (senão o consumo
   *          dobra), SELF antes de investimento, terceiro antes de investimento.
   */
  function moneyKind(t) {
    if (!t) return null;
    if (t.is_settlement) return KIND.SETTLEMENT;
    if (t.counterpart === "SELF" || t.dest_account_id != null) return KIND.TRANSFER;
    if (t.is_third_party) return KIND.THIRD_PARTY;
    //> `transfer` + `is_revenue=1` é receita real pro backend: divergir tirava
    //> dinheiro de "Entradas" sem tirar do total.
    if (t.flow === "expense" ? t.method === "transfer" : (!t.is_revenue && t.method === "transfer")) {
      return KIND.INVEST;
    }
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
    [KIND.THIRD_PARTY]: "Em nome de terceiros",
    [KIND.REVENUE]:     "Receitas",
    [KIND.EXPENSE]:     "Despesas",
  };

  const KIND_HINT = {
    [KIND.SETTLEMENT]:  "liquidação de fatura — os gastos reais são os itens da fatura; contar o pagamento dobraria o consumo",
    [KIND.TRANSFER]:    "transferência entre suas contas — não conta como despesa nem receita",
    [KIND.INVEST]:      "movimento de investimento — não conta como despesa nem receita",
    [KIND.THIRD_PARTY]: "dinheiro que passou pela sua conta sem ser seu — fora de todos os seus totais",
    [KIND.REVENUE]:     "receita real",
    [KIND.EXPENSE]:     "despesa de consumo",
  };

  function kindSign(t) {
    return (t && t.flow === "income") ? "+" : "−";
  }

  function fmtParts(v) {
    const n = Math.abs(v ?? 0);
    const full = n.toLocaleString("pt-BR", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const cut = full.lastIndexOf(",");
    return cut < 0 ? { int: full, cents: "" }
                   : { int: full.slice(0, cut), cents: full.slice(cut) };
  }

  return { KIND, moneyKind, kindSign, KIND_COLOR, KIND_LABEL, KIND_HINT, fmtParts };
});
