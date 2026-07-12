/** router.ts — micro-router: path patterns + dispatch. */
import type { Req, Res } from "./respond.ts";
import { error } from "./respond.ts";

export type Handler = (req: Req, res: Res) => void | Promise<void>;
export type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

/** "/api/transactions/:id" → { pattern, keys: ["id"] } */
export function compilePath(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = path.replace(/:([a-zA-Z_]+)/g, (_m, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${re}$`), keys };
}

/** Casa método+path; popula req.params e executa o handler. False = sem rota. */
export async function dispatch(routes: Route[], req: Req, res: Res, pathname: string): Promise<boolean> {
  const method = req.method ?? "GET";
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(pathname);
    if (!m) continue;
    req.params = {};
    for (let i = 0; i < route.keys.length; i++) {
      try {
        req.params[route.keys[i]] = decodeURIComponent(m[i + 1]);
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
