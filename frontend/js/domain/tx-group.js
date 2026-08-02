(function (root, factory) {
  const api = factory(
    typeof require !== "undefined" ? require("./money.js") : (root.BS || {}),
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function (M) {

  const { KIND, moneyKind, KIND_LABEL } = M;

  function groupKeyOf(t) {
    const k = moneyKind(t);
    if (k !== KIND.EXPENSE && k !== KIND.REVENUE) return `kind:${k}`;

    return t.category_id != null ? `cat:${t.category_id}` : `none:${k}`;
  }

  const UNCATEGORIZED = "Sem categoria";
  const UNCATEGORIZED_INCOME = "Receita sem categoria";

  function buildGroups(txs, catsById) {
    const cats = catsById || new Map();
    const byKey = new Map();

    for (const t of txs) {
      const key = groupKeyOf(t);
      let g = byKey.get(key);
      if (!g) {
        const kind = moneyKind(t);
        const hasCat = key.startsWith("cat:");
        const noCat = key.startsWith("none:");

        const isCat = hasCat || noCat;
        const catId = hasCat ? t.category_id : null;
        const meta = catId != null ? cats.get(catId) : null;
        g = {
          key, kind, isCat, categoryId: catId,
          label: hasCat ? (t.category || (meta && meta.name) || UNCATEGORIZED)
               : noCat  ? (kind === KIND.REVENUE ? UNCATEGORIZED_INCOME : UNCATEGORIZED)
                        : KIND_LABEL[kind],
          txs: [], total: 0, net: 0, count: 0,

          budget: meta && kind === KIND.EXPENSE && meta.budget_cents != null
            ? meta.budget_cents / 100 : null,
          budgetSource: meta && kind === KIND.EXPENSE ? (meta.budget_source ?? null) : null,
          prevSpent: meta && meta.prev_spent_cents != null ? meta.prev_spent_cents / 100 : null,
        };
        byKey.set(key, g);
      }
      g.txs.push(t);
      g.total += t.amount;

      g.net += (t.flow === "expense" ? t.amount : -t.amount);
      g.count += 1;
    }

    const groups = [...byKey.values()];
    for (const g of groups) g.maxAmount = g.txs.reduce((m, t) => Math.max(m, t.amount), 0);

    return groups.sort((a, b) =>
      (a.isCat === b.isCat) ? b.total - a.total : (a.isCat ? -1 : 1));
  }

  function groupDelta(g) {
    if (g.prevSpent == null || g.prevSpent === 0) return null;
    return (g.total - g.prevSpent) / g.prevSpent;
  }

  const SCALE_MIN = 11, SCALE_MAX = 15;

  function scaleFor(amount, maxAmount) {
    if (!maxAmount || maxAmount <= 0) return SCALE_MIN;
    const share = Math.min(1, Math.abs(amount) / maxAmount);
    return Math.round((SCALE_MIN + (SCALE_MAX - SCALE_MIN) * Math.sqrt(share)) * 10) / 10;
  }

  /**
   * @brief   Onde o gasto está em relação ao alvo.
   * @warning Compara em CENTAVOS INTEIROS. A API entrega reais, e somá-los em float
   *          fazia 0,10 três vezes darem 0.30000000000000004 — um alvo de R$ 0,30
   *          nascia "estourado" com exatamente 30 centavos gastos.
   */
  function budgetState(spent, budget) {
    if (budget == null || budget <= 0) return null;
    const gastoC = Math.round(spent * 100);
    const alvoC = Math.round(budget * 100);
    return {
      ratio: gastoC / alvoC,
      over: gastoC > alvoC,
      color: gastoC > alvoC ? "var(--neg)" : gastoC * 10 >= alvoC * 8 ? "var(--warn)" : "var(--accent)",
    };
  }

  return { groupKeyOf, buildGroups, groupDelta, scaleFor, budgetState, UNCATEGORIZED,
           UNCATEGORIZED_INCOME, SCALE_MIN, SCALE_MAX };
});
