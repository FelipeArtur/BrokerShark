export interface TxRecord {
  date: string;              // ISO
  amountCents: number;       // sempre positivo
  description: string;
  accountId: string;
  flow: "expense" | "income";
  method: string;
  isRevenue: 0 | 1;
  externalId?: string;       // UUID Nubank
  note?: string;
  isInvestmentLeg: boolean;
  isCaixinhaLeg: boolean;
  sourceFile: string;
}

export interface ParsedFile {
  records: TxRecord[];
  skipped: { line: string; reason: string }[];
  /** Σ assinada dos valores parseados — cruzada com a soma independente do arquivo cru. */
  signedSumCents: number;
  warnings: string[];
}
