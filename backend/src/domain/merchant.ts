// Reduz uma descrição de extrato ao "núcleo" do comerciante — usado como matcher
// da regra nome→categoria. O resultado é SEMPRE substring da descrição minúscula,
// porque a sugestão (routes) casa via hay.includes(matcher).
const PREFIXES = [
  /^pix enviado:\s*cp\s*:\d+-/i,
  /^pix enviado:\s*\d+\s+\d+\s+/i,
  /^transferência enviada pelo pix\s*-\s*/i,
  /^transferência enviada\s*-\s*/i,
  /^pagamento de boleto efetuado\s*-\s*/i,
];
const TRAIL = /\s+(salvador|sao paulo|são paulo|contagem|salto|simoes filho|simões filho|brasilia|brasília|rio de janeiro)\b.*$/i;
const TRAIL_UF = /\s+bra$/i;

export function normalizeMerchant(desc: string): string {
  let s = String(desc || "").trim();
  if (!s) return "";
  for (const re of PREFIXES) s = s.replace(re, "");
  s = s.replace(TRAIL_UF, "");
  s = s.replace(TRAIL, "");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s;
}
