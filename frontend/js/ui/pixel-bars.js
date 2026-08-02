(function () {

const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  //> Neutro: verde é receita e só receita, então o comparativo não reusa a cor.
  const GHOST = { width: 3, background: "var(--fg-3)", opacity: 0.5 };

  /**
   * @brief   As barras de um mês no fluxo mês a mês.
   * @warning Altura zero tem duas causas: sem medição não desenha nada; zero MEDIDO
   *          ganha marca neutra, senão finge um valor pequeno que não existiu.
   */
  function PixelBars({ slot, maxV, isPicked, compare }) {
    const specs = window.BS.barSpecs(slot, maxV, compare);
    return h("div", { className: "tl-bars" }, specs.map(s => {
      if (s.height <= 0) {
        const marca = s.measured && !s.ghost;
        return h("div", {
          key: s.key,
          className: marca ? "tl-bar tl-bar--zero" : "tl-bar",
          title: marca
            ? (s.kind === "income" ? "nenhuma receita neste mês" : "nenhuma despesa neste mês")
            : undefined,
        });
      }
      return h("div", {
        key: s.key,
        className: s.ghost
          ? "tl-bar"
          : `tl-bar ${s.kind === "income" ? "dither-pos" : "dither-neg"}`,
        title: s.ghost ? (s.kind === "income" ? "receita do mês anterior" : "despesa do mês anterior") : undefined,
        style: s.ghost
          ? { height: s.height, ...GHOST }
          : { height: s.height, opacity: isPicked ? 1 : 0.8 },
      });
    }));
  }

  window.BS = window.BS || {};
  window.BS.PixelBars = PixelBars;
})();
