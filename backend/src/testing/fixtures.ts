import type { DatabaseSync } from "node:sqlite";

// Apoio de TESTE, não de produção.
//
// Ledger novo nasce sem categoria nenhuma (ver `jobs/backfill/seeds.ts`): a
// taxonomia de gasto é decisão de quem usa, não estrutura do domínio. Mas quase
// todo teste que envolve categorizar precisa de ALGUMA categoria pra apontar, e
// repetir o INSERT em quinze arquivos convidaria cada um a inventar a sua.
//
// Os nomes aqui são genéricos de propósito. Não são "as categorias do produto" —
// são as categorias DESTE teste.

export interface TestCategories {
  expense: Record<string, number>;
  income: Record<string, number>;
}

const EXPENSE = ["Alimentação", "Transporte", "Moradia"];
const INCOME = ["Salário", "Outro"];

/** Cria um conjunto mínimo de categorias e devolve os ids por nome. */
export function seedTestCategories(db: DatabaseSync): TestCategories {
  const ins = db.prepare("INSERT INTO categories (name, flow) VALUES (?, ?)");
  const out: TestCategories = { expense: {}, income: {} };
  for (const n of EXPENSE) out.expense[n] = Number(ins.run(n, "expense").lastInsertRowid);
  for (const n of INCOME) out.income[n] = Number(ins.run(n, "income").lastInsertRowid);
  return out;
}

/** Id da primeira categoria de despesa — quando o teste só precisa de "uma". */
export function anyExpenseCategory(db: DatabaseSync): number {
  const row = db.prepare("SELECT id FROM categories WHERE flow='expense' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  return row ? row.id : seedTestCategories(db).expense["Alimentação"]!;
}
