/**
 * @file router.ts
 * @brief Micro-router: compila padrões de path e despacha a requisição ao handler.
 *
 * router.ts — micro-router: path patterns + dispatch.
 */
import type { Req, Res } from "./respond.ts";
import { error } from "./respond.ts";

/** @brief Handler de rota; pode ser síncrono ou assíncrono. */
export type Handler = (req: Req, res: Res) => void | Promise<void>;

/** @brief Rota registrada: método, padrão compilado, nomes dos params e handler. */
export type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

/**
 * @brief Compilar um path com `:params` em regex + a lista de nomes dos params.
 *
 * "/api/transactions/:id" → { pattern, keys: ["id"] }
 *
 * @param path padrão da rota, com segmentos `:nome`
 * @return `pattern` ancorado que casa o path inteiro e `keys` na ordem de captura
 */
export function compilePath(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = path.replace(/:([a-zA-Z_]+)/g, (_m, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${re}$`), keys };
}

/**
 * @brief Casar método+path, popular req.params e executar o handler da rota.
 *
 * Casa método+path; popula req.params e executa o handler. False = sem rota.
 *
 * @param routes rotas registradas, testadas na ordem
 * @param req requisição; recebe `params` decodificados quando a rota casa
 * @param res resposta HTTP
 * @param pathname path já sem query-string
 * @return true se alguma rota casou (inclusive quando respondeu 400 por param
 *         malformado); false quando nenhuma casou — o caller cai no estático
 */
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
