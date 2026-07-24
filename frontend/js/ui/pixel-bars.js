/**
 * @file pixel-bars.js
 * @brief Barras dithered (receita/despesa) de um mês da timeline de fluxo.
 */
/* pixel-bars.js — dithered pixel bars for the cashflow timeline. */
(function () {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  /**
   * @brief Desenha as barras de um mês: receita e despesa, mais a barra
   *        fantasma do mês anterior quando a comparação está ligada.
   * @param props.slot mês da timeline {month, data, prev} — `data`/`prev` trazem
   *        income/expenses em REAIS, ou data nulo quando o mês não tem dados
   * @param props.maxV maior valor do ano exibido, em reais — a escala é comum a
   *        todos os meses do ano, senão as alturas não seriam comparáveis
   * @param props.isPicked true quando é o mês do seletor global (barra opaca)
   * @param props.compare true desenha a barra fantasma da receita do mês anterior
   * @return elemento React com as barras do mês
   */
  function PixelBars({ slot, maxV, isPicked, compare }) {
    const d = slot.data;
    /**
     * @brief Converte valor em altura de barra, com piso visível.
     * @param v valor em REAIS
     * @return altura em px — mínimo 2px se v > 0, pra não sumir um mês com dados
     */
    const scale = (v) => Math.max((v / maxV) * 52, v > 0 ? 2 : 0);
    const bars = [
      h("div", { key: "i", className: "tl-bar dither-pos", style: { height: d ? scale(d.income) : 0, opacity: isPicked ? 1 : 0.8 } }),
      h("div", { key: "e", className: "tl-bar dither-neg", style: { height: d ? scale(d.expenses) : 0, opacity: isPicked ? 1 : 0.8 } }),
    ];
    if (compare && slot.prev) {
      bars.push(h("div", { key: "gi", className: "tl-bar", style: { height: scale(slot.prev.income), width: 3, background: "var(--fg-3)", opacity: 0.5 } }));
    }
    return h("div", { className: "tl-bars" }, bars);
  }
  /**
   * @brief Barra FANTASMA de um compromisso futuro (projeção/virtual).
   *        Contorno tracejado, preenchimento transparente — display-only, nunca
   *        confundível com fato realizado. Nunca verde (é saída).
   * @param props.value valor em REAIS
   * @param props.maxV maior valor da série, em reais — escala comum
   * @return elemento React da barra fantasma
   */
  function ProjectedBar({ value, maxV }) {
    const scale = (v) => Math.max((v / (maxV || 1)) * 52, v > 0 ? 2 : 0);
    return h("div", { className: "tl-bar", style: {
      height: scale(value),
      background: "transparent",
      outline: "1px dashed var(--fg-3)",
      outlineOffset: -1,
      opacity: 0.6,
    } });
  }
  window.BS = window.BS || {};
  window.BS.PixelBars = PixelBars;
  window.BS.ProjectedBar = ProjectedBar;
})();
