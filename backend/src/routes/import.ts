/**
 * @file import.ts
 * @brief Import incremental via UI: preview/staging editável/confirm + B3, com reverter.
 *
 * import.ts — import incremental via UI (extratos Nubank/Inter + relatório B3).
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
import { isIntId, isShortText, isPositiveAmount, isIsoDate } from "../http/validate.ts";
import { parseInterFatura } from "../ingest/interFatura.ts";
import { insertOpenFatura, pruneEmptyOpenInvoices } from "../db/faturaImport.ts";
import type { TxRecord } from "../ingest/types.ts";
import { parseNubankExtrato } from "../ingest/nubankExtrato.ts";
import { parseInterExtrato } from "../ingest/interExtrato.ts";
import { parseB3, type B3Report } from "../ingest/b3.ts";
import { pairSelfTransfers } from "../jobs/backfill/selfPairs.ts";
import { rederiveCaixinha } from "../jobs/backfill/caixinha.ts";
import { reconcileOpenInvoices } from "../db/reconcile.ts";

// ── Staging (em memória — o backfill é a fonte de reconstrução) ──────────────
/** @brief Linha em revisão; valores *Cents em centavos inteiros. */
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
/** @brief Lote em staging: conta dona, linhas em revisão e instante de criação. */
interface Batch { accountId: string; rows: StagingRow[]; createdAt: number }

const staging = new Map<string, Batch>();
const STAGE_TTL_MS = 60 * 60 * 1000; // 1h — solta batches abandonados

/**
 * @brief Descartar os lotes de staging abandonados (mais velhos que o TTL).
 *
 * Staging vive em memória e nada limpa um preview que o usuário nunca confirmou.
 */
function gcStaging(): void {
  const now = Date.now();
  for (const [id, b] of staging) if (now - b.createdAt > STAGE_TTL_MS) staging.delete(id);
}

// ── Helpers de fio (reais ⇄ centavos) ────────────────────────────────────────
/**
 * @brief Converter centavos inteiros em reais, para o fio.
 * @param c valor em centavos inteiros
 * @return valor em reais
 */
const toReais = (c: number) => Math.round(c) / 100;

/**
 * @brief Converter reais recebidos do fio em centavos inteiros.
 * @param r valor em reais
 * @return valor em centavos inteiros (arredondado)
 */
const toCents = (r: number) => Math.round(r * 100);

/**
 * @brief Serializar uma linha de staging para o formato do fio.
 * @param r linha em staging
 * @return objeto do fio, com `amount` em REAIS
 */
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

/**
 * @brief Somar o ajuste que as edições do usuário fizeram no lote.
 *
 * Ajuste (reais, sinalizado por fluxo) das linhas novas vs valor original.
 *
 * Sinal por fluxo: baixar uma despesa é ajuste POSITIVO (sobra mais dinheiro),
 * baixar uma receita é negativo. Só as linhas `new` contam — duplicata não entra.
 *
 * @param b lote em staging
 * @return divergência acumulada em REAIS (0 quando nada foi editado)
 */
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
 * @brief Descobrir a conta dona de um CSV pelo cabeçalho.
 *
 * Ordem importa: identificador → Nubank; "data lançamento" (junto) → extrato Inter;
 * categoria+tipo+valor (sem os anteriores) → fatura Inter (inter-cc). O header da
 * fatura tem "data" e "lançamento" em colunas separadas, então nunca casa o
 * "data lançamento" junto do extrato.
 *
 * @param csv conteúdo do arquivo (só os primeiros 4 KB são olhados)
 * @return "nu-db", "inter-db", "inter-cc", ou `null` quando não reconhecido
 */
export function detectAccount(csv: string): string | null {
  const head = csv.slice(0, 4096).toLowerCase();
  if (head.includes("identificador") && head.includes("valor")) return "nu-db";
  if (head.includes("data lançamento") || head.includes("data lancamento")) return "inter-db";
  if (head.includes("categoria") && head.includes("tipo") && head.includes("valor")) return "inter-cc";
  return null;
}

/**
 * @brief Montar as rotas do import incremental ligadas a esta conexão.
 * @param db conexão do DB
 * @return rotas de detect, preview, staging, confirm, reverter-lote e B3
 */
export function importRoutes(db: DatabaseSync): Route[] {
  // Sugestão de categoria pelo histórico (descrição exata mais frequente).
  const suggestStmt = db.prepare(`
    SELECT category_id FROM transactions
    WHERE description = ? AND category_id IS NOT NULL AND flow = ?
    GROUP BY category_id ORDER BY COUNT(*) DESC LIMIT 1
  `);
  /**
   * @brief Sugerir categoria pelo histórico de descrição exata do mesmo fluxo.
   * @param desc descrição da transação
   * @param flow fluxo ('expense'|'income') — a mesma descrição pode ter categoria
   *             diferente em cada sentido
   * @return id da categoria mais usada, ou `null` se não houver histórico
   */
  const suggestCategory = (desc: string, flow: string): number | null => {
    const row = suggestStmt.get(desc, flow) as { category_id: number } | undefined;
    return row ? row.category_id : null;
  };

  const nubankDup = db.prepare("SELECT 1 FROM transactions WHERE external_id = ?");
  const interCount = db.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE date = ? AND flow = ? AND amount_cents = ? AND description = ?",
  );

  // ── POST /api/import/detect — sniff do header → conta dona ──────────────
  /**
   * @brief Detectar a conta dona de cada arquivo enviado (pré-seleção da UI).
   * @param req requisição multipart com os arquivos
   * @param res resposta; lista `{ filename, account_id }` com `account_id` null
   *            quando não deu para reconhecer
   * @throws HttpError 400/413 vindos de parseMultipart
   */
  async function detect(req: Req, res: Res) {
    const parts = await parseMultipart(req);
    const out = fileParts(parts).map((p) => ({
      filename: p.filename,
      account_id: detectAccount(p.data.toString("utf-8")),
    }));
    json(res, out);
  }

  // ── POST /api/import/preview — parse + dedup → linhas de revisão ─────────
  /**
   * @brief Parsear os arquivos, marcar duplicatas e abrir um lote em staging.
   *
   * NADA é escrito no DB aqui — só staging em memória; quem grava é o confirm.
   *
   * Dedup por banco: Nubank por `external_id` (UUID); Inter por CONTAGEM da chave
   * composta, começando do que o DB já tem — duas linhas idênticas legítimas no
   * mesmo dia (2 pix iguais) não podem ser tratadas como duplicata uma da outra.
   *
   * Sugestão de categoria só para linha `new` e categorizável — perna de
   * investimento/transfer não recebe categoria.
   *
   * @param req requisição multipart: campo `account_id` + os arquivos
   * @param res resposta; `batch_id`, contagens e as linhas (`amount` em REAIS)
   * @throws HttpError 400/413 vindos de parseMultipart
   */
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
  /**
   * @brief Editar uma linha do staging (valor, categoria ou apelido) antes do confirm.
   *
   * Edita só a memória. O valor original é preservado em `originalAmountCents` e vai
   * para `original_amount_cents` no confirm — a edição fica auditável contra o extrato.
   *
   * @param req requisição; params `:batch`/`:row`, body `{ amount?, category_id?,
   *            display_name? }` com `amount` em REAIS
   * @param res resposta; a linha atualizada + `amount_divergence` em REAIS;
   *            404 se o batch expirou (TTL) ou a linha não existe
   * @throws HttpError 400/413 vindos de readBody
   */
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

  /**
   * @brief Inserir as linhas escolhidas do lote e refazer SELF + Caixinha.
   *
   * Tudo numa TRANSAÇÃO: os INSERTs, a rederivação da Caixinha e o re-pareamento
   * SELF. Se qualquer passo falhar, ROLLBACK — um import pela metade deixaria o
   * ledger com perna SELF órfã ou Caixinha fora de reconciliação.
   *
   * Pós-insert é obrigatório porque as linhas novas mudam o passado: uma perna nova
   * pode fechar par SELF com uma perna JÁ existente, e uma perna de poupança nova
   * muda o saldo derivado da Caixinha.
   *
   * Só linhas `new` não-excluídas entram; duplicata nunca é inserida. `import_batch_id`
   * é o que permite reverter o lote depois.
   *
   * @param req requisição; body `{ batch_id, exclude_ids?, import_batch_id? }`
   * @param res resposta; `inserted` e o `import_batch_id` usado; 404 se o batch
   *            expirou; 500 (com rollback) se a transação falhar
   * @throws HttpError 400/413 vindos de readBody
   */
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
      // C1: extrato do inter-db pode conter o pagamento de uma fatura aberta
      // (importada pela UI). Reconcilia agora, senão o pagamento double-conta.
      // No-op quando não há fatura aberta.
      if (batch.accountId === "inter-db") reconcileOpenInvoices(db);
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
  /**
   * @brief Reverter um lote importado, arrastando as pernas SELF pareadas.
   *
   * Uma perna SELF fora do lote é arrastada junto: deixá-la órfã faria a sobrevivente
   * voltar a contar como gasto/receita real. Se alguma linha tocava a Caixinha, os
   * snapshots derivados são reconstruídos — senão a posição guardaria dinheiro que
   * não está mais no ledger. Tudo em transação, com rollback.
   *
   * @param req requisição; param `:id` = import_batch_id
   * @param res resposta; `restore` traz as rows apagadas (undo); 404 se o lote não
   *            existir; 500 (com rollback) se a transação falhar
   */
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
    // Faturas tocadas pelo lote (H4): após apagar os itens, a invoice aberta que
    // ficar sem itens é apagada — senão vira compromisso fantasma.
    const invoiceIds = restore.map((r) => r.invoice_id).filter((v): v is number => v != null);

    db.prepare("BEGIN").run();
    try {
      for (const r of restore) db.prepare("DELETE FROM transactions WHERE id = ?").run(r.id);
      if (invoiceIds.length) pruneEmptyOpenInvoices(db, invoiceIds);
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
  /**
   * @brief Ler e parsear o primeiro arquivo enviado como relatório B3.
   * @param req_parts partes já fatiadas do multipart
   * @return o relatório parseado
   * @throws HttpError 400 se não vier arquivo, ou se o parse falhar (a mensagem
   *         lembra o nome padrão, de onde sai a ref_date)
   */
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

  /**
   * @brief Prever o efeito de um relatório B3: o que seria criado vs atualizado.
   *
   * Só lê — nada é gravado.
   *
   * @param req requisição multipart com o .xlsx
   * @param res resposta; contagens e as posições com `balance` em REAIS
   * @throws HttpError 400/413 de parseMultipart ou do parse do relatório
   */
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

  /**
   * @brief Aplicar um relatório B3: upsert das posições + snapshots datados.
   *
   * SEM soft-close, de propósito — diferença central vs a fase b3Sync do backfill.
   * O soft-close precisa comparar a sequência de relatórios (e a aba RF pisca); um
   * upload avulso não prova ausência, e fechar aqui apagaria posição viva da carteira.
   * Posição some da B3 → só o backfill decide.
   *
   * Tudo em transação, com rollback. CDB do Inter vira `group_name='Porquinho'`.
   *
   * @param req requisição multipart com o .xlsx
   * @param res resposta; `created`/`updated`; 500 (com rollback) se a transação falhar
   * @throws HttpError 400/413 de parseMultipart ou do parse do relatório
   */
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

  // ── Fatura Inter ABERTA (inter-cc) — fluxo próprio, stateless como o B3 ──
  /** @brief Parsear o CSV enviado como fatura Inter (1º arquivo). */
  function readFatura(parts: Awaited<ReturnType<typeof parseMultipart>>) {
    const files = fileParts(parts);
    if (!files.length) throw new HttpError(400, "nenhum arquivo enviado");
    const f = files[0];
    const fat = parseInterFatura(f.data.toString("utf-8"), f.filename ?? "fatura.csv");
    return { fat, filename: f.filename ?? `fatura-inter-${fat.refMonth}.csv` };
  }

  /**
   * @brief Preview de uma fatura Inter aberta: itens, total e se é reimport.
   * @param req multipart com o CSV da fatura
   * @param res `{ ref_month, items, total, reimport, already_paid, rows }`
   */
  async function faturaPreview(req: Req, res: Res) {
    let parsed;
    try { parsed = readFatura(await parseMultipart(req)); }
    catch (e) { return error(res, e instanceof Error ? e.message : "falha ao ler fatura"); }
    const { fat } = parsed;
    const existing = db.prepare(
      "SELECT payment_tx_id FROM invoices WHERE account_id = 'inter-cc' AND ref_month = ?",
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

  /**
   * @brief Confirmar o import de uma fatura Inter aberta (payment_tx_id NULL).
   *
   * Stateless (re-upload como o B3). `due_date` (ISO) opcional vem do form.
   * Reconciliação NÃO acontece aqui — só quando o extrato com o pagamento entra
   * (confirm do inter-db chama reconcileOpenInvoices, C1).
   *
   * @param req multipart: CSV + campo `due_date?` + `import_batch_id?`
   * @param res `{ ok, invoiceId, inserted, duplicate, totalCents, import_batch_id }`;
   *            500 (rollback) se a transação falhar
   */
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
