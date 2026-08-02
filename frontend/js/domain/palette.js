(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  const HUES = [15, 50, 90, 155, 200, 250, 290, 330];

  function quantizeHue(str) {
    const s = String(str == null ? "" : str);
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (s.charCodeAt(i) + ((hash << 5) - hash)) | 0;
    return Math.abs(hash) % HUES.length;
  }

  function swatchColor(str) {
    return `oklch(75% 0.14 ${HUES[quantizeHue(str)]})`;
  }

  //> `quantizeHue` e `HUES` saem só pro teste; a tela usa `swatchColor` e nada mais.
  return { quantizeHue, swatchColor, HUES };
});
