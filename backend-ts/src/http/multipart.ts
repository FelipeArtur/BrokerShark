/**
 * @file multipart.ts
 * @brief Parser mínimo de multipart/form-data para o upload do import via UI.
 *
 * multipart.ts — parser mínimo de multipart/form-data (zero deps).
 *
 *  Só o import via UI precisa de upload de arquivo (CSV texto + xlsx binário).
 *  readBody() em respond.ts é JSON-only; aqui lemos o corpo cru como Buffer e
 *  fatiamos pelas boundaries. Cap próprio (extrato/xlsx passam de 1 MB).
 */
import type { Req } from "./respond.ts";
import { HttpError } from "./respond.ts";

const MAX_UPLOAD_BYTES = 20_000_000; // 20 MB — extratos longos + relatório B3
const MAX_PARTS = 64; // extrato + fatura + B3 num drop normal é << 64

/** @brief Uma parte do corpo multipart; `filename` presente = parte-arquivo. */
export interface Part {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

/**
 * @brief Ler o corpo cru da requisição como Buffer, respeitando o cap de upload.
 * @param req requisição cujo corpo será consumido
 * @return o corpo completo em Buffer
 * @throws HttpError 413 se passar de MAX_UPLOAD_BYTES (20 MB)
 */
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

/**
 * @brief Extrair a boundary do header Content-Type (com ou sem aspas).
 * @param req requisição multipart
 * @return a boundary declarada
 * @throws HttpError 400 se o Content-Type não trouxer boundary
 */
function boundaryOf(req: Req): string {
  const ct = req.headers["content-type"] ?? "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  const b = (m?.[1] ?? m?.[2] ?? "").trim();
  if (!b) throw new HttpError(400, "multipart sem boundary");
  return b;
}

/**
 * @brief Fatiar um corpo multipart em memória nas suas partes nomeadas.
 *
 * Fatia um corpo multipart já em memória (puro, testável).
 *
 * @param body corpo multipart completo
 * @param boundary boundary sem o prefixo "--"
 * @param maxParts teto de partes aceitas (default MAX_PARTS = 64)
 * @return as partes com `name` declarado, na ordem do corpo; partes sem `name`
 *         no Content-Disposition são ignoradas
 * @throws HttpError 413 se o corpo trouxer mais que `maxParts` partes nomeadas
 */
export function splitMultipart(body: Buffer, boundary: string, maxParts = MAX_PARTS): Part[] {
  const delim = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];

  let idx = body.indexOf(delim);
  while (idx >= 0) {
    const start = idx + delim.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // "--" final
    const next = body.indexOf(delim, start);
    if (next < 0) break;
    const seg = body.subarray(start, next - 2); // remove o CRLF antes da próxima boundary
    const headEnd = seg.indexOf("\r\n\r\n");
    if (headEnd >= 0) {
      const rawHead = seg.subarray(0, headEnd).toString("utf-8");
      const data = seg.subarray(headEnd + 4);
      const cd = /content-disposition:[^\r\n]*/i.exec(rawHead)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(cd)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(cd)?.[1];
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(rawHead)?.[1]?.trim();
      if (name != null) {
        if (parts.length >= maxParts) throw new HttpError(413, "arquivos demais");
        parts.push({ name, filename, contentType, data });
      }
    }
    idx = next;
  }
  return parts;
}

/**
 * @brief Ler o corpo multipart do stream e fatiá-lo em partes nomeadas.
 *
 * Lê o corpo multipart do stream e o fatia em partes nomeadas.
 *
 * @param req requisição com Content-Type multipart/form-data
 * @return as partes do corpo
 * @throws HttpError 400 se o Content-Type não for multipart ou faltar boundary;
 *         413 se o corpo ou a contagem de partes estourar os limites
 */
export async function parseMultipart(req: Req): Promise<Part[]> {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(400, "esperado multipart/form-data");
  }
  const body = await readRaw(req);
  return splitMultipart(body, boundaryOf(req));
}

/**
 * @brief Filtrar só as partes-arquivo (as que têm filename).
 *
 * Primeira parte-arquivo (tem filename).
 *
 * @param parts partes já fatiadas
 * @return as partes que declaram `filename`
 */
export function fileParts(parts: Part[]): Part[] {
  return parts.filter((p) => p.filename != null);
}

/**
 * @brief Ler o valor de um campo de texto do formulário pelo nome.
 *
 * Valor de um campo texto por nome.
 *
 * @param parts partes já fatiadas
 * @param name nome do campo; partes-arquivo são ignoradas na busca
 * @return o valor como texto UTF-8 já trimado, ou `undefined` se o campo não existir
 */
export function fieldValue(parts: Part[], name: string): string | undefined {
  const p = parts.find((x) => x.name === name && x.filename == null);
  return p ? p.data.toString("utf-8").trim() : undefined;
}
