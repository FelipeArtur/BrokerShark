# Test Net + CSRF Fix + Backfill Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os dois P0 da auditoria (backfill destrói dados da UI; CSRF por falta de check de Origin) e estabelecer a rede de testes (`node:test`) que faltava.

**Architecture:** TDD com o runner nativo `node:test` (zero deps, type-stripping nativo do Node 26). Segurança: `originAllowed()` puro em `security.ts`, aplicado no server para métodos de escrita. Backfill: guarda pura `hasUserOverlay()` que aborta o rebuild destrutivo quando há dados escritos pela UI (a menos de `--force`).

**Tech Stack:** TypeScript sobre Node ≥26 (sem build), `node:sqlite`, `node:test`, `node:http`.

## Global Constraints

- Node ≥ 26, native type-stripping, **sem build step**. Rodar tudo de `backend-ts/`.
- **Zero novas dependências npm** (só `xlsx` já existe). Testes = `node:test` builtin.
- Dinheiro sempre em **centavos inteiros**; nunca float no ledger.
- Testes co-locados: `src/**/<nome>.test.ts`. Script: `node --test "src/**/*.test.ts"`.
- Comando de teste verificado neste ambiente: `.ts` com type-strip nativo passa (sem flag).
- Mensagens de erro/CLI em pt-BR (segue o código existente).

---

### Task 1: Rede de testes + domínio `money`

**Files:**
- Modify: `backend-ts/package.json` (adicionar script `test`)
- Test: `backend-ts/src/domain/money.test.ts`

**Interfaces:**
- Consumes: `parseMoneyCents(raw: string): number`, `parseDateBR(raw: string): string` de `src/domain/money.ts`.
- Produces: script `npm test` → `node --test "src/**/*.test.ts"`.

- [ ] **Step 1: Escrever o teste que falha**

Create `backend-ts/src/domain/money.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoneyCents, parseDateBR } from "./money.ts";

test("parseMoneyCents: formato BR (vírgula decimal, ponto de milhar)", () => {
  assert.equal(parseMoneyCents("1.234,56"), 123456);
  assert.equal(parseMoneyCents("-50,00"), -5000);
  assert.equal(parseMoneyCents("0,01"), 1);
});

test("parseMoneyCents: formato com ponto decimal (extrato Nubank)", () => {
  assert.equal(parseMoneyCents("-50.00"), -5000);
});

test("parseDateBR: DD/MM/YYYY → ISO", () => {
  assert.equal(parseDateBR("01/03/2026"), "2026-03-01");
  assert.equal(parseDateBR("31/12/2025"), "2025-12-31");
});
```

- [ ] **Step 2: Adicionar o script de teste**

In `backend-ts/package.json`, dentro de `"scripts"`, adicionar a linha `test` (manter as existentes):
```json
  "scripts": {
    "start": "node src/server.ts",
    "backfill": "node src/jobs/backfill.ts",
    "test": "node --test \"src/**/*.test.ts\""
  },
```

- [ ] **Step 3: Rodar e confirmar que passa**

Run (de `backend-ts/`): `npm test`
Expected: `pass 3` (as três asserções de `money.test.ts`), `fail 0`.

> Nota: se `parseMoneyCents("-50.00")` falhar, o parser não aceita ponto decimal — reporte antes de "corrigir"; o smoke test do import Nubank já exercitou esse caminho com sucesso, então a expectativa é passar.

- [ ] **Step 4: Commit**

```bash
git add backend-ts/package.json backend-ts/src/domain/money.test.ts
git commit -m "test(domain): rede node:test + cobertura de money"
```

---

### Task 2: Domínio `classify` + `dates`

**Files:**
- Test: `backend-ts/src/domain/classify.test.ts`
- Test: `backend-ts/src/domain/dates.test.ts`

**Interfaces:**
- Consumes: `isInvestment(desc)`, `isCaixinhaLeg(desc, bank)`, `checkingExpenseMethod(desc)` de `src/domain/classify.ts`; `monthRange(month, year)` de `src/domain/dates.ts`.

- [ ] **Step 1: Escrever `classify.test.ts` (falha)**

Create `backend-ts/src/domain/classify.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isInvestment, isCaixinhaLeg, checkingExpenseMethod } from "./classify.ts";

test("isInvestment: keywords de investimento", () => {
  assert.equal(isInvestment("Aplicacao RDB"), true);
  assert.equal(isInvestment("Resgate Tesouro"), true);
  assert.equal(isInvestment("Compra PADARIA"), false);
});

test("isCaixinhaLeg: só Nubank, exclui corretora", () => {
  assert.equal(isCaixinhaLeg("Aplicacao RDB", "nubank"), true);
  assert.equal(isCaixinhaLeg("Aplicacao RDB", "inter"), false);      // banco errado
  assert.equal(isCaixinhaLeg("NuInvest Tesouro", "nubank"), false);  // corretora excluída
});

test("checkingExpenseMethod: método por descrição", () => {
  assert.equal(checkingExpenseMethod("PIX enviado para Maria"), "pix");
  assert.equal(checkingExpenseMethod("Pagamento de fatura"), "credit");
  assert.equal(checkingExpenseMethod("Compra no debito"), "debit");
});
```

- [ ] **Step 2: Escrever `dates.test.ts` (falha)**

Create `backend-ts/src/domain/dates.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthRange } from "./dates.ts";

test("monthRange: primeiro e último dia ISO", () => {
  assert.deepEqual(monthRange(2, 2026), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(monthRange(12, 2025), { start: "2025-12-01", end: "2025-12-31" });
});
```

- [ ] **Step 3: Rodar e confirmar que passam**

Run: `npm test`
Expected: total `pass 6` (3 de money + 3 novos), `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add backend-ts/src/domain/classify.test.ts backend-ts/src/domain/dates.test.ts
git commit -m "test(domain): cobertura de classify e dates"
```

---

### Task 3: Golden tests dos parsers de extrato

**Files:**
- Test: `backend-ts/src/ingest/nubankExtrato.test.ts`
- Test: `backend-ts/src/ingest/interExtrato.test.ts`

**Interfaces:**
- Consumes: `parseNubankExtrato(text, sourceFile): ParsedFile`; `parseInterExtrato(text, sourceFile): InterParsed`. Ambos aceitam o CSV como **string** (sem arquivo em disco).

- [ ] **Step 1: Escrever `nubankExtrato.test.ts` (falha)**

Create `backend-ts/src/ingest/nubankExtrato.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNubankExtrato } from "./nubankExtrato.ts";

test("Nubank: parse, sinal e classificação de perna Caixinha", () => {
  const csv = [
    "Data,Valor,Identificador,Descrição",
    "01/03/2026,-50.00,uuid-1,Compra PADARIA",
    "02/03/2026,-200.00,uuid-2,Aplicacao RDB",
    "05/03/2026,1000.00,uuid-3,Transferencia recebida pelo Pix",
  ].join("\n");
  const p = parseNubankExtrato(csv, "nu.csv");

  assert.equal(p.records.length, 3);

  const padaria = p.records[0];
  assert.equal(padaria.amountCents, 5000);
  assert.equal(padaria.flow, "expense");
  assert.equal(padaria.externalId, "uuid-1");

  const rdb = p.records[1];
  assert.equal(rdb.isCaixinhaLeg, true);
  assert.equal(rdb.method, "transfer");

  const pix = p.records[2];
  assert.equal(pix.flow, "income");
  assert.equal(pix.isRevenue, 1);
});
```

- [ ] **Step 2: Escrever `interExtrato.test.ts` (falha)**

Create `backend-ts/src/ingest/interExtrato.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInterExtrato } from "./interExtrato.ts";

test("Inter: preâmbulo, ponto-e-vírgula, saldo de abertura derivado", () => {
  const csv = [
    "Extrato Conta", ";;;", ";;;", ";;;",
    "Data Lançamento;Descrição;Valor;Saldo",
    "03/03/2026;PIX ENVIADO MARIA;-30,00;970,00",
  ].join("\n");
  const p = parseInterExtrato(csv, "inter.csv");

  assert.equal(p.records.length, 1);
  const r = p.records[0];
  assert.equal(r.amountCents, 3000);
  assert.equal(r.flow, "expense");
  assert.equal(r.accountId, "inter-db");
  // saldo de abertura = primeiro saldo − primeiro valor = 970 − (−30) = 1000
  assert.equal(p.openingBalanceCents, 100000);
});
```

- [ ] **Step 3: Rodar e confirmar que passam**

Run: `npm test`
Expected: total `pass 8`, `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add backend-ts/src/ingest/nubankExtrato.test.ts backend-ts/src/ingest/interExtrato.test.ts
git commit -m "test(ingest): golden tests dos parsers Nubank e Inter"
```

---

### Task 4: `originAllowed()` — defesa CSRF (função pura)

**Files:**
- Modify: `backend-ts/src/http/security.ts` (adicionar `originAllowed`)
- Test: `backend-ts/src/http/security.test.ts`

**Interfaces:**
- Consumes: `ALLOWED_HOSTNAMES` (Set já existente no módulo), tipo `Req`.
- Produces: `originAllowed(req: Req): boolean` — `true` se `Origin` ausente (não-browser/same-origin) ou hostname em localhost; `false` se `Origin` presente e externo/inválido.

- [ ] **Step 1: Escrever o teste que falha**

Create `backend-ts/src/http/security.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { originAllowed } from "./security.ts";

const req = (origin?: string) => ({ headers: origin ? { origin } : {} }) as any;

test("originAllowed: sem Origin (curl / same-origin GET) permite", () => {
  assert.equal(originAllowed(req()), true);
});

test("originAllowed: localhost/127.0.0.1 permite (qualquer porta)", () => {
  assert.equal(originAllowed(req("http://127.0.0.1:8000")), true);
  assert.equal(originAllowed(req("http://localhost:3000")), true);
});

test("originAllowed: origem externa bloqueia", () => {
  assert.equal(originAllowed(req("https://evil.com")), false);
});

test("originAllowed: Origin malformado bloqueia", () => {
  assert.equal(originAllowed(req("not-a-url")), false);
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test`
Expected: FAIL — `originAllowed` não é exportado (erro de import / `is not a function`).

- [ ] **Step 3: Implementar `originAllowed`**

In `backend-ts/src/http/security.ts`, adicionar após a função `hostAllowed`:
```ts
/**
 * Defesa CSRF: sem auth, o adversário é uma página maliciosa no browser do
 * usuário. `readBody` ignora Content-Type, então POSTs de escrita são
 * atingíveis como "simple request". Rejeitamos escrita quando o Origin está
 * presente e não é localhost. Origin ausente = não-browser (curl, backfill)
 * ou GET same-origin — o allowlist de Host já cobre esse caso.
 */
export function originAllowed(req: Req): boolean {
  const origin = req.headers.origin;
  if (origin == null) return true;
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: total `pass 12`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend-ts/src/http/security.ts backend-ts/src/http/security.test.ts
git commit -m "feat(security): originAllowed — defesa CSRF por allowlist de Origin"
```

---

### Task 5: Aplicar o check de Origin no server (escrita)

**Files:**
- Modify: `backend-ts/src/server.ts` (import + guarda para métodos != GET/HEAD)

**Interfaces:**
- Consumes: `originAllowed` de `./http/security.ts`.

- [ ] **Step 1: Importar `originAllowed`**

In `backend-ts/src/server.ts`, na linha de import de security, adicionar `originAllowed`:
```ts
import { hostAllowed, securityHeaders, originAllowed } from "./http/security.ts";
```

- [ ] **Step 2: Aplicar a guarda antes do dispatch**

In `backend-ts/src/server.ts`, dentro do `try` do request handler, logo após `securityHeaders(res);`, adicionar:
```ts
    // CSRF: escrita só de origem localhost (GET/HEAD são idempotentes/leitura)
    if (method !== "GET" && method !== "HEAD" && !originAllowed(req)) {
      return error(res, "origin não permitido", 403);
    }
```

- [ ] **Step 3: Verificação de integração (server real)**

Iniciar o server contra um DB de teste em background e checar com curl.

Preparar (de `backend-ts/`), usando o helper de DB de teste do scratchpad se disponível, ou um DB existente em `data/`:
```bash
node src/server.ts --port 8123 data/brokershark-v2.db > /tmp/bs-origin.log 2>&1 &
sleep 1
# 1) escrita com Origin externo → 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Origin: https://evil.com" -H "Content-Type: application/json" \
  -d '{"name":"x","flow":"expense"}' http://127.0.0.1:8123/api/categories
# 2) escrita sem Origin (curl) → NÃO 403 (200/400 do handler)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"","flow":"expense"}' http://127.0.0.1:8123/api/categories
# 3) leitura GET com Origin externo → não bloqueada
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.com" \
  http://127.0.0.1:8123/api/accounts
kill %1
```
Expected:
- (1) `403`
- (2) `400` (handler rejeita nome vazio) — **não** 403
- (3) `200`

> Se não houver DB em `data/`, criar um DB de esquema+seeds antes (ver `db/open.ts` `initSchema` + `jobs/backfill/seeds.ts` `seedAccountsAndCategories`), ou rodar contra o DB de teste do scratchpad.

- [ ] **Step 4: Commit**

```bash
git add backend-ts/src/server.ts
git commit -m "feat(security): aplicar originAllowed nas escritas (CSRF)"
```

---

### Task 6: Cap de partes no multipart (SEC-3) + torná-lo testável

**Files:**
- Modify: `backend-ts/src/http/multipart.ts` (extrair `splitMultipart` puro + `MAX_PARTS`)
- Test: `backend-ts/src/http/multipart.test.ts`

**Interfaces:**
- Produces: `splitMultipart(body: Buffer, boundary: string, maxParts?: number): Part[]` — puro, lança `HttpError(413)` se exceder `maxParts`.
- `parseMultipart` passa a ler o stream e delegar a `splitMultipart`.

- [ ] **Step 1: Escrever o teste que falha**

Create `backend-ts/src/http/multipart.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMultipart } from "./multipart.ts";

const BOUNDARY = "X";
function bodyWith(nParts: number): Buffer {
  let s = "";
  for (let i = 0; i < nParts; i++) {
    s += `--${BOUNDARY}\r\n`;
    s += `Content-Disposition: form-data; name="f${i}"\r\n\r\n`;
    s += `v${i}\r\n`;
  }
  s += `--${BOUNDARY}--\r\n`;
  return Buffer.from(s, "utf-8");
}

test("splitMultipart: extrai campos nomeados", () => {
  const parts = splitMultipart(bodyWith(2), BOUNDARY);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].name, "f0");
  assert.equal(parts[0].data.toString("utf-8"), "v0");
});

test("splitMultipart: excesso de partes lança 413", () => {
  assert.throws(() => splitMultipart(bodyWith(5), BOUNDARY, 4), /413|partes|arquivos/i);
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test`
Expected: FAIL — `splitMultipart` não exportado.

- [ ] **Step 3: Refatorar `multipart.ts` extraindo `splitMultipart`**

In `backend-ts/src/http/multipart.ts`, adicionar a constante perto de `MAX_UPLOAD_BYTES`:
```ts
const MAX_PARTS = 64; // extrato + fatura + B3 num drop normal é << 64
```

Substituir a função `parseMultipart` existente por esta dupla (o corpo do laço vira `splitMultipart`):
```ts
/** Fatia um corpo multipart já em memória (puro, testável). */
export function splitMultipart(body: Buffer, boundary: string, maxParts = MAX_PARTS): Part[] {
  const delim = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];

  let idx = body.indexOf(delim);
  while (idx >= 0) {
    const start = idx + delim.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break; // "--" final
    const next = body.indexOf(delim, start);
    if (next < 0) break;
    const seg = body.subarray(start, next - 2); // remove o CRLF antes da próxima boundary
    const headEnd = seg.indexOf("\r\n\r\n");
    if (headEnd >= 0) {
      const rawHead = seg.subarray(0, headEnd).toString("utf-8");
      const data = seg.subarray(headEnd + 4);
      const cd = /content-disposition:[^\r\n]*/i.exec(rawHead)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(cd)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(cd)?.[1];
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(rawHead)?.[1]?.trim();
      if (name != null) {
        if (parts.length >= maxParts) throw new HttpError(413, "arquivos demais");
        parts.push({ name, filename, contentType, data });
      }
    }
    idx = next;
  }
  return parts;
}

/** Lê o corpo multipart do stream e o fatia em partes nomeadas. */
export async function parseMultipart(req: Req): Promise<Part[]> {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(400, "esperado multipart/form-data");
  }
  const body = await readRaw(req);
  return splitMultipart(body, boundaryOf(req));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: total `pass 14`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add backend-ts/src/http/multipart.ts backend-ts/src/http/multipart.test.ts
git commit -m "feat(http): cap de partes no multipart + splitMultipart testável (SEC-3)"
```

---

### Task 7: Guarda anti-perda-de-dados no backfill (P0-A)

**Files:**
- Create: `backend-ts/src/jobs/backfill/guard.ts`
- Test: `backend-ts/src/jobs/backfill/guard.test.ts`
- Modify: `backend-ts/src/jobs/backfill.ts` (checar a guarda antes do `rmSync`)

**Interfaces:**
- Produces: `hasUserOverlay(db: DatabaseSync): boolean` — `true` se o DB contém dados escritos pela UI (lançamento manual/edições/importações incrementais) que um rebuild destruiria.

- [ ] **Step 1: Escrever o teste que falha**

Create `backend-ts/src/jobs/backfill/guard.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { seedAccountsAndCategories } from "./seeds.ts";
import { hasUserOverlay } from "./guard.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  seedAccountsAndCategories(db);
  return db;
}

test("hasUserOverlay: DB recém-semeado (sem edições) = false", () => {
  const db = freshDb();
  assert.equal(hasUserOverlay(db), false);
});

test("hasUserOverlay: transação importada pela UI = true", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, import_batch_id)
    VALUES ('2026-03-01','expense','pix','nu-db',1000,'x','sess-1')`).run();
  assert.equal(hasUserOverlay(db), true);
});

test("hasUserOverlay: apelido editado pela UI = true", () => {
  const db = freshDb();
  db.prepare(`INSERT INTO transactions
    (date, flow, method, account_id, amount_cents, description, display_name)
    VALUES ('2026-03-01','expense','pix','nu-db',1000,'x','Almoço')`).run();
  assert.equal(hasUserOverlay(db), true);
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test`
Expected: FAIL — módulo `guard.ts` não existe.

- [ ] **Step 3: Implementar `guard.ts`**

Create `backend-ts/src/jobs/backfill/guard.ts`:
```ts
/** guard.ts — detecta dados escritos pela UI que um rebuild destruiria.
 *
 *  O backfill reconstrói o DB do zero. Depois que a UI passou a escrever
 *  (lançamento manual, edições, import incremental), um rebuild silencioso
 *  apagaria tudo isso. Esta guarda deixa o orquestrador abortar (a menos de
 *  --force) quando há overlay do usuário.
 */
import type { DatabaseSync } from "node:sqlite";

export function hasUserOverlay(db: DatabaseSync): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE import_batch_id IS NOT NULL
       OR display_name IS NOT NULL
       OR is_third_party = 1
  `).get() as { n: number };
  return row.n > 0;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: total `pass 17`, `fail 0`.

- [ ] **Step 5: Ligar a guarda no orquestrador**

In `backend-ts/src/jobs/backfill.ts`:

(a) Adicionar imports no topo (junto aos outros `node:` / locais):
```ts
import { existsSync } from "node:fs";
import { hasUserOverlay } from "./backfill/guard.ts";
```
(`rmSync` já é importado de `node:fs`; adicionar `existsSync` ao mesmo import se preferir uma linha só.)

(b) Trocar o parsing dos args para tolerar `--force`. Substituir:
```ts
const acervoDir = process.argv[2];
const dbPath = process.argv[3] ?? join(import.meta.dirname, "../../../data/brokershark-v2.db");
```
por:
```ts
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");
const acervoDir = positional[0];
const dbPath = positional[1] ?? join(import.meta.dirname, "../../../data/brokershark-v2.db");
```

(c) Inserir a guarda imediatamente ANTES da linha do `rmSync`:
```ts
if (existsSync(dbPath) && !force) {
  const existing = openDb(dbPath);
  const overlay = hasUserOverlay(existing);
  existing.close();
  if (overlay) {
    console.error(
      "Abortado: o DB tem dados escritos pela UI (edições/lançamentos/importações).\n" +
      "Um rebuild apagaria tudo. Use --force para reconstruir mesmo assim,\n" +
      "ou importe novos meses pela UI (import incremental).",
    );
    process.exit(1);
  }
}
```

- [ ] **Step 6: Verificação de integração (CLI)**

Testar que a guarda aborta e que `--force` passa. Usar um DB descartável.
```bash
cd backend-ts
# cria DB mínimo com overlay: schema+seeds + 1 tx importada
node -e '
const {DatabaseSync}=require("node:sqlite");
const {initSchema}=require("./src/db/open.ts");
const {seedAccountsAndCategories}=require("./src/jobs/backfill/seeds.ts");
const db=new DatabaseSync("/tmp/bs-guard.db"); db.exec("PRAGMA foreign_keys=ON");
initSchema(db); seedAccountsAndCategories(db);
db.prepare("INSERT INTO transactions (date,flow,method,account_id,amount_cents,description,import_batch_id) VALUES (?,?,?,?,?,?,?)").run("2026-03-01","expense","pix","nu-db",1000,"x","sess-1");
db.close();'
# sem --force → aborta (exit 1) e NÃO apaga
node src/jobs/backfill.ts /diretorio/inexistente /tmp/bs-guard.db; echo "exit=$?"
ls -la /tmp/bs-guard.db   # ainda existe
```
Expected: mensagem "Abortado: o DB tem dados escritos pela UI…", `exit=1`, arquivo `/tmp/bs-guard.db` ainda presente.
(`node -e` com require de `.ts`: se falhar por ESM, criar o DB via um pequeno `.ts` no scratchpad usando `import` — o objetivo é só semear o overlay.)

- [ ] **Step 7: Commit**

```bash
git add backend-ts/src/jobs/backfill/guard.ts backend-ts/src/jobs/backfill/guard.test.ts backend-ts/src/jobs/backfill.ts
git commit -m "feat(backfill): guarda anti-perda-de-dados (aborta rebuild com overlay; --force) (P0-A)"
```

---

### Task 8: Review da estratégia de investimentos na pipeline (backfill verify)

**Files:**
- Create: `backend-ts/src/jobs/backfill/investReview.ts`
- Test: `backend-ts/src/jobs/backfill/investReview.test.ts`
- Modify: `backend-ts/src/jobs/backfill/verify.ts` (import + bloco de review antes do fecho de `printReport`)

**Interfaces:**
- Produces: `reviewInvestments(db: DatabaseSync): { violations: string[]; panorama: InvestPanorama }`.
  - `InvestPanorama = { totalCents: number; byType: {type,cents,pct}[]; topConcentration: {name,pct}|null; bySource: {source,count}[] }`.
- Consumes: `initSchema` de `../../db/open.ts` (só no teste).

- [ ] **Step 1: Escrever o teste que falha**

Create `backend-ts/src/jobs/backfill/investReview.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../../db/open.ts";
import { reviewInvestments } from "./investReview.ts";

function db0(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  initSchema(db);
  return db;
}
const addInv = (db: DatabaseSync, o: any): number => Number(db.prepare(
  "INSERT INTO investments (name, match_key, type, bank, source) VALUES (?,?,?,?,?)",
).run(o.name, o.match_key, o.type, o.bank, o.source).lastInsertRowid);
const addSnap = (db: DatabaseSync, id: number, ref: string, net: number, src = "b3") =>
  db.prepare("INSERT INTO position_snapshots (investment_id, ref_date, net_cents, source) VALUES (?,?,?,?)")
    .run(id, ref, net, src);

test("reviewInvestments: carteira sã → sem violações + panorama", () => {
  const db = db0();
  const t = addInv(db, { name: "Tesouro X", match_key: "b3:tx", type: "tesouro", bank: "tesouro", source: "b3" });
  addSnap(db, t, "2026-03-31", 500000);
  const c = addInv(db, { name: "Caixinha Nubank", match_key: "ledger:caixinha-nubank", type: "rdb", bank: "nubank", source: "ledger" });
  addSnap(db, c, "2026-03-31", 0, "derived");
  const r = reviewInvestments(db);
  assert.deepEqual(r.violations, []);
  assert.equal(r.panorama.totalCents, 500000);
  assert.equal(r.panorama.byType[0].type, "tesouro");
});

test("reviewInvestments: posição ledger não-Caixinha viola", () => {
  const db = db0();
  const p = addInv(db, { name: "Porquinho?", match_key: "ledger:porquinho", type: "cdb", bank: "inter", source: "ledger" });
  addSnap(db, p, "2026-03-31", 1000, "derived");
  assert.ok(reviewInvestments(db).violations.some((v) => /ledger inesperada/.test(v)));
});

test("reviewInvestments: posição aberta sem snapshot viola", () => {
  const db = db0();
  addInv(db, { name: "Sem snap", match_key: "b3:nosnap", type: "acao", bank: "b3", source: "b3" });
  assert.ok(reviewInvestments(db).violations.some((v) => /sem nenhum snapshot/.test(v)));
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test`
Expected: FAIL — módulo `investReview.ts` não existe.

- [ ] **Step 3: Implementar `investReview.ts`**

Create `backend-ts/src/jobs/backfill/investReview.ts`:
```ts
/** investReview.ts — review da estratégia de investimentos na fase verify.
 *  Duas partes: invariantes (violação → backfill aborta) + panorama de alocação.
 */
import type { DatabaseSync } from "node:sqlite";

export interface InvestPanorama {
  totalCents: number;
  byType: { type: string; cents: number; pct: number }[];
  topConcentration: { name: string; pct: number } | null;
  bySource: { source: string; count: number }[];
}
export interface InvestReview { violations: string[]; panorama: InvestPanorama }

export function reviewInvestments(db: DatabaseSync): InvestReview {
  const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as T[];
  const get = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...(p as never[])) as T | undefined;
  const violations: string[] = [];

  // Invariante 1: só a Caixinha é posição derivada (Porquinho é B3, não derivado)
  for (const r of all<{ name: string }>(
    "SELECT name FROM investments WHERE source='ledger' AND match_key != 'ledger:caixinha-nubank'",
  )) violations.push(`posição ledger inesperada "${r.name}" — só a Caixinha deve ser derivada (Porquinho é B3)`);

  // Invariante 2: a Caixinha reconcilia com a soma das pernas
  const cx = get<{ id: number }>("SELECT id FROM investments WHERE match_key='ledger:caixinha-nubank'");
  if (cx) {
    const legs = get<{ s: number }>(
      "SELECT COALESCE(SUM(CASE WHEN flow='expense' THEN amount_cents ELSE -amount_cents END),0) AS s FROM transactions WHERE investment_id=?",
      cx.id,
    )!.s;
    const snap = get<{ net_cents: number }>(
      "SELECT net_cents FROM position_snapshots WHERE investment_id=? AND source='derived' ORDER BY ref_date DESC LIMIT 1",
      cx.id,
    );
    if (snap && snap.net_cents !== legs)
      violations.push(`Caixinha não reconcilia: snapshot ${snap.net_cents} ≠ Σ pernas ${legs}`);
  }

  // Invariante 3: posição aberta sem nenhum snapshot
  for (const r of all<{ name: string }>(
    "SELECT i.name FROM investments i LEFT JOIN position_snapshots ps ON ps.investment_id=i.id WHERE i.closed_at IS NULL AND ps.id IS NULL",
  )) violations.push(`posição aberta "${r.name}" sem nenhum snapshot`);

  // Invariante 4: snapshot com net negativo
  for (const r of all<{ name: string; net_cents: number }>(
    "SELECT i.name, ps.net_cents FROM position_snapshots ps JOIN investments i ON i.id=ps.investment_id WHERE ps.net_cents < 0",
  )) violations.push(`net negativo em "${r.name}": ${r.net_cents}`);

  // Panorama de alocação — posições abertas, último snapshot de cada
  const open = all<{ type: string; name: string; net: number | null }>(`
    SELECT i.type, i.name,
      (SELECT net_cents FROM position_snapshots s WHERE s.investment_id=i.id ORDER BY ref_date DESC LIMIT 1) AS net
    FROM investments i WHERE i.closed_at IS NULL
  `);
  const totalCents = open.reduce((s, r) => s + (r.net ?? 0), 0);
  const pct = (c: number) => (totalCents > 0 ? Math.round((c / totalCents) * 1000) / 10 : 0);
  const byTypeMap = new Map<string, number>();
  for (const r of open) byTypeMap.set(r.type, (byTypeMap.get(r.type) ?? 0) + (r.net ?? 0));
  const byType = [...byTypeMap].map(([type, cents]) => ({ type, cents, pct: pct(cents) }))
    .sort((a, b) => b.cents - a.cents);
  const top = open.filter((r) => r.net != null).sort((a, b) => b.net! - a.net!)[0];
  const topConcentration = top && totalCents > 0 ? { name: top.name, pct: pct(top.net!) } : null;
  const bySource = all<{ source: string; count: number }>(
    "SELECT source, COUNT(*) AS count FROM investments WHERE closed_at IS NULL GROUP BY source",
  );

  return { violations, panorama: { totalCents, byType, topConcentration, bySource } };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test`
Expected: total `pass 20`, `fail 0`.

- [ ] **Step 5: Ligar na fase verify**

In `backend-ts/src/jobs/backfill/verify.ts`:

(a) adicionar o import no topo (junto aos outros):
```ts
import { reviewInvestments } from "./investReview.ts";
```
(b) inserir, dentro de `printReport`, imediatamente ANTES da última `}` que fecha a função (após o bloco "Validação de Invariantes"):
```ts
  const invRev = reviewInvestments(db);
  console.log("\n■ Estratégia de investimentos:");
  console.log(`  Total investido (posições abertas): ${fmtCents(invRev.panorama.totalCents)}`);
  for (const t of invRev.panorama.byType) console.log(`    ${t.type}: ${fmtCents(t.cents)} (${t.pct}%)`);
  if (invRev.panorama.topConcentration)
    console.log(`  Maior concentração: ${invRev.panorama.topConcentration.name} (${invRev.panorama.topConcentration.pct}%)`);
  console.log(`  Posições por fonte: ${invRev.panorama.bySource.map((s) => `${s.source}=${s.count}`).join(", ")}`);
  if (invRev.violations.length) {
    console.error(`  [ERRO] ${invRev.violations.length} violação(ões) de invariante de investimento:`);
    for (const v of invRev.violations) console.error("    - " + v);
    process.exit(1);
  } else {
    console.log("  ✓ Invariantes de investimento intactas");
  }
```

- [ ] **Step 6: Verificação de integração (opcional, se houver acervo)**

Se houver diretório de acervo, rodar o backfill e conferir o bloco novo no relatório:
```bash
cd backend-ts
node src/jobs/backfill.ts "<dir do acervo>" /tmp/bs-invrev.db --force 2>&1 | sed -n '/Estratégia de investimentos/,/Invariantes de investimento/p'
```
Expected: bloco "■ Estratégia de investimentos:" com total, % por tipo, concentração, fontes, e "✓ Invariantes de investimento intactas".

- [ ] **Step 7: Commit**

```bash
git add backend-ts/src/jobs/backfill/investReview.ts backend-ts/src/jobs/backfill/investReview.test.ts backend-ts/src/jobs/backfill/verify.ts
git commit -m "feat(backfill): review da estratégia de investimentos no verify (invariantes + panorama)"
```

---

## Fora de escopo (planos seguintes)

- **Fase 2 completa** — extrair `core/pipeline.ts` unificando dedup+insert+post-process (mata o achado B). Requer também idempotência de `faturas` e `seeds`/dedup-Inter a partir do DB.
- **Backfill totalmente idempotente** (re-rodar sem `--force` preservando tudo) — depende da Fase 2.
- **UI (Fase 4)** — contraste `--fg-3`, staging durável, empty/first-run states.
- **Fase 5** — ativar `rules` (editar = criar regra), migrar `xlsx` para o build do CDN do SheetJS (SEC-2), `## Não-objetivos` no PRODUCT.md.
- **Fase 6** — quebrar `primitives.js`; `store.js` no frontend.

## Self-Review

- **Cobertura do escopo:** P0-A → Task 7 (guarda). P0-B/SEC-1 → Tasks 4-5. SEC-3 → Task 6. Rede de testes/Fase 0 → Tasks 1-3. Review de estratégia de investimentos na pipeline → Task 8. ✔
- **Placeholders:** nenhum — todo passo tem código/comando real e saída esperada. ✔
- **Consistência de tipos:** `originAllowed(req)`, `splitMultipart(body, boundary, maxParts)`, `hasUserOverlay(db)` usados exatamente com essas assinaturas nos testes e no wiring. ✔
- **Nota de risco:** a verificação de integração da Task 5/7 depende de um DB local; o passo dá o fallback (schema+seeds) se não houver `data/brokershark-v2.db`.
