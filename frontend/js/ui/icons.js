/* IIFE-wrapped */
(function () {
/**
 * @file icons.js
 * @brief Ícones SVG inline usados pelo shell e pelos modais (sem dependência
 *        externa — o app é 100% offline).
 */

/**
 * @brief Desenha o ícone de lupa (busca).
 * @param props.size lado do ícone em px (padrão 17)
 * @return elemento React <svg>
 */
function IconSearch({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round",
    style: { display: "block", flexShrink: 0 }
  },
    React.createElement("circle", { cx: 6.5, cy: 6.5, r: 4 }),
    React.createElement("path", { d: "M10 10 L14 14" })
  );
}

/**
 * @brief Desenha o ícone de ajustes (dois sliders).
 * @param props.size lado do ícone em px (padrão 17)
 * @return elemento React <svg>
 */
function IconSettings({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round",
    style: { display: "block", flexShrink: 0 }
  },
    React.createElement("line", { x1: 2, y1: 5, x2: 14, y2: 5 }),
    React.createElement("circle", { cx: 9.5, cy: 5, r: 1.7, fill: "currentColor", stroke: "none" }),
    React.createElement("line", { x1: 2, y1: 11, x2: 14, y2: 11 }),
    React.createElement("circle", { cx: 5.5, cy: 11, r: 1.7, fill: "currentColor", stroke: "none" })
  );
}

/**
 * @brief Desenha o cadeado — fechado marca lançamento de terceiros.
 * @param props.size lado do ícone em px (padrão 16)
 * @param props.open true desenha o arco aberto (não é de terceiros)
 * @return elemento React <svg>
 */
function IconLock({ size = 16, open = false }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
    style: { display: "block", flexShrink: 0 }
  },
    React.createElement("rect", { x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.2 }),
    React.createElement("path", { d: open ? "M5.5 7 V5 a2.5 2.5 0 0 1 4.8 -1" : "M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" })
  );
}

/**
 * @brief Desenha o ícone de importar (seta pra cima sobre uma base).
 * @param props.size lado do ícone em px (padrão 17)
 * @return elemento React <svg>
 */
function IconImport({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
  },
    React.createElement("path", { d: "M8 11 L8 2" }),
    React.createElement("path", { d: "M4 6 L8 2 L12 6" }),
    React.createElement("path", { d: "M2 14 L14 14" })
  );
}

window.BS = window.BS || {};
window.BS.IconSearch = IconSearch;
window.BS.IconSettings = IconSettings;
window.BS.IconLock = IconLock;
window.BS.IconImport = IconImport;

})();
