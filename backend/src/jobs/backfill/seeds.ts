import type { DatabaseSync } from "node:sqlite";

/**
 * Contas base do acervo — os três destinos que os parsers de extrato e de fatura
 * referenciam por id fixo.
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
  acc.run("nu-db", "nubank", "checking", "Nubank Conta");
  acc.run("inter-db", "inter", "checking", "Inter Conta");
  acc.run("inter-cc", "inter", "credit_card", "Inter Cartão");
}

export function seedRules(db: DatabaseSync): void {
  const ins = db.prepare("INSERT INTO rules (matcher, action, value, priority) VALUES (?,?,?,?)");
  for (const k of ["rdb", "nuinvest", "tesouro", "irrf", "cobrança de investimentos",
    "aplicação", "aplicacao", "resgate", "caixinha", "porquinho", "cdb porq"]) {
    ins.run(k, "investment_leg", null, 100);
  }
  for (const k of ["rdb", "caixinha", "dinheiro guardado"]) ins.run(k, "investment_leg", "Caixinha Nubank", 90);
  ins.run("fatura", "settlement", null, 100);
}
