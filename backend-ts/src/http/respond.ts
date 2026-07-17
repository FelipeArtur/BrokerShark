/**
 * @file respond.ts
 * @brief Resposta JSON/erro, leitura de body com limite e acesso à query-string.
 *
 * respond.ts — resposta JSON, erro e leitura de body (com limites).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** @brief Requisição HTTP com os params de rota preenchidos pelo dispatch. */
export type Req = IncomingMessage & { params?: Record<string, string> };

/** @brief Resposta HTTP (alias de ServerResponse). */
export type Res = ServerResponse;

const MAX_BODY_BYTES = 1_000_000; // payloads reais são KBs; 1 MB já é folga

/**
 * @brief Responder JSON com no-store (dado financeiro nunca fica em cache).
 * @param res resposta HTTP
 * @param data payload a serializar
 * @param status status HTTP (default 200)
 */
export function json(res: Res, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

/**
 * @brief Responder um erro no formato `{ error: message }`.
 * @param res resposta HTTP
 * @param message mensagem de erro (pt-BR, exibida na UI)
 * @param status status HTTP (default 400)
 */
export function error(res: Res, message: string, status = 400): void {
  json(res, { error: message }, status);
}

/**
 * @brief Erro que carrega o status HTTP a devolver ao cliente.
 *
 * Body JSON. Lança HttpError(400) em JSON inválido e (413) acima do limite.
 */
export class HttpError extends Error {
  status: number;
  /**
   * @brief Construir o erro com status e mensagem.
   * @param status status HTTP a devolver
   * @param message mensagem de erro
   */
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * @brief Ler e desserializar o body JSON da requisição, respeitando o cap de 1 MB.
 *
 * Ignora o Content-Type de propósito — por isso todo write exige Origin localhost
 * (ver security.ts): sem essa checagem o endpoint seria atingível como "simple request".
 *
 * @param req requisição cujo corpo será consumido
 * @return o JSON desserializado; objeto vazio quando o corpo é vazio
 * @throws HttpError 413 se o corpo passar de MAX_BODY_BYTES; 400 se o JSON for inválido
 */
export async function readBody<T = Record<string, unknown>>(req: Req): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body grande demais");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

// ── Query-string ───────────────────────────────────────────────────────────

/**
 * @brief Extrair a query-string da URL da requisição.
 * @param req requisição
 * @return URLSearchParams (vazio quando não há "?")
 */
export function qs(req: Req): URLSearchParams {
  const url = req.url ?? "/";
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

/**
 * @brief Ler um parâmetro de query-string como string.
 * @param req requisição
 * @param key nome do parâmetro
 * @return o valor, ou `undefined` se ausente
 */
export function qsStr(req: Req, key: string): string | undefined {
  return qs(req).get(key) ?? undefined;
}

/**
 * @brief Ler um parâmetro de query-string como número.
 * @param req requisição
 * @param key nome do parâmetro
 * @return o número, ou `undefined` se ausente, vazio ou não-finito
 */
export function qsInt(req: Req, key: string): number | undefined {
  const v = qs(req).get(key);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
