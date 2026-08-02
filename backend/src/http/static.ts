import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
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

export function makeStatic(rootDir: string) {
  const root = resolve(rootDir);

  return function serveStatic(pathname: string, res: Res): void {
    const rel = pathname === "/" ? "index.html"
      : pathname.startsWith("/static/") ? pathname.slice("/static/".length)
      : null;
    if (rel == null) return error(res, "not found", 404);

    const file = resolve(root, rel);
    if (!file.startsWith(root + sep)) return error(res, "not found", 404);
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
