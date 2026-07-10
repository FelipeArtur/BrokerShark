/** helpers.ts — utilidades compartilhadas entre rotas. */
import type { IncomingMessage, ServerResponse } from "node:http";

// ── Tipos ──────────────────────────────────────────────────────────────────
export type Req = IncomingMessage & { params?: Record<string, string> };
export type Res = ServerResponse;
export type Handler = (req: Req, res: Res) => void | Promise<void>;
export type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

// ── SSE broadcaster ────────────────────────────────────────────────────────
export const sseClients = new Set<Res>();

export function broadcast(event = "update"): void {
  for (const res of sseClients) {
    try { res.write(`data: ${event}\n\n`); } catch { sseClients.delete(res); }
  }
}

// ── JSON / body helpers ────────────────────────────────────────────────────
export function json(res: Res, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function error(res: Res, message: string, status = 400): void {
  json(res, { error: message }, status);
}

export async function readBody<T = Record<string, unknown>>(req: Req): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

// ── Query-string helpers ───────────────────────────────────────────────────
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

// ── Routing helpers ────────────────────────────────────────────────────────
/**
 * Transforma um path pattern como "/api/transactions/:id"
 * em { pattern: RegExp, keys: ["id"] }.
 */
export function compilePath(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = path.replace(/:([a-zA-Z_]+)/g, (_m, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${re}$`), keys };
}

// ── Date helpers ───────────────────────────────────────────────────────────
export function currentMonth(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export function monthRange(month: number, year: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const start = `${year}-${mm}-01`;
  // último dia do mês
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/** Retorna o YYYY-MM-DD de hoje. */
export function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
