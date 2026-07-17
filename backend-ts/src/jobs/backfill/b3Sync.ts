/**
 * @file b3Sync.ts
 * @brief Fase B3: upsert de posições por match_key, snapshots datados e soft-close.
 *
 * b3Sync.ts — B3 = tabela verdade: upsert por match_key + snapshots + soft-close.
 *
 *  Soft-close por tipo de aba (invariante — ver CLAUDE.md):
 *  - Tesouro/RV: o consolidado sempre lista o que existe — ausente de qualquer
 *    relatório mais novo → fechada (MGLU3 some do anual-2024; Prefixado 2026
 *    some da aba Tesouro em jan/2026 ao vencer).
 *  - Renda Fixa (CDB Inter/Porquinho): a aba PISCA no consolidado — CDBs somem
 *    em jan/fev/mar e maio de 2026 com o Porquinho vivo no extrato. Aba RF
 *    ausente = SEM INFORMAÇÃO, não zero. Só fecha quando um relatório mais novo
 *    COM aba RF presente deixa de listar a posição.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseB3, type B3Report } from "../../ingest/b3.ts";

/**
 * @brief Classificar uma aba do relatório na família que rege seu soft-close.
 *
 * A família decide a regra de fechamento: "rf" tem o tratamento da aba que pisca;
 * "tesouro" e "rv" fecham direto por ausência.
 *
 * @param sheet nome da aba
 * @return "tesouro", "rf" (Renda Fixa) ou "rv" (Ações/BDR)
 */
const kindOf = (sheet: string): string => {
  const s = sheet.toLowerCase();
  if (s.includes("tesouro")) return "tesouro";
  if (s.includes("renda fixa")) return "rf";
  return "rv";
};

/**
 * @brief Sincronizar as posições da B3: upsert, snapshot por relatório e soft-close.
 *
 * Upsert por `match_key` (ISIN/código/ticker): reaparecer num relatório mais novo
 * limpa o `closed_at` — a posição volta a viver. Nunca há DELETE: fechar é
 * soft-close, para o histórico de snapshots continuar de pé.
 *
 * Soft-close: uma posição vista pela última vez ANTES do relatório mais novo é
 * candidata a fechar, e a decisão segue a família da aba (ver @file):
 *  - tesouro/rv → fecha, datada no último dia em que foi vista;
 *  - rf → só fecha se existir um relatório mais novo COM a aba RF presente; sem
 *    isso, a ausência é falta de informação e a posição fica aberta.
 *
 * CDB do Inter vira `group_name='Porquinho'`. O Porquinho é B3 e NÃO é derivado do
 * ledger — derivá-lo contaria em dobro e ignoraria o rendimento.
 *
 * @param db conexão do DB em construção
 * @param b3Files relatórios com ref_date, em ORDEM cronológica (o último define o
 *                corte do soft-close)
 * @return linhas de relatório legível, uma por arquivo processado
 * @throws Error se algum .xlsx não puder ser lido ou parseado
 */
export function syncB3(db: DatabaseSync, b3Files: { f: string; ref: string }[]): string[] {
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

  const reportsByKind = new Map<string, string[]>();   // kind → refDates com a aba presente
  const posSeen = new Map<number, { kind: string; dates: string[] }>();
  const log: string[] = [];

  for (const { f } of b3Files) {
    const rep: B3Report = parseB3(readFileSync(f) as Buffer, basename(f));
    for (const sheet of rep.sheets) {
      const k = kindOf(sheet);
      reportsByKind.set(k, [...(reportsByKind.get(k) ?? []), rep.refDate]);
    }
    for (const p of rep.positions) {
      const group = p.type === "cdb" && p.bank === "inter" ? "Porquinho" : null;
      const row = upsertInv.get(
        p.name, p.matchKey, p.code, p.type, p.bank, p.indexer, p.maturityIso, group, rep.refDate,
      ) as { id: number };
      if (group) db.prepare("UPDATE investments SET group_name = ? WHERE id = ?").run(group, row.id);
      insSnap.run(row.id, rep.refDate, p.quantity, p.unitPriceCents, p.appliedCents, p.grossCents, p.netCents);
      const seen = posSeen.get(row.id) ?? { kind: kindOf(p.sheet), dates: [] };
      seen.dates.push(rep.refDate);
      posSeen.set(row.id, seen);
    }
    log.push(`  ${rep.refDate} (${basename(f)}): ${rep.positions.length} posições [${rep.sheets.join(", ") || "sem abas"}]`);
  }

  const newestReport = b3Files.at(-1)?.ref ?? "";
  const closeInv = db.prepare("UPDATE investments SET closed_at = ? WHERE id = ?");
  for (const [invId, seen] of posSeen) {
    const lastSeen = seen.dates.sort().at(-1)!;
    if (lastSeen >= newestReport) continue;
    if (seen.kind === "rf") {
      const laterWithSheet = (reportsByKind.get("rf") ?? []).some((d) => d > lastSeen);
      if (laterWithSheet) closeInv.run(lastSeen, invId);
    } else {
      closeInv.run(lastSeen, invId);
    }
  }
  return log;
}
