import type { SavingsRule } from "../domain/classify.ts";

/**
 * @brief As palavras que reconhecem movimento de investimento.
 * @note  Vem por parâmetro, não da config: mantém o parser puro e testável sem disco.
 */
export interface LedgerVocabulary {
  investmentKeywords: readonly string[];
  savings?: SavingsRule;
}

export interface TxRecord {
  date: string;
  amountCents: number;
  description: string;
  accountId: string;
  flow: "expense" | "income";
  method: string;
  isRevenue: 0 | 1;
  externalId?: string;
  note?: string;
  isInvestmentLeg: boolean;
  /** Perna da posição de poupança DERIVADA do ledger (ver `derivedSavings`). */
  isSavingsLeg: boolean;
  sourceFile: string;
}

export interface ParsedFile {
  records: TxRecord[];
  skipped: { line: string; reason: string }[];

  signedSumCents: number;
  warnings: string[];
}
