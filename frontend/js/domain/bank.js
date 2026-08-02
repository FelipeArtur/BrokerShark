(function (root, factory) {
  const api = factory(
    typeof require !== "undefined" ? require("./palette.js") : (root.BS || {}),
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function (P) {

  /**
   * @file    Identidade visual de banco, num lugar só.
   * @details Cor sai do nome por hash estável (palette). Nenhum banco tem identidade
   *          reservada no código: instituição nova entra sem herdar a de outra.
   */

  /** Cores declaradas em `bankColors` na config. Mapa de módulo porque `bankColor` roda dentro de render. */
  let declared = {};

  /**
   * @brief Registra as cores da config.
   * @param map Chave é o nome do banco, sem caixa.
   */
  function setBankColors(map) {
    declared = {};
    for (const [k, v] of Object.entries(map || {})) {
      if (v) declared[String(k).trim().toLowerCase()] = v;
    }
  }

  /**
   * @brief   Cor do banco: a declarada na config, senão derivada do nome.
   * @details Declarar cor é escolha de quem usa, no `config/local.json` dele.
   */
  function bankColor(bank, id) {
    const key = String(bank || "").trim().toLowerCase();
    return declared[key] || P.swatchColor(String(bank || id || ""));
  }

  /**
   * @brief   Rótulo humano do banco.
   * @warning Tem que ser o MESMO em todo lugar: é chave de faceta e de filtro. Se
   *          divergirem, clicar na faceta não filtra nada.
   */
  function bankLabel(bank, id) {
    if (bank) return String(bank).replace(/^./, c => c.toUpperCase());
    return String(id || "Outros");
  }

  /**
   * @brief Rótulo curto pra faixa de KPI, onde não cabe o nome inteiro.
   */
  function bankShortLabel(bank, id) {
    const full = bankLabel(bank, id);
    return full.length <= 8 ? full : full.slice(0, 8);
  }

  /**
   * @brief   Contas por banco, cartão aninhado sob a conta que paga a fatura.
   * @details Cartão não é conta irmã: é a fatura de uma conta. O parentesco vem do
   *          banco em comum. Duas telas usam a mesma árvore, daí morar aqui.
   * @param   ordenarPorSaldo maior saldo primeiro (widget); senão por nome (painel).
   */
  function groupByBank(accounts, ordenarPorSaldo = false) {
    const grupos = new Map();
    for (const a of accounts || []) {
      const g = grupos.get(a.bank) || { bank: a.bank, contas: [], cartoes: [] };
      (a.type === "credit_card" ? g.cartoes : g.contas).push(a);
      grupos.set(a.bank, g);
    }
    const saldo = g => g.contas.reduce((s, a) => s + (a.balance || 0), 0);
    return [...grupos.values()].sort((x, y) =>
      (ordenarPorSaldo ? saldo(y) - saldo(x) : 0) || String(x.bank).localeCompare(String(y.bank)));
  }

  return { bankColor, bankLabel, bankShortLabel, setBankColors, groupByBank };
});
