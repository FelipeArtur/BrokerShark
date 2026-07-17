/**
 * @file dates.ts
 * @brief Datas de referência do dashboard: mês corrente, faixa do mês, mês anterior, hoje.
 *
 * dates.ts — datas de referência (puro, sem IO).
 */

/**
 * @brief Obter mês e ano correntes do relógio local.
 * @return objeto com `month` 1–12 (já normalizado, não o 0–11 do Date) e `year`
 */
export function currentMonth(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

/**
 * @brief Calcular o primeiro e o último dia ISO de um mês.
 *
 * Primeiro e último dia ISO do mês.
 *
 * @param month mês 1–12
 * @param year ano com 4 dígitos
 * @return `start` = "YYYY-MM-01" e `end` = último dia real do mês (respeita bissexto)
 */
export function monthRange(month: number, year: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * @brief Obter o mês de referência anterior.
 *
 * 'YYYY-MM' anterior. Vira o ano sozinho: '2026-01' → '2025-12'.
 *
 * @param refMonth mês de referência "YYYY-MM"
 * @return o "YYYY-MM" imediatamente anterior
 */
export function prevRefMonth(refMonth: string): string {
  const y = Number(refMonth.slice(0, 4));
  const m = Number(refMonth.slice(5, 7));
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/**
 * @brief Obter a data de hoje em ISO.
 *
 * YYYY-MM-DD de hoje.
 *
 * @return data local corrente como "YYYY-MM-DD"
 */
export function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
