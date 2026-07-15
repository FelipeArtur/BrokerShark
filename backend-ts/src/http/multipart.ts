/** multipart.ts — parser mínimo de multipart/form-data (zero deps).
 *
 *  Só o import via UI precisa de upload de arquivo (CSV texto + xlsx binário).
 *  readBody() em respond.ts é JSON-only; aqui lemos o corpo cru como Buffer e
 *  fatiamos pelas boundaries. Cap próprio (extrato/xlsx passam de 1 MB).
 */
import type { Req } from "./respond.ts";
import { HttpError } from "./respond.ts";

const MAX_UPLOAD_BYTES = 20_000_000; // 20 MB — extratos longos + relatório B3

export interface Part {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

async function readRaw(req: Req): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, "arquivo grande demais");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function boundaryOf(req: Req): string {
  const ct = req.headers["content-type"] ?? "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  const b = (m?.[1] ?? m?.[2] ?? "").trim();
  if (!b) throw new HttpError(400, "multipart sem boundary");
  return b;
}

/** Lê e fatia o corpo multipart em partes nomeadas (arquivos como Buffer). */
export async function parseMultipart(req: Req): Promise<Part[]> {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(400, "esperado multipart/form-data");
  }
  const body = await readRaw(req);
  const delim = Buffer.from(`--${boundaryOf(req)}`);
  const parts: Part[] = [];

  let idx = body.indexOf(delim);
  while (idx >= 0) {
    const start = idx + delim.length;
    // fim do stream: "--" logo após a boundary
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    const next = body.indexOf(delim, start);
    if (next < 0) break;
    // segmento entre boundaries, sem o CRLF que precede a próxima boundary
    const seg = body.subarray(start, next - 2);
    const headEnd = seg.indexOf("\r\n\r\n");
    if (headEnd >= 0) {
      const rawHead = seg.subarray(0, headEnd).toString("utf-8");
      const data = seg.subarray(headEnd + 4);
      const cd = /content-disposition:[^\r\n]*/i.exec(rawHead)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(cd)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(cd)?.[1];
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(rawHead)?.[1]?.trim();
      if (name != null) parts.push({ name, filename, contentType, data });
    }
    idx = next;
  }
  return parts;
}

/** Primeira parte-arquivo (tem filename). */
export function fileParts(parts: Part[]): Part[] {
  return parts.filter((p) => p.filename != null);
}

/** Valor de um campo texto por nome. */
export function fieldValue(parts: Part[], name: string): string | undefined {
  const p = parts.find((x) => x.name === name && x.filename == null);
  return p ? p.data.toString("utf-8").trim() : undefined;
}
