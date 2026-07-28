// Gerador de ledger SINTÉTICO — o modo demo do projeto.
//
// Existe por duas razões. A primeira é que o BrokerShark é inútil vazio: sem
// acervo não há tela, e quem clona o repositório não tem o meu acervo (nem
// deveria). A segunda é que screenshot de dashboard financeiro com dado real é
// vazamento — as imagens do README saem daqui.
//
// Duas regras de desenho:
//
// 1. **Passa pelos mesmos módulos do backfill.** Pareamento SELF, derivação da
//    Caixinha, fatura itemizada e reconciliação do pagamento são os de produção.
//    Um gerador que inserisse linhas prontas produziria um banco bonito e
//    mentiroso, que não prova nada sobre o código.
// 2. **É determinístico.** PRNG com semente fixa: a mesma demo hoje e daqui a um
//    ano, então screenshot não envelhece sozinho e bug de demo é reproduzível.
//
// No fim, roda a auditoria de invariantes contra o que acabou de gerar e ABORTA
// se alguma quebrou. Se o gerador não consegue produzir um ledger válido, o
// problema é do gerador ou da invariante — nos dois casos eu quero saber.

import { rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb, initSchema, restrictPermissions } from "../db/open.ts";
import { runMigrations } from "../db/migrate.ts";
import { seedAccounts, seedRules } from "./backfill/seeds.ts";
import { makeTxInserter, newStats } from "./backfill/txInsert.ts";
import type { TxRecord } from "../ingest/types.ts";
import { pairSelfTransfers } from "./backfill/selfPairs.ts";
import { deriveCaixinha } from "./backfill/caixinha.ts";
import { insertOpenFatura } from "../db/faturaImport.ts";
import type { FaturaItem } from "../ingest/interFatura.ts";
import { reconcileOpenInvoices } from "../db/reconcile.ts";
import { auditLedger } from "../db/audit.ts";
import { reviewInvestments } from "./backfill/investReview.ts";
import { fmtCents } from "../domain/money.ts";
import { today } from "../domain/dates.ts";

const MONTHS = 24;
const SEED = 20260727;

/** mulberry32 — PRNG pequeno e determinístico. Não é criptografia, é cenário. */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = makeRng(SEED);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const between = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

// Comerciantes inventados. Nome plausível o bastante pra tela parecer real, e
// obviamente fictício o bastante pra ninguém confundir com um extrato de verdade.
const MERCHANTS = {
  mercado: ["Mercado Boa Compra", "Supermercado Estrela", "Hortifruti da Praça"],
  restaurante: ["Restaurante do Zé", "Cantina Bella Vista", "Cafeteria Grão Torrado", "Padaria Sol Nascente"],
  farmacia: ["Farmácia Vida", "Drogaria Bem-Estar"],
  transporte: ["Posto Central", "Mobilidade Urbana App", "Estacionamento Centro"],
  lazer: ["Livraria Página Virada", "Cinema Paradiso", "Loja Esporte Total"],
  assinatura: ["Streaming Estelar", "Música Sem Fim", "Academia Movimento"],
} as const;

// Comerciante → categoria semeada. É o que popula o widget de categorias e o que
// as regras aprendidas documentam.
const CATEGORY_OF: Record<string, string> = {
  mercado: "Alimentação", restaurante: "Alimentação",
  farmacia: "Saúde e Bem-Estar", transporte: "Transporte",
  lazer: "Compras e Lazer", assinatura: "Compras e Lazer",
};

type Kind = keyof typeof MERCHANTS;

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Os MONTHS meses que terminam no mês corrente, do mais antigo pro mais novo. */
function monthList(): { year: number; month: number; ym: string }[] {
  const now = new Date(`${today()}T12:00:00`);
  const out: { year: number; month: number; ym: string }[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1, ym: ym(d) });
  }
  return out;
}

export interface DemoReport {
  dbPath: string;
  transactions: number;
  invoices: number;
  openInvoice: string | null;
  investments: number;
  months: number;
}

export function seedDemo(dbPath: string): DemoReport {
  for (const s of ["", "-wal", "-shm"]) rmSync(dbPath + s, { force: true });

  const db = openDb(dbPath);
  initSchema(db);
  runMigrations(db);
  seedAccounts(db);
  seedRules(db);

  const months = monthList();
  const lastDay = Number(today().slice(8, 10));
  const ins = makeTxInserter(db);
  const stats = newStats();
  let seq = 0;

  const tx = (r: Partial<TxRecord> & Pick<TxRecord, "date" | "amountCents" | "description">) => {
    ins.insert({
      accountId: "nu-db", flow: "expense", method: "pix", isRevenue: 0,
      isInvestmentLeg: false, isCaixinhaLeg: false, sourceFile: "demo",
      externalId: `demo-${++seq}`,
      ...r,
    } as TxRecord, stats);
  };

  // ── extrato: um mês de vida financeira, 24 vezes ──────────────────────────
  for (const [i, m] of months.entries()) {
    const isCurrent = i === months.length - 1;
    const cap = (d: number) => (isCurrent ? Math.min(d, lastDay) : d);

    // Salário: a âncora do mês. É o que faz "receita real" existir.
    tx({ date: iso(m.year, m.month, cap(5)), amountCents: 650000, flow: "income",
         method: "ted", isRevenue: 1, description: "Transferência recebida - Empresa Exemplo Ltda" });

    // Freela em alguns meses — receita que não é recorrente, de propósito.
    if (rand() < 0.35) {
      tx({ date: iso(m.year, m.month, cap(between(12, 24))), amountCents: between(80000, 250000),
           flow: "income", method: "pix", isRevenue: 1,
           description: "Pix recebido: Consultoria Exemplo ME" });
    }

    // Aluguel: mesmo valor, todo mês, dia 10. É o que a detecção de recorrência
    // precisa enxergar pra projetar a visão de futuro.
    if (cap(10) >= 10) {
      tx({ date: iso(m.year, m.month, 10), amountCents: 185000,
           description: "Pix enviado: Imobiliária Exemplo - aluguel" });
    }

    // Transferência entre contas do próprio dono. Vira par SELF no pareamento —
    // e é justamente o caso que não pode ser contado como gasto nem aplicação.
    //
    // O valor não é decorativo: o salário cai no Nubank, mas a fatura do cartão
    // e parte dos gastos saem do Inter. Transferir de menos faz a conta Inter
    // afundar mês a mês e a demo termina com saldo negativo de dezenas de
    // milhares — cenário que existe, mas não é o que a tela deve ilustrar.
    if (cap(7) >= 7) {
      tx({ date: iso(m.year, m.month, 7), amountCents: 320000, method: "ted",
           description: "Transferência enviada pelo Pix - Titular da conta" });
      tx({ date: iso(m.year, m.month, 7), amountCents: 320000, flow: "income", method: "pix",
           accountId: "inter-db", isRevenue: 1, description: "Pix recebido: Titular da conta" });
    }

    // Caixinha (RDB do Nubank): aplica todo mês, resgata de vez em quando.
    if (cap(15) >= 15) {
      tx({ date: iso(m.year, m.month, 15), amountCents: 80000, method: "transfer",
           description: "Aplicação RDB", isInvestmentLeg: true, isCaixinhaLeg: true });
    }
    if (i > 6 && i % 9 === 0 && cap(20) >= 20) {
      tx({ date: iso(m.year, m.month, 20), amountCents: 150000, flow: "income", method: "transfer",
           description: "Resgate RDB", isInvestmentLeg: true, isCaixinhaLeg: true });
    }

    // Gastos avulsos na conta corrente (pix e débito). O volume é calibrado pra
    // que o mês FECHE perto do salário: uma demo que sobra R$ 3 mil todo mês
    // acumula patrimônio de fantasia e não parece a vida de ninguém.
    for (let k = 0; k < between(7, 11); k++) {
      const kind = pick(["mercado", "restaurante", "farmacia", "transporte"] as const) as Kind;
      const day = cap(between(2, 27));
      if (isCurrent && day > lastDay) continue;
      tx({ date: iso(m.year, m.month, day), amountCents: between(2500, 35000),
           accountId: pick(["nu-db", "inter-db"]),
           description: `Pix enviado: ${pick(MERCHANTS[kind])}` });
    }

    // ── fatura do cartão: itens itemizados, como o CSV do banco entrega ──────
    const items: FaturaItem[] = [];
    for (let k = 0; k < between(9, 15); k++) {
      const kind = pick(["mercado", "restaurante", "lazer", "assinatura"] as const) as Kind;
      const day = cap(between(1, 14));
      if (isCurrent && day > lastDay) continue;
      items.push({
        date: iso(m.year, m.month, day),
        description: pick(MERCHANTS[kind]),
        bankCategory: kind.toUpperCase(),
        amountCents: between(2500, 38000),
      });
    }
    // Uma compra parcelada em 6x, pra existir compromisso futuro de verdade.
    if (i === months.length - 3) {
      for (let p = 1; p <= 6; p++) {
        const d = new Date(m.year, m.month - 1 + (p - 1), 12);
        if (ym(d) > months[months.length - 1]!.ym) break;
        items.push({
          date: iso(d.getFullYear(), d.getMonth() + 1, 12),
          description: "Loja Eletrônicos Exemplo - notebook",
          bankCategory: "ELETRONICOS", amountCents: 41650,
          installmentSeq: p, installmentTotal: 6,
        });
      }
    }
    if (!items.length) continue;

    // Vencimento no dia 20 do PRÓPRIO mês de referência. Não é decoração: a
    // reconciliação casa o pagamento numa janela de −70/+35 dias a partir do
    // primeiro dia do ref_month, então fatura vencendo no mês seguinte cairia
    // fora da janela e nasceria eternamente "em aberto".
    const dueDay = isCurrent && lastDay >= 20 ? Math.min(28, lastDay + 1) : 20;
    const fatura = insertOpenFatura(db, {
      refMonth: m.ym,
      dueDate: iso(m.year, m.month, dueDay),
      items: items.filter(it => it.date.slice(0, 7) === m.ym),
      sourceFile: "demo",
      importBatchId: `demo-fatura-${m.ym}`,
    });

    // O pagamento sai da conta corrente no vencimento e vira LIQUIDAÇÃO (fora
    // dos totais de consumo — os gastos reais são os itens). A última fatura
    // fica aberta de propósito: é ela que alimenta o "Comprometido".
    if (!isCurrent) {
      tx({ date: iso(m.year, m.month, dueDay), amountCents: fatura.totalCents,
           accountId: "inter-db", method: "credit",
           description: "Pagamento de fatura cartão de crédito" });
    }
  }

  // ── as derivações de produção, na ordem do backfill ───────────────────────
  pairSelfTransfers(db);
  deriveCaixinha(db, ins.caixinhaTxIds);
  reconcileOpenInvoices(db);

  categorize(db);
  seedPositions(db, months);
  seedBudgets(db);

  restrictPermissions(dbPath);

  // ── o gerador se audita ───────────────────────────────────────────────────
  const violations = auditLedger(db);
  const invest = reviewInvestments(db);
  if (violations.length || invest.violations.length) {
    for (const v of violations) console.error(`  ✗ ${v.check}: ${v.message} (${v.count})`);
    for (const v of invest.violations) console.error(`  ✗ ${v}`);
    db.close();
    throw new Error("o ledger gerado viola invariantes — corrija o gerador antes de publicar");
  }

  const count = (sql: string): number =>
    Number((db.prepare(sql).get() as { n: number }).n);
  const open = db.prepare(
    "SELECT ref_month FROM invoices WHERE payment_tx_id IS NULL ORDER BY ref_month DESC LIMIT 1",
  ).get() as { ref_month: string } | undefined;

  const report: DemoReport = {
    dbPath,
    transactions: count("SELECT COUNT(*) AS n FROM transactions"),
    invoices: count("SELECT COUNT(*) AS n FROM invoices"),
    openInvoice: open?.ref_month ?? null,
    investments: count("SELECT COUNT(*) AS n FROM investments"),
    months: months.length,
  };
  db.close();
  return report;
}

/**
 * Cria as categorias DA DEMO e categoriza por comerciante, deixando a regra
 * aprendida no banco — é assim que a UI aprende quando o dono categoriza, e a
 * aba Regras nasce com conteúdo.
 *
 * As categorias nascem aqui, e não no seed, porque um ledger de verdade nasce
 * sem nenhuma: taxonomia de gasto é escolha de quem usa. Estas são as escolhas
 * da personagem fictícia da demonstração.
 */
function categorize(db: DatabaseSync): void {
  const ins = db.prepare("INSERT INTO categories (name, flow) VALUES (?, ?)");
  const catId = new Map<string, number>();
  for (const n of ["Alimentação", "Transporte", "Saúde e Bem-Estar", "Compras e Lazer", "Moradia"]) {
    catId.set(n, Number(ins.run(n, "expense").lastInsertRowid));
  }
  const salario = Number(ins.run("Salário", "income").lastInsertRowid);
  ins.run("Freela", "income");

  const upd = db.prepare(
    "UPDATE transactions SET category_id = ? WHERE lower(description) LIKE ? AND category_id IS NULL",
  );
  const rule = db.prepare(
    "INSERT INTO rules (matcher, match_field, action, value, priority) VALUES (?, 'description', 'category', ?, 50)",
  );

  for (const [kind, names] of Object.entries(MERCHANTS)) {
    const cat = catId.get(CATEGORY_OF[kind]!);
    if (!cat) continue;
    for (const n of names) {
      upd.run(cat, `%${n.toLowerCase()}%`);
      rule.run(n.toLowerCase(), String(cat));
    }
  }

  const moradia = catId.get("Moradia")!;
  upd.run(moradia, "%aluguel%");
  rule.run("imobiliária exemplo", String(moradia));
  upd.run(salario, "%empresa exemplo%");
}

/**
 * Posições de renda fixa com medição mensal — o que na vida real vem do
 * relatório da B3. Rendimento não é chutado: o snapshot cresce e a tela COMPUTA
 * a diferença, que é a invariante do módulo de investimentos.
 */
function seedPositions(db: DatabaseSync, months: { year: number; month: number; ym: string }[]): void {
  const posicoes = [
    { name: "Tesouro IPCA+ 2029", key: "demo:tesouro-ipca-2029", type: "tesouro",
      bank: "b3", group: null, aplicado: 500000, taxaMes: 0.0075 },
    { name: "CDB Banco Exemplo 108% CDI", key: "demo:cdb-exemplo", type: "cdb",
      bank: "banco exemplo", group: "Porquinho", aplicado: 300000, taxaMes: 0.0088 },
  ];

  const insPos = db.prepare(`
    INSERT INTO investments (name, match_key, type, bank, source, group_name, opened_at)
    VALUES (?,?,?,?,'b3',?,?)`);
  const insSnap = db.prepare(`
    INSERT INTO position_snapshots
      (investment_id, ref_date, quantity, applied_cents, gross_cents, net_cents, source)
    VALUES (?,?,?,?,?,?, 'b3')`);

  for (const p of posicoes) {
    const start = months[Math.floor(months.length / 3)]!;
    const id = Number(
      insPos.run(p.name, p.key, p.type, p.bank, p.group, `${start.ym}-01`).lastInsertRowid,
    );
    let mes = 0;
    for (const m of months) {
      if (m.ym < start.ym) continue;
      const bruto = Math.round(p.aplicado * (1 + p.taxaMes) ** mes);
      const liquido = p.aplicado + Math.round((bruto - p.aplicado) * 0.85); // IR sobre o ganho
      const lastDay = new Date(m.year, m.month, 0).getDate();
      insSnap.run(id, iso(m.year, m.month, lastDay), 1, p.aplicado, bruto, liquido);
      mes++;
    }
  }
}

/** Alvos de gasto em algumas categorias — sem alvo, o widget nasce sem tensão. */
function seedBudgets(db: DatabaseSync): void {
  const alvos: Record<string, number> = {
    "Alimentação": 120000, "Transporte": 40000,
    "Saúde e Bem-Estar": 30000, "Compras e Lazer": 60000,
  };
  const ins = db.prepare(
    "INSERT INTO category_budgets (category_id, ref_month, amount_cents) VALUES (?, '', ?)",
  );
  for (const [name, cents] of Object.entries(alvos)) {
    const c = db.prepare("SELECT id FROM categories WHERE name = ? AND flow='expense'")
      .get(name) as { id: number } | undefined;
    if (c) ins.run(c.id, cents);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const dbPath = process.argv[2] ?? join(import.meta.dirname, "../../data/demo.db");
  const r = seedDemo(dbPath);
  console.log(`
  LEDGER DE DEMONSTRAÇÃO  →  ${r.dbPath}

    ${r.months} meses · ${r.transactions} lançamentos · ${r.invoices} faturas
    ${r.investments} posições de investimento${r.openInvoice ? ` · fatura aberta: ${r.openInvoice}` : ""}

    ✓ invariantes conferidas (auditoria + review de investimentos)

  Suba o painel apontando pra ele:

    npm start -- data/demo.db
`);
}
