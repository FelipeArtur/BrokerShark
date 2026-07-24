# Categorias Unificadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all category management into the dashboard Categories card, reduce the seed to 6 data-driven macro categories, show budgets as an accent/amber/red health-bar, and add a learn-and-suggest merchant→category recognition that never auto-applies.

**Architecture:** Backend adds a data migration (old cats → 6 macro) and a pure `normalizeMerchant` helper that feeds rule-writing on categorize; the existing rules-based suggestion surfaces learned categories. Frontend moves category CRUD/bulk entry into the Categories card, removes the topbar and table duplicates, and upgrades the per-row budget bar.

**Tech Stack:** TypeScript (Node ≥26, node:sqlite, node:test), React 18 hyperscript (no build), plain SQL migrations.

## Global Constraints

- Money in integer cents; never floats in the ledger.
- Migrations are forward-only, in `backend/src/db/migrations/NNNN_slug.sql`, contain NO `BEGIN`/`COMMIT` (the runner wraps each in a transaction), run on both server boot and backfill.
- "Verde = receita e só receita." The health-bar uses `--accent`/`--warn`/`--neg`, never `--pos`.
- Recognition never auto-applies a category; it only pre-fills a suggestion the user confirms.
- Frontend is hyperscript (`React.createElement`, never JSX), each file an IIFE; bump `?v=NN` cache tokens in `frontend/index.html` for any changed JS/CSS.
- The 6 macro expense categories, verbatim: `Alimentação`, `Transporte`, `Saúde e Bem-Estar`, `Compras e Lazer`, `Compromissos e Transferências`, `Igreja/Dízimo`. Income categories unchanged.
- Tests: `cd backend && npm test` (node:test over `src/**/*.test.ts` + `../frontend/js/**/*.test.js`).

---

### Task 1: Seed + migration to 6 macro categories

**Files:**
- Modify: `backend/src/jobs/backfill/seeds.ts:3-4` (EXPENSE_CATS)
- Create: `backend/src/db/migrations/0002_macro_categories.sql`
- Test: `backend/src/db/migrations/macroCategories.test.ts`

**Interfaces:**
- Produces: a DB whose `categories` table holds exactly the 6 macro expense categories (plus the 5 unchanged income), with every previously-categorized expense transaction reassigned to a macro.

- [ ] **Step 1: Write the failing test**

Create `backend/src/db/migrations/macroCategories.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(HERE, "0002_macro_categories.sql"), "utf8");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, flow TEXT);
    CREATE TABLE category_budgets (category_id INTEGER, ref_month TEXT DEFAULT '', amount_cents INTEGER,
      PRIMARY KEY(category_id, ref_month),
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE);
    CREATE TABLE transactions (id INTEGER PRIMARY KEY, flow TEXT, category_id INTEGER);
  `);
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

test("migration 0002: old expense cats collapse into the 6 macro, transactions reassigned", () => {
  const db = freshDb();
  const cat = db.prepare("INSERT INTO categories (name, flow) VALUES (?, ?)");
  for (const n of ["Alimentação", "Carro", "Jogos", "Igreja", "Dízimo", "Outro", "Educação"]) cat.run(n, "expense");
  for (const n of ["Salário"]) cat.run(n, "income");
  const idOf = (n: string) => (db.prepare("SELECT id FROM categories WHERE name=?").get(n) as any).id;
  const tx = db.prepare("INSERT INTO transactions (flow, category_id) VALUES ('expense', ?)");
  tx.run(idOf("Carro"));      // → Transporte
  tx.run(idOf("Jogos"));      // → Compras e Lazer
  tx.run(idOf("Igreja"));     // → Igreja/Dízimo
  tx.run(idOf("Educação"));   // → Compras e Lazer
  tx.run(idOf("Alimentação")); // stays

  db.exec(MIGRATION);

  const names = (db.prepare("SELECT name FROM categories WHERE flow='expense' ORDER BY name").all() as any[]).map(r => r.name);
  assert.deepEqual(names, ["Alimentação", "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo", "Saúde e Bem-Estar", "Transporte"]);
  const catOfTx = (i: number) => (db.prepare("SELECT name FROM categories WHERE id=(SELECT category_id FROM transactions WHERE id=?)").get(i) as any).name;
  assert.equal(catOfTx(1), "Transporte");
  assert.equal(catOfTx(2), "Compras e Lazer");
  assert.equal(catOfTx(3), "Igreja/Dízimo");
  assert.equal(catOfTx(4), "Compras e Lazer");
  assert.equal(catOfTx(5), "Alimentação");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM categories WHERE flow='income'").get() as any).n, 1);
});

test("migration 0002 is a no-op on a fresh DB that already has only the 6 macro", () => {
  const db = freshDb();
  const cat = db.prepare("INSERT INTO categories (name, flow) VALUES (?, 'expense')");
  for (const n of ["Alimentação", "Transporte", "Saúde e Bem-Estar", "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo"]) cat.run(n);
  db.exec(MIGRATION);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM categories WHERE flow='expense'").get() as any).n, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/db/migrations/macroCategories.test.ts`
Expected: FAIL — `ENOENT` on `0002_macro_categories.sql` (file not created yet).

- [ ] **Step 3: Create the migration**

Create `backend/src/db/migrations/0002_macro_categories.sql`:

```sql
-- Reduz as categorias de despesa às 6 macro (fundamentadas no gasto real via agy).
-- Reatribui os lançamentos já categorizados e remove as antigas. No-op num DB fresh
-- (o seed já cria as 6). Sem BEGIN/COMMIT — o runner envelopa.

INSERT OR IGNORE INTO categories (name, flow) VALUES
  ('Alimentação','expense'),
  ('Transporte','expense'),
  ('Saúde e Bem-Estar','expense'),
  ('Compras e Lazer','expense'),
  ('Compromissos e Transferências','expense'),
  ('Igreja/Dízimo','expense');

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Transporte' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name='Carro');

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Saúde e Bem-Estar' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name='Atividade física');

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compras e Lazer' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Jogos','Lazer','Eletrônicos','Educação'));

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Igreja/Dízimo' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Igreja','Dízimo'));

UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
  WHERE category_id IN (SELECT id FROM categories WHERE flow='expense' AND name IN ('Eventos / Terceiros','Outro'));

-- catch-all: qualquer categoria de despesa não-macro que ainda carregue lançamentos
UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name='Compromissos e Transferências' AND flow='expense')
  WHERE category_id IN (
    SELECT id FROM categories WHERE flow='expense' AND name NOT IN
      ('Alimentação','Transporte','Saúde e Bem-Estar','Compras e Lazer','Compromissos e Transferências','Igreja/Dízimo'));

DELETE FROM categories WHERE flow='expense' AND name NOT IN
  ('Alimentação','Transporte','Saúde e Bem-Estar','Compras e Lazer','Compromissos e Transferências','Igreja/Dízimo');
```

- [ ] **Step 4: Update the seed**

In `backend/src/jobs/backfill/seeds.ts`, replace line 3-4:

```ts
const EXPENSE_CATS = ["Alimentação", "Transporte", "Saúde e Bem-Estar",
  "Compras e Lazer", "Compromissos e Transferências", "Igreja/Dízimo"];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && node --test src/db/migrations/macroCategories.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Full suite + commit**

Run: `cd backend && npm test` — Expected: all pass.

```bash
git add backend/src/jobs/backfill/seeds.ts backend/src/db/migrations/0002_macro_categories.sql backend/src/db/migrations/macroCategories.test.ts
git commit -m "feat(categories): 6 macro seed + migration collapsing old expense cats"
```

---

### Task 2: Categories card becomes the single management hub

**Files:**
- Modify: `frontend/js/screens/dashboard.js` (CategoriesWidget header ~345-349, add onManage/onCreate props threaded from DashboardView ~696)
- Modify: `frontend/js/screens/app.js:161-163` (remove topbar "Categorias" button), `:200-202` (Overlay still mounted, opened via card callback)
- Modify: `frontend/js/screens/history.js:210-219` (remove `lote · N` toolbar button)
- Modify: `frontend/index.html` (bump `?v=` for dashboard.js, app.js, history.js)

**Interfaces:**
- Consumes: existing `window.BS.CategoriesPanel`, `postCategory(name, flow)` (already imported in overlays/categories.js; expose the create path to the card).
- Produces: DashboardView owns `categoriesOpen` state passed down; CategoriesWidget renders `+ Nova` (inline create) and `⚙ Gerenciar` (opens overlay) in its header.

- [ ] **Step 1: Thread category-overlay state into DashboardView**

The `categoriesOpen`/`setCategoriesOpen` state currently lives in `app.js`. Keep it in `app.js` but pass an `onManageCategories` callback into `DashboardView` → `CategoriesWidget`. In `app.js`, find where `DashboardView` is rendered and add prop `onManageCategories: () => setCategoriesOpen(true)`. Remove the topbar button block:

```js
// DELETE these lines in app.js (~161-163):
h("button", { className: "px-btn px-btn--ghost", onClick: () => setCategoriesOpen(true) },
  h(window.BS.IconSettings, { size: 14 }), "Categorias"
),
```

- [ ] **Step 2: Add + Nova / ⚙ Gerenciar to the card header**

In `dashboard.js` CategoriesWidget signature, accept `onManageCategories, onCreateCategory`. Replace the header (`~346-349`) with:

```js
h("div", { className: "widget-h" },
  h("span", { className: "widget-title" }, "Categorias"),
  h("span", { className: "mono", style: { marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--neg)" } }, "−" + fmtBRL(totalExp)),
  h("button", { className: "px-btn px-btn--ghost px-btn--sm", style: { marginLeft: 8 }, title: "Nova categoria", onClick: onCreateCategory }, "+ Nova"),
  h("button", { className: "px-btn px-btn--ghost px-btn--sm", title: "Gerenciar categorias", onClick: onManageCategories }, "⚙")
),
```

For `+ Nova`, wire `onCreateCategory` to open the same overlay in create-focus (simplest: `onCreateCategory = onManageCategories` for now; the overlay already has the inline "Nova categoria" input at top). Pass `onManageCategories` for both from DashboardView.

- [ ] **Step 3: Thread props through DashboardView**

Where DashboardView renders `CategoriesWidget` (~696), add `onManageCategories, onCreateCategory: onManageCategories` to its props, and accept `onManageCategories` in the DashboardView signature + pass from app.js.

- [ ] **Step 4: Remove the table's `lote · N` button**

In `history.js` (~210-219), delete the `uncatCount > 0 && h("button", …, \`lote · ${uncatCount}\`)` block from the toolbar. Leave `bulkOpen`/`setBulkOpen` and the modal itself intact (still opened via `openBulk` prop from the card's "Categorizar em lote").

- [ ] **Step 5: Verify in browser**

Run: `cd backend && npm start` (bump `?v=` first). Load `http://127.0.0.1:8000`.
Expected: topbar has only "Importar"; Categories card header shows `+ Nova` and `⚙`; clicking `⚙` opens the categories overlay; the table toolbar no longer shows `lote · N`; the card's "Categorizar em lote · N" still opens the bulk modal.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/screens/dashboard.js frontend/js/screens/app.js frontend/js/screens/history.js frontend/index.html
git commit -m "feat(categories): card is the single management hub; drop topbar + table duplicates"
```

---

### Task 3: Budget health-bar (accent/amber/red)

**Files:**
- Modify: `frontend/js/domain/tx-group.js:78-86` (budgetState colors)
- Modify: `frontend/js/domain/tx-group.test.js` (add color assertions)
- Modify: `frontend/js/screens/dashboard.js` CategoryRow (~409-410 bar markup)
- Modify: `docs/DESIGN.md` (note the budget-bar color triad)
- Modify: `frontend/index.html` (bump `?v=` for tx-group.js, dashboard.js)

**Interfaces:**
- Consumes: `budgetState(spent, budget)` → `{ ratio, color, over }`.
- Produces: `budgetState` returns `over: boolean` (ratio > 1) and `color` ∈ {`var(--accent)`, `var(--warn)`, `var(--neg)`}.

- [ ] **Step 1: Write the failing test**

In `frontend/js/domain/tx-group.test.js`, add:

```js
test("budgetState: color triad is accent/warn/neg, never green", () => {
  const { budgetState } = require("./tx-group.js");
  assert.equal(budgetState(50, 100).color, "var(--accent)");   // 50% under control
  assert.equal(budgetState(85, 100).color, "var(--warn)");     // 85% warning
  assert.equal(budgetState(120, 100).color, "var(--neg)");     // 120% over
  assert.equal(budgetState(120, 100).over, true);
  assert.equal(budgetState(50, 100).over, false);
  assert.equal(budgetState(0, 0), null);                        // no budget
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test ../frontend/js/domain/tx-group.test.js`
Expected: FAIL — current `<0.8` color is `var(--fg-2)`, and `over` is undefined.

- [ ] **Step 3: Update budgetState**

Replace `tx-group.js:78-86`:

```js
function budgetState(spent, budget) {
  if (budget == null || budget <= 0) return null;
  const ratio = spent / budget;
  return {
    ratio,
    over: ratio > 1,
    color: ratio > 1 ? "var(--neg)" : ratio >= 0.8 ? "var(--warn)" : "var(--accent)",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test ../frontend/js/domain/tx-group.test.js`
Expected: PASS.

- [ ] **Step 5: Upgrade the CategoryRow bar**

Replace the bar markup in `dashboard.js` CategoryRow (`~409-410`):

```js
st && h("div", { style: { position: "relative", height: 8, background: "var(--bg-2)", border: "1px solid var(--line-1)", overflow: "hidden" } },
  h("div", { style: { width: Math.min(100, st.ratio * 100) + "%", height: "100%", background: st.color, transition: "width 0.2s" } }),
  st.over && h("div", { className: "dither-neg", style: { position: "absolute", inset: 0, opacity: 0.35, pointerEvents: "none" } })),
```

(`.dither-neg` already exists in `pixel.css`; the overflow overlay is the "estourado" cue, static so it respects reduced-motion.)

- [ ] **Step 6: Document the exception**

In `docs/DESIGN.md`, under the budget-progress note, add: "A health-bar de orçamento no card usa **accent (<80%) · warn (80–100%) · neg (>100%)** — nunca verde. Verde segue exclusivo de receita."

- [ ] **Step 7: Full suite + browser check + commit**

Run: `cd backend && npm test` — Expected: all pass. Bump `?v=`, reload, confirm a category with a target shows a taller colored bar; over-budget shows the red dithered overflow.

```bash
git add frontend/js/domain/tx-group.js frontend/js/domain/tx-group.test.js frontend/js/screens/dashboard.js docs/DESIGN.md frontend/index.html
git commit -m "feat(categories): budget health-bar (accent/warn/neg, overflow cue)"
```

---

### Task 4: `normalizeMerchant` pure helper

**Files:**
- Create: `backend/src/domain/merchant.ts`
- Test: `backend/src/domain/merchant.test.ts`

**Interfaces:**
- Produces: `export function normalizeMerchant(desc: string): string` — returns a lowercased core substring of the description (prefixes and trailing city/UF stripped), or `""` when nothing distinctive remains. The result MUST be a substring of `desc.toLowerCase()` so the existing rules suggestion (`hay.includes(matcher)`) matches.

- [ ] **Step 1: Write the failing test**

Create `backend/src/domain/merchant.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchant } from "./merchant.ts";

test("strips PIX/transfer prefixes, keeps the merchant core", () => {
  assert.equal(normalizeMerchant("Pix enviado: Cp :10573521-PIX Marketplace"), "pix marketplace");
  assert.equal(normalizeMerchant("Transferência enviada pelo Pix - IFOOD.COM AGENCIA"), "ifood.com agencia");
});

test("strips trailing city/UF, keeps the store name", () => {
  assert.equal(normalizeMerchant("POSTO SOL COSTA AZUL SALVADOR BRA"), "posto sol costa azul");
  assert.equal(normalizeMerchant("G BARBOSA 35 SALVADOR BRA"), "g barbosa 35");
});

test("result is always a substring of the lowercased input", () => {
  for (const d of ["Pix enviado: Cp :1-DECATHLON SALVADOR BRA", "MAMMA JAMMA SALVADOR BRA"]) {
    assert.ok(d.toLowerCase().includes(normalizeMerchant(d)), `"${normalizeMerchant(d)}" must be in "${d.toLowerCase()}"`);
  }
});

test("blank/degenerate input → empty string", () => {
  assert.equal(normalizeMerchant(""), "");
  assert.equal(normalizeMerchant("   "), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/domain/merchant.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `backend/src/domain/merchant.ts`:

```ts
// Reduz uma descrição de extrato ao "núcleo" do comerciante — usado como matcher
// da regra nome→categoria. O resultado é SEMPRE substring da descrição minúscula,
// porque a sugestão (routes) casa via hay.includes(matcher).
const PREFIXES = [
  /^pix enviado:\s*cp\s*:\d+-/i,
  /^pix enviado:\s*\d+\s+\d+\s+/i,
  /^transferência enviada pelo pix\s*-\s*/i,
  /^transferência enviada\s*-\s*/i,
  /^pagamento de boleto efetuado\s*-\s*/i,
];
const TRAIL = /\s+(salvador|sao paulo|são paulo|contagem|salto|simoes filho|simões filho|brasilia|brasília|rio de janeiro)\b.*$/i;
const TRAIL_UF = /\s+bra$/i;

export function normalizeMerchant(desc: string): string {
  let s = String(desc || "").trim();
  if (!s) return "";
  for (const re of PREFIXES) s = s.replace(re, "");
  s = s.replace(TRAIL_UF, "");
  s = s.replace(TRAIL, "");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/domain/merchant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/merchant.ts backend/src/domain/merchant.test.ts
git commit -m "feat(recognition): normalizeMerchant pure helper (substring-safe matcher)"
```

---

### Task 5: Learn on categorize — upsert category rule

**Files:**
- Modify: `backend/src/routes/transactions.ts` (patchTransaction ~119-135, bulkCategorize ~188-195) — add rule upsert after setting category_id
- Modify: `backend/src/routes/import.ts` (suggestCategory ~90-93) — also consult rules
- Test: `backend/src/routes/transactions.test.ts` (add learn+suggest e2e; create file if absent)

**Interfaces:**
- Consumes: `normalizeMerchant` from Task 4.
- Produces: helper `learnCategoryRule(db, description, categoryId)` that upserts a `rules` row (`action='category'`, `matcher`=normalized, `value`=String(categoryId), `priority`=50, `enabled`=1). Idempotent per matcher (updates value if the matcher already has a category rule).

- [ ] **Step 1: Write the failing test**

Create/extend `backend/src/routes/transactions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { learnCategoryRule } from "./transactions.ts";

function db0(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, match_field TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER DEFAULT 1);`);
  return db;
}

test("learnCategoryRule inserts a category rule from the merchant core", () => {
  const db = db0();
  learnCategoryRule(db, "POSTO SOL COSTA AZUL SALVADOR BRA", 7);
  const r = db.prepare("SELECT matcher, action, value FROM rules WHERE action='category'").get() as any;
  assert.equal(r.matcher, "posto sol costa azul");
  assert.equal(r.value, "7");
});

test("learnCategoryRule updates the value when the same merchant is re-categorized", () => {
  const db = db0();
  learnCategoryRule(db, "MAMMA JAMMA SALVADOR BRA", 3);
  learnCategoryRule(db, "MAMMA JAMMA SALVADOR BRA", 9);
  const rows = db.prepare("SELECT value FROM rules WHERE action='category' AND matcher='mamma jamma'").all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, "9");
});

test("learnCategoryRule ignores a blank merchant core", () => {
  const db = db0();
  learnCategoryRule(db, "   ", 4);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM rules").get() as any).n, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/routes/transactions.test.ts`
Expected: FAIL — `learnCategoryRule` not exported.

- [ ] **Step 3: Implement and wire the helper**

In `backend/src/routes/transactions.ts`, add the import at top and export the helper:

```ts
import { normalizeMerchant } from "../domain/merchant.ts";

export function learnCategoryRule(db: DatabaseSync, description: string, categoryId: number): void {
  const matcher = normalizeMerchant(description);
  if (!matcher || categoryId == null) return;
  const existing = db.prepare("SELECT id FROM rules WHERE action='category' AND matcher=?").get(matcher) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE rules SET value=?, enabled=1 WHERE id=?").run(String(categoryId), existing.id);
  } else {
    db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES (?, 'category', ?, 50, 1)")
      .run(matcher, String(categoryId));
  }
}
```

In `patchTransaction`, after the `UPDATE transactions … category_id` succeeds and `category_id` was in the body and non-null, look up the row's description and call `learnCategoryRule(db, row.description, Number(v))`. (Fetch `display_name, description` for the id; prefer `display_name ?? description`.)

In `bulkCategorize` (~188-195), after the bulk `UPDATE`, load `SELECT display_name, description FROM transactions WHERE id IN (...)` and call `learnCategoryRule` for each with the body's `category_id`.

- [ ] **Step 4: Make import consult rules too**

In `backend/src/routes/import.ts`, extend `suggestCategory(desc, flow)` to fall back to rules when the exact-description match misses:

```ts
const ruleStmt = db.prepare("SELECT value, matcher FROM rules WHERE action='category' AND enabled=1 ORDER BY priority ASC, id ASC");
const suggestCategory = (desc: string, flow: string): number | null => {
  const exact = suggestStmt.get(desc, flow) as { category_id: number } | undefined;
  if (exact) return exact.category_id;
  const hay = String(desc || "").toLowerCase();
  const rule = (ruleStmt.all() as any[]).find(r => hay.includes(String(r.matcher).toLowerCase()));
  return rule ? Number(rule.value) : null;
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test src/routes/transactions.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + commit**

Run: `cd backend && npm test` — Expected: all pass (existing month-transactions suggestion now has data to match).

```bash
git add backend/src/routes/transactions.ts backend/src/routes/import.ts backend/src/routes/transactions.test.ts
git commit -m "feat(recognition): learn merchant→category rule on categorize; import consults rules"
```

---

### Task 6: Suggestion chip + orphan-rule cleanup on delete

**Files:**
- Modify: `frontend/js/ui/primitives.js` TxRow category cell (the inline `<select>`/`.data-tag` area ~512-544) — show a "sugerido" chip when `suggested_category_id` present and `category_id` empty; clicking accepts it (PATCH).
- Modify: `backend/src/routes/categories.ts` (deleteCategory) — delete orphan `rules` whose `value` was the removed category id.
- Test: `backend/src/routes/categories.test.ts` (orphan-rule cleanup; create if absent)
- Modify: `frontend/index.html` (bump `?v=` for primitives.js)

**Interfaces:**
- Consumes: `t.suggested_category_id`, `t.suggested_category_name` (already on the payload from Task 5's data + existing routes), `patchTransactionCategory(id, categoryId)` from `core/api.js` (reuse the existing category-PATCH client fn used by the inline select).

- [ ] **Step 1: Write the failing test (backend orphan cleanup)**

Create/extend `backend/src/routes/categories.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { deleteOrphanCategoryRules } from "./categories.ts";

test("deleteOrphanCategoryRules removes category rules pointing at a deleted category", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE rules (id INTEGER PRIMARY KEY, matcher TEXT, action TEXT, value TEXT, priority INTEGER, enabled INTEGER)");
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('posto x','category','7',50,1)").run();
  db.prepare("INSERT INTO rules (matcher, action, value, priority, enabled) VALUES ('mercado y','category','9',50,1)").run();
  deleteOrphanCategoryRules(db, 7);
  const left = db.prepare("SELECT value FROM rules WHERE action='category'").all() as any[];
  assert.deepEqual(left.map(r => r.value), ["9"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/routes/categories.test.ts`
Expected: FAIL — `deleteOrphanCategoryRules` not exported.

- [ ] **Step 3: Implement + wire into delete**

In `backend/src/routes/categories.ts`, add and export:

```ts
export function deleteOrphanCategoryRules(db: DatabaseSync, categoryId: number): void {
  db.prepare("DELETE FROM rules WHERE action='category' AND value=?").run(String(categoryId));
}
```

Call it inside the existing category-delete handler, right after the category row is deleted (same transaction/flow), passing the deleted id.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test src/routes/categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the "sugerido" chip in TxRow**

In `primitives.js` TxRow, in the category cell: when `t.category_id == null && t.suggested_category_id != null`, render (next to the inline select) a small clickable chip:

```js
t.category_id == null && t.suggested_category_id != null && React.createElement("button", {
  className: "px-chip", title: `Sugerido pelo nome do gasto — clique para aplicar`,
  style: { cursor: "pointer", color: "var(--accent)", borderColor: "var(--accent)" },
  onClick: () => onEditCategory && onEditCategory(t.id, t.suggested_category_id),
}, `sugerido: ${t.suggested_category_name}`)
```

Reuse the same `onEditCategory(id, categoryId)` path the inline select already calls to PATCH the category (verify its signature in TxRow's props and match it). Accepting the chip PATCHes, which re-runs Task 5's learn (reinforcing the rule).

- [ ] **Step 6: Full suite + browser check + commit**

Run: `cd backend && npm test` — Expected: all pass. Bump `?v=`, reload: categorize a merchant, then a new uncategorized row from the same merchant shows a "sugerido: <cat>" chip; clicking it sets the category. Delete a category in the overlay → its learned rules stop suggesting.

```bash
git add backend/src/routes/categories.ts backend/src/routes/categories.test.ts frontend/js/ui/primitives.js frontend/index.html
git commit -m "feat(recognition): suggestion chip in the ledger + orphan-rule cleanup on delete"
```

---

## Self-Review

**Spec coverage:**
- C (6 macro + migration) → Task 1. ✓
- A (card hub, drop topbar + table dup) → Task 2. ✓
- B (health-bar accent/warn/neg) → Task 3. ✓
- D (recognition: normalize + learn + suggest) → Tasks 4, 5, 6. ✓
- E (create/delete revisado + orphan-rule cleanup) → Task 2 (create via card), Task 6 (delete cleanup); delete-with-reassign already exists and is unchanged. ✓

**Placeholder scan:** No TBD/TODO; migration number 0002 is concrete; all code shown.

**Type consistency:** `normalizeMerchant(desc): string` used identically in Tasks 4/5. `learnCategoryRule(db, description, categoryId)` defined Task 5, not re-signed elsewhere. `budgetState → {ratio, over, color}` consumed by CategoryRow in Task 3. `deleteOrphanCategoryRules(db, categoryId)` Task 6.

**Open verification points for the implementer:**
- Task 2: confirm the exact prop name DashboardView passes to CategoriesWidget and that app.js renders DashboardView with the new callback.
- Task 5: confirm `patchTransaction`'s variable for the loaded row and that it has `description`/`display_name`.
- Task 6: confirm `onEditCategory`'s real signature in TxRow before wiring the chip.
