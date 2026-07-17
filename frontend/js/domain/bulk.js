/**
 * @file bulk.js
 * @brief Decisão pura do "aplicar todas as sugestões" da categorização em lote.
 *
 * Separa a DECISÃO (o que aplicar) do EFEITO (aplicar) — é isso que torna o
 * batch testável sem DOM nem rede, e o que permite disparar as chamadas em
 * paralelo e atualizar o estado uma vez só no fim.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /**
   * @brief Lista os pares (comerciante, categoria) a gravar num "aplicar todas".
   * @param groups grupos de uncategorized-merchants; ausente vira []
   * @return array {merchant_key, flow, ids, category_id} — só os que têm sugestão
   */
  function suggestionPlan(groups) {
    return (groups || [])
      .filter(g => g.suggested_category_id != null)
      .map(g => ({
        merchant_key: g.merchant_key,
        flow: g.flow,
        ids: g.ids,
        category_id: g.suggested_category_id,
      }));
  }

  return { suggestionPlan };
});
