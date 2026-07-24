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
  isCaixinhaLeg: boolean;
  sourceFile: string;
}

export interface ParsedFile {
  records: TxRecord[];
  skipped: { line: string; reason: string }[];

  signedSumCents: number;
  warnings: string[];
}
