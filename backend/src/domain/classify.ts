// Classificação de lançamento a partir da descrição — lógica PURA.
//
// As palavras que identificam investimento e poupança NÃO moram aqui: são de
// quem usa, e mudam com o banco e com o produto ("reserva", "rdb", "cofrinho",
// o nome que o app do banco dá). Vêm de `config/`, e este módulo só aplica.
// O que é do domínio é a forma de decidir, não o vocabulário.

export interface SavingsRule {
  keywords: string[];
  /** Palavras que DESQUALIFICAM: mesmo casando, não é a poupança derivada. */
  excludeKeywords: string[];
  /** Conta cujas pernas alimentam a posição derivada. */
  accountId: string;
}

const hasAny = (low: string, words: readonly string[]): boolean =>
  words.some(k => low.includes(k.toLowerCase()));

export function isInvestment(desc: string, keywords: readonly string[]): boolean {
  return hasAny(desc.toLowerCase(), keywords);
}

/**
 * @brief   Perna da poupança DERIVADA do ledger, a que não tem custódia em corretora.
 * @warning `excludeKeywords` evita contar em dobro: resgate custodiado também carrega
 *          "resgate", mas já entra pela posição real.
 */
export function isDerivedSavingsLeg(
  desc: string, accountId: string, rule: SavingsRule | undefined,
): boolean {
  if (!rule || accountId !== rule.accountId) return false;
  const low = desc.toLowerCase();
  if (hasAny(low, rule.excludeKeywords)) return false;
  return hasAny(low, rule.keywords);
}

function isInvoicePayment(desc: string): boolean {
  return desc.toLowerCase().includes("fatura");
}

export function checkingExpenseMethod(desc: string): string {
  const low = desc.toLowerCase();
  if (isInvoicePayment(desc)) return "credit";
  if (low.includes("pix")) return "pix";
  if (low.includes("débito") || low.includes("debito")) return "debit";
  return "ted";
}

export function incomeMethod(desc: string): string {
  return desc.toLowerCase().includes("pix") ? "pix" : "ted";
}
