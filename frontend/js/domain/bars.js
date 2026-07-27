(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  // Quais barras um mês desenha no widget "Fluxo mês a mês".
  //
  // O modo comparar mostrava só a receita do mês anterior — metade da
  // comparação. Num app cuja pergunta é "quanto posso gastar", a metade que
  // faltava era a que mais importa: gastei mais ou menos que no mês passado.
  //
  // A ordem é load-bearing: cada fantasma vem LOGO DEPOIS da barra real que ele
  // compara. Fantasma solto no fim encosta na barra errada e a leitura inverte.

  const BAR_MAX_PX = 52;
  const BAR_MIN_PX = 2;

  /** Altura em px. Valor > 0 nunca vira barra invisível; maxV 0 não vira NaN. */
  function scaleBar(value, maxV) {
    const v = Number(value) || 0;
    if (v <= 0) return 0;
    if (!(maxV > 0)) return BAR_MIN_PX;
    return Math.max((v / maxV) * BAR_MAX_PX, BAR_MIN_PX);
  }

  /**
   * @param slot    { data: {income, expenses}|null, prev: {income, expenses}|null }
   * @param maxV    maior valor da série, pra escala comum entre os meses
   * @param compare toggle "vs ant." ligado
   * @returns [{ key, kind: 'income'|'expense', ghost: boolean, height }]
   */
  function barSpecs(slot, maxV, compare) {
    const d = (slot && slot.data) || null;
    const prev = compare && slot ? slot.prev : null;
    const out = [];

    out.push({ key: "i", kind: "income", ghost: false, height: d ? scaleBar(d.income, maxV) : 0 });
    if (prev) {
      out.push({ key: "gi", kind: "income", ghost: true, height: scaleBar(prev.income, maxV) });
    }
    out.push({ key: "e", kind: "expense", ghost: false, height: d ? scaleBar(d.expenses, maxV) : 0 });
    if (prev) {
      out.push({ key: "ge", kind: "expense", ghost: true, height: scaleBar(prev.expenses, maxV) });
    }
    return out;
  }

  return { barSpecs, scaleBar, BAR_MAX_PX, BAR_MIN_PX };
});
