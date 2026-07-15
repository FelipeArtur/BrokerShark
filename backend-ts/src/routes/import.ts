/** import.ts — import incremental via UI (extratos Nubank/Inter + relatório B3).
 *
 *  Fluxo em duas fases (staging em memória, keyed por batch_id):
 *    1. preview  → parse + dedup vs DB → linhas de revisão (editáveis)
 *    2. confirm  → INSERT das linhas escolhidas → re-pareia SELF + rederiva Caixinha
 *
 *  Reusa os parsers de ingest/ e as invariantes de jobs/backfill/ (selfPairs,
 *  caixinha). Faturas Inter NÃO entram por aqui — só contas-corrente + B3.
 *  Dinheiro em centavos; o fio troca reais (o front formata em R$).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { HttpError } from "../http/respond.ts";
import { parseMultipart, fileParts, fieldValue } from "../http/multipart.ts";
import { isIntId, isShortText, isPositiveAmount } from "../http/validate.ts";
import type { TxRecord } from "../ingest/types.ts";
import { parseNubankExtrato } from "../ingest/nubankExtrato.ts";
import { parseInterExtrato } from "../ingest/interExtrato.ts";
import { parseB3, type B3Report } from "../ingest/b3.ts";
import { pairSelfTransfers } from "../jobs/backfill/selfPairs.ts";
import { rederiveCaixinha } from "../jobs/backfill/caixinha.ts";

// ── Staging (em memória — o backfill é a fonte de reconstrução) ──────────────
interface StagingRow {
  id: number;
  rec: TxRecord;
  originalAmountCents: number;
  amountCents: number;
  displayName: string | null;
  categoryId: number | null;
  suggestedCategoryId: number | null;
  status: "new" | "duplicate";
}
interface Batch { accountId: string; rows: StagingRow[]; createdAt: number }

const staging = new Map<string, Batch>();
const STAGE_TTL_MS = 60 * 60 * 1000; // 1h — solta batches abandonados

function gcStaging(): void {
  const now = Date.now();
  for (const [id, b] of staging) if (now - b.createdAt > STAGE_TTL_MS) staging.delete(id);
}

// ── Helpers de fio (reais ⇄ centavos) ────────────────────────────────────────
const toReais = (c: number) => Math.round(c) / 100;
const toCents = (r: number) => Math.round(r * 100);

function wireRow(r: StagingRow) {
  return {
    id: r.id,
    date: r.rec.date,
    description: r.rec.description,
    amount: toReais(r.amountCents),
    flow: r.rec.flow,
    method: r.rec.method,
    is_revenue: r.rec.isRevenue,
    is_settlement: 0,
    counterpart: null,
    status: r.status,
    display_name: r.displayName,
    category_id: r.categoryId,
    suggested_category_id: r.suggestedCategoryId,
  };
}

/** Ajuste (reais, sinalizado por fluxo) das linhas novas vs valor original. */
function divergenceReais(b: Batch): number {
  let cents = 0;
  for (const r of b.rows) {
    if (r.status !== "new") continue;
    const delta = r.amountCents - r.originalAmountCents;
    cents += r.rec.flow === "expense" ? -delta : delta;
  }
  return toReais(cents);
}

export function importRoutes(db: DatabaseSync): Route[] {
  // Sugestão de categoria pelo histórico (descrição exata mais frequente).
  const suggestStmt = db.prepare(`
    SELECT category_id FROM transactions
    WHERE description = ? AND category_id IS NOT NULL AND flow = ?
    GROUP BY category_id ORDER BY COUNT(*) DESC LIMIT 1
  `);
  const suggestCategory = (desc: string, flow: string): number | null => {
    const row = suggestStmt.get(desc, flow) as { category_id: number } | undefined;
    return row ? row.category_id : null;
  };

  const nubankDup = db.prepare("SELECT 1 FROM transactions WHERE external_id = ?");
  const interCount = db.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE date = ? AND flow = ? AND amount_cents = ? AND description = ?",
  );

  function detectAccount(csv: string): string | null {
    const head = csv.slice(0, 4096).toLowerCase();
    if (head.includes("identificador") && head.includes("valor")) return "nu-db";
    if (head.includes("data lançamento") || head.includes("data lancamento")) return "inter-db";
    return null;
  }

  // ── POST /api/import/detect — sniff do header → conta dona ──────────────
  async function detect(req: Req, res: Res) {
    const parts = await parseMultipart(req);
    const out = fileParts(parts).map((p) => ({
      filename: p.filename,
      account_id: detectAccount(p.data.toString("utf-8")),
    }));
    json(res, out);
  }

  // ── POST /api/import/preview — parse + dedup → linhas de revisão ─────────
  async function preview(req: Req, res: Res) {
    gcStaging();
    const parts = await parseMultipart(req);
    const account = fieldValue(parts, "account_id");
    if (account !== "nu-db" && account !== "inter-db") return error(res, "account_id inválido");
    const files = fileParts(parts);
    if (!files.length) return error(res, "nenhum arquivo enviado");

    const rows: StagingRow[] = [];
    let skipped = 0;
    let rowId = 0;
    // Dedup Inter: contagem por chave começando do que o DB já tem.
    const interSeen = new Map<string, number>();

    for (const f of files) {
      const text = f.data.toString("utf-8");
      let recs: TxRecord[];
      try {
        const parsed = account === "nu-db"
          ? parseNubankExtrato(text, f.filename ?? "upload.csv")
          : parseInterExtrato(text, f.filename ?? "upload.csv");
        recs = parsed.records;
        skipped += parsed.skipped.length;
      } catch (e) {
        return error(res, e instanceof Error ? e.message : "falha ao ler arquivo");
      }

      for (const rec of recs) {
        let status: StagingRow["status"] = "new";
        if (account === "nu-db") {
          if (rec.externalId && nubankDup.get(rec.externalId)) status = "duplicate";
        } else {
          const key = `${rec.date}|${rec.flow}|${rec.amountCents}|${rec.description}`;
          if (!interSeen.has(key)) {
            const n = (interCount.get(rec.date, rec.flow, rec.amountCents, rec.description) as { n: number }).n;
            interSeen.set(key, n);
          }
          const remaining = interSeen.get(key)!;
          if (remaining > 0) { status = "duplicate"; interSeen.set(key, remaining - 1); }
        }
        const categorizable = rec.method !== "transfer" && !rec.isInvestmentLeg;
        rows.push({
          id: rowId++,
          rec,
          originalAmountCents: rec.amountCents,
          amountCents: rec.amountCents,
          displayName: null,
          categoryId: null,
          suggestedCategoryId: (status === "new" && categorizable)
            ? suggestCategory(rec.description, rec.flow) : null,
          status,
        });
      }
    }

    const batchId = randomUUID();
    const batch: Batch = { accountId: account, rows, createdAt: Date.now() };
    staging.set(batchId, batch);

    const newCount = rows.filter((r) => r.status === "new").length;
    const dupCount = rows.filter((r) => r.status === "duplicate").length;
    json(res, {
      batch_id: batchId,
      counts: { new: newCount, duplicate: dupCount, skipped, total: newCount + dupCount + skipped },
      rows: rows.map(wireRow),
      amount_divergence: 0,
    });
  }

  // ── PATCH /api/import/staging/:batch/:row — edita uma linha ─────────────
  async function patchStaging(req: Req, res: Res) {
    const batch = staging.get(req.params!.batch!);
    if (!batch) return error(res, "batch expirado — reanalise", 404);
    const rowId = Number(req.params!.row);
    const row = batch.rows.find((r) => r.id === rowId);
    if (!row) return error(res, "linha não encontrada", 404);

    const body = await readBody<{ amount?: unknown; category_id?: unknown; display_name?: unknown }>(req);
    if ("amount" in body) {
      if (!isPositiveAmount(body.amount)) return error(res, "valor inválido");
      row.amountCents = toCents(body.amount as number);
    }
    if ("category_id" in body) {
      if (body.category_id !== null && !isIntId(body.category_id)) return error(res, "category_id inválido");
      row.categoryId = (body.category_id as number | null) ?? null;
    }
    if ("display_name" in body) {
      const dn = body.display_name;
      if (dn !== null && !isShortText(dn, 100)) return error(res, "apelido inválido (≤100)");
      row.displayName = dn ? String(dn).trim() || null : null;
    }
    json(res, { ok: true, row: wireRow(row), amount_divergence: divergenceReais(batch) });
  }

  // ── POST /api/import/confirm — INSERT + re-pareia SELF + Caixinha ────────
  const insertTx = db.prepare(`
    INSERT INTO transactions
      (date, flow, method, account_id, amount_cents, description, is_revenue,
       external_id, display_name, category_id, original_amount_cents,
       import_batch_id, is_settlement, source_file)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)
  `);

  async function confirm(req: Req, res: Res) {
    const body = await readBody<{ batch_id?: unknown; exclude_ids?: unknown; import_batch_id?: unknown }>(req);
    const batch = staging.get(String(body.batch_id ?? ""));
    if (!batch) return error(res, "batch expirado — reanalise", 404);
    const exclude = new Set(Array.isArray(body.exclude_ids) ? body.exclude_ids.map(Number) : []);
    const importBatchId = isShortText(body.import_batch_id, 80)
      ? String(body.import_batch_id) : randomUUID();

    const toInsert = batch.rows.filter((r) => r.status === "new" && !exclude.has(r.id));
    const caixinhaIds: number[] = [];
    let inserted = 0;

    const tx = db.prepare("BEGIN");
    tx.run();
    try {
      for (const r of toInsert) {
        const edited = r.amountCents !== r.originalAmountCents;
        const info = insertTx.run(
          r.rec.date, r.rec.flow, r.rec.method, r.rec.accountId, r.amountCents,
          r.rec.description, r.rec.isRevenue, r.rec.externalId ?? null,
          r.displayName, r.categoryId, edited ? r.originalAmountCents : null,
          importBatchId, r.rec.sourceFile,
        );
        inserted++;
        if (r.rec.isCaixinhaLeg) caixinhaIds.push(Number(info.lastInsertRowid));
      }
      rederiveCaixinha(db, caixinhaIds);
      pairSelfTransfers(db);
      db.prepare("COMMIT").run();
    } catch (e) {
      db.prepare("ROLLBACK").run();
      return error(res, e instanceof Error ? e.message : "falha ao importar", 500);
    }

    staging.delete(String(body.batch_id));
    broadcast();
    json(res, { ok: true, inserted, import_batch_id: importBatchId });
  }

  // ── DELETE /api/import/batch/:id — reverte um lote importado ─────────────
  async function deleteBatch(req: Req, res: Res) {
    const importBatchId = req.params!.id!;
    const rows = db.prepare("SELECT * FROM transactions WHERE import_batch_id = ?")
      .all(importBatchId) as any[];
    if (!rows.length) return error(res, "lote não encontrado", 404);

    // arrasta a perna SELF pareada (mesmo fora do lote) — igual ao delete de tx
    const byId = new Map<number, any>(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      if (r.self_pair_tx_id && !byId.has(r.self_pair_tx_id)) {
        const pair = db.prepare("SELECT * FROM transactions WHERE id = ?").get(r.self_pair_tx_id) as any;
        if (pair) byId.set(pair.id, pair);
      }
    }
    const restore = [...byId.values()];
    const caixinhaTouched = restore.some((r) => r.investment_id != null);

    db.prepare("BEGIN").run();
    try {
      for (const r of restore) db.prepare("DELETE FROM transactions WHERE id = ?").run(r.id);
      if (caixinhaTouched) rederiveCaixinha(db, []);
      db.prepare("COMMIT").run();
    } catch (e) {
      db.prepare("ROLLBACK").run();
      return error(res, e instanceof Error ? e.message : "falha ao reverter", 500);
    }
    broadcast();
    json(res, { ok: true, deleted: restore.length, restore });
  }

  // ── B3 (xlsx) — preview e confirm por match_key (sem soft-close) ─────────
  function readB3(req_parts: Awaited<ReturnType<typeof parseMultipart>>): B3Report {
    const f = fileParts(req_parts)[0];
    if (!f) throw new HttpError(400, "nenhum arquivo enviado");
    try {
      return parseB3(f.data, f.filename ?? "relatorio.xlsx");
    } catch (e) {
      throw new HttpError(400, e instanceof Error
        ? `${e.message} — mantenha o nome padrão do relatório B3 (ex: …mensal-2026-janeiro.xlsx)`
        : "falha ao ler relatório B3");
    }
  }
  const invExists = db.prepare("SELECT 1 FROM investments WHERE match_key = ?");

  async function b3Preview(req: Req, res: Res) {
    const rep = readB3(await parseMultipart(req));
    let created = 0, updated = 0;
    const positions = rep.positions.map((p) => {
      const exists = !!invExists.get(p.matchKey);
      exists ? updated++ : created++;
      return { status: exists ? "updated" : "new", name: p.name, balance: toReais(p.netCents) };
    });
    json(res, { created, updated, total: rep.positions.length, positions });
  }

  const upsertInv = db.prepare(`
    INSERT INTO investments (name, match_key, code, type, bank, indexer, maturity_date, group_name, source, opened_at)
    VALUES (?,?,?,?,?,?,?,?, 'b3', ?)
    ON CONFLICT (match_key) DO UPDATE SET
      name = excluded.name, indexer = COALESCE(excluded.indexer, indexer),
      maturity_date = COALESCE(excluded.maturity_date, maturity_date), closed_at = NULL
    RETURNING id
  `);
  const insSnap = db.prepare(`
    INSERT INTO position_snapshots
      (investment_id, ref_date, quantity, unit_price_cents, applied_cents, gross_cents, net_cents, source)
    VALUES (?,?,?,?,?,?,?, 'b3')
    ON CONFLICT (investment_id, ref_date, source) DO UPDATE SET
      quantity = excluded.quantity, net_cents = excluded.net_cents,
      applied_cents = excluded.applied_cents, gross_cents = excluded.gross_cents
  `);

  async function b3Confirm(req: Req, res: Res) {
    const rep = readB3(await parseMultipart(req));
    let created = 0, updated = 0;
    db.prepare("BEGIN").run();
    try {
      for (const p of rep.positions) {
        const exists = !!invExists.get(p.matchKey);
        exists ? updated++ : created++;
        const group = p.type === "cdb" && p.bank === "inter" ? "Porquinho" : null;
        const row = upsertInv.get(
          p.name, p.matchKey, p.code, p.type, p.bank, p.indexer, p.maturityIso, group, rep.refDate,
        ) as { id: number };
        if (group) db.prepare("UPDATE investments SET group_name = ? WHERE id = ?").run(group, row.id);
        insSnap.run(row.id, rep.refDate, p.quantity, p.unitPriceCents, p.appliedCents, p.grossCents, p.netCents);
      }
      db.prepare("COMMIT").run();
    } catch (e) {
      db.prepare("ROLLBACK").run();
      return error(res, e instanceof Error ? e.message : "falha ao importar B3", 500);
    }
    broadcast();
    json(res, { ok: true, created, updated });
  }

  const cp = compilePath;
  return [
    { method: "POST", ...cp("/api/import/detect"), handler: detect },
    { method: "POST", ...cp("/api/import/preview"), handler: preview },
    { method: "PATCH", ...cp("/api/import/staging/:batch/:row"), handler: patchStaging },
    { method: "POST", ...cp("/api/import/confirm"), handler: confirm },
    { method: "DELETE", ...cp("/api/import/batch/:id"), handler: deleteBatch },
    { method: "POST", ...cp("/api/import/b3/preview"), handler: b3Preview },
    { method: "POST", ...cp("/api/import/b3"), handler: b3Confirm },
  ];
}
