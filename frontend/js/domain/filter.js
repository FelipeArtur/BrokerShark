(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  function emptyFilter() {
    return { categories: new Set(), accounts: new Set(), banks: new Set(), flow: "all", method: "all", search: "" };
  }

  function toggleFacet(filter, kind, value) {
    const next = new Set(filter[kind]);
    if (next.has(value)) next.delete(value); else next.add(value);
    return Object.assign({}, filter, { [kind]: next });
  }

  function facetCount(filter) {
    return filter.categories.size + filter.accounts.size + filter.banks.size
      + (filter.flow !== "all" ? 1 : 0) + (filter.method !== "all" ? 1 : 0)
      + (filter.search ? 1 : 0);
  }

  function searchMatch(label, query) {
    if (!query) return true;
    return String(label || "").toLowerCase().includes(String(query).toLowerCase());
  }

  const METHOD_MAP = { pix: "pix", pix_received: "pix", credit: "credit", ted: "ted" };

  function matchesFilter(tx, filter) {
    if (filter.flow !== "all" && tx.flow !== filter.flow) return false;
    if (filter.method !== "all") {
      const m = METHOD_MAP[tx.method] || tx.method;
      if (m !== filter.method) return false;
    }
    if (filter.categories.size && !filter.categories.has(tx.category)) return false;
    if (filter.banks.size && !filter.banks.has(tx.bank)) return false;
    if (filter.accounts.size && !filter.accounts.has(tx.account_id)) return false;
    if (!searchMatch(tx.label, filter.search)) return false;
    return true;
  }

  return { emptyFilter, toggleFacet, facetCount, searchMatch, matchesFilter };
});
