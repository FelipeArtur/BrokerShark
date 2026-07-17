/**
 * @file analytics.ts
 * @brief Agregações do dashboard: série mensal, balanço do mês, top PIX, sem categoria.
 *
 * analytics.ts — agregações do dashboard.
 *
 * /api/monthly (série receita×despesa), /api/pix-top (contrapartes do mês),
 * /api/uncategorized-merchants (painel de lote), /api/cashflow-statement
 * (balanço do mês da Visão do Mês).
 *
 * FRONTEIRA DE UNIDADE: agrega em centavos inteiros; o JSON sai em REAIS (÷100).
 */
import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, qsStr, qsInt } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { currentMonth, monthRange } from "../domain/dates.ts";

/**
 * @brief SQL das somas de um período, em centavos inteiros.
 *
 * Somas de um período: receita real, despesa de consumo, fluxo de investimento.
 *
 * Materializa a REGRA CONSUMO-DESPESA (invariante): despesa de consumo exige
 * `method != 'transfer'` (perna de investimento não é gasto), `is_settlement=0`
 * (pagamento de fatura não reconta o consumo já itemizado), `is_third_party=0` e
 * `dest_account_id IS NULL`. Receita real exige `is_revenue=1` — self-transfer e
 * movimento de investimento ficam fora. Divergir daqui = total errado.
 */
const FLOW_SUMS = `
  COALESCE(SUM(CASE
    WHEN t.flow='income' AND t.is_revenue=1 AND t.is_third_party=0
    THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
  COALESCE(SUM(CASE
    WHEN t.flow='expense' AND t.method != 'transfer'
      AND t.is_settlement=0 AND t.is_third_party=0
      AND t.dest_account_id IS NULL
    THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
  COALESCE(SUM(CASE
    WHEN t.flow='expense' AND t.method='transfer'
      AND t.dest_account_id IS NULL AND t.is_settlement=0
    THEN t.amount_cents ELSE 0 END), 0) AS invest_out_cents,
  COALESCE(SUM(CASE
    WHEN t.flow='income' AND t.is_revenue=0 AND t.method='transfer'
    THEN t.amount_cents ELSE 0 END), 0) AS invest_in_cents
`;

/**
 * @brief Montar as rotas de agregação do dashboard ligadas a esta conexão.
 * @param db conexão do DB
 * @return rotas GET /api/monthly, /api/cashflow-statement, /api/pix-top e
 *         /api/uncategorized-merchants
 */
export function analyticsRoutes(db: DatabaseSync): Route[] {
  // ── GET /api/monthly?bank=&account=&present= ──────────────────────────
  // Série mensal receita×despesa. present=1 inclui o mês corrente.
  /**
   * @brief Série mensal de receita × despesa (as barras de fluxo do dashboard).
   *
   * O mês corrente fica FORA por padrão: ainda incompleto, ele apareceria como uma
   * queda falsa na série. `present=1` inclui.
   *
   * @param req requisição; query `bank`, `account` e `present` (opcionais)
   * @param res resposta; `income`/`expenses` em REAIS
   */
  function getMonthly(req: Req, res: Res) {
    const bank = qsStr(req, "bank");
    const account = qsStr(req, "account");
    const present = qsStr(req, "present");

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (bank) { conditions.push("a.bank = ?"); params.push(bank); }
    if (account) { conditions.push("t.account_id = ?"); params.push(account); }
    if (present !== "1") {
      const { month: cm, year: cy } = currentMonth();
      conditions.push("strftime('%Y-%m', t.date) < ?");
      params.push(`${cy}-${String(cm).padStart(2, "0")}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = db.prepare(`
      SELECT
        strftime('%Y', t.date) AS year,
        CAST(strftime('%m', t.date) AS INTEGER) AS month,
        ${FLOW_SUMS}
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      ${where}
      GROUP BY year, month
      ORDER BY year, month
    `).all(...params) as any[];

    json(res, rows.map(r => ({
      label: `${String(r.month).padStart(2, "0")}/${r.year}`,
      month: r.month,
      year: Number(r.year),
      income: r.income_cents / 100,
      expenses: r.expense_cents / 100,
    })));
  }

  // ── GET /api/cashflow-statement?month=&year= ──────────────────────────
  /**
   * @brief Balanço do mês: receita, despesa de consumo e investimento líquido.
   *
   * `investment_net` = aplicado − resgatado (positivo = mês em que se guardou mais
   * do que se tirou).
   *
   * @param req requisição; query `month`/`year` (default = mês corrente)
   * @param res resposta; todos os totais em REAIS
   */
  function getCashflowStatement(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const row = db.prepare(`
      SELECT ${FLOW_SUMS} FROM transactions t WHERE t.date >= ? AND t.date <= ?
    `).get(start, end) as any;

    json(res, {
      month, year,
      income_total: row.income_cents / 100,
      expense_total: row.expense_cents / 100,
      investment_net: (row.invest_out_cents - row.invest_in_cents) / 100,
    });
  }

  // ── GET /api/pix-top?month=&year= ─────────────────────────────────────
  // counterpart só é gravado no pareamento SELF; a contraparte de um pix comum
  // vive na description — extraída aqui (prefixos Nubank/Inter + cauda CPF/CNPJ).
  /**
   * @brief Extrair o nome da contraparte de um PIX a partir da descrição.
   * @param desc descrição da transação
   * @return o nome limpo (sem prefixo do banco nem cauda de CPF/CNPJ/agência);
   *         "" se nada sobrar
   */
  function pixCounterpart(desc: string): string {
    return String(desc ?? "")
      .replace(/"/g, "")
      .replace(/^transfer[êe]ncia enviada pelo pix\s*[-–]?\s*/i, "")
      .replace(/^pix enviado:?\s*/i, "")
      .replace(/cp\s*:\s*\d+\s*-\s*/i, "")
      .replace(/\s*[-–]\s*(?:•••|\d{3}\.\d{3}\.|\d{2}\.\d{3}\.\d{3}\/).*$/u, "")
      .replace(/\s+Agência:.*$/iu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /**
   * @brief Top 20 contrapartes de PIX enviado no mês, por valor.
   *
   * Exclui pernas SELF (transferência entre contas próprias não é gasto com
   * ninguém), liquidações e terceiros. Agrupa case-insensitive, preservando a
   * grafia do primeiro registro visto.
   *
   * @param req requisição; query `month`/`year` (default = mês corrente)
   * @param res resposta; `total` em REAIS, ordenado do maior para o menor
   */
  function getPixTop(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const rows = db.prepare(`
      SELECT description, counterpart, amount_cents
      FROM transactions
      WHERE date >= ? AND date <= ?
        AND flow = 'expense'
        AND method = 'pix'
        AND (counterpart IS NULL OR counterpart != 'SELF')
        AND is_settlement = 0
        AND is_third_party = 0
    `).all(start, end) as any[];

    const groups = new Map<string, { counterpart: string; total_cents: number; count: number }>();
    for (const r of rows) {
      const name = r.counterpart ?? pixCounterpart(r.description);
      if (!name) continue;
      const key = name.toLowerCase();
      const g = groups.get(key) ?? { counterpart: name, total_cents: 0, count: 0 };
      g.total_cents += r.amount_cents;
      g.count += 1;
      groups.set(key, g);
    }

    json(res, [...groups.values()]
      .sort((a, b) => b.total_cents - a.total_cents)
      .slice(0, 20)
      .map(g => ({ counterpart: g.counterpart, total: g.total_cents / 100, count: g.count })));
  }

  // ── GET /api/uncategorized-merchants?month=&year= ─────────────────────
  // Linhas categorizáveis sem categoria, agrupadas por (comerciante, flow),
  // com ids agregados p/ o categorize-bulk e sugestão via rules.
  /**
   * @brief Agrupar as transações sem categoria por comerciante, sugerindo categoria.
   *
   * Só entram linhas CATEGORIZÁVEIS — mesma regra consumo-despesa / receita real do
   * FLOW_SUMS. Liquidação e perna de investimento não pedem categoria, e listá-las
   * aqui viraria trabalho inútil na UI.
   *
   * A sugestão vem da primeira `rule` de categoria cujo matcher casa o nome, na
   * ordem de prioridade.
   *
   * @param req requisição; query `month`/`year` (default = mês corrente)
   * @param res resposta; `total` em REAIS e `ids` para o categorize-bulk
   */
  function getUncategorizedMerchants(req: Req, res: Res) {
    const { month: cm, year: cy } = currentMonth();
    const month = qsInt(req, "month") ?? cm;
    const year = qsInt(req, "year") ?? cy;
    const { start, end } = monthRange(month, year);

    const rows = db.prepare(`
      SELECT
        COALESCE(t.display_name, t.description) AS merchant_key,
        t.flow,
        COUNT(*) AS count,
        SUM(t.amount_cents) AS total_cents,
        MIN(t.description) AS sample_description,
        GROUP_CONCAT(t.id) AS ids
      FROM transactions t
      WHERE t.category_id IS NULL
        AND t.date >= ? AND t.date <= ?
        AND (
          (t.flow = 'expense' AND t.method != 'transfer' AND t.is_settlement = 0
            AND t.is_third_party = 0 AND t.dest_account_id IS NULL)
          OR (t.flow = 'income' AND t.is_revenue = 1 AND t.is_third_party = 0)
        )
      GROUP BY merchant_key, t.flow
      ORDER BY total_cents DESC
    `).all(start, end) as any[];

    const rules = db.prepare(
      "SELECT matcher, value FROM rules WHERE action='category' AND enabled=1 ORDER BY priority ASC, id ASC"
    ).all() as any[];
    const catName = new Map<number, string>(
      (db.prepare("SELECT id, name FROM categories").all() as any[]).map(c => [c.id, c.name]),
    );

    json(res, rows.map(r => {
      const hay = String(r.merchant_key ?? "").toLowerCase();
      const rule = rules.find(x => hay.includes(String(x.matcher).toLowerCase()));
      const sugId = rule ? Number(rule.value) : null;
      return {
        merchant_key: r.merchant_key,
        flow: r.flow,
        count: r.count,
        total: r.total_cents / 100,
        sample_description: r.sample_description,
        ids: String(r.ids).split(",").map(Number),
        suggested_category_id: sugId,
        suggested_category_name: sugId != null ? catName.get(sugId) ?? null : null,
      };
    }));
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/monthly"), handler: getMonthly },
    { method: "GET", ...cp("/api/cashflow-statement"), handler: getCashflowStatement },
    { method: "GET", ...cp("/api/pix-top"), handler: getPixTop },
    { method: "GET", ...cp("/api/uncategorized-merchants"), handler: getUncategorizedMerchants },
  ];
}
