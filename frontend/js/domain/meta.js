/**
 * @file meta.js
 * @brief Derivações puras da camada "score" (streak de meses positivos,
 *        recorde de patrimônio, progresso do orçamento).
 */
/* meta.js — pure derivations of the light "score" layer. UMD dual tail. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /**
   * @brief Conta quantos meses seguidos, até o último, fecharam positivos.
   * @param monthlyNet série cronológica do saldo do mês (receita − despesa),
   *        em REAIS; o último elemento é o mês mais recente
   * @return tamanho da sequência positiva no fim da série (0 se o último ≤ 0)
   */
  function savingsStreak(monthlyNet) {
    let n = 0;
    for (let i = (monthlyNet || []).length - 1; i >= 0; i--) {
      if (monthlyNet[i] > 0) n++; else break;
    }
    return n;
  }

  /**
   * @brief Diz se o último ponto da série é máximo estrito (recorde).
   * @param series série cronológica de valores em REAIS; exige ≥ 2 pontos —
   *        um empate NÃO conta como recorde
   * @return true só quando o último ponto supera todos os anteriores
   */
  function isAllTimeHigh(series) {
    if (!series || series.length < 2) return false;
    const last = series[series.length - 1];
    for (let i = 0; i < series.length - 1; i++) if (series[i] >= last) return false;
    return true;
  }

  /**
   * @brief Calcula o progresso do orçamento do mês.
   *
   * Os dois argumentos têm que estar na MESMA unidade — os nomes dizem
   * CENTAVOS INTEIROS (é o que meta.test.js exercita). `pct` é grampeado em
   * 0–100 pra barra não estourar, mas `remainingCents` fica negativo quando
   * estourou: o número é a verdade, a barra é só a régua.
   *
   * @param spentCents gasto do mês em centavos inteiros
   * @param targetCents alvo do mês em centavos inteiros; null/≤0 = sem alvo
   * @return {pct, remainingCents}, ou null quando não há alvo definido
   */
  function budgetProgress(spentCents, targetCents) {
    if (targetCents == null || targetCents <= 0) return null;
    const pct = Math.max(0, Math.min(100, Math.round((spentCents / targetCents) * 100)));
    return { pct, remainingCents: targetCents - spentCents };
  }

  return { savingsStreak, isAllTimeHigh, budgetProgress };
});
