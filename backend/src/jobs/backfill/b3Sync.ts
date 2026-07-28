import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseB3, type B3Report } from "../../ingest/b3.ts";
import { groupNameFor } from "../../config.ts";

const kindOf = (sheet: string): string => {
  const s = sheet.toLowerCase();
  if (s.includes("tesouro")) return "tesouro";
  if (s.includes("renda fixa")) return "rf";
  return "rv";
};

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

  const reportsByKind = new Map<string, string[]>();
  const posSeen = new Map<number, { kind: string; dates: string[] }>();
  const log: string[] = [];

  for (const { f } of b3Files) {
    const rep: B3Report = parseB3(readFileSync(f) as Buffer, basename(f));
    for (const sheet of rep.sheets) {
      const k = kindOf(sheet);
      reportsByKind.set(k, [...(reportsByKind.get(k) ?? []), rep.refDate]);
    }
    for (const p of rep.positions) {
      const group = groupNameFor(p.type, p.bank);
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
