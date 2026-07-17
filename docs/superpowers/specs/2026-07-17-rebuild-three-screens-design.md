# Reconstrução das três telas de apoio — design

**Data:** 2026-07-17
**Escopo:** `modal-bulk.js` (Categorizar em lote), `view-overview.js` (Gerenciar
Categorias), `modal-import.js` (Importar Dados).

---

## Problema

As três telas ficaram fora do remodel pixel. O diagnóstico é mecânico, não
estético: `pixel.css` aplica a linguagem pixel via
`border-radius: 0 !important`, mas o seletor alcança só as classes de painel
(`.widget`, `.modal`, `.kpi-strip`, `.drawer`, `.table-widget`). O **conteúdo
interno** dessas três telas é estilizado com objetos `style` inline no JS, e
estilo inline vence stylesheet independente de `!important`.

Resultado: as três são exatamente as três com mais `borderRadius` inline do
frontend.

| Arquivo | `borderRadius` | `boxShadow` | `gradient` |
|---|---|---|---|
| `modal-import.js` | 16 | 2 | 0 |
| `view-overview.js` | 14 | 1 | 0 |
| `modal-bulk.js` | 10 | 3 | 1 |
| `view-history.js` (convertida) | 1 | 0 | 0 |

Elas carregam a linguagem visual anterior ao remodel intacta: cantos de 12px,
sombras suaves difusas, gradientes, avatares circulares, `transition: 0.2s`.

O usuário confirmou que o incômodo é nas quatro dimensões: **visual destoa**,
**fluxo/interação ruim**, **densidade/legibilidade**. Logo, repintar não
resolve — é reconstrução.

## Abordagem escolhida

**Vocabulário pixel em CSS; telas viram markup fino.** As primitivas que as três
repetem viram classes; as telas passam a consumi-las em vez de objetos `style`.

Ataca a causa raiz: o estilo inline é o que torna o tema inalcançável. Depois
disso o tema alcança as telas por construção, e a próxima mudança de tema não
precisa reabrir esses arquivos.

**Alternativas descartadas:**

- *Repintar inline* (trocar `borderRadius: 12` por `0` em cada objeto): rápido,
  mas não entrega fluxo nem densidade, e deixa a mesma armadilha montada.
- *Reconstruir cada tela isolada, estilo ad-hoc*: três telas divergem de novo em
  três direções — foi assim que chegamos aqui.

---

## Parte 1 — Fundação: `frontend/css/pixel-ui.css`

Arquivo **novo**. `pixel.css` é a camada estrutural (bordas, CRT, dither,
keyframes) e o `CLAUDE.md` a descreve assim; vocabulário de componente
interativo é outra preocupação, e misturar borraria essa fronteira.

| Classe | Substitui |
|---|---|
| `.px-row` | linha de item inline-styled (3 cópias divergentes hoje) |
| `.px-field` | input / select |
| `.px-btn`, `.px-btn-primary`, `.px-btn-danger` | ~10 botões inline |
| `.px-chip` | tag mono (contagem, valor) |
| `.px-swatch` | avatar circular |
| `.px-dropzone` | área de drop do import |
| `.px-steps` | indicador de passo do wizard |
| `.px-empty` | estado vazio |

### Três conversões load-bearing

**Círculos viram quadrados.** `borderRadius: "50%"` aparece 6 vezes (avatares,
botão fechar, dot de fluxo). Não há círculo num grid de pixels — é o que mais
faz essas telas destoarem.

**Paleta quantizada.** `stringToColor` faz `hash % 360` → 360 matizes, cada
comerciante uma cor levemente diferente. Arte pixel é definida por paleta
*limitada*. Quantizar para ~8 matizes da paleta Balatro. Mantém a estabilidade
(mesma string → mesma cor), corta a variação contínua.

**Botão que afunda.** `transition: 0.2s` suave → `:active` desloca
`translate(1px, 1px)` e a sombra degrau colapsa. Feedback Balatro, reusando a
linguagem de sombra que já existe.

### Regra geral

- `border-radius` → `0`; borda dura `2px solid var(--line-1)`.
- Sombra suave/difusa → degrau (`2px 2px 0 #05060d`).
- Gradiente → fill chapado ou dither (`.dither-*` já existe em `pixel.css`).
- `transition: Xs` suave → `steps()` ou nada.
- Tokens de cor/fonte vêm de `style.css`; `pixel-ui.css` não define paleta.

---

## Parte 2 — As telas

### Categorizar em lote (`modal-bulk.js`)

**Densidade.** Linha ~36px (swatch 20px + nome + chip de contagem + valor +
select), contra 44px de avatar + 16px de padding hoje. ~11 comerciantes
visíveis contra ~4.

**Interação — decisão do usuário:** escolher categoria no select **aplica na
hora**. A linha faz `bs-pop`, sai da lista, e um toast oferece *Desfazer*. O
botão "Salvar" deixa de existir: custava o 3º clique e o select já sabia a
intenção no 2º. Casa com o padrão de undo que o import já usa.

**`applyAllSuggestions` — cuidado.** Hoje roda `await` em série *de propósito*:
o comentário no código diz que paralelo competiria pelo mesmo estado, e está
correto, porque cada `onApply` remove o grupo da lista. A reconstrução dispara
as chamadas em paralelo mas atualiza o estado **uma única vez ao fim**, em vez
de uma vez por resposta. Preserva a razão do serial sem pagar a fila de N
round-trips.

**Preservado:** sugestão inline (`✨ Nome`), criar categoria inline, agrupamento
por comerciante ordenado por gasto.

### Gerenciar Categorias (`view-overview.js`)

**Afordância.** Renomear hoje é clique num `<span>` revelado só por `title` —
ganha ícone de lápis visível. Excluir é `×` cinza que só aparece no hover —
vira botão presente.

**Densidade.** Linha compacta, mesmo `.px-row` do lote.

**Preservado (load-bearing):** reatribuição **obrigatória** na exclusão. Sem
ela, os lançamentos ficam órfãos e viram indistinguíveis dos que ainda faltam
categorizar.

### Importar Dados (`modal-import.js`)

**Fluxo não muda.** O wizard de 2 passos (drop+banco → revisão) + tela de
resultado está são. O problema ali é pintura e densidade.

- Indicador de passo (`.px-steps`).
- Dropzone pixel (borda dura tracejada).
- Densidade na tabela de preview.
- `EditableCell` mantém o contrato (commit no blur/Enter, Escape cancela).

---

## Fora de escopo

**Alvo de gasto continua editado na tabela** (`view-history.js`), não no painel
de categorias. `CategoriesPanel` chama um endpoint que devolve só
`id, name, flow, transaction_count`; o alvo é editado onde o gasto está visível
ao lado. É um split defensável — mudá-lo é outra decisão, não esta.

Nenhuma mudança de backend, schema ou invariante financeira. Nenhuma mudança em
`view-dashboard.js` / `view-history.js`.

---

## Testes

`npm test` cobre helpers puros (`money`, `tx-group`, `filter`, `meta`, `juice`
via node:test). O repo **não tem jsdom**, então componente React não entra em
teste unitário aqui, e CSS não é testável em unidade.

**Ganham teste node, seguindo a convenção dos 5 puros existentes:**

- `quantizeHue(str) → number` — índice de matiz na paleta. Mesma string devolve
  sempre o mesmo índice; o índice cai sempre dentro da paleta (`0 ≤ i < 8`);
  string vazia não quebra.
- `suggestionPlan(groups) → [{merchant_key, category_id}]` — filtra os grupos
  com `suggested_category_id != null` e devolve os pares a enviar. Puro: separa
  a decisão "o que aplicar" do efeito "aplicar", que é o que torna o batch
  paralelo testável sem DOM nem rede.

O resto verifica no browser (server local já sobe em `127.0.0.1:8000`):
densidade real das listas, aplicar-na-hora + Desfazer, exclusão com
reatribuição, wizard de import ponta a ponta.

## Critérios de aceite

1. `grep borderRadius` nos três arquivos → **0**.
2. Nenhuma regressão de fluxo: import continua drop → revisão → confirmar →
   reverter lote; exclusão de categoria continua exigindo destino.
3. Lote: 1 clique categoriza; Desfazer restaura.
4. `npm test` verde.
5. As três telas indistinguíveis do resto do app em linguagem visual.
