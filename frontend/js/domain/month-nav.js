(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /**
   * @file    Salto de um ano na barra do topo — a navegação era um mês por clique.
   * @warning `monthly` é ESPARSO: índice ± 12 não é um ano. O salto mira a DATA e
   *          aterrissa no mês existente mais próximo.
   */

  const ordinal = (m) => m.year * 12 + m.month;

  /**
   * @brief   Índice do mês mais próximo de `delta` anos do selecionado.
   * @details Devolve o índice atual quando não há pra onde ir — o chamador usa essa
   *          igualdade pra desabilitar o botão. Empate resolve pelo mais antigo.
   * @param monthly  [{year, month}, …] crescente, esparso
   * @param monthSel {year, month} atual
   * @param delta    anos: -1 volta, +1 avança
   */
  function jumpYearIndex(monthly, monthSel, delta) {
    if (!Array.isArray(monthly) || !monthly.length || !monthSel) return -1;
    const cur = monthly.findIndex(m => m.year === monthSel.year && m.month === monthSel.month);
    const target = ordinal(monthSel) + delta * 12;

    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < monthly.length; i++) {
      const dist = Math.abs(ordinal(monthly[i]) - target);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    //> Aterrissar no próprio mês deixa o botão morto, sem clique que não muda nada.
    return best === -1 ? cur : best;
  }

  /** Há para onde saltar? Falso quando o salto cairia no mês atual. */
  function canJumpYear(monthly, monthSel, delta) {
    if (!Array.isArray(monthly) || !monthly.length || !monthSel) return false;
    const cur = monthly.findIndex(m => m.year === monthSel.year && m.month === monthSel.month);
    const to = jumpYearIndex(monthly, monthSel, delta);
    return to >= 0 && to !== cur;
  }

  return { jumpYearIndex, canJumpYear };
});
