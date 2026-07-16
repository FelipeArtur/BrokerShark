/* tx-group.js — agrupamento da tabela. Puro. UMD dual tail: node require + window.BS. */
(function (root, factory) {
  const api = factory(
    typeof require !== "undefined" ? require("./money.js") : (root.BS || {}),
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function (M) {

  const { KIND, moneyKind, KIND_LABEL } = M;

  /* Grupo = categoria QUANDO a espécie tem categoria; senão, grupo = espécie.
     Transferência/investimento/liquidação/third-party não têm category_id —
     agrupá-los por categoria jogaria os quatro no balde "Sem categoria" junto
     com os gastos que você realmente esqueceu de categorizar, que é justo o que
     você precisa achar ali. */
  function groupKeyOf(t) {
    const k = moneyKind(t);
    if (k === KIND.EXPENSE || k === KIND.REVENUE) return `cat:${t.category_id ?? 0}`;
    return `kind:${k}`;
  }

  const UNCATEGORIZED = "Sem categoria";

  /**
   * Agrupa as transações já filtradas.
   *
   * UNIDADE: tudo aqui dentro é REAIS, igual ao resto do front (a API manda
   * `amount` em reais; só o ledger é centavos). `budget_cents`/`prev_spent_cents`
   * do endpoint vêm em centavos e são convertidos UMA vez, aqui na fronteira —
   * depois disso nenhum caller precisa saber de centavos.
   *
   * @param txs lista de transações (amount em reais)
   * @param catsById Map(id → {name, flow, budget_cents, budget_source, prev_spent_cents})
   * @returns grupos ordenados: categorias por total desc, espécies no fim.
   */
  function buildGroups(txs, catsById) {
    const cats = catsById || new Map();
    const byKey = new Map();

    for (const t of txs) {
      const key = groupKeyOf(t);
      let g = byKey.get(key);
      if (!g) {
        const kind = moneyKind(t);
        const isCat = key.startsWith("cat:");
        const catId = isCat ? (t.category_id ?? null) : null;
        const meta = catId != null ? cats.get(catId) : null;
        g = {
          key, kind, isCat, categoryId: catId,
          label: isCat ? (t.category || (meta && meta.name) || UNCATEGORIZED) : KIND_LABEL[kind],
          txs: [], total: 0, count: 0,
          // Alvo só existe em categoria de despesa. null = sem alvo (≠ alvo zero).
          budget: meta && kind === KIND.EXPENSE && meta.budget_cents != null
            ? meta.budget_cents / 100 : null,
          budgetSource: meta && kind === KIND.EXPENSE ? (meta.budget_source ?? null) : null,
          prevSpent: meta && meta.prev_spent_cents != null ? meta.prev_spent_cents / 100 : null,
        };
        byKey.set(key, g);
      }
      g.txs.push(t);
      g.total += t.amount;
      g.count += 1;
    }

    const groups = [...byKey.values()];
    for (const g of groups) g.maxAmount = g.txs.reduce((m, t) => Math.max(m, t.amount), 0);

    // Categorias primeiro (é onde você age), espécies contábeis no fim.
    return groups.sort((a, b) =>
      (a.isCat === b.isCat) ? b.total - a.total : (a.isCat ? -1 : 1));
  }

  /* Δ vs. mês anterior, em fração. null quando não há base (mês anterior zerado:
     "subiu ∞%" não informa nada). */
  function groupDelta(g) {
    if (g.prevSpent == null || g.prevSpent === 0) return null;
    return (g.total - g.prevSpent) / g.prevSpent;
  }

  /* Escala por valor: o corpo do número cresce com a fatia DENTRO do grupo.
     Escala local, não global — senão o mês do aluguel achata todo o resto.
     Teto e piso fixos: legibilidade não é negociável. */
  const SCALE_MIN = 11, SCALE_MAX = 15;
  function scaleFor(amount, maxAmount) {
    if (!maxAmount || maxAmount <= 0) return SCALE_MIN;
    const share = Math.min(1, Math.abs(amount) / maxAmount);
    return Math.round((SCALE_MIN + (SCALE_MAX - SCALE_MIN) * Math.sqrt(share)) * 10) / 10;
  }

  /* Estado do alvo (spent e budget em REAIS). Sem verde pra "dentro do alvo":
     verde já significa receita, e reusar quebraria a semântica das espécies.
     null = sem alvo, que a UI mostra diferente de "alvo de R$ 0,00". */
  function budgetState(spent, budget) {
    if (budget == null || budget <= 0) return null;
    const ratio = spent / budget;
    return {
      ratio,
      color: ratio > 1 ? "var(--neg)" : ratio >= 0.8 ? "var(--warn)" : "var(--fg-2)",
    };
  }

  return { groupKeyOf, buildGroups, groupDelta, scaleFor, budgetState, UNCATEGORIZED, SCALE_MIN, SCALE_MAX };
});
