import type { Req } from "./respond.ts";
import { HttpError } from "./respond.ts";

// Quem parseia multipart é o runtime, não este arquivo.
//
// `Request.formData()` (undici, builtin) já lê boundary, `Content-Disposition`,
// nome de campo e nome de arquivo — antes isso eram ~40 linhas de varredura de
// buffer e quatro regexes aqui dentro. O que sobra é só o que o runtime NÃO
// faz: ler o corpo com teto de bytes antes de materializar qualquer coisa, e
// recusar quantidade absurda de partes.

const MAX_UPLOAD_BYTES = 20_000_000;
const MAX_PARTS = 64;

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

export async function parseMultipart(req: Req, maxParts = MAX_PARTS): Promise<Part[]> {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(400, "esperado multipart/form-data");
  }
  const body = await readRaw(req);

  let form: FormData;
  try {
    form = await new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": ct },
      body,
    }).formData();
  } catch {
    throw new HttpError(400, "multipart malformado");
  }

  const parts: Part[] = [];
  for (const [name, value] of form) {
    if (parts.length >= maxParts) throw new HttpError(413, "arquivos demais");
    if (typeof value === "string") {
      parts.push({ name, data: Buffer.from(value, "utf-8") });
    } else {
      parts.push({
        name,
        filename: value.name,
        contentType: value.type || undefined,
        data: Buffer.from(await value.arrayBuffer()),
      });
    }
  }
  return parts;
}

export function fileParts(parts: Part[]): Part[] {
  return parts.filter((p) => p.filename != null);
}

export function fieldValue(parts: Part[], name: string): string | undefined {
  const p = parts.find((x) => x.name === name && x.filename == null);
  return p ? p.data.toString("utf-8").trim() : undefined;
}
