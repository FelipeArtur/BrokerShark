import type { DatabaseSync } from "node:sqlite";

// Auditoria de invariantes sobre um DB VIVO.
//
// O `printReport` do backfill só roda depois de uma reconstrução; o DB do dia a
// dia muda pelo import da UI e nunca era conferido. Cada check aqui é uma das
// invariantes documentadas no CLAUDE.md virada em consulta — se uma delas
// quebra, algum total da tela está mentindo.

export type Violation = { check: string; message: string; count: number };

type Check = { check: string; message: string; sql: string };

const CHECKS: Check[] = [
  {
    check: "self-sem-par",
    message: "perna SELF declarada sem contraparte — seria contada como despesa de consumo",
    sql: `SELECT COUNT(*) AS n FROM transactions
          WHERE counterpart = 'SELF' AND self_pair_tx_id IS NULL`,
  },
  {
    check: "self-par-nao-reciproco",
    message: "self_pair_tx_id aponta pra linha que não aponta de volta",
    sql: `SELECT COUNT(*) AS n FROM transactions a
          LEFT JOIN transactions b ON b.id = a.self_pair_tx_id
          WHERE a.self_pair_tx_id IS NOT NULL
            AND (b.id IS NULL OR b.self_pair_tx_id IS NULL OR b.self_pair_tx_id != a.id)`,
  },
  {
    check: "self-saida-nao-transfer",
    message: "perna SELF de saída fora de method='transfer' — a regra consumo-despesa não a excluiria",
    sql: `SELECT COUNT(*) AS n FROM transactions
          WHERE self_pair_tx_id IS NOT NULL AND flow = 'expense' AND method != 'transfer'`,
  },
  {
    check: "self-entrada-como-receita",
    message: "perna SELF de entrada com is_revenue=1 — inflaria a receita real",
    sql: `SELECT COUNT(*) AS n FROM transactions
          WHERE self_pair_tx_id IS NOT NULL AND flow = 'income' AND is_revenue = 1`,
  },
  {
    check: "self-como-investimento",
    //> Perna SELF ligada a posição contaria a mesma quantia em dois lugares.
    message: "perna SELF ligada a uma posição de investimento — transferência viraria aplicação",
    sql: `SELECT COUNT(*) AS n FROM transactions
          WHERE self_pair_tx_id IS NOT NULL AND investment_id IS NOT NULL`,
  },
  {
    check: "liquidacao-mal-classificada",
    message: "liquidação de fatura marcada como transferência ou terceiro — dupla contagem de consumo",
    sql: `SELECT COUNT(*) AS n FROM transactions
          WHERE is_settlement = 1 AND (method = 'transfer' OR is_third_party = 1)`,
  },
  {
    check: "item-fatura-conta-errada",
    message: "item de fatura lançado em conta diferente da fatura",
    sql: `SELECT COUNT(*) AS n FROM transactions t JOIN invoices i ON i.id = t.invoice_id
          WHERE t.is_settlement = 0 AND t.account_id != i.account_id`,
  },
  {
    check: "fatura-total-diverge",
    //> Estorno abate o total: o confronto é com o líquido, não com a soma bruta.
    message: "total da fatura não bate com o líquido dos seus itens",
    sql: `SELECT COUNT(*) AS n FROM invoices i
          WHERE EXISTS (SELECT 1 FROM transactions t WHERE t.invoice_id = i.id AND t.is_settlement = 0)
            AND i.total_cents != (
              SELECT COALESCE(SUM(CASE WHEN t.flow = 'expense' THEN t.amount_cents ELSE -t.amount_cents END), 0)
              FROM transactions t WHERE t.invoice_id = i.id AND t.is_settlement = 0)`,
  },
  {
    check: "fatura-pagamento-inexistente",
    message: "fatura marcada como paga apontando pra lançamento que não existe",
    sql: `SELECT COUNT(*) AS n FROM invoices i
          LEFT JOIN transactions t ON t.id = i.payment_tx_id
          WHERE i.payment_tx_id IS NOT NULL AND t.id IS NULL`,
  },
  {
    check: "parcela-seq-invalida",
    message: "parcela com número acima do total — projeção de compromisso sairia errada",
    sql: `SELECT COUNT(*) AS n FROM transactions
          WHERE installment_seq IS NOT NULL AND installment_total IS NOT NULL
            AND installment_seq > installment_total`,
  },
  //> `external_id` duplicado não entra: o UNIQUE do schema barra antes de virar dado.
  {
    check: "destino-igual-origem",
    message: "transferência com conta de destino igual à de origem",
    sql: `SELECT COUNT(*) AS n FROM transactions WHERE dest_account_id = account_id`,
  },
  {
    check: "posicao-sem-snapshot",
    message: "posição aberta sem nenhum snapshot — entraria no patrimônio valendo zero",
    sql: `SELECT COUNT(*) AS n FROM investments i WHERE i.closed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM position_snapshots s WHERE s.investment_id = i.id)`,
  },
  {
    check: "snapshot-negativo",
    message: "snapshot de posição com valor líquido negativo",
    sql: `SELECT COUNT(*) AS n FROM position_snapshots WHERE net_cents < 0`,
  },
  {
    check: "categoria-sentido-errado",
    message: "lançamento categorizado com categoria do sentido oposto",
    sql: `SELECT COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
          WHERE t.flow != c.flow`,
  },
  {
    check: "lancamento-pos-encerramento",
    //> Movimento DEPOIS do fim: ou a data do encerramento está errada, ou a linha
    //> entrou na conta errada.
    message: "lançamento com data posterior ao encerramento da conta",
    sql: `SELECT COUNT(*) AS n FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE a.closed_at IS NOT NULL AND t.date > a.closed_at`,
  },
  {
    check: "conta-encerrada-com-divida",
    //> Espelho da recusa do PATCH. Cartão: fatura aberta. Conta: saldo negativo.
    message: "conta encerrada com dívida em aberto — o valor a pagar sumiu da posição",
    sql: `SELECT COUNT(*) AS n FROM accounts a WHERE a.closed_at IS NOT NULL AND (
            EXISTS (SELECT 1 FROM invoices i
                    WHERE i.account_id = a.id AND i.payment_tx_id IS NULL)
            OR (a.type = 'checking' AND a.initial_balance_cents + COALESCE((
                 SELECT SUM(CASE WHEN t.flow = 'income' THEN t.amount_cents
                                 ELSE -t.amount_cents END)
                 FROM transactions t WHERE t.account_id = a.id), 0) < 0))`,
  },
  {
    check: "alvo-em-categoria-de-receita",
    message: "alvo de gasto definido em categoria que não é de despesa",
    sql: `SELECT COUNT(*) AS n FROM category_budgets cb JOIN categories c ON c.id = cb.category_id
          WHERE c.flow != 'expense'`,
  },
];

export const AUDIT_CHECK_COUNT = CHECKS.length;

export function auditLedger(db: DatabaseSync): Violation[] {
  const out: Violation[] = [];
  for (const c of CHECKS) {
    const count = Number((db.prepare(c.sql).get() as { n: number }).n ?? 0);
    if (count > 0) out.push({ check: c.check, message: c.message, count });
  }
  return out;
}
