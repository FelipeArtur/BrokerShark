// As duas regras que decidem o que conta como dinheiro gasto e dinheiro ganho.
// São a invariante mais load-bearing do ledger (CLAUDE.md) e viviam copiadas em
// cinco consultas — com três formatações e dois jeitos de prefixar coluna. Uma
// cópia que não acompanhasse as outras faria os totais divergirem entre widgets
// sem quebrar teste nenhum, então a fonte passa a ser única.
//
// `alias` é o apelido da tabela na consulta ("t" em `FROM transactions t`);
// vazio quando a consulta não usa apelido.

const col = (alias: string) => (alias ? `${alias}.` : "");

/**
 * Despesa de CONSUMO — o que de fato saiu do bolso.
 *
 * Fora dela: transferência (perna de investimento e perna de saída de um par
 * SELF, que `selfPairs` reescreve pra `method='transfer'`), liquidação de fatura
 * (o gasto real são os itens da fatura — contar o pagamento dobraria), gasto de
 * terceiro e transferência com destino interno declarado.
 */
export function consumptionExpense(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'expense' AND ${c}method != 'transfer' AND ${c}is_settlement = 0
    AND ${c}is_third_party = 0 AND ${c}dest_account_id IS NULL`;
}

/**
 * Receita REAL — dinheiro que entrou de fora.
 *
 * `is_revenue = 0` marca self-transfer e movimento de investimento: entrou na
 * conta, mas não é renda nova.
 */
export function realIncome(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'income' AND ${c}is_revenue = 1 AND ${c}is_third_party = 0`;
}

/**
 * Perna de INVESTIMENTO que sai da conta — aplicação.
 *
 * O par SELF é o vizinho perigoso: `selfPairs` reescreve a perna de saída pra
 * `method='transfer'`, que é exatamente a marca da aplicação. Sem excluir
 * `self_pair_tx_id`, mandar dinheiro da conta A pra conta B vira "aplicou" e o
 * saldo livre do mês encolhe sozinho — foi o que acontecia no resumo do mês.
 */
export function investmentOut(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'expense' AND ${c}method = 'transfer' AND ${c}self_pair_tx_id IS NULL
    AND ${c}dest_account_id IS NULL AND ${c}is_settlement = 0`;
}

/**
 * Perna de INVESTIMENTO que entra na conta — resgate.
 *
 * `is_revenue = 0` sozinho não basta: `selfPairs` também zera o da perna de
 * entrada. Hoje a perna SELF de entrada guarda o método original (pix/ted), mas
 * depender disso é depender de um acaso do extrato — a exclusão explícita de
 * `self_pair_tx_id` é o que sustenta a regra.
 */
export function investmentIn(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'income' AND ${c}is_revenue = 0 AND ${c}method = 'transfer'
    AND ${c}self_pair_tx_id IS NULL`;
}
