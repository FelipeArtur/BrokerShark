(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  root.BS.juice = api;
  Object.assign(root.BS, { shouldAnimate: api.shouldAnimate });
})(typeof self !== "undefined" ? self : globalThis, function () {

  const shouldAnimate = (reducedMotion) => !reducedMotion;

  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";

  function reduced() { return hasDOM && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  function coinDrop(x, y) {
    if (!hasDOM || !shouldAnimate(reduced())) return;
    const el = document.createElement("div");
    el.className = "bs-coin"; el.textContent = "+";
    el.style.left = (x || window.innerWidth / 2) + "px";
    el.style.top = (y || 80) + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }

  function anim(el, cls, ms) {
    if (!el || !shouldAnimate(reduced())) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  function boot(el) { anim(el, "bs-boot", 460); }
  function pop(el) { anim(el, "bs-pop", 200); }
  function shake(el) { anim(el, "bs-shake", 420); }

  return { coinDrop, boot, pop, shake, shouldAnimate };
});
