/**
 * @file static.ts
 * @brief Serve o frontend estático, com guarda de path traversal e mapa /static/.
 *
 * static.ts — frontend estático com guarda de path traversal.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { Res } from "./respond.ts";
import { error } from "./respond.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

/**
 * @brief Criar o servidor de arquivos estáticos preso a um diretório raiz.
 * @param rootDir diretório do frontend; resolvido uma vez e usado como fronteira
 * @return função `serveStatic(pathname, res)` que atende um arquivo sob a raiz
 */
export function makeStatic(rootDir: string) {
  const root = resolve(rootDir);
  /**
   * @brief Atender um arquivo do frontend, barrando qualquer path fora da raiz.
   *
   * A guarda compara o caminho JÁ resolvido com a raiz: só passa o que estiver sob
   * `root` (ou o próprio index.html). É isso que barra traversal via "..".
   *
   * @param pathname path pedido; "/static/<sub>" mapeia para "<root>/<sub>" (contrato v1)
   *                 e "/" cai em index.html
   * @param res resposta HTTP; recebe 404 quando o path escapa da raiz ou não é arquivo
   */
  return function serveStatic(pathname: string, res: Res): void {
    // contrato v1: assets sob /static/<subdir> → frontend/<subdir>
    const path = pathname.startsWith("/static/") ? pathname.slice("/static".length) : pathname;
    const rel = path === "/" ? "index.html" : path.slice(1);
    const file = resolve(root, rel);
    if (file !== join(root, "index.html") && !file.startsWith(root + sep)) {
      return error(res, "not found", 404);
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      return error(res, "not found", 404);
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    createReadStream(file).pipe(res);
  };
}
