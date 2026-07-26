export function currentMonth(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export function monthRange(month: number, year: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Hoje em ISO, no fuso LOCAL.
 *
 * `toISOString()` seria UTC — em UTC-3, das 21h em diante ele já devolve a data
 * de amanhã, e uma conta aberta à noite nasceria datada no dia seguinte.
 */
export function today(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function prevRefMonth(refMonth: string): string {
  const y = Number(refMonth.slice(0, 4));
  const m = Number(refMonth.slice(5, 7));
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, "0")}`;
}

