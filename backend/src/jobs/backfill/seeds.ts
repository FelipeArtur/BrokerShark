import type { DatabaseSync } from "node:sqlite";
import { config } from "../../config.ts";

/**
 * @brief   As contas da config — os destinos que o import e o backfill usam.
 * @warning Categoria NÃO nasce aqui: ledger novo começa com zero, porque taxonomia de
 *          gasto é decisão de quem usa, não estrutura do domínio.
 */
export function seedAccounts(db: DatabaseSync): void {
  const acc = db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)");
  for (const a of config().accounts) acc.run(a.id, a.bank, a.type, a.name);
}

/**
 * @brief   Documenta no banco a classificação que o ingest já aplicou.
 * @note    Não são lidas em execução: existem pro ledger explicar a si mesmo. Saem da
 *          MESMA config do parser, senão a explicação mente.
 */
export function seedRules(db: DatabaseSync): void {
  const c = config();
  const ins = db.prepare("INSERT INTO rules (matcher, action, value, priority) VALUES (?,?,?,?)");
  for (const k of c.investmentKeywords) ins.run(k.toLowerCase(), "investment_leg", null, 100);
  if (c.derivedSavings) {
    for (const k of c.derivedSavings.keywords) {
      ins.run(k.toLowerCase(), "investment_leg", c.derivedSavings.name, 90);
    }
  }
  ins.run("fatura", "settlement", null, 100);
}
