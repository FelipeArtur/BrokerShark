/**
 * @file budget.ts
 * @brief Resolução do alvo de gasto por categoria (override do mês → alvo fixo).
 *
 * Alvo de gasto por categoria — resolução pura (sem DB/IO).
 *
 *  Duas camadas, uma tabela: ref_month='' é o alvo fixo (vale todo mês),
 *  ref_month='YYYY-MM' sobrescreve só aquele mês. Precedência: override → fixo.
 *
 *  Categoria sem alvo resolve pra `null`, NUNCA pra zero: "sem alvo" e "alvo de
 *  R$ 0,00" são estados diferentes — zero significaria tudo nascer 100% estourado.
 */

/** ref_month do alvo fixo. */
export const FIXED = "";

/** @brief Linha crua de alvo: categoria, mês ('' = fixo) e valor em centavos inteiros. */
export type BudgetRow = {
  category_id: number;
  ref_month: string;
  amount_cents: number;
};

/** @brief Camada que originou o alvo resolvido: override do mês ou alvo fixo. */
export type BudgetSource = "month" | "fixed";

/** @brief Alvo vigente: valor em centavos inteiros + a camada de onde veio. */
export type ResolvedBudget = {
  amount_cents: number;
  source: BudgetSource;
};

/**
 * @brief Resolver o alvo vigente de uma categoria num mês (override → fixo).
 *
 * Alvo vigente da categoria no mês. `null` = sem alvo definido.
 *
 * @param rows todas as linhas de alvo conhecidas (fixas e por mês)
 * @param categoryId categoria cujo alvo se quer resolver
 * @param refMonth mês "YYYY-MM"; FIXED ('') consulta apenas o alvo fixo
 * @return alvo vigente com `amount_cents` em centavos inteiros, ou `null` se a
 *         categoria não tiver alvo — nunca zero (ver nota do @file)
 */
export function resolveBudget(
  rows: readonly BudgetRow[],
  categoryId: number,
  refMonth: string,
): ResolvedBudget | null {
  let fixed: BudgetRow | undefined;
  for (const r of rows) {
    if (r.category_id !== categoryId) continue;
    if (r.ref_month === refMonth && refMonth !== FIXED) {
      return { amount_cents: r.amount_cents, source: "month" };
    }
    if (r.ref_month === FIXED) fixed = r;
  }
  return fixed ? { amount_cents: fixed.amount_cents, source: "fixed" } : null;
}

/**
 * @brief Validar que um valor é mês de referência aceito pela tabela de alvos.
 *
 * 'YYYY-MM' de um mês real, ou '' (o alvo fixo).
 *
 * @param v valor a validar (entrada não confiável de rota)
 * @return true se for "YYYY-MM" com mês 1–12, ou FIXED ('')
 */
export function isRefMonth(v: unknown): v is string {
  if (v === FIXED) return true;
  if (typeof v !== "string" || !/^\d{4}-\d{2}$/.test(v)) return false;
  const m = Number(v.slice(5));
  return m >= 1 && m <= 12;
}

/**
 * @brief Calcular a fração do alvo já consumida pelo gasto do mês.
 *
 * Quanto do alvo já foi gasto. `null` (sem alvo) não vira progresso.
 *
 * @param spentCents gasto da categoria no mês, em centavos inteiros
 * @param budget alvo resolvido, ou `null` quando a categoria não tem alvo
 * @return razão gasto/alvo (1 = alvo cravado, >1 = estourado), ou `null` quando não
 *         há alvo ou o alvo é <= 0 — evita divisão por zero
 */
export function budgetRatio(spentCents: number, budget: ResolvedBudget | null): number | null {
  if (!budget || budget.amount_cents <= 0) return null;
  return spentCents / budget.amount_cents;
}
