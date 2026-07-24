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
