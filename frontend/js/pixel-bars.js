/* pixel-bars.js — dithered pixel bars for the cashflow timeline. */
(function () {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  function PixelBars({ slot, maxV, isPicked, compare }) {
    const d = slot.data;
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
  window.BS = window.BS || {};
  window.BS.PixelBars = PixelBars;
})();
