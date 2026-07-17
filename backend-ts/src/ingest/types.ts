/**
 * @file types.ts
 * @brief Tipos comuns dos parsers de ingestão (registro de transação e arquivo parseado).
 */

/**
 * @brief Uma linha de extrato já normalizada, pronta para virar INSERT.
 *
 * `amountCents` é sempre POSITIVO — o sinal vive em `flow`. O valor é em centavos
 * inteiros.
 */
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

/** @brief Resultado do parse de um arquivo: registros, descartes, Σ de conferência e avisos. */
export interface ParsedFile {
  records: TxRecord[];
  skipped: { line: string; reason: string }[];
  /** Σ assinada dos valores parseados — cruzada com a soma independente do arquivo cru. */
  signedSumCents: number;
  warnings: string[];
}
