/**
 * @file seeds.ts
 * @brief Estado inicial do DB reconstruído: contas, categorias e rules.
 *
 * seeds.ts — contas, categorias e rules (estado inicial do DB reconstruído).
 */
import type { DatabaseSync } from "node:sqlite";

const EXPENSE_CATS = ["Alimentação", "Carro", "Jogos", "Lazer", "Atividade física",
  "Eletrônicos", "Educação", "Igreja", "Dízimo", "Outro", "Eventos / Terceiros"];
const INCOME_CATS = ["Salário", "Freela", "PIX recebido", "Transferência", "Outro"];

/**
 * @brief Semear as 3 contas (nu-db, inter-db, inter-cc) e as categorias base.
 *
 * Roda num DB recém-criado: os INSERTs são crus e falhariam em id duplicado. Os ids
 * das contas são fixos — os parsers os referenciam por nome.
 *
 * @param db conexão do DB recém-inicializado
 */
export function seedAccountsAndCategories(db: DatabaseSync): void {
  const acc = db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)");
  acc.run("nu-db", "nubank", "checking", "Nubank Conta");
  acc.run("inter-db", "inter", "checking", "Inter Conta");
  acc.run("inter-cc", "inter", "credit_card", "Inter Cartão");

  const cat = db.prepare("INSERT INTO categories (name, flow) VALUES (?,?)");
  for (const c of EXPENSE_CATS) cat.run(c, "expense");
  for (const c of INCOME_CATS) cat.run(c, "income");
}

/**
 * @brief Semear a tabela `rules` com as keywords de classificação já aplicadas.
 *
 * Documenta as keywords de classificação aplicadas (editável na UI futura).
 *
 * As rules DOCUMENTAM a classificação — quem classifica de fato é domain/classify.ts
 * durante o parse. Mudar uma keyword aqui não reclassifica nada; a fonte é o
 * classify.ts. A tabela alimenta a sugestão de categoria na UI.
 *
 * @param db conexão do DB em construção
 */
export function seedRules(db: DatabaseSync): void {
  const ins = db.prepare("INSERT INTO rules (matcher, action, value, priority) VALUES (?,?,?,?)");
  for (const k of ["rdb", "nuinvest", "tesouro", "irrf", "cobrança de investimentos",
    "aplicação", "aplicacao", "resgate", "caixinha", "porquinho", "cdb porq"]) {
    ins.run(k, "investment_leg", null, 100);
  }
  for (const k of ["rdb", "caixinha", "dinheiro guardado"]) ins.run(k, "investment_leg", "Caixinha Nubank", 90);
  ins.run("fatura", "settlement", null, 100);
}
