import type { DatabaseSync } from "node:sqlite";

const EXPENSE_CATS = ["Alimentação", "Transporte", "Saúde e Bem-Estar",
  "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo"];
const INCOME_CATS = ["Salário", "Freela", "PIX recebido", "Transferência", "Outro"];

export function seedAccountsAndCategories(db: DatabaseSync): void {
  const acc = db.prepare("INSERT INTO accounts (id, bank, type, name) VALUES (?,?,?,?)");
  acc.run("nu-db", "nubank", "checking", "Nubank Conta");
  acc.run("inter-db", "inter", "checking", "Inter Conta");
  acc.run("inter-cc", "inter", "credit_card", "Inter Cartão");

  // guardado por NOT EXISTS: sem isso, um fresh backfill duplicaria as 6 macro
  // (migration 0002 roda ANTES do seed em backfill.ts e já as insere numa
  // tabela vazia; alguns testes de rota rodam o seed antes da migration —
  // os dois caminhos precisam ser idempotentes um em relação ao outro).
  const cat = db.prepare(
    "INSERT INTO categories (name, flow) SELECT ?, ? WHERE NOT EXISTS " +
    "(SELECT 1 FROM categories WHERE name=? AND flow=?)",
  );
  for (const c of EXPENSE_CATS) cat.run(c, "expense", c, "expense");
  for (const c of INCOME_CATS) cat.run(c, "income", c, "income");
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
