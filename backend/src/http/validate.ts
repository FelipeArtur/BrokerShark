/**
 * @file validate.ts
 * @brief Type guards de entrada das rotas (datas, valores, ids, texto, métodos).
 *
 * validate.ts — validações de entrada (puras; FKs são checadas nos handlers).
 *
 * Funções Type Guard para garantir que os inputs externos que chegam nas rotas
 * (via req.body ou querystring) possuem o formato e os tipos corretos antes
 * de qualquer processamento.
 */

/**
 * @brief Validar uma data ISO "YYYY-MM-DD" existente no calendário.
 *
 * Diferente de parseDateBR, aqui o dia é checado contra o mês real (31/02 falha,
 * 29/02 só passa em bissexto).
 *
 * @param v valor a validar (entrada não confiável)
 * @return true se for "YYYY-MM-DD" com mês 1–12 e dia existente naquele mês
 */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= new Date(y, m, 0).getDate();
}

/**
 * @brief Validar um valor monetário positivo vindo do JSON.
 *
 * Valor monetário em reais vindo do JSON: número finito > 0, máx 2 casas úteis.
 *
 * @param v valor a validar; unidade é REAIS (é a fronteira JSON — a conversão para
 *          centavos inteiros acontece no handler, depois desta guarda)
 * @return true se for número finito, > 0 e < 1_000_000_000
 */
export function isPositiveAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1_000_000_000;
}

/**
 * @brief Validar um id de chave primária.
 * @param v valor a validar
 * @return true se for inteiro > 0
 */
export function isIntId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * @brief Validar uma lista não-vazia de ids (usada nas operações em lote).
 * @param v valor a validar
 * @return true se for array de 1 a 10_000 ids inteiros > 0
 */
export function isIntIdArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 10_000 && v.every(isIntId);
}

/**
 * @brief Validar um texto curto não-vazio (descrição, apelido, nome de categoria).
 * @param v valor a validar
 * @param max comprimento máximo em caracteres (default 200)
 * @return true se for string com conteúdo além de espaços e dentro do limite
 */
export function isShortText(v: unknown, max = 200): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/** @brief Whitelist do campo `method` de transactions (espelha o CHECK do schema). */
export const TX_METHODS = new Set([
  "pix", "credit", "ted", "transfer", "debit", "salary", "freelance", "pix_received", "other",
]);
