/**
 * @file security.ts
 * @brief Fronteiras do server local: allowlist de Host, allowlist de Origin e headers.
 *
 * security.ts — fronteiras do app local (sem auth: a máquina é o perímetro).
 *
 * - Host allowlist: barra DNS rebinding (site malicioso resolvendo o próprio
 *   domínio para 127.0.0.1 viraria same-origin e leria o ledger).
 * - Headers: nosniff, sem iframes, CSP self-only (frontend é 100% vendorizado,
 *   nada externo é legítimo).
 */
import type { Req, Res } from "./respond.ts";

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * @brief Verificar se o header Host está na allowlist de localhost (anti DNS-rebinding).
 *
 * Verifica se a requisição veio de um host permitido (localhost/127.0.0.1).
 * Essencial para prevenir ataques de DNS-Rebinding onde um site malicioso
 * faz o browser do usuário resolver um domínio localmente.
 * 
 * @param req A requisição HTTP a ser verificada
 * @returns boolean indicando se o host é permitido
 */
export function hostAllowed(req: Req): boolean {
  const host = req.headers.host ?? "";
  // separa porta preservando IPv6 ([::1]:8000)
  const name = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];
  return ALLOWED_HOSTNAMES.has(name.toLowerCase());
}

/**
 * @brief Verificar se o Origin da requisição é localhost (defesa CSRF nos writes).
 *
 * Defesa CSRF: sem auth, o adversário é uma página maliciosa no browser do
 * usuário. `readBody` ignora Content-Type, então POSTs de escrita são
 * atingíveis como "simple request". Rejeitamos escrita quando o Origin está
 * presente e não é localhost. Origin ausente = não-browser (curl, backfill)
 * ou GET same-origin — o allowlist de Host já cobre esse caso.
 *
 * @param req requisição a verificar
 * @return true se o Origin for localhost ou estiver ausente; false se o Origin for
 *         de outra origem ou não parsear como URL
 */
export function originAllowed(req: Req): boolean {
  const origin = req.headers.origin;
  if (origin == null) return true;
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * @brief Aplicar os headers de segurança da resposta (nosniff, frame-deny, CSP self-only).
 *
 * A CSP é self-only porque o frontend é 100% vendorizado — nada externo é legítimo.
 *
 * @param res resposta HTTP a receber os headers
 */
export function securityHeaders(res: Res): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}
