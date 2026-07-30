import type { Req, Res } from "./respond.ts";
import { error } from "./respond.ts";

export type Handler = (req: Req, res: Res) => void | Promise<void>;

export type Route = { method: string; pattern: URLPattern; handler: Handler };

/**
 * Padrão de rota a partir do caminho — `URLPattern`, não regex montada à mão.
 *
 * `:id` é sintaxe nativa do `URLPattern` (global no Node ≥ 23.8), com a mesma
 * semântica que a substituição manual tinha: casa um segmento, sem atravessar
 * `/`. O decode continua sendo nosso, porque `exec` devolve o grupo cru.
 */
export function compilePath(path: string): { pattern: URLPattern } {
  return { pattern: new URLPattern({ pathname: path }) };
}

export async function dispatch(routes: Route[], req: Req, res: Res, pathname: string): Promise<boolean> {
  const method = req.method ?? "GET";
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.pattern.exec({ pathname });
    if (!m) continue;
    req.params = {};
    for (const [key, raw] of Object.entries(m.pathname.groups)) {
      try {
        req.params[key] = decodeURIComponent(raw ?? "");
      } catch {
        error(res, "parâmetro malformado", 400);
        return true;
      }
    }
    await route.handler(req, res);
    return true;
  }
  return false;
}
