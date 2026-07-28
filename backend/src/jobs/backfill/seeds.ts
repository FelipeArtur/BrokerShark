import type { DatabaseSync } from "node:sqlite";
import { config } from "../../config.ts";

/**
 * As contas declaradas na config — os destinos que o import e o backfill usam.
 *
 * **Categoria NÃO nasce aqui, de propósito.** Ledger novo começa com zero
 * categorias, e quem usa cria as suas pela UI. Taxonomia de gasto é decisão
 * pessoal: as seis macro que este projeto carregou por meses dizem mais sobre a
 * vida do dono do que sobre o domínio, e semeá-las empurraria essa vida pra
 * dentro do ledger de quem clonasse o repositório. Sem categoria semeada, o
 * lançamento importado nasce sem categoria — que é exatamente o estado que a UI
 * já sabe mostrar e resolver em lote.
 */
export function seedAccounts(db: DatabaseSync): void {
  const acc = db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)");
  for (const a of config().accounts) acc.run(a.id, a.bank, a.type, a.name);
}

/**
 * Documenta, no banco, a classificação que o ingest aplicou.
 *
 * Estas regras não são lidas em execução — a classificação já aconteceu no
 * parser. Elas existem pra que o ledger explique a si mesmo: quem abrir a aba
 * Regras vê por que aquele lançamento virou perna de investimento. Por isso
 * saem da mesma config que o parser usou; duas listas divergentes fariam a
 * explicação mentir sobre o que de fato aconteceu.
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
