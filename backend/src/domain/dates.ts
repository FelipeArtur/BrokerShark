/**
 * @brief Mês e ano correntes do relógio local.
 */
export function currentMonth(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

/**
 * @brief Primeiro e último dia do mês, em ISO.
 */
export function monthRange(month: number, year: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * @brief   Hoje em ISO, no fuso LOCAL.
 * @warning Nada de `toISOString()` (é UTC: das 21h em diante já vira amanhã) nem de
 *          `toLocaleDateString("sv-SE")` (com `small-icu` cai calado no en-US e dá `7/30/2026`).
 */
export function today(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * @brief Mês anterior a um `YYYY-MM`.
 */
export function prevRefMonth(refMonth: string): string {
  const y = Number(refMonth.slice(0, 4));
  const m = Number(refMonth.slice(5, 7));
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, "0")}`;
}
