/**
 * @file filter.js
 * @brief Lógica pura do filtro facetado compartilhado pelos widgets e pela
 *        tabela: OR dentro de uma faceta, AND entre facetas.
 */
/* filter.js — pure faceted-filter logic. UMD dual tail: node require + window.BS. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /**
   * @brief Cria o filtro neutro, que casa com toda transação.
   * @return filtro {categories, accounts, banks: Set, flow, method: "all", search: ""}
   */
  function emptyFilter() {
    return { categories: new Set(), accounts: new Set(), banks: new Set(), flow: "all", method: "all", search: "" };
  }

  /**
   * @brief Liga/desliga um valor numa faceta de conjunto, sem mutar o filtro.
   * @param filter filtro atual
   * @param kind faceta: "categories", "accounts" ou "banks"
   * @param value valor clicado (nome da categoria, id da conta, nome do banco)
   * @return novo filtro com o valor alternado
   */
  function toggleFacet(filter, kind, value) {
    const next = new Set(filter[kind]);
    if (next.has(value)) next.delete(value); else next.add(value);
    return Object.assign({}, filter, { [kind]: next });
  }

  /**
   * @brief Conta quantas dimensões do filtro estão ativas.
   * @param filter filtro atual
   * @return número de facetas ativas — 0 significa "nada filtrado"
   */
  function facetCount(filter) {
    return filter.categories.size + filter.accounts.size + filter.banks.size
      + (filter.flow !== "all" ? 1 : 0) + (filter.method !== "all" ? 1 : 0)
      + (filter.search ? 1 : 0);
  }

  /**
   * @brief Casa um rótulo com a busca (substring, sem diferenciar maiúsculas).
   * @param label texto da linha (descrição, apelido…)
   * @param query termo buscado; vazio casa com tudo
   * @return true se o rótulo contém o termo
   */
  function searchMatch(label, query) {
    if (!query) return true;
    return String(label || "").toLowerCase().includes(String(query).toLowerCase());
  }

  /* pix_received colapsa em pix: pro filtro, PIX é PIX — a direção já é `flow`. */
  const METHOD_MAP = { pix: "pix", pix_received: "pix", credit: "credit", ted: "ted" };

  /**
   * @brief Testa se uma transação passa por todas as facetas do filtro.
   * @param tx transação normalizada {flow, method, category, bank, account_id, label}
   * @param filter filtro atual
   * @return true quando a linha deve aparecer
   */
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
