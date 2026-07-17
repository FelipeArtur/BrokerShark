# Organização de pastas e nomenclatura — design

**Data:** 2026-07-17
**Escopo:** layout do repo. Zero mudança de comportamento, lógica ou schema.
**Ordem:** roda ANTES da reconstrução das três telas
(`2026-07-17-rebuild-three-screens-design.md`), pra que as telas já nasçam no
lugar certo.

---

## Diagnóstico

A queixa foi "componente, regra de negócio e teste misturados; cadê o back, cadê
o banco". Investigado, é uma queixa e meia:

**O backend já está bem em camadas** — `db/` (banco), `domain/` (regra pura, sem
DB/IO), `ingest/` (parsers), `http/` (infra), `routes/` (handlers), `jobs/`
(backfill). Não se mexe na estrutura interna.

**`frontend/js/` é o misturado de verdade:** 19 arquivos chapados numa pasta,
onde o nome do arquivo é a única pista do que a coisa é.

| O que é | Arquivos |
|---|---|
| Regra de negócio pura | `money` `tx-group` `filter` `meta` |
| Componente reusável | `primitives` `icons` `pixel-bars` |
| Tela / overlay | `view-*` `modal-*` `app` |
| Infra | `api` |
| Efeito | `juice` |

O frontend **já tem** um domínio puro e testado — espelho exato de
`backend/src/domain/`. Só não tem a pasta. O prefixo `view-`/`modal-` é pasta
fingindo ser nome de arquivo.

**Testes co-locados NÃO são o problema; são deliberados.** Documentado no
`CLAUDE.md` (`npm test = node:test (co-locado)`). Co-location é convenção
corrente: teste ao lado do fonte é achado, movido e apagado junto. Separar em
`tests/` espelhando a árvore cria duas árvores pra manter em sincronia.
**Mantido.** O que incomodava era a densidade da pasta chapada, que as pastas
resolvem.

**`backend-ts` é fóssil.** O sufixo `-ts` distinguia do backend Python do v1,
removido no rewrite. Hoje não distingue de nada e fica assimétrico com
`frontend/`.

---

## Alvo

```
backend/                  (era backend-ts/ — sufixo fóssil)
  data/                   (era ./data/ — ledger SQLite; gitignored)
  src/                    inalterado: db, domain, ingest, http, routes, jobs
frontend/
  js/
    domain/    money, tx-group, filter, meta      ← espelha backend/src/domain
    core/      api, juice
    ui/        primitives, icons, pixel-bars
    screens/   app, dashboard, history
    overlays/  transaction, import, bulk, categories
  css/, fonts/, img/      inalterados
docs/, README.md, CLAUDE.md
```

`*.test.js` / `*.test.ts` permanecem co-locados ao lado do fonte.

### `overlays/`, não `modals/`

"Overlay" é a palavra do próprio produto: o `CLAUDE.md` diz "detalhe abre em
**drill-down overlay**, nunca navegação", e `primitives.js` já exporta `Overlay`.
Modal e drawer são a mesma ideia — abre por cima da tela única. Isso decide onde
`CategoriesPanel` mora: é drawer, não tela.

### Mapa de movimentação (frontend)

| De | Para |
|---|---|
| `js/money.js` (+test) | `js/domain/money.js` |
| `js/tx-group.js` (+test) | `js/domain/tx-group.js` |
| `js/filter.js` (+test) | `js/domain/filter.js` |
| `js/meta.js` (+test) | `js/domain/meta.js` |
| `js/api.js` | `js/core/api.js` |
| `js/juice.js` (+test) | `js/core/juice.js` |
| `js/primitives.js` | `js/ui/primitives.js` |
| `js/icons.js` | `js/ui/icons.js` |
| `js/pixel-bars.js` | `js/ui/pixel-bars.js` |
| `js/app.js` | `js/screens/app.js` |
| `js/view-dashboard.js` | `js/screens/dashboard.js` |
| `js/view-history.js` | `js/screens/history.js` |
| `js/view-overview.js` | `js/overlays/categories.js` |
| `js/modal-transaction.js` | `js/overlays/transaction.js` |
| `js/modal-import.js` | `js/overlays/import.js` |
| `js/modal-bulk.js` | `js/overlays/bulk.js` |

`view-overview.js → overlays/categories.js` conserta um nome errado: o arquivo é
`CategoriesPanel`; "overview" é fóssil da tela "Dinheiro" que virou o dashboard
— o comentário no topo do arquivo já admite isso.

---

## Restrições duras

**Não há build step.** A ordem dos `<script>` no `index.html` é manual e
load-bearing (`money` antes de `primitives`; `app.js` por último). Cada tag tem
`?v=NN` na mão. `static.ts` mapeia `/static/<sub>` → `frontend/<sub>` — o mapa
não muda, só os subcaminhos. Mover arquivo = acertar `index.html` na mão.

**Nada de import/export.** Cada arquivo é IIFE publicando em `window.BS`. Mover
arquivo **não** quebra referência entre arquivos (não há caminho de import no
JS) — só as tags do `index.html`. Isso é o que torna esse reorg barato.

**`git mv`** preserva histórico. Usar sempre.

### A armadilha do glob de teste

```json
"test": "node --test \"src/**/*.test.ts\" \"../frontend/js/*.test.js\""
```

O glob do frontend é chapado (`js/*.test.js`). Assim que os testes puros vão pra
`js/domain/`, ele deixa de casar e **os 5 testes do frontend somem da suíte em
silêncio** — `npm test` fica verde testando menos. Vira `js/**/*.test.js` **no
mesmo commit** do move. Verificação obrigatória: a contagem de testes antes e
depois tem de bater (75).

### O move do `data/`

O mais arriscado, e o único que toca dado real.

- **Não é versionado** (`.gitignore`: `data/`). Git não desfaz. O padrão `data/`
  não tem barra inicial, então casa em qualquer nível e `backend/data/` continua
  ignorado — **verificar com `git check-ignore` depois do move.**
- **WAL ativo.** Mover `.db` com WAL/SHM vivos corrompe. **Derrubar o server
  antes**; mover os três arquivos (`.db`, `.db-wal`, `.db-shm`) juntos.
- **Reconstruível.** Verificado em 2026-07-17: 901 transações, zero com
  `import_batch_id`/`display_name`/`is_third_party` — nenhum overlay da UI, tudo
  do backfill. Se corromper, `backfill --force` refaz a partir do acervo. (Se um
  dia houver overlay da UI, esse move deixa de ter rede.)
- **Dois caminhos default a atualizar**, ambos relativos a `import.meta.dirname`:
  `server.ts:43` (`../../data/…`) e `jobs/backfill.ts:36` (`../../../data/…`).
  Depois do move viram `../data/…` e `../../data/…`.
- Permissões 0600 preservadas (`mv` mantém).

---

## Fora de escopo

- Estrutura interna de `backend/src/` — já está boa.
- Separar teste do fonte — co-location é deliberada e fica.
- Qualquer mudança de lógica, comportamento, schema ou invariante financeira.
- Planos/specs datados em `docs/superpowers/` citando `backend-ts` — são
  registro histórico do que era verdade na data. Não reescrever.

---

## Critérios de aceite

1. `npm test` verde **e com a mesma contagem de antes (75)** — prova que o glob
   novo acha os testes do frontend.
2. App sobe e renderiza: sem 404 de script, sem erro de console.
3. `git log --follow` acha o histórico de um arquivo movido (prova do `git mv`).
4. `git check-ignore backend/data/brokershark-v2.db` → ainda ignorado.
5. Ledger intacto: 901 transações depois do move.
6. Zero ocorrência de `backend-ts` fora de `docs/` (histórico) e
   `package-lock.json`.
7. `git status` limpo de arquivo não rastreado inesperado.
