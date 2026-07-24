export const INVESTMENT_KEYWORDS = [
  "rdb", "nuinvest", "tesouro", "irrf", "cobrança de investimentos",
  "cobranca de investimentos", "aplicação", "aplicacao", "resgate",
  "caixinha", "porquinho", "cdb porq",
] as const;

export const CAIXINHA_KEYWORDS = ["rdb", "caixinha", "dinheiro guardado"] as const;

export function isInvestment(desc: string): boolean {
  const low = desc.toLowerCase();
  return INVESTMENT_KEYWORDS.some((k) => low.includes(k));
}

export function isCaixinhaLeg(desc: string, bank: string): boolean {
  if (bank !== "nubank") return false;
  const low = desc.toLowerCase();

  if (low.includes("nuinvest") || low.includes("tesouro")) return false;
  return CAIXINHA_KEYWORDS.some((k) => low.includes(k));
}

export function isFaturaPayment(desc: string): boolean {
  return desc.toLowerCase().includes("fatura");
}

export function checkingExpenseMethod(desc: string): string {
  const low = desc.toLowerCase();
  if (isFaturaPayment(desc)) return "credit";
  if (low.includes("pix")) return "pix";
  if (low.includes("débito") || low.includes("debito")) return "debit";
  return "ted";
}

export function incomeMethod(desc: string): string {
  return desc.toLowerCase().includes("pix") ? "pix" : "ted";
}
