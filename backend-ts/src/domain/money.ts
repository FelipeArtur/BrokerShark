/**
 * @file money.ts
 * @brief Parse e formatação de dinheiro em centavos inteiros (sem float no ledger).
 *
 * Fronteira monetária do sistema: toda string de valor vinda de export bancário
 * entra por aqui e vira inteiro. Nenhum valor do ledger passa por float.
 */

/**
 * @brief Converter uma string de valor BRL em centavos inteiros.
 *
 * Parse de valores BRL para CENTAVOS INTEIROS. Porta fiel do adapters.parse_money v1,
 * sem passar por float: a string é decomposta em inteiro+fração.
 *
 * Formatos reais: "-6.19" (Nubank), "182,20" / "-146,00" (Inter),
 * "R$ 1.830,62" (fatura), "1.000" (milhar sem decimal).
 *
 * @param raw string crua do export ("R$ 1.830,62", "-6.19", "1.000"); aceita
 *            prefixo "R$", sinal, separadores de milhar e espaços
 * @return valor em centavos inteiros, negativo quando a string vem com "-"
 * @throws Error se a string for vazia, não casar o formato aceito, ou o valor
 *         em centavos estourar o inteiro seguro / o teto de 1e14
 */
export function parseMoneyCents(raw: string): number {
  let s = (raw ?? "").trim().replace(/R\$/g, "").replace(/[\s ]/g, "");
  if (!s) throw new Error("empty amount");
  const neg = s.startsWith("-");
  s = s.replace(/^[+-]/, "");
  if (s.includes(",")) {
    // convenção brasileira: ponto = milhar, vírgula = decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, ""); // "1.234.567" → milhares
  } else if (s.includes(".") && s.split(".")[1]!.length === 3) {
    // ponto único com 3 dígitos: separador de milhar ("1.000" → 1000).
    // Exports bancários usam sempre 2 decimais.
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

/**
 * @brief Formatar centavos inteiros como texto BRL ("R$ 1.830,62").
 * @param c valor em centavos inteiros (pode ser negativo)
 * @return string no formato "R$ 0,00", com "-" à frente quando negativo
 */
export function fmtCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}R$ ${(abs / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * @brief Converter data brasileira "DD/MM/YYYY" em ISO "YYYY-MM-DD".
 *
 * "DD/MM/YYYY" → ISO "YYYY-MM-DD". Lança em data inválida.
 *
 * @param raw data no formato brasileiro, com zeros à esquerda ("05/01/2026")
 * @return data ISO "YYYY-MM-DD"
 * @throws Error se o formato não casar ou mês/dia estiverem fora de faixa
 */
export function parseDateBR(raw: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!m) throw new Error(`invalid date: ${raw}`);
  const [, d, mo, y] = m;
  const day = Number(d), month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`invalid date: ${raw}`);
  return `${y}-${mo}-${d}`;
}
