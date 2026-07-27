import type { DatabaseSync } from "node:sqlite";
import type { Req, Res } from "../http/respond.ts";
import { json, error, readBody } from "../http/respond.ts";
import type { Route } from "../http/router.ts";
import { compilePath } from "../http/router.ts";
import { broadcast } from "../http/sse.ts";
import { isIntId } from "../http/validate.ts";
import { normalizeMerchant } from "../domain/merchant.ts";

// Regras APRENDIDAS: categorizar um lançamento grava `matcher → categoria`
// (`learnCategoryRule`), e daí em diante essa regra sugere sozinha em três
// lugares — tabela do mês, comerciantes sem categoria e preview do import.
//
// Aprender sem poder desaprender é o problema: uma regra errada gravada uma vez
// sugere errado pra sempre, e o único conserto era recategorizar por acaso o
// mesmo comerciante. Estas rotas dão o caminho de volta.
//
// Só `action='category'` é exposto. As regras semeadas pelo backfill
// (`investment_leg`, `settlement`) documentam a classificação que já aconteceu
// — nada as lê em tempo de execução, então editá-las não mudaria nada e a tela
// prometeria um efeito que não existe.

const SQL_LEARNED = `
  SELECT r.id, r.matcher, r.value, r.enabled, r.priority,
         c.id AS category_id, c.name AS category_name, c.flow AS category_flow,
         (SELECT COUNT(*) FROM transactions t
           WHERE t.category_id IS NULL
             AND LOWER(COALESCE(t.display_name, '') || ' ' || COALESCE(t.description, ''))
                 LIKE '%' || LOWER(r.matcher) || '%') AS pending_matches
  FROM rules r
  LEFT JOIN categories c ON c.id = CAST(r.value AS INTEGER)
  WHERE r.action = 'category'
  ORDER BY r.enabled DESC, r.matcher ASC
`;

export function ruleRoutes(db: DatabaseSync): Route[] {

  const findRule = (id: unknown) =>
    isIntId(id)
      ? db.prepare("SELECT * FROM rules WHERE id = ? AND action = 'category'").get(id) as any
      : undefined;

  function getRules(_req: Req, res: Res) {
    const rows = db.prepare(SQL_LEARNED).all() as any[];
    json(res, rows.map(r => ({
      id: r.id,
      matcher: r.matcher,
      enabled: r.enabled,
      category_id: r.category_id,
      // Categoria apagada deixa a regra órfã apontando pra um id morto.
      // `deleteOrphanCategoryRules` limpa no caminho normal; se sobrar uma, ela
      // aparece aqui como órfã em vez de sumir sem explicação.
      category_name: r.category_name ?? null,
      category_flow: r.category_flow ?? null,
      orphan: r.category_name == null,
      pending_matches: r.pending_matches,
    })));
  }

  async function patchRule(req: Req, res: Res) {
    const rule = findRule(Number(req.params!.id));
    if (!rule) return error(res, "regra não encontrada", 404);
    const body = await readBody<Record<string, unknown>>(req);

    const updates: string[] = [];
    const params: unknown[] = [];

    if ("category_id" in body) {
      const v = body.category_id;
      if (!isIntId(v) || !db.prepare("SELECT 1 FROM categories WHERE id = ?").get(v)) {
        return error(res, "categoria inexistente");
      }
      updates.push("value = ?"); params.push(String(v));
    }
    if ("enabled" in body) {
      const v = body.enabled;
      if (v !== 0 && v !== 1) return error(res, "enabled deve ser 0|1");
      updates.push("enabled = ?"); params.push(v);
    }
    if (!updates.length) return error(res, "nenhum campo para atualizar");

    params.push(rule.id);
    db.prepare(`UPDATE rules SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    broadcast();
    json(res, { ok: true });
  }

  function deleteRule(req: Req, res: Res) {
    const rule = findRule(Number(req.params!.id));
    if (!rule) return error(res, "regra não encontrada", 404);
    // Apagar a regra NÃO descategoriza nada: o que já foi categorizado é
    // decisão tomada, e desfazer em massa seria uma surpresa cara. Some só a
    // sugestão daqui pra frente.
    db.prepare("DELETE FROM rules WHERE id = ?").run(rule.id);
    broadcast();
    json(res, { ok: true });
  }

  // Espelho de leitura do que a sugestão faria: dado um texto, qual regra
  // casaria. Serve pra tela explicar "por que sugeriu isso".
  async function testRule(req: Req, res: Res) {
    const body = await readBody<{ description?: unknown }>(req);
    const desc = typeof body.description === "string" ? body.description : "";
    if (!desc.trim()) return error(res, "description obrigatória");

    const hay = desc.toLowerCase();
    const rows = db.prepare(
      "SELECT id, matcher, value FROM rules WHERE action='category' AND enabled=1 ORDER BY priority ASC, id ASC",
    ).all() as any[];
    const hit = rows.find(r => hay.includes(String(r.matcher).toLowerCase()));

    json(res, {
      merchant_core: normalizeMerchant(desc),
      rule_id: hit ? hit.id : null,
      matcher: hit ? hit.matcher : null,
      category_id: hit ? Number(hit.value) : null,
    });
  }

  const cp = compilePath;
  return [
    { method: "GET", ...cp("/api/rules"), handler: getRules },
    { method: "POST", ...cp("/api/rules/test"), handler: testRule },
    { method: "PATCH", ...cp("/api/rules/:id"), handler: patchRule },
    { method: "DELETE", ...cp("/api/rules/:id"), handler: deleteRule },
  ];
}
