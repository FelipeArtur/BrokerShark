(function (root, factory) {
  const api = factory(
    typeof require !== "undefined" ? require("./palette.js") : (root.BS || {}),
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function (P) {

  // Identidade de banco, num lugar só.
  //
  // Nubank e Inter são as duas contas do dono e têm cor própria no sistema
  // visual. Banco que entrar depois não pode herdar a cor nem o nome de um
  // deles — antes disso, uma conta nova aparecia rotulada "Inter" na faixa
  // herói e pintada com o laranja do Inter.

  const isNubank = (bank, id) =>
    String(bank || "").toLowerCase() === "nubank" || String(id || "").startsWith("nu");

  const isInter = (bank, id) =>
    String(bank || "").toLowerCase() === "inter" || String(id || "").startsWith("inter");

  /** Cor do banco. Banco novo ganha uma cor estável do palette. */
  function bankColor(bank, id) {
    if (isNubank(bank, id)) return "var(--nubank)";
    if (isInter(bank, id)) return "var(--inter)";
    return P.swatchColor(String(bank || id || ""));
  }

  /**
   * Rótulo humano do banco.
   *
   * Tem que ser o MESMO em todo lugar: o widget da fatura usa isso como chave de
   * faceta e a tabela de lançamentos usa pra casar a filtragem. Se um disser
   * "Outros" e o outro "C6", clicar na faceta não filtra nada.
   */
  function bankLabel(bank, id) {
    if (isNubank(bank, id)) return "Nubank";
    if (isInter(bank, id)) return "Inter";
    if (bank) return String(bank).replace(/^./, c => c.toUpperCase());
    return String(id || "Outros");
  }

  /** Rótulo curto pra faixa de KPI, onde não cabe o nome inteiro. */
  function bankShortLabel(bank, id) {
    if (isNubank(bank, id)) return "Nu";
    return bankLabel(bank, id).slice(0, 6);
  }

  return { bankColor, bankLabel, bankShortLabel };
});
