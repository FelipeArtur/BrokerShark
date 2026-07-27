(function () {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);

  // Fantasma é neutro nas duas espécies: verde é receita e só receita, então
  // o comparativo não pode reusar a cor — quem diz o que é o fantasma é a
  // barra real ao lado dele (ver domain/bars.js, a ordem é load-bearing).
  const GHOST = { width: 3, background: "var(--fg-3)", opacity: 0.5 };

  function PixelBars({ slot, maxV, isPicked, compare }) {
    const specs = window.BS.barSpecs(slot, maxV, compare);
    return h("div", { className: "tl-bars" }, specs.map(s => h("div", {
      key: s.key,
      className: s.ghost
        ? "tl-bar"
        : `tl-bar ${s.kind === "income" ? "dither-pos" : "dither-neg"}`,
      title: s.ghost ? (s.kind === "income" ? "receita do mês anterior" : "despesa do mês anterior") : undefined,
      style: s.ghost
        ? { height: s.height, ...GHOST }
        : { height: s.height, opacity: isPicked ? 1 : 0.8 },
    })));
  }

  window.BS = window.BS || {};
  window.BS.PixelBars = PixelBars;
})();
