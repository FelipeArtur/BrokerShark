/** respond.ts — resposta JSON, erro e leitura de body (com limites). */
import type { IncomingMessage, ServerResponse } from "node:http";

export type Req = IncomingMessage & { params?: Record<string, string> };
export type Res = ServerResponse;

const MAX_BODY_BYTES = 1_000_000; // payloads reais são KBs; 1 MB já é folga

export function json(res: Res, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

export function error(res: Res, message: string, status = 400): void {
  json(res, { error: message }, status);
}

/** Body JSON. Lança HttpError(400) em JSON inválido e (413) acima do limite. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
export function qs(req: Req): URLSearchParams {
  const url = req.url ?? "/";
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

export function qsStr(req: Req, key: string): string | undefined {
  return qs(req).get(key) ?? undefined;
}

export function qsInt(req: Req, key: string): number | undefined {
  const v = qs(req).get(key);
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
