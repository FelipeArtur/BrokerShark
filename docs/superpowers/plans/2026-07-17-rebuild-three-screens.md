# Reconstrução das três telas de apoio — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir Categorizar em lote, Gerenciar Categorias e Importar Dados
— hoje ilhas de estilo inline pré-remodel — sobre um vocabulário pixel em CSS,
com densidade e fluxo redesenhados.

**Architecture:** As três telas estilizam o conteúdo interno com objetos `style`
inline no JS, e inline vence stylesheet — é por isso que o `!important` do
`pixel.css` nunca as alcançou. A correção é extrair o vocabulário repetido pra
classes num `pixel-ui.css` novo e as telas viram markup fino consumindo essas
classes. Dois helpers puros saem pra `domain/` com teste co-locado.

**Tech Stack:** React 18 via hyperscript (`React.createElement`, **nunca JSX**),
sem build step, cada arquivo em IIFE publicando em `window.BS`. CSS puro com
custom properties. node:test pros helpers puros.

**Spec:** `docs/superpowers/specs/2026-07-17-rebuild-three-screens-design.md`

## Global Constraints

- **Sem build step.** Hyperscript puro (`h = React.createElement`), nunca JSX.
  Cada arquivo é IIFE que publica em `window.BS`. Sem `import`/`export` (exceto
  o rabo UMD dos helpers puros, ver Task 1).
- **Zero mudança de backend, schema ou invariante financeira.** Nenhum arquivo
  em `backend/` é tocado.
- **Baseline atual:** `npm test` = **75 testes, 75 pass, 0 fail** (rodar de
  dentro de `backend/`). Cada task que acrescenta teste sobe esse número — o
  novo total vira a baseline da próxima.
- **Tokens vêm de `style.css`; `pixel-ui.css` NÃO define paleta nem fonte.**
  Cores: `--bg-0..3`, `--line-1` (preto), `--line-2`, `--fg-0..3`, `--accent`,
  `--pos`, `--neg`, `--warn`. Espaço: `--s-1:2px` … `--s-9:32px`. Corpo:
  `--fz-9:10px` … `--fz-0:44px`. Fonte: `--ff-sans` (Silkscreen), `--ff-mono`
  (Departure Mono).
- **`--r-1`…`--r-6` já valem `0`.** Os tokens de raio foram zerados no remodel;
  as telas com `borderRadius: 12` inline estão contornando um token que já diz
  zero. Não reintroduzir raio.
- **Ordem dos `<script>` no `index.html` é load-bearing.** Todo arquivo novo em
  `domain/` entra ANTES de `ui/primitives.js`. `screens/app.js` fica por último.
- **`git mv`/`git add` normais; um commit por task.**
- Idioma: código e comentário em português como o resto do repo; Doxygen
  (`@file`/`@brief`/`@param`/`@return`) por função, como os 18 arquivos do front.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `frontend/css/pixel-ui.css` | **novo** — vocabulário de componente (`.px-*`) |
| `frontend/js/domain/palette.js` (+test) | **novo** — `quantizeHue`, `swatchColor` |
| `frontend/js/domain/bulk.js` (+test) | **novo** — `suggestionPlan` |
| `frontend/js/overlays/bulk.js` | reescrito — markup fino + aplica-na-hora |
| `frontend/js/overlays/categories.js` | reescrito — markup fino + afordância |
| `frontend/js/overlays/import.js` | reescrito — markup fino + densidade |
| `frontend/js/screens/history.js` | modificado — `applyBulk` ganha erro+undo |
| `frontend/index.html` | modificado — 3 tags novas |
| `CLAUDE.md` | modificado — árvore + pixel-ui.css |

---

### Task 1: Fundação — `pixel-ui.css` + helpers puros

**Files:**
- Create: `frontend/css/pixel-ui.css`
- Create: `frontend/js/domain/palette.js`, `frontend/js/domain/palette.test.js`
- Create: `frontend/js/domain/bulk.js`, `frontend/js/domain/bulk.test.js`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: tokens de `style.css` (ver Global Constraints).
- Produces:
  - `window.BS.quantizeHue(str) → number` — índice `0..7`
  - `window.BS.swatchColor(str) → string` — `oklch()` da paleta
  - `window.BS.suggestionPlan(groups) → [{merchant_key, flow, ids, category_id}]`
  - classes CSS: `.px-row`, `.px-field`, `.px-btn` (+`--primary`/`--danger`),
    `.px-chip`, `.px-swatch`, `.px-dropzone`, `.px-steps`, `.px-empty`

- [ ] **Step 1: Escrever os testes de `palette` (falham — arquivo não existe)**

Criar `frontend/js/domain/palette.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const P = require("./palette.js");

test("quantizeHue é estável: mesma string, mesmo índice", () => {
  assert.equal(P.quantizeHue("Padaria do Zé"), P.quantizeHue("Padaria do Zé"));
  assert.equal(P.quantizeHue("iFood"), P.quantizeHue("iFood"));
});

test("quantizeHue cai sempre dentro da paleta (0..7)", () => {
  const nomes = ["", "a", "iFood", "Uber", "Padaria do Zé", "SUPERMERCADO XYZ",
                 "99Pay", "Ação Ltda", "🍕", "x".repeat(500)];
  for (const n of nomes) {
    const i = P.quantizeHue(n);
    assert.ok(Number.isInteger(i), `${JSON.stringify(n)} → ${i} não é inteiro`);
    assert.ok(i >= 0 && i < 8, `${JSON.stringify(n)} → ${i} fora de 0..7`);
  }
});

test("quantizeHue não quebra com string vazia", () => {
  assert.equal(P.quantizeHue(""), 0);
});

test("swatchColor devolve um oklch() da paleta", () => {
  const c = P.swatchColor("iFood");
  assert.match(c, /^oklch\(/);
  assert.equal(c, P.swatchColor("iFood"));
});

test("swatchColor usa hues distintos pra nomes que caem em índices distintos", () => {
  const cores = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(P.swatchColor));
  assert.ok(cores.size > 1, "todas as cores iguais — quantização quebrada");
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | tail -5
```

Esperado: falha com `Cannot find module './palette.js'`.

- [ ] **Step 3: Implementar `palette.js`**

Criar `frontend/js/domain/palette.js`. O rabo UMD é o mesmo padrão de
`core/juice.js` — publica em `window.BS` no browser e em `module.exports` no
node, sem build step:

```js
/**
 * @file palette.js
 * @brief Cor estável por nome, quantizada à paleta — arte pixel tem paleta
 *        LIMITADA, então 360 matizes contínuos destoam do resto do app.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /** Matizes da paleta Balatro — 8 passos, escolhidos pra serem distinguíveis. */
  const HUES = [15, 50, 90, 155, 200, 250, 290, 330];

  /**
   * @brief Índice de matiz estável derivado de uma string.
   * @param str nome do comerciante; vazio/nulo devolve 0
   * @return inteiro em [0, 8)
   */
  function quantizeHue(str) {
    const s = String(str == null ? "" : str);
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (s.charCodeAt(i) + ((hash << 5) - hash)) | 0;
    return Math.abs(hash) % HUES.length;
  }

  /**
   * @brief Cor do swatch de um comerciante — estável e sempre da paleta.
   * @param str nome do comerciante
   * @return string oklch()
   */
  function swatchColor(str) {
    return `oklch(75% 0.14 ${HUES[quantizeHue(str)]})`;
  }

  return { quantizeHue, swatchColor, HUES };
});
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `pass` sobe de 75 pra **80**, `fail 0`.

- [ ] **Step 5: Escrever os testes de `bulk` (falham)**

Criar `frontend/js/domain/bulk.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const B = require("./bulk.js");

const g = (k, sug) => ({ merchant_key: k, flow: "expense", ids: [1, 2],
                         suggested_category_id: sug });

test("suggestionPlan só devolve grupos COM sugestão", () => {
  const plano = B.suggestionPlan([g("a", 7), g("b", null), g("c", 9)]);
  assert.deepEqual(plano.map(p => p.merchant_key), ["a", "c"]);
});

test("suggestionPlan carrega ids e category_id de cada grupo", () => {
  const [p] = B.suggestionPlan([g("a", 7)]);
  assert.deepEqual(p, { merchant_key: "a", flow: "expense", ids: [1, 2], category_id: 7 });
});

test("suggestionPlan devolve vazio quando ninguém tem sugestão", () => {
  assert.deepEqual(B.suggestionPlan([g("a", null)]), []);
});

test("suggestionPlan aguenta lista vazia e undefined", () => {
  assert.deepEqual(B.suggestionPlan([]), []);
  assert.deepEqual(B.suggestionPlan(undefined), []);
});

test("suggestionPlan trata id 0 como sugestão ausente só se for null/undefined", () => {
  // 0 não é um id válido no SQLite (AUTOINCREMENT começa em 1), mas a regra é
  // != null — documenta que a checagem não é falsy.
  assert.equal(B.suggestionPlan([g("a", 0)]).length, 1);
});
```

- [ ] **Step 6: Rodar e ver falhar**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | tail -5
```

Esperado: falha com `Cannot find module './bulk.js'`.

- [ ] **Step 7: Implementar `bulk.js`**

Criar `frontend/js/domain/bulk.js`:

```js
/**
 * @file bulk.js
 * @brief Decisão pura do "aplicar todas as sugestões" da categorização em lote.
 *
 * Separa a DECISÃO (o que aplicar) do EFEITO (aplicar) — é isso que torna o
 * batch testável sem DOM nem rede, e o que permite disparar as chamadas em
 * paralelo e atualizar o estado uma vez só no fim.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  /**
   * @brief Lista os pares (comerciante, categoria) a gravar num "aplicar todas".
   * @param groups grupos de uncategorized-merchants; ausente vira []
   * @return array {merchant_key, flow, ids, category_id} — só os que têm sugestão
   */
  function suggestionPlan(groups) {
    return (groups || [])
      .filter(g => g.suggested_category_id != null)
      .map(g => ({
        merchant_key: g.merchant_key,
        flow: g.flow,
        ids: g.ids,
        category_id: g.suggested_category_id,
      }));
  }

  return { suggestionPlan };
});
```

- [ ] **Step 8: Rodar e ver passar**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `pass` sobe de 80 pra **85**, `fail 0`.

- [ ] **Step 9: Criar `pixel-ui.css`**

Criar `frontend/css/pixel-ui.css`:

```css
/* pixel-ui.css — vocabulário de componente interativo da linguagem pixel.
   pixel.css é a camada ESTRUTURAL (bordas de painel, CRT, dither, keyframes);
   este arquivo é o vocabulário que as telas consomem. Paleta e fonte vêm de
   style.css — aqui não se define cor nem família, só forma. */

/* ── Linha de item ────────────────────────────────────────────────────────
   Substitui a linha inline-styled que existia em 3 cópias divergentes.
   Compacta de propósito: a versão antiga (avatar 44px + padding 16px) mostrava
   ~4 itens por tela. */
.px-row {
  display: flex; align-items: center; gap: var(--s-5);
  padding: var(--s-3) var(--s-4);
  min-height: 36px;
  background: var(--bg-1);
  border: 2px solid var(--line-1);
  box-shadow: 2px 2px 0 #05060d;
}
.px-row:hover { background: var(--bg-2); }
.px-row + .px-row { margin-top: var(--s-3); }

.px-list { display: flex; flex-direction: column; }

/* ── Swatch: quadrado, nunca círculo ──────────────────────────────────────
   Não existe círculo num grid de pixels — o avatar redondo era o que mais
   fazia estas telas destoarem. A cor vem de domain/palette.js (quantizada). */
.px-swatch {
  width: 20px; height: 20px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--line-1);
  font-family: var(--ff-sans); font-size: var(--fz-9); line-height: 1;
  color: var(--bg-0);
}

/* ── Campo (input/select) ─────────────────────────────────────────────── */
.px-field {
  height: 28px; padding: 0 var(--s-4);
  background: var(--bg-0); color: var(--fg-0);
  border: 2px solid var(--line-2);
  font-family: var(--ff-mono); font-size: var(--fz-7);
  outline: none;
}
.px-field:focus { border-color: var(--accent); }
select.px-field { cursor: pointer; appearance: none; padding-right: var(--s-7); }

/* ── Botão que afunda ─────────────────────────────────────────────────────
   :active desloca 1px e a sombra degrau colapsa — o feedback Balatro, reusando
   a linguagem de sombra que pixel.css já estabeleceu. steps() e não easing:
   interpolação suave é a antítese de pixel. */
.px-btn {
  height: 28px; padding: 0 var(--s-5);
  display: inline-flex; align-items: center; gap: var(--s-3);
  background: var(--bg-2); color: var(--fg-0);
  border: 2px solid var(--line-1);
  box-shadow: 2px 2px 0 #05060d;
  font-family: var(--ff-sans); font-size: var(--fz-9); letter-spacing: 1px;
  cursor: pointer;
  transition: transform 60ms steps(2), box-shadow 60ms steps(2);
}
.px-btn:hover { background: var(--bg-3); }
.px-btn:active { transform: translate(2px, 2px); box-shadow: 0 0 0 #05060d; }
.px-btn:disabled { opacity: 0.4; cursor: default; }
.px-btn:disabled:active { transform: none; box-shadow: 2px 2px 0 #05060d; }
.px-btn--primary { background: var(--accent); color: var(--accent-fg); }
.px-btn--primary:hover { background: var(--accent); filter: brightness(1.12); }
.px-btn--danger { background: var(--neg); color: var(--bg-0); }
.px-btn--danger:hover { background: var(--neg); filter: brightness(1.12); }

/* ── Chip: rótulo mono pra contagem/valor ────────────────────────────────── */
.px-chip {
  padding: 1px var(--s-3);
  background: var(--bg-2); color: var(--fg-2);
  border: 2px solid var(--line-1);
  font-family: var(--ff-mono); font-size: var(--fz-9);
  white-space: nowrap;
}

/* ── Dropzone ─────────────────────────────────────────────────────────────
   Tracejado DURO: dash curto e igual, sem raio. */
.px-dropzone {
  padding: var(--s-8) var(--s-6);
  text-align: center;
  background: var(--bg-1);
  border: 3px dashed var(--line-2);
  color: var(--fg-2);
  font-family: var(--ff-sans); font-size: var(--fz-8); letter-spacing: 1px;
  cursor: pointer;
}
.px-dropzone:hover, .px-dropzone--over {
  border-color: var(--accent); color: var(--fg-0); background: var(--bg-2);
}

/* ── Indicador de passo do wizard ─────────────────────────────────────────── */
.px-steps { display: flex; align-items: center; gap: var(--s-3); }
.px-step {
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--line-1);
  background: var(--bg-2); color: var(--fg-3);
  font-family: var(--ff-sans); font-size: var(--fz-9);
}
.px-step--active { background: var(--accent); color: var(--accent-fg); }
.px-step--done   { background: var(--pos);    color: var(--bg-0); }
.px-step-bar { width: 16px; height: 2px; background: var(--line-2); }

/* ── Estado vazio ─────────────────────────────────────────────────────────── */
.px-empty {
  padding: var(--s-9) var(--s-6);
  text-align: center; color: var(--fg-3);
  font-family: var(--ff-sans); font-size: var(--fz-8); letter-spacing: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .px-btn { transition: none; }
}
```

- [ ] **Step 10: Ligar os três arquivos no `index.html`**

Em `frontend/index.html`, na seção de `<link>`, acrescentar **depois** de
`pixel.css` (ordem importa: `pixel-ui.css` assume os tokens e a camada
estrutural já declarados):

```html
  <link rel="stylesheet" href="/static/css/pixel-ui.css?v=46" />
```

Na seção de `<script>`, acrescentar as duas linhas de `domain/` **antes** de
`ui/primitives.js` — a regra vigente é que todo `domain/` carrega antes da UI
que o consome:

```html
  <script src="/static/js/domain/palette.js?v=46"></script>
  <script src="/static/js/domain/bulk.js?v=46"></script>
```

Colocá-las logo após a linha de `domain/tx-group.js`.

- [ ] **Step 11: Provar que o browser carrega os três**

```bash
cd /home/felipe/Projects/BrokerShark/backend
PID=$(ss -ltnp 2>/dev/null | grep ':8000' | grep -oP 'pid=\K[0-9]+' | head -1)
[ -n "$PID" ] && kill "$PID"; sleep 1
setsid nohup node src/server.ts > /tmp/srv.log 2>&1 < /dev/null &
sleep 2
curl -s -o /dev/null -w "pixel-ui.css: %{http_code}\n" http://127.0.0.1:8000/static/css/pixel-ui.css
curl -s -o /dev/null -w "palette.js:   %{http_code}\n" http://127.0.0.1:8000/static/js/domain/palette.js
curl -s -o /dev/null -w "bulk.js:      %{http_code}\n" http://127.0.0.1:8000/static/js/domain/bulk.js
```

Esperado: `200` nos três.

> **Nunca use `pgrep -f "node src/server.ts"`** pra checar o server: `-f` casa a
> linha de comando do próprio shell que roda o pgrep, dá falso positivo, e um
> `pkill` no mesmo padrão mata o seu shell. Use a porta, como acima.

- [ ] **Step 12: Commit**

```bash
cd /home/felipe/Projects/BrokerShark
git add frontend/css/pixel-ui.css frontend/js/domain/palette.js \
        frontend/js/domain/palette.test.js frontend/js/domain/bulk.js \
        frontend/js/domain/bulk.test.js frontend/index.html
git commit -m "feat(pixel-ui): vocabulário de componente + helpers puros

pixel.css aplica border-radius:0 !important só nas classes de painel; o
conteúdo das telas de apoio é estilo inline no JS, e inline vence
stylesheet. Extrair o vocabulário pra classes é o que torna o tema
alcançável — repintar inline deixaria a mesma armadilha montada.

Arquivo novo e não dentro de pixel.css: aquele é a camada estrutural
(bordas de painel, CRT, dither, keyframes); componente interativo é outra
preocupação.

quantizeHue quantiza a cor do comerciante a 8 matizes. A versão inline
fazia hash % 360: arte pixel é definida por paleta LIMITADA, e 360
matizes contínuos destoam. suggestionPlan separa a decisão do efeito — é
o que torna o batch paralelo testável sem DOM nem rede.

Testes: 75 → 85.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Reconstruir Categorizar em lote

**Files:**
- Rewrite: `frontend/js/overlays/bulk.js`
- Modify: `frontend/js/screens/history.js:110-121` (`applyBulk`)

**Interfaces:**
- Consumes: `window.BS.swatchColor(str)`, `window.BS.suggestionPlan(groups)`
  (Task 1); `window.BS.Modal`, `window.BS.prettifyDesc`, `window.BS.fmtBRL`;
  `postCategory(name, flow)` e `patchTransactionCategory(txId, categoryId)` de
  `core/api.js`.
- Produces: `window.BS.BulkCategorizeModal` — mesmas props de hoje
  (`groups, catsByFlow, monthLabel, onApply, onClose, onRefreshCats`), mais
  `onApplyAll(plan)`.

**Contexto que decide o desenho:**

`applyBulk` em `screens/history.js:120` hoje faz `.catch(() => {})` — **engole o
erro**. Hoje isso só faz o clique não surtir efeito. Com "aplica na hora" isso
vira mentira: a linha sumiria e o usuário acharia que gravou. Esta task
conserta.

O Desfazer é possível **sem tocar no backend**, mas só por um caminho:
`POST /api/transactions/categorize-bulk` valida `categoryExists(category_id)` e
**recusa null**; já `PATCH /api/transactions/:id` aceita `category_id: null`
(`transactions.ts:201` deixa null passar). Como esta tela só lista comerciantes
**sem categoria**, desfazer é sempre voltar pra null — nunca restaurar valor
anterior. Logo: `Promise.all(ids.map(id => patchTransactionCategory(id, null)))`.

- [ ] **Step 1: Reescrever `applyBulk` em `screens/history.js`**

Substituir o bloco das linhas 104-121 por:

```js
  const uncatCount = bulkGroups.reduce((s, g) => s + g.count, 0);
  /**
   * @brief Categoriza todas as ocorrências de um comerciante de uma vez.
   * @param group grupo de uncategorized-merchants {merchant_key, flow, ids}
   * @param categoryId id da categoria escolhida
   * @return Promise que resolve com {undo} — `undo` devolve os lançamentos ao
   *         estado sem categoria; rejeita se a gravação falhar (o chamador
   *         avisa o usuário: com aplicação imediata, engolir o erro faria a
   *         linha sumir dando a impressão de que gravou)
   */
  const applyBulk = async (group, categoryId) => {
    const list = catsByFlow[group.flow] || [];
    const catName = list.find(c => c.id === categoryId)?.name || "";
    await categorizeBulk(group.ids, categoryId);
    setBulkGroups(prev => prev.filter(g => !(g.merchant_key === group.merchant_key && g.flow === group.flow)));
    if (setMonthTx) {
      setMonthTx(prev => prev.map(tx => group.ids.includes(tx.id) ? { ...tx, category_id: categoryId, category: catName } : tx));
    }
    return {
      /**
       * @brief Devolve o grupo ao estado sem categoria.
       *
       * Via PATCH e não categorize-bulk: aquele exige categoria existente e
       * recusa null. Como a tela só lista não-categorizados, o alvo é sempre null.
       */
      undo: async () => {
        await Promise.all(group.ids.map(id => window.BS.patchTransactionCategory(id, null)));
        setBulkGroups(prev => [...prev, group]);
        if (setMonthTx) {
          setMonthTx(prev => prev.map(tx => group.ids.includes(tx.id) ? { ...tx, category_id: null, category: null } : tx));
        }
      },
    };
  };
```

- [ ] **Step 2: Confirmar que `patchTransactionCategory` está exposto em `window.BS`**

```bash
cd /home/felipe/Projects/BrokerShark
grep -n "patchTransactionCategory" frontend/js/core/api.js | tail -3
```

Se a função não aparecer num `Object.assign(window.BS, …)` no fim de
`core/api.js`, acrescentá-la lá junto das outras — sem isso a chamada do Step 1
quebra em runtime.

- [ ] **Step 3: Reescrever `frontend/js/overlays/bulk.js`**

Substituir o arquivo inteiro por:

```js
/* IIFE-wrapped: own scope (replaces Babel's per-file isolation) */
(function () {
/**
 * @file bulk.js
 * @brief Categorização em lote por comerciante: uma escolha etiqueta todas as
 *        ocorrências do mês de uma vez.
 */
/* global React, postCategory */

const { fmtBRL } = window.BS;

/**
 * @brief Renderiza o painel de categorização em lote.
 * @param props.groups comerciantes sem categoria {merchant_key, flow, ids, count,
 *        total, sample_description, suggested_category_id, suggested_category_name};
 *        `total` em REAIS
 * @param props.catsByFlow {expense, income} — opções por fluxo do comerciante
 * @param props.monthLabel rótulo do mês exibido no título
 * @param props.onApply (grupo, categoryId) → Promise<{undo}>; rejeita em falha
 * @param props.onClose fecha o modal
 * @param props.onRefreshCats recarrega categorias após criar uma; devolve {expense, income}
 * @param props.onToast (msg, kind, action) — enfileira aviso; `action` é
 *        {label, onClick} e faz o toast durar 6s
 * @return elemento React do modal
 */
function BulkCategorizeModal({ groups, catsByFlow, monthLabel, onApply, onClose, onRefreshCats, onToast }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const [creatingFor, setCreatingFor] = React.useState(null);
  const [newCatName, setNewCatName] = React.useState("");
  const [busy, setBusy] = React.useState(null);
  const Modal = window.BS.Modal;
  const prettify = window.BS.prettifyDesc || (s => s);
  const total = groups.reduce((s, g) => s + g.count, 0);
  const plan = window.BS.suggestionPlan(groups);

  /**
   * @brief Grava a categoria do comerciante e oferece o desfazer.
   *
   * Aplica na hora: o select já carrega a intenção, e um "Salvar" separado
   * custava um terceiro clique. A rede é o toast com Desfazer.
   */
  const apply = async (g, categoryId) => {
    if (busy) return;
    setBusy(g.merchant_key);
    try {
      const { undo } = await onApply(g, categoryId);
      const nome = (catsByFlow[g.flow] || []).find(c => c.id === categoryId)?.name || "categoria";
      onToast(`${g.count} ${g.count === 1 ? "lançamento" : "lançamentos"} → ${nome}`, "success", {
        label: "Desfazer",
        onClick: () => undo().catch(e => onToast(e.message || "Não foi possível desfazer.", "error")),
      });
    } catch (e) {
      onToast(e.message || "Não foi possível categorizar.", "error");
    } finally { setBusy(null); }
  };

  /**
   * @brief Aplica todas as sugestões de uma vez.
   *
   * Dispara em PARALELO e atualiza o estado uma vez só no fim. A versão antiga
   * usava await em série porque cada onApply removia o grupo da lista e o
   * paralelo competia pelo mesmo estado — o motivo era real, mas a solução
   * custava N round-trips em fila. Aqui a decisão (suggestionPlan) é pura e o
   * efeito acontece de uma vez.
   */
  const applyAll = async () => {
    if (busy || plan.length === 0) return;
    setBusy("__all__");
    const res = await Promise.allSettled(
      plan.map(p => onApply(groups.find(g => g.merchant_key === p.merchant_key && g.flow === p.flow), p.category_id))
    );
    const ok = res.filter(r => r.status === "fulfilled");
    const err = res.length - ok.length;
    if (ok.length) {
      onToast(`${ok.length} ${ok.length === 1 ? "comerciante categorizado" : "comerciantes categorizados"}`, "success", {
        label: "Desfazer",
        onClick: () => Promise.all(ok.map(r => r.value.undo()))
          .catch(e => onToast(e.message || "Não foi possível desfazer.", "error")),
      });
    }
    if (err) onToast(`${err} ${err === 1 ? "falhou" : "falharam"}`, "error");
    setBusy(null);
  };

  /**
   * @brief Cria a categoria digitada e já a aplica ao comerciante.
   * @param g grupo do comerciante — o `flow` dele define o fluxo da nova categoria
   */
  const handleCreateNew = async (g) => {
    if (!newCatName.trim() || busy) return;
    setBusy(g.merchant_key);
    try {
      await postCategory(newCatName.trim(), g.flow);
      const novas = await onRefreshCats();
      const criada = (novas[g.flow] || []).find(c => c.name.toLowerCase() === newCatName.trim().toLowerCase());
      setCreatingFor(null); setNewCatName("");
      setBusy(null);
      if (criada) await apply(g, criada.id);
    } catch (e) {
      setBusy(null);
      onToast(e.message || "Não foi possível criar a categoria.", "error");
    }
  };

  return h(Modal, { open: true, onClose, title: `Categorizar em lote — ${monthLabel}`, width: 720 },
    h("div", { style: { display: "flex", flexDirection: "column", gap: "var(--s-5)" } },

      h("div", { className: "label", style: { color: "var(--fg-2)" } },
        groups.length === 0
          ? `Tudo categorizado em ${monthLabel}.`
          : `${groups.length} ${groups.length === 1 ? "comerciante aguarda" : "comerciantes aguardam"} · ${total} ${total === 1 ? "lançamento" : "lançamentos"}`),

      plan.length > 0 && h("div", { className: "px-row" },
        h("span", { style: { flex: 1, fontFamily: "var(--ff-sans)", fontSize: "var(--fz-8)", color: "var(--fg-0)" } },
          `${plan.length} ${plan.length === 1 ? "sugestão automática" : "sugestões automáticas"}`),
        h("button", { className: "px-btn px-btn--primary", onClick: applyAll, disabled: !!busy },
          busy === "__all__" ? "APLICANDO…" : "APLICAR TODAS")
      ),

      groups.length === 0
        ? h("div", { className: "px-empty" }, "NADA A CATEGORIZAR")
        : h("div", { className: "px-list", style: { maxHeight: "55vh", overflowY: "auto" } },
            groups.map(g => {
              const list = catsByFlow[g.flow] || [];
              const nome = prettify(g.sample_description);
              const criando = creatingFor === g.merchant_key;

              return h("div", { className: "px-row", key: `${g.flow}-${g.merchant_key}` },
                h("div", { className: "px-swatch", style: { background: window.BS.swatchColor(nome) } },
                  nome.charAt(0).toUpperCase()),

                h("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                                     whiteSpace: "nowrap", fontSize: "var(--fz-6)", color: "var(--fg-0)" },
                            title: nome }, nome),

                h("span", { className: "px-chip" }, `${g.count}×`),
                h("span", { className: "mono", style: { fontSize: "var(--fz-7)",
                            color: g.flow === "income" ? "var(--pos)" : "var(--neg)" } },
                  (g.flow === "income" ? "+" : "−") + fmtBRL(Math.abs(g.total))),

                criando
                  ? h(React.Fragment, null,
                      h("input", {
                        className: "px-field", autoFocus: true, placeholder: "Nome da categoria…",
                        value: newCatName, style: { width: 160 },
                        onChange: e => setNewCatName(e.target.value),
                        onKeyDown: e => {
                          if (e.key === "Escape") { setCreatingFor(null); setNewCatName(""); }
                          if (e.key === "Enter") handleCreateNew(g);
                        },
                      }),
                      h("button", { className: "px-btn px-btn--primary", onClick: () => handleCreateNew(g),
                                    disabled: !newCatName.trim() || !!busy }, "CRIAR")
                    )
                  : h(React.Fragment, null,
                      g.suggested_category_id != null && h("button", {
                        className: "px-btn", disabled: !!busy,
                        title: "Aplicar a sugestão",
                        onClick: () => apply(g, g.suggested_category_id),
                      }, `✨ ${g.suggested_category_name}`),
                      h("select", {
                        className: "px-field", value: "", "aria-label": "Categoria",
                        disabled: !!busy, style: { width: 150 },
                        onChange: e => {
                          if (e.target.value === "__NEW__") { setCreatingFor(g.merchant_key); setNewCatName(""); }
                          else if (e.target.value) apply(g, parseInt(e.target.value, 10));
                        },
                      },
                        h("option", { value: "" }, g.suggested_category_id != null ? "Outra…" : "Escolher…"),
                        list.map(c => h("option", { key: c.id, value: c.id }, c.name)),
                        h("option", { value: "__NEW__" }, "+ Nova categoria")
                      )
                    )
              );
            })
          )
    )
  );
}

window.BS = window.BS || {};
Object.assign(window.BS, { BulkCategorizeModal });

})();
```

- [ ] **Step 4: Passar `onToast` no ponto de uso**

Em `frontend/js/screens/history.js:406-407`, a chamada de `BulkCategorizeModal`
precisa receber `onToast`. O `push` do toast vive em `screens/app.js` via
`useToasts()`. Se `screens/history.js` não tiver acesso a `push`, use o evento
global que `useToasts` já escuta (ver `primitives.js:407` — o hook escuta
`bs-toast`), acrescentando à chamada:

```js
      onToast: (msg, kind, action) =>
        window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg, kind, action } })),
```

Antes de escrever isso, **verifique o formato exato do detail** que `useToasts`
espera:

```bash
cd /home/felipe/Projects/BrokerShark
grep -n "bs-toast" -A 6 frontend/js/ui/primitives.js
```

Se o formato divergir, use o que o código espera — ele é a verdade.

- [ ] **Step 5: Provar que nenhum estilo inline de raio sobrou**

```bash
cd /home/felipe/Projects/BrokerShark
grep -c "borderRadius" frontend/js/overlays/bulk.js
```

Esperado: `0`.

- [ ] **Step 6: Rodar os testes**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `tests 85`, `pass 85`, `fail 0`.

- [ ] **Step 7: Verificar no browser (esta task NÃO está pronta sem isso)**

Subir o server (ver Task 1 Step 11) e abrir `http://127.0.0.1:8000`. Na tabela
do mês, abrir "Categorizar em lote". Confirmar, um a um:

1. As linhas são compactas — cabem ~11 comerciantes, não ~4.
2. Os swatches são **quadrados**, não círculos.
3. Escolher uma categoria no select **grava na hora**, a linha sai da lista, e
   aparece um toast com "Desfazer".
4. Clicar "Desfazer" traz a linha de volta e o lançamento volta a ficar sem
   categoria.
5. "APLICAR TODAS" aplica todas as sugestões e oferece um Desfazer só.
6. Console sem erro.

- [ ] **Step 8: Commit**

```bash
cd /home/felipe/Projects/BrokerShark
git add frontend/js/overlays/bulk.js frontend/js/screens/history.js frontend/js/core/api.js
git commit -m "feat(bulk): reconstrói a categorização em lote

Linha de ~36px contra avatar de 44px + padding 16px: ~11 comerciantes
por tela em vez de ~4. Swatch quadrado — não há círculo num grid de
pixels, e o avatar redondo era o que mais destoava.

Escolher a categoria agora GRAVA: o select já carregava a intenção no 2º
clique e o botão Salvar cobrava um 3º. A rede é o toast com Desfazer,
que vai por PATCH e não por categorize-bulk — aquele exige categoria
existente e recusa null, e desfazer aqui é sempre voltar pra null (a tela
só lista não-categorizados).

applyBulk deixa de engolir o erro (.catch(() => {})). Isso já era ruim, e
com aplicação imediata seria mentira: a linha sumiria e o usuário acharia
que gravou.

applyAllSuggestions era await em série; o comentário dizia que paralelo
competia pelo mesmo estado, e era verdade — cada onApply removia o grupo
da lista. Agora a decisão é pura (suggestionPlan) e o efeito é
Promise.allSettled com um estado só no fim: preserva o motivo do serial
sem a fila de N round-trips.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Reconstruir Gerenciar Categorias

**Files:**
- Rewrite: `frontend/js/overlays/categories.js`

**Interfaces:**
- Consumes: `.px-*` (Task 1); `window.BS.Modal`, `window.BS.SegmentControl`;
  `fetchCategoriesFull(flow)`, `postCategory(name, flow)`,
  `patchCategory(id, name)`, `deleteCategory(id, reassignTo)` de `core/api.js`.
- Produces: `window.BS.CategoriesPanel` — mesmas props
  (`refreshKey, onRefresh, onClose`).

**Load-bearing, não mexer:** a exclusão exige destino de reatribuição. Sem isso
os lançamentos ficam órfãos e viram indistinguíveis dos que ainda faltam
categorizar. O `handleDelete` atual já garante isso (`if (!deleteModal || !reassignTo) return;`
e o botão desabilitado quando `transaction_count > 0` e não há destino) —
preservar as duas guardas.

- [ ] **Step 1: Ler o arquivo atual inteiro antes de reescrever**

```bash
cd /home/felipe/Projects/BrokerShark && cat frontend/js/overlays/categories.js
```

O comportamento a preservar: alternância expense/income por `SegmentControl`,
form de criação inline, renomear com commit em Enter/blur e cancelamento em
Escape, exclusão com reatribuição obrigatória, `onRefresh` avisando o shell.

- [ ] **Step 2: Reescrever, trocando estilo inline por `.px-*`**

As mudanças de comportamento (só estas duas):

1. **Renomear ganha afordância.** Hoje é clique num `<span>` revelado só por
   `title="Clique para renomear"` — invisível. Acrescentar um botão de lápis
   visível na linha, que entra em modo edição. O clique no nome continua
   funcionando (não remover o atalho, só deixar de ser a única porta).
2. **Excluir deixa de ser fantasma de hover.** O `×` hoje só existe no
   `onMouseEnter`. Vira `.px-btn.px-btn--danger` presente na linha.

Mapa de substituição — cada `style` inline vira classe:

| Hoje | Vira |
|---|---|
| `<div>` da linha com `padding/borderRadius/onMouseEnter` | `className: "px-row"` |
| dot `borderRadius: "50%"` do fluxo | `className: "px-swatch"` (cor `--pos`/`--neg` por fluxo) |
| `<input>` de criar/renomear | `className: "px-field"` |
| botão "Adicionar" | `className: "px-btn px-btn--primary"` |
| botão `×` de excluir | `className: "px-btn px-btn--danger"` |
| `<span>` de contagem de lançamentos | `className: "px-chip"` |
| bloco de lista vazia | `className: "px-empty"` |
| `<select>` de reatribuição | `className: "px-field"` |
| botão "Excluir Definitivamente" | `className: "px-btn px-btn--danger"` |
| botão "Cancelar" | `className: "px-btn"` |
| `borderRadius: "50%"` do botão fechar (✕) | `className: "px-btn"` |

O `<h2>` do cabeçalho e o container do Drawer mantêm o layout atual — só os
`style` de raio/sombra/transição saem.

- [ ] **Step 3: Provar que nenhum raio inline sobrou**

```bash
cd /home/felipe/Projects/BrokerShark
grep -c "borderRadius" frontend/js/overlays/categories.js
```

Esperado: `0`.

- [ ] **Step 4: Provar que as duas guardas da exclusão continuam de pé**

```bash
cd /home/felipe/Projects/BrokerShark
grep -n "reassignTo" frontend/js/overlays/categories.js
```

Esperado: aparecer tanto o `return` precoce de `handleDelete` quanto o
`disabled` do botão de excluir. Se qualquer um sumiu, a reatribuição
obrigatória foi quebrada — refazer.

- [ ] **Step 5: Rodar os testes**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `tests 85`, `pass 85`, `fail 0`.

- [ ] **Step 6: Verificar no browser**

Abrir `http://127.0.0.1:8000` → botão "Categorias" no topo. Confirmar:

1. Linhas compactas, sem canto redondo, com sombra degrau.
2. O lápis de renomear é **visível sem hover**; clicar nele entra em edição;
   Enter grava, Escape cancela.
3. O botão de excluir é **visível sem hover**.
4. Excluir uma categoria **com** lançamentos exige escolher destino — o botão
   fica desabilitado até escolher.
5. Excluir uma categoria **sem** lançamentos funciona direto.
6. Criar categoria funciona e a lista recarrega.
7. Console sem erro.

- [ ] **Step 7: Commit**

```bash
cd /home/felipe/Projects/BrokerShark
git add frontend/js/overlays/categories.js
git commit -m "feat(categories): reconstrói o gerenciador de categorias

Estilo inline vira .px-*, então o tema alcança a tela por construção.

Duas mudanças de comportamento, ambas de afordância: renomear era clique
num <span> revelado só por title — invisível; ganha lápis presente (o
clique no nome continua valendo, só deixa de ser a única porta). Excluir
era um × que só existia no hover; vira botão presente.

Preservado de propósito: a reatribuição obrigatória na exclusão. Sem ela
os lançamentos ficam órfãos e viram indistinguíveis dos que ainda faltam
categorizar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Reconstruir Importar Dados + fechar a documentação

**Files:**
- Rewrite: `frontend/js/overlays/import.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `.px-*` (Task 1); `window.BS.Modal`, `BankChip`, `fmtDateBR`,
  `fmtBRL`, `fmtBRLCompact`, `IconImport`.
- Produces: `window.BS.ImportModal` — mesmas props (`onClose`, `onDone`).

**Fluxo NÃO muda.** O wizard de 2 passos (`step = (groups || b3s.length) ? 2 : 1`,
linha 151) + tela de resultado está são; o problema ali é pintura e densidade.
Não redesenhe o fluxo.

**`EditableCell` mantém o contrato:** commit no blur e no Enter, Escape cancela,
`onCommit` só é chamado se o valor mudou, `onError` recebe a mensagem quando
`onCommit` rejeita. Só os `style` inline dele mudam.

- [ ] **Step 1: Ler o arquivo atual inteiro antes de reescrever**

```bash
cd /home/felipe/Projects/BrokerShark && cat frontend/js/overlays/import.js
```

São 648 linhas. Entender `step1View` (linha ~394), `step2View` (~617) e
`resultsView` antes de tocar.

- [ ] **Step 2: Trocar estilo inline por `.px-*`, sem mexer no fluxo**

| Hoje | Vira |
|---|---|
| área de drop de arquivo | `className: "px-dropzone"` (`px-dropzone--over` no dragover) |
| `<input>`/`<select>` do passo 1 e do preview | `className: "px-field"` |
| botões de ação (Importar, Confirmar, Cancelar) | `className: "px-btn"` / `px-btn--primary"` |
| tags de contagem/valor do preview | `className: "px-chip"` |
| linhas da tabela de preview | `className: "px-row"` (ou `<tr>` com as mesmas bordas) |
| bloco de "nenhum arquivo" | `className: "px-empty"` |
| `EditableCell` — `borderRadius: 4/3` no input e no span | remover (raio 0) |

- [ ] **Step 3: Acrescentar o indicador de passo**

No cabeçalho do modal, antes do conteúdo, com `step` já calculado na linha 151:

```js
      h("div", { className: "px-steps", style: { marginBottom: "var(--s-5)" } },
        h("div", { className: `px-step ${step === 1 ? "px-step--active" : "px-step--done"}` }, "1"),
        h("div", { className: "px-step-bar" }),
        h("div", { className: `px-step ${step === 2 ? "px-step--active" : ""}` }, "2")
      ),
```

- [ ] **Step 4: Provar que nenhum raio inline sobrou nas três telas**

```bash
cd /home/felipe/Projects/BrokerShark
for f in bulk categories import; do
  echo "overlays/$f.js: $(grep -c borderRadius frontend/js/overlays/$f.js)"
done
```

Esperado: `0` nas três — é o critério de aceite nº 1 do spec.

- [ ] **Step 5: Atualizar o `CLAUDE.md`**

Duas edições. Na árvore de `Repository Structure`, na linha de `css/`,
acrescentar o arquivo novo:

```
  css/                  # estilos; pixel.css — estrutural (bordas duras, sombras degrau, scanlines CRT, dither, keyframes)
                        # pixel-ui.css — vocabulário de componente (.px-row/.px-field/.px-btn/.px-swatch/.px-chip…)
```

E na árvore de `js/domain/`, acrescentar os dois arquivos novos:

```
                        # palette.js — cor estável por nome, quantizada a 8 matizes — testada
                        # bulk.js — suggestionPlan (decisão do "aplicar todas") — testada
```

- [ ] **Step 6: Rodar os testes**

```bash
cd /home/felipe/Projects/BrokerShark/backend && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Esperado: `tests 85`, `pass 85`, `fail 0`.

- [ ] **Step 7: Verificar o import ponta a ponta no browser**

Este é o fluxo mais arriscado do app — grava no ledger. Abrir
`http://127.0.0.1:8000` → "Importar". Confirmar:

1. O indicador mostra o passo 1 ativo.
2. Arrastar (ou escolher) um CSV de extrato → detecta e vai pro passo 2.
3. O indicador passa pro 2.
4. O preview lista as linhas com densidade legível, sem canto redondo.
5. Clicar num valor/apelido edita; Enter grava; Escape cancela.
6. Confirmar importa e a tela de resultado aparece com a opção de reverter.
7. **Reverter o lote funciona** — o ledger volta ao que era.
8. Console sem erro.

Se não houver CSV à mão, ao menos confirmar 1 e o passo 1 renderizando, e
declarar isso no report — **não** afirmar que o fluxo inteiro foi verificado
sem tê-lo feito.

- [ ] **Step 8: Commit**

```bash
cd /home/felipe/Projects/BrokerShark
git add frontend/js/overlays/import.js CLAUDE.md
git commit -m "feat(import): reconstrói o fluxo de importação

Estilo inline vira .px-*; ganha indicador de passo, dropzone de borda
dura e densidade no preview.

O fluxo NÃO muda: o wizard de 2 passos + resultado estava são — ali o
problema era pintura e densidade, não desenho de interação. EditableCell
mantém o contrato (commit no blur/Enter, Escape cancela).

Fecha o critério nº 1 do spec: borderRadius inline nas três telas = 0.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Critérios de aceite (do spec)

1. `grep borderRadius` nos três arquivos → **0**.
2. Sem regressão de fluxo: import segue drop → revisão → confirmar → reverter
   lote; exclusão de categoria segue exigindo destino.
3. Lote: 1 clique categoriza; Desfazer restaura.
4. `npm test` verde — **85** ao fim (75 antes + 5 de `palette` + 5 de `bulk`).
5. As três telas indistinguíveis do resto do app em linguagem visual.
