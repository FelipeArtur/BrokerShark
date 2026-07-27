(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  // Salto de um ano na barra do topo.
  //
  // A navegação era um mês por clique: ir de jul/2026 a 2024 custava ~30
  // cliques, e o único atalho real (as abas de ano do widget de fluxo) mora na
  // segunda dobra da tela. Um salto de 12 meses resolve em dois cliques sem
  // inventar dropdown, popover ou z-index novo — a página nunca rola.
  //
  // `monthly` é ESPARSO: só traz mês que tem dado. Então índice ± 12 não é um
  // ano — pode pular por cima de um buraco e cair longe. O salto mira a data e
  // aterrissa no mês existente mais próximo dela.

  const ordinal = (m) => m.year * 12 + m.month;

  /**
   * Índice em `monthly` do mês mais próximo de `delta` anos do selecionado.
   *
   * Devolve o índice atual quando não há pra onde ir (já está na ponta) — o
   * chamador usa essa igualdade pra desabilitar o botão. Empate de distância
   * resolve pelo mais antigo, porque `monthly` vem em ordem crescente.
   *
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
    // Aterrissar no próprio mês não é salto — deixa o botão morto em vez de
    // dar um clique que não muda nada.
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
