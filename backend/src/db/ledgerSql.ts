// As regras de total do ledger, numa fonte só — copiadas à mão, divergem entre
// widgets sem quebrar teste. `alias` é o apelido da tabela ("t" em
// `FROM transactions t`), vazio quando a consulta não usa.

const col = (alias: string) => (alias ? `${alias}.` : "");

/** Despesa de consumo. Fora: transferência, liquidação de fatura, terceiro, destino interno. */
export function consumptionExpense(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'expense' AND ${c}method != 'transfer' AND ${c}is_settlement = 0
    AND ${c}is_third_party = 0 AND ${c}dest_account_id IS NULL`;
}

/** Receita real. `is_revenue = 0` marca self-transfer e investimento: entrou, mas não é renda. */
export function realIncome(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'income' AND ${c}is_revenue = 1 AND ${c}is_third_party = 0`;
}

/** Aplicação. Excluir `self_pair_tx_id` é load-bearing: sem isso, mandar de A pra B vira "aplicou". */
export function investmentOut(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'expense' AND ${c}method = 'transfer' AND ${c}self_pair_tx_id IS NULL
    AND ${c}dest_account_id IS NULL AND ${c}is_settlement = 0 AND ${c}is_third_party = 0`;
}

/** Resgate. `is_revenue = 0` não basta — `selfPairs` também zera o da perna SELF de entrada. */
export function investmentIn(alias = ""): string {
  const c = col(alias);
  return `${c}flow = 'income' AND ${c}is_revenue = 0 AND ${c}method = 'transfer'
    AND ${c}self_pair_tx_id IS NULL AND ${c}is_third_party = 0`;
}
