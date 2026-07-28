import type { DatabaseSync } from "node:sqlite";
import { setConfig, type BrokerSharkConfig } from "../config.ts";

// Apoio de TESTE, não de produção.
//
// Ledger novo nasce sem categoria nenhuma (ver `jobs/backfill/seeds.ts`): a
// taxonomia de gasto é decisão de quem usa, não estrutura do domínio. Mas quase
// todo teste que envolve categorizar precisa de ALGUMA categoria pra apontar, e
// repetir o INSERT em quinze arquivos convidaria cada um a inventar a sua.
//
// Os nomes aqui são genéricos de propósito. Não são "as categorias do produto" —
// são as categorias DESTE teste.

/**
 * A config que os testes usam — fixa, não a do disco.
 *
 * Ler `config/default.json` faria a suíte depender do arquivo que estiver lá:
 * bastava alguém criar `config/local.json` com as próprias contas pra metade dos
 * testes começar a falhar por motivo nenhum.
 */
export const TEST_CONFIG: BrokerSharkConfig = {
  accounts: [
    { id: "conta-a", bank: "Banco A", type: "checking", name: "Banco A Conta",
      statementFormat: "ids" },
    { id: "conta-b", bank: "Banco B", type: "checking", name: "Banco B Conta",
      statementFormat: "running-balance" },
    { id: "cartao-b", bank: "Banco B", type: "credit_card", name: "Banco B Cartão",
      invoiceFormat: "itemized", paidFrom: "conta-b" },
  ],
  investmentKeywords: ["aplicação", "aplicacao", "resgate", "tesouro", "cdb", "reserva"],
  derivedSavings: {
    name: "Reserva", bank: "Banco A", type: "reserva", accountId: "conta-a",
    keywords: ["reserva", "dinheiro guardado"],
    excludeKeywords: ["corretora", "tesouro"],
  },
  positionGroups: [{ type: "cdb", bank: "Banco B", name: "Renda fixa do Banco B" }],
};

/** Fixa a config do processo na de teste. Chame no topo do arquivo de teste. */
export function useTestConfig(): void {
  setConfig(TEST_CONFIG);
}

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
