(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  root.BS.juice = api;
})(typeof self !== "undefined" ? self : globalThis, function () {

  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";

  /** Quem pediu menos movimento não recebe nenhum. */
  function reduced() {
    return hasDOM && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function coinDrop() {
    if (!hasDOM || reduced()) return;
    const el = document.createElement("div");
    el.className = "bs-coin"; el.textContent = "+";
    el.style.left = (window.innerWidth / 2) + "px";
    el.style.top = "80px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }

  function anim(el, cls, ms) {
    if (!el || reduced()) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  function boot(el) { anim(el, "bs-boot", 460); }

  return { coinDrop, boot };
});
