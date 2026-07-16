/* meta.js — pure derivations of the light "score" layer. UMD dual tail. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  function savingsStreak(monthlyNet) {
    let n = 0;
    for (let i = (monthlyNet || []).length - 1; i >= 0; i--) {
      if (monthlyNet[i] > 0) n++; else break;
    }
    return n;
  }

  function isAllTimeHigh(series) {
    if (!series || series.length < 2) return false;
    const last = series[series.length - 1];
    for (let i = 0; i < series.length - 1; i++) if (series[i] >= last) return false;
    return true;
  }

  function budgetProgress(spentCents, targetCents) {
    if (targetCents == null || targetCents <= 0) return null;
    const pct = Math.max(0, Math.min(100, Math.round((spentCents / targetCents) * 100)));
    return { pct, remainingCents: targetCents - spentCents };
  }

  return { savingsStreak, isAllTimeHigh, budgetProgress };
});
