import type { SavingsRule } from "../domain/classify.ts";

/**
 * As palavras que o ledger usa pra reconhecer movimento de investimento.
 *
 * Passa como parâmetro em vez de ser lida da config lá dentro: parser continua
 * função pura de (texto, vocabulário) → registros, testável sem arquivo de
 * configuração no disco.
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
