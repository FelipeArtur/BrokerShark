/**
 * @file faturas.ts
 * @brief Fase de faturas: itens itemizados + reconciliação do pagamento (liquidação).
 *
 * faturas.ts — fatura itemizada (invariante central do v2).
 *
 *  Itens da fatura Inter = gastos reais no inter-cc. O pagamento no extrato é
 *  LIQUIDAÇÃO (is_settlement=1), excluída dos totais de consumo — sem isso o
 *  consumo contaria em dobro (itens + pagamento).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fmtCents } from "../../domain/money.ts";
import { parseInterFatura } from "../../ingest/interFatura.ts";
import type { TxInserter } from "./txInsert.ts";

/**
 * @brief Importar as faturas Inter e reconciliar cada pagamento como liquidação.
 *
 * Três destinos possíveis para um pagamento de fatura no extrato:
 *  - valor EXATO do total, na janela −70/+35d do ref_month → liquidação casada
 *    (`is_settlement=1` + `invoice_id`), e a fatura aponta de volta em `payment_tx_id`;
 *  - sem match exato mas DENTRO da cobertura das faturas importadas → liquidação
 *    parcial (rotativo/débito automático): o consumo já está itemizado, então o
 *    pagamento também é marcado `is_settlement=1` para não contar em dobro;
 *  - FORA da cobertura → fica stand-in: o pagamento É o único registro daquele
 *    gasto (não há itens importados), então NÃO é marcado como liquidação.
 *
 * Roda depois dos extratos — a reconciliação procura pernas já inseridas.
 *
 * @param db conexão do DB em construção
 * @param ins inserter compartilhado; os itens usam `ins.stmt` direto (colunas extras)
 * @param files faturas `fatura-inter-YYYY-MM.csv`
 * @return linhas de relatório legível (valores formatados em BRL) para a verificação
 * @throws Error se alguma fatura tiver nome ou header inválido
 */
export function importFaturas(db: DatabaseSync, ins: TxInserter, files: string[]): string[] {
  const report: string[] = [];
  const insInvoice = db.prepare(
    "INSERT INTO invoices (account_id, ref_month, total_cents, source_file) VALUES (?,?,?,?)",
  );

  for (const f of files) {
    const fat = parseInterFatura(readFileSync(f, "utf-8"), basename(f));
    const invId = Number(insInvoice.run("inter-cc", fat.refMonth, fat.totalCents, basename(f)).lastInsertRowid);
    for (const it of fat.items) {
      ins.stmt.run(
        it.date,
        it.amountCents >= 0 ? "expense" : "income",
        "credit", "inter-cc", Math.abs(it.amountCents), it.description,
        0, null, invId, it.installmentSeq ?? null, it.installmentTotal ?? null,
        it.bankCategory || null, basename(f),
      );
    }
    // Pagamento no extrato: valor EXATO do total da fatura, janela −70/+35 dias
    // do refMonth (nos dados reais o pagamento antecede o mês-rótulo em ~1 mês).
    const refStart = `${fat.refMonth}-01`;
    const pay = db.prepare(`
      SELECT id, date, amount_cents FROM transactions
      WHERE account_id = 'inter-db' AND flow = 'expense'
        AND lower(description) LIKE '%fatura%' AND invoice_id IS NULL
        AND amount_cents = ?
        AND julianday(date) BETWEEN julianday(?) - 70 AND julianday(?) + 35
      ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1
    `).get(fat.totalCents, refStart, refStart, refStart) as
      { id: number; date: string; amount_cents: number } | undefined;
    if (pay) {
      db.prepare("UPDATE transactions SET is_settlement = 1, invoice_id = ?, method = 'credit' WHERE id = ?")
        .run(invId, pay.id);
      db.prepare("UPDATE invoices SET payment_tx_id = ? WHERE id = ?").run(pay.id, invId);
    }
    report.push(
      `  ${fat.refMonth}: ${fat.items.length} itens = ${fmtCents(fat.totalCents)}` +
      (fat.skipped.length ? ` (${fat.skipped.length} espelho(s) de pagamento ignorado(s))` : "") +
      "; " +
      (pay
        ? `pagamento casado ${pay.date} ${fmtCents(pay.amount_cents)} ✓ EXATO`
        : "⚠ sem pagamento de valor exato — itens entram, pagamento (se houver) fica stand-in"),
    );
  }

  // Pagamentos sem match exato DENTRO da cobertura das faturas importadas são
  // liquidações parciais (rotativo/débito automático) — o consumo já está
  // itemizado. Fora da cobertura → stand-in (o pagamento É o registro do gasto).
  const cover = db.prepare(
    "SELECT MIN(ref_month) AS lo, MAX(ref_month) AS hi FROM invoices WHERE account_id = 'inter-cc'",
  ).get() as { lo: string | null; hi: string | null };
  const strayPays = db.prepare(`
    SELECT id, date, amount_cents, description FROM transactions
    WHERE account_id = 'inter-db' AND flow='expense'
      AND lower(description) LIKE '%fatura%' AND invoice_id IS NULL ORDER BY date
  `).all() as { id: number; date: string; amount_cents: number; description: string }[];
  for (const s of strayPays) {
    const inCoverage = cover.lo !== null && s.date >= `${cover.lo}-01` && s.date <= `${cover.hi}-31`;
    if (inCoverage) {
      const inv = db.prepare(`
        SELECT id, ref_month FROM invoices WHERE account_id = 'inter-cc'
        ORDER BY ABS(julianday(ref_month || '-01') - julianday(?)) LIMIT 1
      `).get(s.date) as { id: number; ref_month: string };
      db.prepare("UPDATE transactions SET is_settlement = 1, invoice_id = ?, method = 'credit' WHERE id = ?")
        .run(inv.id, s.id);
      report.push(
        `  liquidação parcial → fatura ${inv.ref_month}: ${s.date} ${fmtCents(s.amount_cents)} ("${s.description.slice(0, 44)}")`,
      );
    } else {
      report.push(`  stand-in (fora da cobertura): ${s.date} ${fmtCents(s.amount_cents)} ("${s.description.slice(0, 44)}")`);
    }
  }
  return report;
}
