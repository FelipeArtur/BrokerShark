(function () {

const h = (tag, props, ...children) => React.createElement(tag, props, ...children);

  // Fantasma é neutro nas duas espécies: verde é receita e só receita, então
  // o comparativo não pode reusar a cor — quem diz o que é o fantasma é a
  // barra real ao lado dele (ver domain/bars.js, a ordem é load-bearing).
  const GHOST = { width: 3, background: "var(--fg-3)", opacity: 0.5 };

  function PixelBars({ slot, maxV, isPicked, compare }) {
    const specs = window.BS.barSpecs(slot, maxV, compare);
    return h("div", { className: "tl-bars" }, specs.map(s => {
      // Altura zero tem duas causas, e elas não podem desenhar a mesma coisa.
      // Mês sem medição: nada. Mês medido em que nada entrou (ou nada saiu):
      // marca neutra no piso — diz "mediu, e deu zero" sem fingir um valor
      // pequeno, que é o que o tracinho de 2px colorido fazia. Fantasma zerado
      // fica de fora: é comparação secundária, e a marca teria a largura da
      // barra cheia em vez da do fantasma.
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
