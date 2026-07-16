/** Alvo de gasto por categoria — resolução pura (sem DB/IO).
 *
 *  Duas camadas, uma tabela: ref_month='' é o alvo fixo (vale todo mês),
 *  ref_month='YYYY-MM' sobrescreve só aquele mês. Precedência: override → fixo.
 *
 *  Categoria sem alvo resolve pra `null`, NUNCA pra zero: "sem alvo" e "alvo de
 *  R$ 0,00" são estados diferentes — zero significaria tudo nascer 100% estourado.
 */

/** ref_month do alvo fixo. */
export const FIXED = "";

export type BudgetRow = {
  category_id: number;
  ref_month: string;
  amount_cents: number;
};

export type BudgetSource = "month" | "fixed";

export type ResolvedBudget = {
  amount_cents: number;
  source: BudgetSource;
};

/** Alvo vigente da categoria no mês. `null` = sem alvo definido. */
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

/** 'YYYY-MM' de um mês real, ou '' (o alvo fixo). */
export function isRefMonth(v: unknown): v is string {
  if (v === FIXED) return true;
  if (typeof v !== "string" || !/^\d{4}-\d{2}$/.test(v)) return false;
  const m = Number(v.slice(5));
  return m >= 1 && m <= 12;
}

/** Quanto do alvo já foi gasto. `null` (sem alvo) não vira progresso. */
export function budgetRatio(spentCents: number, budget: ResolvedBudget | null): number | null {
  if (!budget || budget.amount_cents <= 0) return null;
  return spentCents / budget.amount_cents;
}
