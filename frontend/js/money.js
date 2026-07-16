/**
 * @file money.js
 * @brief As espécies de dinheiro (KIND) e como elas aparecem — classificador,
 *        cores, rótulos e formatação. Puro, sem React/DOM.
 *
 * UNIDADE: `t.amount` vem da API em REAIS (float). Centavos inteiros só
 * existem no ledger/backend.
 */
/* money.js — as espécies de dinheiro e como elas aparecem.
   Puro (sem React/DOM). UMD dual tail: node require + window.BS. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /* ── Espécies ────────────────────────────────────────────────────────────
     Seis estados, exaustivos e mutuamente exclusivos. Cada linha do ledger é
     exatamente um deles.

     A ORDEM É LOAD-BEARING (espelha a precedência do backfill/analytics.ts):

     1. settlement  antes de expense — pagamento de fatura é liquidação; os
                    gastos reais são os itens itemizados. Contar o pagamento
                    dobraria o consumo.
     2. transfer    antes de invest  — perna SELF é dinheiro trocando de bolso,
                    não aplicação. (Verificado no ledger: a perna SELF de saída
                    é method='transfer', que casaria com invest se viesse antes.)
     3. invest      antes de third_party — method='transfer' é sinal forte de
                    perna de investimento.
     4. third_party antes de revenue/expense — as duas regras exigem
                    !is_third_party; dinheiro de terceiro não é nenhuma delas.

     Equivale à regra consumo-despesa do CLAUDE.md:
     flow='expense' AND method != 'transfer' AND is_settlement=0
     AND is_third_party=0 AND dest_account_id IS NULL.                        */

  const KIND = {
    SETTLEMENT:  "settlement",   // liquidação de fatura — fora dos totais
    TRANSFER:    "transfer",     // entre contas próprias — fora dos totais
    INVEST:      "invest",       // perna de investimento — não é gasto nem ganho
    THIRD_PARTY: "third_party",  // paguei por outra pessoa — volta pra mim
    REVENUE:     "revenue",      // receita real
    EXPENSE:     "expense",      // despesa de consumo
  };

  /**
   * @brief Classifica uma linha do ledger em exatamente uma espécie.
   *
   * Espécie da linha. `null` p/ tx ausente — os callers passam tx possivelmente
   * indefinida, e devolver EXPENSE faria `isConsumptionExpense(null)` virar true.
   *
   * A ordem dos testes abaixo é a precedência documentada no topo do arquivo:
   * mexer nela muda a classificação e quebra os totais.
   *
   * @param t transação (`amount` em REAIS); pode vir null/undefined
   * @return uma das constantes KIND, ou null quando `t` é ausente
   */
  function moneyKind(t) {
    if (!t) return null;
    if (t.is_settlement) return KIND.SETTLEMENT;
    if (t.counterpart === "SELF" || t.dest_account_id != null) return KIND.TRANSFER;
    if (t.method === "transfer" || (t.flow === "income" && !t.is_revenue)) return KIND.INVEST;
    if (t.is_third_party) return KIND.THIRD_PARTY;
    return t.flow === "income" ? KIND.REVENUE : KIND.EXPENSE;
  }

  /* Cor por espécie. Investimento é roxo: única saída que não é perda.
     Transferência/liquidação são cinza: ruído contábil. Third-party é amarelo
     porque é pendência, não ruído — cinza diria "ignora isso". */
  const KIND_COLOR = {
    [KIND.SETTLEMENT]:  "var(--fg-3)",
    [KIND.TRANSFER]:    "var(--fg-3)",
    [KIND.INVEST]:      "var(--reserve)",
    [KIND.THIRD_PARTY]: "var(--warn)",
    [KIND.REVENUE]:     "var(--pos)",
    [KIND.EXPENSE]:     "var(--neg)",
  };

  const KIND_LABEL = {
    [KIND.SETTLEMENT]:  "Liquidações",
    [KIND.TRANSFER]:    "Transferências",
    [KIND.INVEST]:      "Investimentos",
    [KIND.THIRD_PARTY]: "De terceiros",
    [KIND.REVENUE]:     "Receitas",
    [KIND.EXPENSE]:     "Despesas",
  };

  const KIND_HINT = {
    [KIND.SETTLEMENT]:  "liquidação de fatura — os gastos reais são os itens da fatura; contar o pagamento dobraria o consumo",
    [KIND.TRANSFER]:    "transferência entre suas contas — não conta como despesa nem receita",
    [KIND.INVEST]:      "movimento de investimento — não conta como despesa nem receita",
    [KIND.THIRD_PARTY]: "gasto de terceiro — fora dos seus totais",
    [KIND.REVENUE]:     "receita real",
    [KIND.EXPENSE]:     "despesa de consumo",
  };

  /* Espécies que entram nos totais do rodapé. As outras são informativas. */
  const COUNTS_AS = { [KIND.REVENUE]: "in", [KIND.EXPENSE]: "out", [KIND.INVEST]: "invest" };

  /**
   * @brief Devolve o sinal contábil da linha.
   *
   * Sinal contábil: descreve a direção do dinheiro, mesmo em espécie que não soma.
   *
   * @param t transação (só `flow` é lido)
   * @return "+" quando é entrada (flow='income'), "−" caso contrário
   */
  function kindSign(t) {
    return (t && t.flow === "income") ? "+" : "−";
  }

  /* ── Formatação ──────────────────────────────────────────────────────────
     fmtParts decompõe pra UI atenuar os centavos. fmtBRL (primitives.js) segue
     existindo pros callers que querem string pronta (title/aria-label). */
  /**
   * @brief Formata um valor em pt-BR e separa a parte inteira dos centavos.
   * @param v valor em REAIS; o sinal é ignorado (quem pinta o sinal é kindSign)
   * @param opts.decimals casas decimais (padrão 2; 0 devolve cents vazio)
   * @return {int, cents} — `int` já com separador de milhar, `cents` incluindo a vírgula
   */
  function fmtParts(v, opts = {}) {
    const { decimals = 2 } = opts;
    const n = Math.abs(v ?? 0);
    const full = n.toLocaleString("pt-BR", {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
    const cut = full.lastIndexOf(",");
    return cut < 0 ? { int: full, cents: "" }
                   : { int: full.slice(0, cut), cents: full.slice(cut) };
  }

  return { KIND, moneyKind, kindSign, KIND_COLOR, KIND_LABEL, KIND_HINT, COUNTS_AS, fmtParts };
});
