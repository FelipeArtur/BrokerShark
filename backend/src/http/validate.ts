export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= new Date(y, m, 0).getDate();
}

export function isPositiveAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1_000_000_000;
}

export function isIntId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function isIntIdArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 10_000 && v.every(isIntId);
}

export function isShortText(v: unknown, max = 200): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

export const TX_METHODS = new Set([
  "pix", "credit", "ted", "transfer", "debit", "salary", "freelance", "pix_received", "other",
]);
