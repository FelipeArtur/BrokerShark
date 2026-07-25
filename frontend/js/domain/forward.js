(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  // Funde a série DURA (fatura aberta + parcelas) com a série PREVISTA
  // (recorrência detectada) num eixo de meses só, sem misturar as bandas:
  // comprometido e previsto continuam separados em cada mês.
  function mergeForwardSeries(hardSeries, recurringSeries) {
    const byMonth = new Map();

    const slot = (month, label) => {
      let s = byMonth.get(month);
      if (!s) byMonth.set(month, (s = {
        month, label, committed: 0, recurringExpense: 0, recurringIncome: 0, maturity: 0,
      }));
      return s;
    };

    for (const s of hardSeries || []) {
      const t = slot(s.month, s.label);
      t.committed += s.total || 0;
      t.maturity += s.maturity || 0;
    }
    for (const s of recurringSeries || []) {
      const t = slot(s.month, s.label);
      t.recurringExpense += s.expense || 0;
      t.recurringIncome += s.income || 0;
    }

    return [...byMonth.values()]
      .map(s => Object.assign(s, {
        outflow: s.committed + s.recurringExpense,
        inflow: s.recurringIncome + s.maturity,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  // Escala das barras: o teto é a maior saída de um mês só. A entrada tem eixo
  // próprio — comparar altura de entrada com saída sugeriria um saldo que a
  // visão não calcula.
  function forwardScale(merged) {
    return {
      outflow: (merged || []).reduce((m, s) => Math.max(m, s.outflow), 0) || 1,
      income: (merged || []).reduce((m, s) => Math.max(m, s.inflow), 0) || 1,
    };
  }

  // O núcleo do comerciante vem do extrato carregando documento, banco, agência
  // e conta ("fulano - •••.000.000-•• - itaú unibanco s.a. (0341) agência: …").
  // Para exibição, corta o ruído: tira o prefixo de transferência e para no
  // primeiro segmento que começa com documento (máscara de CPF ou dígito).
  const RECEIPT_PREFIX = /^(transferência recebida pelo pix|transferência recebida|pix recebido:|transferência enviada pelo pix|transferência enviada)\s*[-:]?\s*/i;

  function merchantLabel(merchant) {
    let s = String(merchant == null ? "" : merchant).trim();
    if (!s) return "";
    const stripped = s.replace(RECEIPT_PREFIX, "").trim();
    if (stripped) s = stripped;

    const parts = s.split(" - ");
    const kept = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
      if (/^[•\d]/.test(parts[i].trim())) break;
      kept.push(parts[i]);
    }
    return kept.join(" - ").trim() || s;
  }

  return { mergeForwardSeries, forwardScale, merchantLabel };
});
