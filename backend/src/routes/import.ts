import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { HttpError } from "../http/respond.ts";
import { parseMultipart, fileParts, fieldValue } from "../http/multipart.ts";
import { isIntId, isShortText, isPositiveAmount, isIsoDate } from "../http/validate.ts";
import { parseInvoiceItemized } from "../ingest/invoiceItemized.ts";
import { insertOpenFatura, pruneEmptyOpenInvoices } from "../db/faturaImport.ts";
import type { TxRecord } from "../ingest/types.ts";
import { parseStatementWithIds } from "../ingest/statementWithIds.ts";
import { parseStatementWithBalance } from "../ingest/statementWithBalance.ts";
import { parseB3, type B3Report } from "../ingest/b3.ts";
import { pairSelfTransfers } from "../jobs/backfill/selfPairs.ts";
import { rederiveSavings } from "../jobs/backfill/derivedSavings.ts";
import { reconcileOpenInvoices } from "../db/reconcile.ts";
import { openCheckingIds } from "./accounts.ts";
import {
  groupNameFor, accountById, accountByFormat,
  ledgerVocabulary, primaryCard,
} from "../config.ts";
import type { StatementFormat, InvoiceFormat } from "../config.ts";

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
const STAGE_TTL_MS = 60 * 60 * 1000;

function gcStaging(): void {
  const now = Date.now();
  for (const [id, b] of staging) if (now - b.createdAt > STAGE_TTL_MS) staging.delete(id);
}

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

function divergenceReais(b: Batch): number {
  let cents = 0;
  for (const r of b.rows) {
    if (r.status !== "new") continue;
    const delta = r.amountCents - r.originalAmountCents;
    cents += r.rec.flow === "expense" ? -delta : delta;
  }
  return toReais(cents);
}

/**
 * Qual FORMATO o arquivo tem, olhando só o cabeçalho.
 *
 * A detecção é sobre o arquivo, nunca sobre o banco: bastam as colunas pra
 * saber qual parser lê aquilo. Quem transforma formato em conta é a config.
 */
export function detectFormat(csv: string): StatementFormat | InvoiceFormat | null {
  const head = csv.slice(0, 4096).toLowerCase();
  if (head.includes("identificador") && head.includes("valor")) return "ids";
  if (head.includes("data lançamento") || head.includes("data lancamento")) return "running-balance";
  if (head.includes("categoria") && head.includes("tipo") && head.includes("valor")) return "itemized";
  return null;
}

/** Conta sugerida para um arquivo — a que a config declara para aquele formato. */
export function detectAccount(csv: string): string | null {
  const fmt = detectFormat(csv);
  if (!fmt) return null;
  return accountByFormat(fmt)?.id ?? null;
}

/**
 * O arquivo é uma fatura de cartão? O cliente precisa saber disso para escolher
 * o fluxo de import, e a resposta é o FORMATO — nunca o id da conta detectada.
 * Cravar um id aqui (ou no cliente) traria de volta pro código a decisão que
 * mora na config.
 */
export function detectIsInvoice(csv: string): boolean {
  return detectFormat(csv) === "itemized";
}

export function importRoutes(db: DatabaseSync): Route[] {

  const suggestStmt = db.prepare(`
    SELECT category_id FROM transactions
    WHERE description = ? AND category_id IS NOT NULL AND flow = ?
    GROUP BY category_id ORDER BY COUNT(*) DESC LIMIT 1
  `);

  const ruleStmt = db.prepare("SELECT value, matcher FROM rules WHERE action='category' AND enabled=1 ORDER BY priority ASC, id ASC");
  const suggestCategory = (desc: string, flow: string): number | null => {
    const exact = suggestStmt.get(desc, flow) as { category_id: number } | undefined;
    if (exact) return exact.category_id;
    const hay = String(desc || "").toLowerCase();
    const rule = (ruleStmt.all() as any[]).find(r => hay.includes(String(r.matcher).toLowerCase()));
    return rule ? Number(rule.value) : null;
  };

  const idDup = db.prepare("SELECT 1 FROM transactions WHERE external_id = ?");
  const occurrenceCount = db.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE date = ? AND flow = ? AND amount_cents = ? AND description = ?",
  );

  async function detect(req: Req, res: Res) {
    const parts = await parseMultipart(req);
    const out = fileParts(parts).map((p) => {
      const csv = p.data.toString("utf-8");
      return {
        filename: p.filename,
        account_id: detectAccount(csv),
        invoice: detectIsInvoice(csv),
      };
    });
    json(res, out);
  }

  async function preview(req: Req, res: Res) {
    gcStaging();
    const parts = await parseMultipart(req);
    const account = fieldValue(parts, "account_id");
    //> Allowlist do DB, não literal: conta encerrada some e não recebe movimento
    //> datado depois do fim.
    if (!account || !openCheckingIds(db).has(account)) {
      return error(res, "account_id inválido — precisa ser conta corrente aberta");
    }
    const files = fileParts(parts);
    if (!files.length) return error(res, "nenhum arquivo enviado");

    //> Formato da config; sem declaração, o que o próprio arquivo disser.
    const format = accountById(account)?.statementFormat
      ?? detectFormat(files[0]!.data.toString("utf-8"));
    if (format !== "ids" && format !== "running-balance") {
      return error(res, "não reconheci o formato do extrato para esta conta");
    }
    const vocab = ledgerVocabulary(account);

    const rows: StagingRow[] = [];
    let skipped = 0;
    let rowId = 0;

    const seenSoFar = new Map<string, number>();

    for (const f of files) {
      const text = f.data.toString("utf-8");
      let recs: TxRecord[];
      try {
        //> Parser vem do FORMATO, nunca de um id de conta escrito à mão.
        const parsed = format === "ids"
          ? parseStatementWithIds(text, f.filename ?? "upload.csv", account, vocab)
          : parseStatementWithBalance(text, f.filename ?? "upload.csv", account, vocab);
        recs = parsed.records;
        skipped += parsed.skipped.length;
      } catch (e) {
        return error(res, e instanceof Error ? e.message : "falha ao ler arquivo");
      }

      for (const rec of recs) {
        let status: StagingRow["status"] = "new";
        if (format === "ids") {
          if (rec.externalId && idDup.get(rec.externalId)) status = "duplicate";
        } else {
          const key = `${rec.date}|${rec.flow}|${rec.amountCents}|${rec.description}`;
          if (!seenSoFar.has(key)) {
            const n = (occurrenceCount.get(rec.date, rec.flow, rec.amountCents, rec.description) as { n: number }).n;
            seenSoFar.set(key, n);
          }
          const remaining = seenSoFar.get(key)!;
          if (remaining > 0) { status = "duplicate"; seenSoFar.set(key, remaining - 1); }
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
    const savingsIds: number[] = [];
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
        if (r.rec.isSavingsLeg) savingsIds.push(Number(info.lastInsertRowid));
      }
      rederiveSavings(db, savingsIds);
      pairSelfTransfers(db);

      //> Só a conta que paga o cartão fecha uma fatura aberta.
      if (batch.accountId === primaryCard()?.paidFrom.id) reconcileOpenInvoices(db);
      db.prepare("COMMIT").run();
    } catch (e) {
      db.prepare("ROLLBACK").run();
      return error(res, e instanceof Error ? e.message : "falha ao importar", 500);
    }

    staging.delete(String(body.batch_id));
    broadcast();
    json(res, { ok: true, inserted, import_batch_id: importBatchId });
  }

  async function deleteBatch(req: Req, res: Res) {
    const importBatchId = req.params!.id!;
    const rows = db.prepare("SELECT * FROM transactions WHERE import_batch_id = ?")
      .all(importBatchId) as any[];
    if (!rows.length) return error(res, "lote não encontrado", 404);

    const byId = new Map<number, any>(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      if (r.self_pair_tx_id && !byId.has(r.self_pair_tx_id)) {
        const pair = db.prepare("SELECT * FROM transactions WHERE id = ?").get(r.self_pair_tx_id) as any;
        if (pair) byId.set(pair.id, pair);
      }
    }
    const restore = [...byId.values()];
    const savingsTouched = restore.some((r) => r.investment_id != null);

    const invoiceIds = restore.map((r) => r.invoice_id).filter((v): v is number => v != null);

    db.prepare("BEGIN").run();
    try {
      for (const r of restore) db.prepare("DELETE FROM transactions WHERE id = ?").run(r.id);
      if (invoiceIds.length) pruneEmptyOpenInvoices(db, invoiceIds);
      if (savingsTouched) rederiveSavings(db, []);
      db.prepare("COMMIT").run();
    } catch (e) {
      db.prepare("ROLLBACK").run();
      return error(res, e instanceof Error ? e.message : "falha ao reverter", 500);
    }
    broadcast();
    json(res, { ok: true, deleted: restore.length, restore });
  }

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
        const group = groupNameFor(p.type, p.bank);
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

  function readFatura(parts: Awaited<ReturnType<typeof parseMultipart>>) {
    const files = fileParts(parts);
    if (!files.length) throw new HttpError(400, "nenhum arquivo enviado");
    const f = files[0];
    const fat = parseInvoiceItemized(f.data.toString("utf-8"), f.filename ?? "fatura.csv");
    return { fat, filename: f.filename ?? `fatura-${fat.refMonth}.csv` };
  }

  async function faturaPreview(req: Req, res: Res) {
    let parsed;
    try { parsed = readFatura(await parseMultipart(req)); }
    catch (e) { return error(res, e instanceof Error ? e.message : "falha ao ler fatura"); }
    const { fat } = parsed;
    const existing = db.prepare(
      "SELECT payment_tx_id FROM invoices WHERE account_id = ? AND ref_month = ?",
    ).get(fat.refMonth) as { payment_tx_id: number | null } | undefined;
    json(res, {
      ref_month: fat.refMonth,
      items: fat.items.length,
      total: toReais(fat.totalCents),
      skipped: fat.skipped.length,
      reimport: !!existing,
      already_paid: !!(existing && existing.payment_tx_id != null),
      rows: fat.items.map((it) => ({
        date: it.date,
        description: it.description,
        amount: toReais(it.amountCents),
        category: it.bankCategory,
        installment: it.installmentTotal ? `${it.installmentSeq}/${it.installmentTotal}` : null,
      })),
    });
  }

  async function faturaConfirm(req: Req, res: Res) {
    const parts = await parseMultipart(req);
    let parsed;
    try { parsed = readFatura(parts); }
    catch (e) { return error(res, e instanceof Error ? e.message : "falha ao ler fatura"); }
    const dueRaw = fieldValue(parts, "due_date");
    if (dueRaw && !isIsoDate(dueRaw)) return error(res, "due_date inválido (esperado YYYY-MM-DD)");
    const bidRaw = fieldValue(parts, "import_batch_id");
    const importBatchId = isShortText(bidRaw, 80) ? String(bidRaw) : randomUUID();

    db.prepare("BEGIN").run();
    try {
      const result = insertOpenFatura(db, {
        refMonth: parsed.fat.refMonth,
        dueDate: dueRaw || null,
        items: parsed.fat.items,
        sourceFile: parsed.filename,
        importBatchId,
      });
      db.prepare("COMMIT").run();
      broadcast();
      json(res, { ok: true, ...result, import_batch_id: importBatchId });
    } catch (e) {
      db.prepare("ROLLBACK").run();
      return error(res, e instanceof Error ? e.message : "falha ao importar fatura", 500);
    }
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
    { method: "POST", ...cp("/api/import/fatura/preview"), handler: faturaPreview },
    { method: "POST", ...cp("/api/import/fatura"), handler: faturaConfirm },
  ];
}
