(function (root, factory) {
  const api = factory(
    typeof require !== "undefined" ? require("./palette.js") : (root.BS || {}),
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function (P) {

  // Identidade visual de banco, num lugar só.
  //
  // A cor sai do nome do banco pelo palette — hash estável, oito matizes. Não há
  // lista de bancos conhecidos aqui de propósito: o mesmo nome sempre recebe a
  // mesma cor, e um banco que ninguém previu entra sem herdar a identidade de
  // outro. (Antes existia um par fixo com os dois bancos do autor, e uma conta
  // nova aparecia rotulada com o nome de um deles e pintada com a cor dele.)

  // Cores DECLARADAS, vindas de `bankColors` na config (o backend manda em
  // `bank_color` no /api/accounts, e o boot chama `setBankColors`). Fica num
  // mapa de módulo porque `bankColor` é chamada de dentro de render, síncrona,
  // em lugares que só têm o nome do banco na mão — não dá pra buscar ali.
  let declared = {};

  /** Registra as cores da config. Chave é o nome do banco, sem caixa. */
  function setBankColors(map) {
    declared = {};
    for (const [k, v] of Object.entries(map || {})) {
      if (v) declared[String(k).trim().toLowerCase()] = v;
    }
  }

  /**
   * Cor do banco: a declarada na config, senão derivada do nome.
   *
   * O fallback é o que mantém a regra de que nenhum banco tem identidade
   * reservada NO CÓDIGO — instituição que ninguém previu entra com cor própria
   * e estável, sem herdar a de outra. Declarar cor é escolha de quem usa, no
   * `config/local.json` dele.
   */
  function bankColor(bank, id) {
    const key = String(bank || "").trim().toLowerCase();
    return declared[key] || P.swatchColor(String(bank || id || ""));
  }

  /**
   * Rótulo humano do banco.
   *
   * Tem que ser o MESMO em todo lugar: o widget da fatura usa isso como chave de
   * faceta e a tabela de lançamentos usa pra casar a filtragem. Se um disser
   * "Outros" e o outro "Banco B", clicar na faceta não filtra nada.
   */
  function bankLabel(bank, id) {
    if (bank) return String(bank).replace(/^./, c => c.toUpperCase());
    return String(id || "Outros");
  }

  /**
   * Rótulo curto pra faixa de KPI, onde não cabe o nome inteiro.
   *
   * Corta na primeira palavra quando ela já distingue ("Banco A" → "Banco"
   * não distingue nada, então cai no corte por tamanho).
   */
  function bankShortLabel(bank, id) {
    const full = bankLabel(bank, id);
    return full.length <= 8 ? full : full.slice(0, 8);
  }

  return { bankColor, bankLabel, bankShortLabel, setBankColors };
});
