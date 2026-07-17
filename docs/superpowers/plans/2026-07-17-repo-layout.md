# Organização de pastas e nomenclatura — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar o layout do repo — `frontend/js/` chapado vira
`domain/core/ui/screens/overlays`; `backend-ts/` vira `backend/`; `data/` entra
em `backend/data/` — sem mudar uma linha de comportamento.

**Architecture:** Movimentação mecânica. O frontend não tem `import`/`export` —
cada arquivo é IIFE publicando em `window.BS` — então mover arquivo **não**
quebra referência entre arquivos JS; só as tags `<script>` do `index.html`. É
isso que torna o reorg barato. O backend não muda de estrutura interna, só de
nome de pasta.

**Tech Stack:** git (`git mv`), Node ≥ 26 (type-stripping nativo), node:test,
node:sqlite. Zero build step.

**Spec:** `docs/superpowers/specs/2026-07-17-repo-layout-design.md`

## Global Constraints

- **Zero mudança de comportamento, lógica, schema ou invariante financeira.**
  Esse plano só move e renomeia.
- **`git mv` sempre, para arquivo RASTREADO** — preserva histórico. Nunca
  `rm` + `add`. Exceção única e deliberada: `data/` é gitignored (Task 2), então
  `git mv` falharia nele — ali é `mv` de disco mesmo.
- **Sem build step:** a ordem dos `<script>` no `index.html` é manual e
  load-bearing. `money.js` **antes** de `tx-group.js` e `primitives.js` (os dois
  consomem `moneyKind` via `window.BS` quando o factory roda). `app.js` **por
  último**.
- **Baseline a preservar:** `npm test` = **75 testes, 75 pass, 0 fail**. Ledger =
  **901 transações**.
- **Testes ficam co-locados** ao lado do fonte (`*.test.js` / `*.test.ts`).
- **`docs/superpowers/plans/` e `specs/` datados NÃO são reescritos** — citam
  `backend-ts` como registro histórico do que era verdade na data.
- Um commit por task.

---

### Task 1: Renomear `backend-ts/` → `backend/`

O sufixo `-ts` distinguia do backend Python do v1, removido no rewrite. Hoje não
distingue de nada.

**Files:**
- Move: `backend-ts/` → `backend/`
- Modify: `backend/package.json` (campo `name`)
- Modify: `backend/package-lock.json:2` e `:8` (campo `name`)

**Interfaces:**
- Consumes: nada.
- Produces: a pasta `backend/`, base de todo caminho das tasks seguintes.

**Por que os caminhos internos NÃO mudam:** renomear não muda a profundidade.
`server.ts` resolve `../../frontend` a partir de `backend/src/` → raiz do repo,
igual antes. Nada a ajustar aqui.

- [ ] **Step 1: Derrubar o server (se estiver de pé)**

```bash
pkill -f "node src/server.ts" || true
```

- [ ] **Step 2: Mover a pasta**

```bash
cd /home/felipe/Projects/BrokerShark
git mv backend-ts backend
```

- [ ] **Step 3: Corrigir o `name` do package.json**

Em `backend/package.json`, trocar:

```json
  "name": "backend-ts",
```

por:

```json
  "name": "backend",
```

Fazer o mesmo em `backend/package-lock.json`, onde `"name": "backend-ts"`
aparece **duas** vezes (linhas 2 e 8):

```bash
cd /home/felipe/Projects/BrokerShark
sed -i 's/"name": "backend-ts"/"name": "backend"/g' backend/package-lock.json
grep -c '"name": "backend"' backend/package-lock.json
```

Esperado: `2`.

- [ ] **Step 4: Verificar que os testes ainda passam do novo caminho**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `tests 75`, `pass 75`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(repo): backend-ts → backend

O sufixo -ts distinguia do backend Python do v1, removido no rewrite.
Hoje não distingue de nada e fica assimétrico com frontend/.

Renomear não muda profundidade, então os caminhos relativos internos
(../../frontend em server.ts) seguem resolvendo igual.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Verificar que o histórico sobreviveu ao move — DEPOIS do commit**

A ordem importa: `git log --follow` só detecta rename a partir de um commit que
o registre. Rodar isso antes de commitar sempre falha, mesmo com `git mv` certo.

```bash
cd /home/felipe/Projects/BrokerShark && git log --follow --oneline backend/src/server.ts | wc -l
```

Esperado: número **maior que 1** (o arquivo tem história anterior ao move). Se
vier `1`, o `git mv` não foi usado — desfazer o commit e refazer com `git mv`.

---

### Task 2: Mover `data/` → `backend/data/`

**A task de maior risco: toca ledger real, não versionado.**

**Files:**
- Move: `data/brokershark-v2.db` (+ `-wal`, `-shm`) → `backend/data/`
- Modify: `backend/src/server.ts:43`
- Modify: `backend/src/jobs/backfill.ts:36`

**Interfaces:**
- Consumes: pasta `backend/` (Task 1).
- Produces: DB em `backend/data/brokershark-v2.db`; caminho default novo.

**Contexto de risco (ler antes de executar):**
- `data/` está no `.gitignore` — **git não desfaz esse move.**
- WAL vivo: mover `.db` sem checkpoint corrompe. Server **tem** que estar fora.
- Rede de segurança: verificado em 2026-07-17 que o DB não tem overlay da UI
  (901 tx, zero `import_batch_id`/`display_name`/`is_third_party`), então
  `backfill --force` reconstrói do acervo se algo der errado.

- [ ] **Step 1: Confirmar que o server está fora (senão o WAL está vivo)**

```bash
pgrep -f "node src/server.ts" && echo "AINDA DE PÉ — derrubar antes de seguir" || echo "fora, pode mover"
```

Esperado: `fora, pode mover`.

- [ ] **Step 2: Registrar o baseline do ledger (pra comparar depois)**

```bash
cd /home/felipe/Projects/BrokerShark
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/brokershark-v2.db',{readOnly:true});
console.log('transações antes:', db.prepare('SELECT COUNT(*) c FROM transactions').get().c);
"
```

Esperado: `transações antes: 901`. Anotar o número.

- [ ] **Step 3: Checkpoint do WAL — dobra o WAL de volta pro .db**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/brokershark-v2.db');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();
console.log('checkpoint ok');
"
```

Esperado: `checkpoint ok`.

- [ ] **Step 4: Mover os três arquivos juntos**

```bash
mkdir -p backend/data
mv data/brokershark-v2.db* backend/data/ 2>/dev/null
rmdir data 2>/dev/null || true
ls -la backend/data/
```

Esperado: `brokershark-v2.db` presente, permissão `-rw-------` (0600 preservado
pelo `mv`).

- [ ] **Step 5: Apontar o server pro caminho novo**

Em `backend/src/server.ts:43`, trocar:

```typescript
  ?? join(import.meta.dirname, "../../data/brokershark-v2.db");
```

por:

```typescript
  ?? join(import.meta.dirname, "../data/brokershark-v2.db");
```

(`import.meta.dirname` = `backend/src`; um nível acima é `backend/`.)

- [ ] **Step 6: Apontar o backfill pro caminho novo**

Em `backend/src/jobs/backfill.ts:36`, trocar:

```typescript
const dbPath = positional[1] ?? join(import.meta.dirname, "../../../data/brokershark-v2.db");
```

por:

```typescript
const dbPath = positional[1] ?? join(import.meta.dirname, "../../data/brokershark-v2.db");
```

(`import.meta.dirname` = `backend/src/jobs`; dois níveis acima é `backend/`.)

Também atualizar o comentário do topo do arquivo (linha ~5), que diz
`constrói data/brokershark-v2.db`, para `backend/data/brokershark-v2.db`.

- [ ] **Step 7: Verificar que o ledger sobreviveu intacto**

```bash
cd /home/felipe/Projects/BrokerShark
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('backend/data/brokershark-v2.db',{readOnly:true});
console.log('transações depois:', db.prepare('SELECT COUNT(*) c FROM transactions').get().c);
console.log('integridade:', db.prepare('PRAGMA integrity_check').get().integrity_check);
"
```

Esperado: `transações depois: 901` (igual ao Step 2) e `integridade: ok`.

- [ ] **Step 8: Verificar que o gitignore ainda cobre o caminho novo**

O padrão `data/` no `.gitignore` não tem barra inicial, então casa em qualquer
nível — mas confirmar, não supor:

```bash
git check-ignore -v backend/data/brokershark-v2.db
```

Esperado: uma linha citando `.gitignore` e o padrão `data/`. **Se não imprimir
nada, o ledger está prestes a ser versionado — parar e corrigir o `.gitignore`.**

- [ ] **Step 9: Subir o server e confirmar que ele acha o DB sozinho**

```bash
cd /home/felipe/Projects/BrokerShark/backend && (npm start &) && sleep 2 && curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/accounts && pkill -f "node src/server.ts"
```

Esperado: `200`.

- [ ] **Step 10: Commit**

```bash
cd /home/felipe/Projects/BrokerShark
git add -A && git commit -m "refactor(repo): data/ → backend/data/

O ledger passa a morar junto do backend que o serve. Caminho default
ajustado nos dois lugares onde nasce: server.ts e jobs/backfill.ts.

O arquivo não é versionado (.gitignore), então o move é de disco e o git
não o desfaz. Feito com o server fora e WAL truncado por checkpoint —
mover .db com WAL vivo corrompe. Ledger conferido antes e depois: 901
transações, integrity_check ok.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Reorganizar `frontend/js/`

**Files:**
- Move: 16 arquivos JS + 5 `.test.js` co-locados (mapa abaixo)
- Modify: `frontend/index.html:24-41` (tags `<script>`)
- Modify: `backend/package.json` (o glob de teste do frontend)

**Interfaces:**
- Consumes: pasta `backend/` (Task 1).
- Produces: `frontend/js/{domain,core,ui,screens,overlays}/`.

**Por que isso é barato:** não há `import`/`export` no frontend. Cada arquivo é
IIFE publicando em `window.BS`, e o `static.ts` mapeia `/static/<sub>` →
`frontend/<sub>` genericamente. Então mover não quebra referência de código —
só as tags do `index.html`.

**A armadilha (a razão desta task existir num commit só):** o glob de teste em
`backend/package.json` é **chapado**:

```json
"test": "node --test \"src/**/*.test.ts\" \"../frontend/js/*.test.js\""
```

`js/*.test.js` casa um nível só. No instante em que os testes puros vão pra
`js/domain/`, ele para de casar e **os 5 testes do frontend somem da suíte em
silêncio** — `npm test` fica verde testando menos, que é a pior falha possível.
Glob e move têm que andar no mesmo commit.

- [ ] **Step 1: Criar as pastas**

```bash
cd /home/felipe/Projects/BrokerShark/frontend/js
mkdir -p domain core ui screens overlays
```

- [ ] **Step 2: Mover — domínio puro (espelha `backend/src/domain/`)**

```bash
cd /home/felipe/Projects/BrokerShark
git mv frontend/js/money.js        frontend/js/domain/money.js
git mv frontend/js/money.test.js   frontend/js/domain/money.test.js
git mv frontend/js/tx-group.js     frontend/js/domain/tx-group.js
git mv frontend/js/tx-group.test.js frontend/js/domain/tx-group.test.js
git mv frontend/js/filter.js       frontend/js/domain/filter.js
git mv frontend/js/filter.test.js  frontend/js/domain/filter.test.js
git mv frontend/js/meta.js         frontend/js/domain/meta.js
git mv frontend/js/meta.test.js    frontend/js/domain/meta.test.js
```

- [ ] **Step 3: Mover — core, ui**

```bash
git mv frontend/js/api.js          frontend/js/core/api.js
git mv frontend/js/juice.js        frontend/js/core/juice.js
git mv frontend/js/juice.test.js   frontend/js/core/juice.test.js
git mv frontend/js/primitives.js   frontend/js/ui/primitives.js
git mv frontend/js/icons.js        frontend/js/ui/icons.js
git mv frontend/js/pixel-bars.js   frontend/js/ui/pixel-bars.js
```

- [ ] **Step 4: Mover — screens, overlays (o prefixo vira pasta)**

```bash
git mv frontend/js/app.js               frontend/js/screens/app.js
git mv frontend/js/view-dashboard.js    frontend/js/screens/dashboard.js
git mv frontend/js/view-history.js      frontend/js/screens/history.js
git mv frontend/js/view-overview.js     frontend/js/overlays/categories.js
git mv frontend/js/modal-transaction.js frontend/js/overlays/transaction.js
git mv frontend/js/modal-import.js      frontend/js/overlays/import.js
git mv frontend/js/modal-bulk.js        frontend/js/overlays/bulk.js
```

`view-overview.js → overlays/categories.js` conserta um nome errado: o arquivo é
`CategoriesPanel`; "overview" é fóssil da tela "Dinheiro" que virou o dashboard.

- [ ] **Step 5: Consertar o glob de teste — ANTES de rodar teste**

Em `backend/package.json`, trocar:

```json
    "test": "node --test \"src/**/*.test.ts\" \"../frontend/js/*.test.js\""
```

por:

```json
    "test": "node --test \"src/**/*.test.ts\" \"../frontend/js/**/*.test.js\""
```

- [ ] **Step 6: Provar que o glob novo acha os 5 testes do frontend**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `tests 75`, `pass 75`, `fail 0`. **A contagem tem que bater 75
exatamente.** Se vier menos (ex.: 60), o glob não está achando o frontend —
parar e corrigir antes de seguir.

- [ ] **Step 7: Reescrever as tags `<script>` do `index.html`**

Em `frontend/index.html`, trocar o bloco das linhas 24-41 por (ordem preservada,
só os caminhos mudam; `?v=43` → `?v=45` pra furar cache):

```html
  <script src="/static/js/core/api.js?v=45"></script>
  <script src="/static/js/ui/icons.js?v=45"></script>
  <!-- money.js antes de tx-group.js e primitives.js: os dois consomem moneyKind
       via window.BS no momento em que o factory roda. -->
  <script src="/static/js/domain/money.js?v=45"></script>
  <script src="/static/js/domain/tx-group.js?v=45"></script>
  <script src="/static/js/ui/primitives.js?v=45"></script>
  <script src="/static/js/domain/filter.js?v=45"></script>
  <script src="/static/js/domain/meta.js?v=45"></script>
  <script src="/static/js/core/juice.js?v=45"></script>
  <script src="/static/js/overlays/transaction.js?v=45"></script>
  <script src="/static/js/overlays/import.js?v=45"></script>
  <script src="/static/js/overlays/bulk.js?v=45"></script>
  <script src="/static/js/overlays/categories.js?v=45"></script>
  <script src="/static/js/screens/history.js?v=45"></script>
  <script src="/static/js/ui/pixel-bars.js?v=45"></script>
  <script src="/static/js/screens/dashboard.js?v=45"></script>
  <script src="/static/js/screens/app.js?v=45"></script>
```

- [ ] **Step 8: Provar que todo script pedido existe no disco**

Compara o que o HTML pede com o que existe — pega typo de caminho antes do
browser:

```bash
cd /home/felipe/Projects/BrokerShark
grep -o '/static/js/[^"?]*\.js' frontend/index.html | sed 's|/static/|frontend/|' | while read f; do
  [ -f "$f" ] && echo "ok   $f" || echo "FALTA $f"
done
```

Esperado: só linhas `ok`. Qualquer `FALTA` = 404 no browser.

- [ ] **Step 9: Subir e verificar que a app renderiza**

```bash
cd /home/felipe/Projects/BrokerShark/backend && (npm start &) && sleep 2
curl -s http://127.0.0.1:8000/static/js/domain/money.js -o /dev/null -w "money.js: %{http_code}\n"
curl -s http://127.0.0.1:8000/static/js/screens/app.js -o /dev/null -w "app.js:   %{http_code}\n"
```

Esperado: `200` nos dois. Depois abrir `http://127.0.0.1:8000` no browser e
confirmar: dashboard renderiza, **console sem erro**, sem 404 na aba Network.

- [ ] **Step 10: Commit**

```bash
cd /home/felipe/Projects/BrokerShark
git add -A && git commit -m "refactor(front): js/ chapado vira domain/core/ui/screens/overlays

19 arquivos numa pasta só, onde o nome do arquivo era a única pista do
que a coisa era. O front já tinha domínio puro e testado (money,
tx-group, filter, meta) — espelho de backend/src/domain; só faltava a
pasta. O prefixo view-/modal- era pasta fingindo ser nome de arquivo.

overlays/ e não modals/ porque overlay é a palavra do produto: o
CLAUDE.md já diz 'drill-down overlay, nunca navegação' e primitives.js
já exporta Overlay. Modal e drawer são a mesma ideia — abre por cima da
tela única. Isso decide onde CategoriesPanel mora.

view-overview.js → overlays/categories.js conserta um nome errado: o
arquivo é CategoriesPanel; 'overview' é fóssil da tela Dinheiro que
virou o dashboard.

Move é barato porque não há import/export: cada arquivo é IIFE em
window.BS, então só as tags do index.html apontavam caminho.

O glob de teste vem junto por necessidade: era js/*.test.js (chapado) e
teria parado de achar os 5 testes do front em silêncio — verde testando
menos. Agora js/**/*.test.js. Contagem conferida: 75 antes, 75 depois.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Sincronizar a documentação

O `CLAUDE.md` é auto-carregado toda sessão e descreve a árvore antiga — deixá-lo
desatualizado faz a próxima sessão procurar arquivo que não existe.

**Files:**
- Modify: `CLAUDE.md` (bloco Repository Structure; comandos de Running Locally)
- Modify: `README.md` (refs a `backend-ts`)

**Interfaces:**
- Consumes: a árvore final das Tasks 1-3.
- Produces: docs que batem com o disco.

- [ ] **Step 1: Achar tudo que ainda aponta pro layout velho**

```bash
cd /home/felipe/Projects/BrokerShark
grep -rn "backend-ts\|view-dashboard\|view-history\|view-overview\|modal-import\|modal-bulk\|modal-transaction" CLAUDE.md README.md
```

Anotar cada ocorrência — todas serão corrigidas nos steps seguintes.

- [ ] **Step 2: Atualizar o bloco `Repository Structure` do CLAUDE.md**

Trocar `backend-ts/` por `backend/` no topo do bloco, acrescentar `data/` sob
ele, e trocar o bloco `frontend/js/` chapado pela árvore nova:

```
backend/
  data/                 # brokershark-v2.db (ledger SQLite, 0600, NUNCA versionado)
  package.json          # deps: xlsx (única npm dep); npm test = node:test
  src/                  # (inalterado: db, domain, ingest, http, routes, jobs)
frontend/
  index.html            # React 18 SPA (hyperscript puro, sem build step)
  js/
    domain/             # regra PURA e testada — espelha backend/src/domain
                        # money.js — ESPÉCIES de dinheiro (moneyKind/KIND_COLOR/fmtParts)
                        # tx-group.js — agrupamento da tabela (buildGroups/scaleFor/budgetState)
                        # filter.js — filtro facetado (applyFilter/toggleFacet/searchMatch)
                        # meta.js — derivações "score" (savingsStreak/isAllTimeHigh/budgetProgress)
    core/               # api.js (fetch + contrato) · juice.js (animações, sem áudio)
    ui/                 # primitives.js (Overlay, Money, TxRow) · icons.js
                        # pixel-bars.js — barras dithered do fluxo mês a mês
    screens/            # app.js (shell) · dashboard.js (a tela única)
                        # history.js (TxTableWidget — a planilha)
    overlays/           # abre por cima da tela única — modal e drawer
                        # transaction.js · import.js · bulk.js · categories.js
```

- [ ] **Step 3: Atualizar `Running Locally` no CLAUDE.md**

Trocar:

```bash
cd backend-ts
```

por:

```bash
cd backend
```

e o caminho do DB de `data/brokershark-v2.db` para `backend/data/brokershark-v2.db`
(aparece no comentário do comando de backfill).

- [ ] **Step 4: Atualizar o README**

Trocar toda ocorrência de `backend-ts` por `backend`. Conferir se o README cita
caminho de arquivo do frontend; se citar, ajustar pra árvore nova.

- [ ] **Step 5: Provar que não sobrou referência morta**

```bash
cd /home/felipe/Projects/BrokerShark
grep -rn "backend-ts\|view-dashboard\|view-history\|view-overview\|modal-import\|modal-bulk\|modal-transaction" CLAUDE.md README.md || echo "limpo"
```

Esperado: `limpo`.

(`docs/superpowers/` **fica como está** — planos e specs datados são registro
histórico do que era verdade na data, não documentação viva.)

- [ ] **Step 6: Verificação final de tudo**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd /home/felipe/Projects/BrokerShark && git status --short | cat
```

Esperado: `tests 75 / pass 75 / fail 0`, e `git status` sem surpresa.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "docs: sincroniza CLAUDE.md e README com a árvore nova

CLAUDE.md é auto-carregado toda sessão — desatualizado, faz a próxima
sessão procurar arquivo que não existe.

docs/superpowers/ fica como está: planos e specs datados são registro
histórico do que era verdade na data, não documentação viva.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Critérios de aceite (do spec)

1. `npm test` verde **com contagem 75** — prova que o glob novo acha o frontend.
2. App sobe e renderiza: sem 404 de script, sem erro de console.
3. `git log --follow` acha histórico de arquivo movido (prova do `git mv`).
4. `git check-ignore backend/data/brokershark-v2.db` → ainda ignorado.
5. Ledger intacto: 901 transações, `integrity_check` ok.
6. Zero `backend-ts` fora de `docs/` (registro histórico datado):
   `grep -rn "backend-ts" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs .`
   → sem saída.
7. `git status` limpo.
