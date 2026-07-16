/* juice.js — sfx (WebAudio synth, no files) + micro-animations + mute. UMD tail. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  root.BS.juice = api;
  Object.assign(root.BS, { nextMuted: api.nextMuted, shouldAnimate: api.shouldAnimate });
})(typeof self !== "undefined" ? self : globalThis, function () {

  const KEY = "bs.muted";
  const nextMuted = (cur) => !cur;
  const shouldAnimate = (reducedMotion, _muted) => !reducedMotion;

  // Browser-only state; guarded so require() in node doesn't touch window.
  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
  let _ctx = null;

  function muted() {
    if (!hasDOM) return true;
    const v = window.localStorage.getItem(KEY);
    return v == null ? true : v === "1"; // default OFF (muted)
  }
  function setMuted(b) { if (hasDOM) window.localStorage.setItem(KEY, b ? "1" : "0"); }

  function reduced() { return hasDOM && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  function ctx() {
    if (!hasDOM) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_ctx) _ctx = new AC();
    return _ctx;
  }

  const TONES = { coin: [880, 1320], blip: [440], error: [180, 120] };

  function sfx(name) {
    if (muted()) return;
    const c = ctx(); if (!c) return;
    const freqs = TONES[name] || TONES.blip;
    let t = c.currentTime;
    freqs.forEach((f) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.1); t += 0.08;
    });
  }

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

  return { muted, setMuted, sfx, coinDrop, boot, pop, shake, nextMuted, shouldAnimate };
});
