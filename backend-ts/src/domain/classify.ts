/**
 * @file classify.ts
 * @brief Classificação pura de linha de extrato por keyword (investimento, método, Caixinha).
 *
 * Classificação pura de linha de extrato — porta de core/domain/classification.py v1.
 * SELF não é decidido aqui (v2 usa pareamento de pernas, ver selfPair.ts).
 */

/** @brief Keywords que marcam uma linha de extrato como movimento de investimento. */
// "cdb porq" cobre "CDB PORQUINHO" e "CDB Porq Obj", incl. estornos.
export const INVESTMENT_KEYWORDS = [
  "rdb", "nuinvest", "tesouro", "irrf", "cobrança de investimentos",
  "cobranca de investimentos", "aplicação", "aplicacao", "resgate",
  "caixinha", "porquinho", "cdb porq",
] as const;

/** @brief Keywords de poupança que identificam as pernas da Caixinha Nubank. */
// Pernas da Caixinha Nubank (RDB fora da B3) — viram investment_id da posição ledger.
export const CAIXINHA_KEYWORDS = ["rdb", "caixinha", "dinheiro guardado"] as const;

/**
 * @brief Dizer se a descrição indica movimento de investimento.
 * @param desc descrição da linha de extrato (case-insensitive)
 * @return true se a descrição contiver alguma INVESTMENT_KEYWORDS
 */
export function isInvestment(desc: string): boolean {
  const low = desc.toLowerCase();
  return INVESTMENT_KEYWORDS.some((k) => low.includes(k));
}

/**
 * @brief Dizer se a linha é perna da Caixinha Nubank (RDB derivado do ledger).
 *
 * Só vale para o Nubank: a Caixinha é RDB fora da B3, derivada do ledger. Pernas de
 * corretora (nuinvest/tesouro) ficam de fora — entram na B3 e contariam em dobro.
 *
 * @param desc descrição da linha de extrato
 * @param bank banco da conta; qualquer valor != "nubank" retorna false
 * @return true se for perna de aplicação/resgate da Caixinha
 */
export function isCaixinhaLeg(desc: string, bank: string): boolean {
  if (bank !== "nubank") return false;
  const low = desc.toLowerCase();
  // keyword de corretora nunca entra na derivação (regra v1 preservada)
  if (low.includes("nuinvest") || low.includes("tesouro")) return false;
  return CAIXINHA_KEYWORDS.some((k) => low.includes(k));
}

/**
 * @brief Dizer se a descrição é um pagamento de fatura de cartão.
 * @param desc descrição da linha de extrato
 * @return true se contiver "fatura"
 */
export function isFaturaPayment(desc: string): boolean {
  return desc.toLowerCase().includes("fatura");
}

/**
 * @brief Deduzir o `method` de uma despesa de conta corrente pela descrição.
 *
 * Precedência load-bearing: fatura → "credit" antes de qualquer outro teste; uma
 * linha "Pagamento de fatura via PIX" é liquidação de cartão, não gasto PIX.
 *
 * @param desc descrição da linha de extrato
 * @return "credit" (fatura), "pix", "debit" ou "ted" como fallback
 */
export function checkingExpenseMethod(desc: string): string {
  const low = desc.toLowerCase();
  if (isFaturaPayment(desc)) return "credit";
  if (low.includes("pix")) return "pix";
  if (low.includes("débito") || low.includes("debito")) return "debit";
  return "ted";
}

/**
 * @brief Deduzir o `method` de uma entrada de conta corrente pela descrição.
 * @param desc descrição da linha de extrato
 * @return "pix" se a descrição citar PIX, senão "ted"
 */
export function incomeMethod(desc: string): string {
  return desc.toLowerCase().includes("pix") ? "pix" : "ted";
}
