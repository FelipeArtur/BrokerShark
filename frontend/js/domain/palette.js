/**
 * @file palette.js
 * @brief Cor estável por nome, quantizada à paleta — arte pixel tem paleta
 *        LIMITADA, então 360 matizes contínuos destoam do resto do app.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /** Matizes da paleta Balatro — 8 passos, escolhidos pra serem distinguíveis. */
  const HUES = [15, 50, 90, 155, 200, 250, 290, 330];

  /**
   * @brief Índice de matiz estável derivado de uma string.
   * @param str nome do comerciante; vazio/nulo devolve 0
   * @return inteiro em [0, 8)
   */
  function quantizeHue(str) {
    const s = String(str == null ? "" : str);
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (s.charCodeAt(i) + ((hash << 5) - hash)) | 0;
    return Math.abs(hash) % HUES.length;
  }

  /**
   * @brief Cor do swatch de um comerciante — estável e sempre da paleta.
   * @param str nome do comerciante
   * @return string oklch()
   */
  function swatchColor(str) {
    return `oklch(75% 0.14 ${HUES[quantizeHue(str)]})`;
  }

  return { quantizeHue, swatchColor, HUES };
});
