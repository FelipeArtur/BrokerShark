export function parseMoneyCents(raw: string): number {
  let s = (raw ?? "").trim().replace(/R\$/g, "").replace(/[\s ]/g, "");
  if (!s) throw new Error("empty amount");
  const neg = s.startsWith("-");
  s = s.replace(/^[+-]/, "");
  if (s.includes(",")) {

    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  } else if (s.includes(".") && s.split(".")[1]!.length === 3) {

    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`invalid amount: ${raw}`);
  const [int, frac = ""] = s.split(".");
  const cents = Number(int) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > 1e14) {
    throw new Error(`amount out of range: ${raw}`);
  }
  return neg ? -cents : cents;
}

export function fmtCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}R$ ${(abs / 100).toFixed(2).replace(".", ",")}`;
}

export function parseDateBR(raw: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!m) throw new Error(`invalid date: ${raw}`);
  const [, d, mo, y] = m;
  const day = Number(d), month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`invalid date: ${raw}`);
  return `${y}-${mo}-${d}`;
}
