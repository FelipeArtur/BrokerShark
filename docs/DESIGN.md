# docs/DESIGN.md — BrokerShark

Sistema visual do dashboard. **Fonte dos tokens: `frontend/css/style.css` (`:root`)**;
a camada estrutural pixel vive em `frontend/css/pixel.css`. Se este arquivo divergir do
CSS, o CSS ganha — atualize aqui.

## Theme

**Tema único: pixel-art / 8-bit, paleta Balatro-CRT, dark.** Não há troca de tema — não
existe `data-theme` no código. O único atributo de raiz que muda tokens é
`data-density` (`compact` / `comfortable`), que ajusta `--fz-6`, `--fz-5` e `--topbar-h`.

Superfícies em degraus (`--bg-0` `#0e0f1a` → `--bg-3` `#2a2d48`), hairline preto puro
(`--line-1` `#000`) e `--line-2` `#3a3d63`. Texto: `--fg-0` `#fdf6e3` (creme) →
`--fg-3` `#6a6d95`.

**Cantos são duros em todo lugar**: `--r-1…--r-6` são todos `0`, e o reset universal
`*, *::before, *::after { border-radius: 0 !important }` (`style.css`) torna a regra
inescapável — inclusive contra `style={{borderRadius}}` inline. Um `border-radius` novo
não é bug: é impossível. (A auditoria de 2026-07-24 achou 34 violações justamente porque
o reset antigo só cobria 5 classes de container.)

## Regras invioláveis (revisão 2026-07-24)

Estas venceram uma auditoria de código; quando este doc divergir do CSS, o CSS ganha —
mas estas seis são para valer nos dois.

1. **Piso de contraste.** Texto ≥4.5:1 contra o fundo em que assenta. `--fg-3` foi
   `#6a6d95` (3.54:1, reprovado) e virou `#9296bd` (6.12 / 5.45 / 4.67 sobre
   `--bg-1/2/3`). `--fg-faint` guarda o tom antigo para hairline e ícone decorativo —
   **nunca** para texto.
2. **Piso de 11px.** Vale para CSS e para `style={{fontSize}}` inline. Exceção estreita:
   número **tabular em Departure Mono** pode ir a 10px em tabela densa (o mono é legível
   nesse tamanho; a bitmap Silkscreen não é). 9px é proibido em qualquer fonte, e
   uppercase/label nunca abaixo de 11px.
3. **Silkscreen só em título.** O `body` é Departure Mono.
4. **Uppercase só em título de bloco**, ≥11px.
5. **Cantos duros, sem exceção** — reset universal com `!important`.
6. **Widget ganha espaço por densidade de informação, não por constante.** O orçamento
   de colunas de `.widget-row` (14) tem que fechar exatamente; widget sem dado colapsa
   em vez de ocupar uma coluna inteira. O bug de 2026-07 (spans somando 17 em 14
   colunas, esmagando cada card a ~175px de 280px) nasceu de ninguém conferir a soma.

**Verde é receita e só receita.** Sem exceção — o KPI herói "Em Caixa" é creme
(`--fg-0`), não verde, justamente para não abrir a primeira brecha.

**Escala de z-index semântica** (`--z-sticky` 10 · `--z-dropdown` 20 · `--z-scanline` 30
· `--z-backdrop` 40 · `--z-layer` 50 · `--z-toast` 60). Números avulsos como 9999 ou
10000 são regressão.

## Color

- **Accent** (identidade tubarão): cyan `--accent` `#5cc6ff` — ação primária, foco,
  seleção, faceta ativa. Nunca decoração.
- **Espécies de dinheiro** — a semântica está em `frontend/js/domain/money.js` (`KIND_COLOR`),
  não aqui; este doc só registra os tokens:

  | espécie | token | cor |
  |---|---|---|
  | receita | `--pos` | `#7be08a` verde |
  | despesa de consumo | `--neg` | `#ff5b6e` vermelho |
  | investimento | `--reserve` | `#c58cff` violeta |
  | transferência SELF · liquidação de fatura | `--fg-3` | `#6a6d95` cinza |
  | gasto de terceiro | `--warn` | `#ffcf5c` âmbar |

  Liquidação entra ainda atenuada (opacidade 0.6). **Verde é receita e só receita** —
  nunca reusar pra "ok"/"dentro do alvo", senão a semântica quebra.

- **Aplicação da cor**: numa tabela longa, o **sinal** (`+`/`−`) carrega a cor da espécie
  e o número fica neutro (`--fg-1`); os centavos entram atenuados (`--fg-3`, ~0.78em).
  Pintar o número inteiro só em poucos e grandes: KPI herói, cabeçalho de grupo, rodapé
  (`<Money emphasis>` em `primitives.js`).

- **Progresso de orçamento** (`budgetState` em `tx-group.js`): < 80% `--accent`,
  80–100% `--warn`, > 100% `--neg`.

  A health-bar de orçamento no card usa **accent (<80%) · warn (80–100%) · neg (>100%)** —
  nunca verde. Verde segue exclusivo de receita.

- **Bancos**: `--nubank` `#c58cff` (violeta), `--inter` `#ffab5c` (laranja) — chips.

> ⚠️ **`--info` (`#5cc6ff`) é hex IDÊNTICO ao `--accent`.** Ele existia pra marcar
> transferência/liquidação como "deliberadamente distinto do accent", o que nunca foi
> verdade no código. Essas espécies migraram pro cinza (`--fg-3`); `--info`/`--info-bg`
> sobrevivem só em `.chip.info` (`style.css`) e são candidatos a remoção.

## Typography

- **Departure Mono** (`--ff-mono`) é a fonte do `body` e carrega TODO texto corrido,
  número, label de dado e empty state. **Silkscreen** (`--ff-sans`) é reservada a
  título de bloco, marca e botão — e nunca abaixo de 11px. Bitmap font em texto de
  9px foi a causa raiz da ilegibilidade de 2026-07. Ambas vendorizadas em `frontend/fonts/` — 100% offline.
  Inter / JetBrains Mono ficam como fallback na stack.
- Escala fixa em px (`--fz-9`/`--fz-8` 11px … `--fz-0` 44px); dashboard não usa clamp fluido.
- **Piso de 11px.** Nenhum texto abaixo disso, em CSS ou inline. `--fz-9` existe só como
  alias histórico e vale 11px.
- **Uppercase + tracking só em título de bloco**, sempre ≥11px. Sub-linha de dado,
  empty state e valor nunca são uppercase.
- Números sempre `font-variant-numeric: tabular-nums` — coluna de valor tem que alinhar.
- Labels: uppercase com `letter-spacing: 1px` (`.widget-title`, `.kpi-label`, `.label`).

## Layout (dashboard único)

- Shell: topbar (`--topbar-h` 52px) → faixa KPI (4 colunas, fixa) → grid de widgets
  (12 colunas, gap 14px) → tabela full-width com scroll interno. **A página nunca rola**;
  o scroll é interno ao widget.
- Spans `.wg-8`/`.wg-4` → 12/6 em ≤1280px → 12 em ≤900px. Alvo: desktop ≥1440 e notebook
  1280. **Mobile não é alvo.**
- Drill-downs: overlay tela cheia (primitiva `Overlay`), estado do dashboard preservado
  por trás. Nunca navegação, nunca aba. **Drawer lateral não existe mais** — gerenciar
  categorias virou drill-down como todo o resto.

## Components

- Primitivas (`primitives.js`): `Overlay` (drill), `Modal` (Esc fecha + focus trap),
  `SegmentControl`, `BankChip`, `TxRow`, `Money`, `FilterBar`, toasts (`useToasts`),
  `Donut`/`DualLine`/`SingleAreaChart` (Chart.js).
- Painéis (`.widget`, `.kpi-strip`, `.modal`, `.table-widget`): borda preta **1px**, sem
  sombra. Hover só troca a cor da borda para `--line-2`. **O cromo é quieto**: a diversão
  pixel mora no movimento (`juice.js`, `steps()`), nas barras dithered e no press do
  `.px-btn` — nunca na moldura de cada bloco.
  A faixa KPI é emoldurada como **um** painel, não quatro cards.
- Barras dithered: `.dither-pos` / `.dither-neg` / `.dither-warn` (gradiente 45° em
  faixas de 3–4px). Fluxo mês a mês é clicável = seletor de mês global.
- Tabela: agrupada por categoria, cabeçalho de grupo colapsável carrega total + barra de
  alvo + Δ vs. mês anterior. O valor da linha escala com a fatia dentro do grupo (11→15px,
  `scaleFor` em `tx-group.js`).

> `Drawer` ainda existe em `primitives.js` — após a remoção do drawer de categorias, fica
> sem caller. Candidato a remoção.

## Motion

Curta e de estado, com **`steps()`** — a estética é pixel, então nada de easing contínuo
nas animações de feedback: `bs-boot` 420ms steps(6), `bs-pop` 180ms steps(3), `bs-shake`
200ms steps(2)×2, `bs-coin` 600ms steps(6). Transições de cor/hover: 0.15s ease.
`prefers-reduced-motion: reduce` zera todas as animações. Sem coreografia de load.

Scanline: overlay fixo no viewport (`#app::after`), muito fraco (5%) e **sem** blend
multiply — com blend, o texto embaçava.

Apenas arte raster leva `image-rendering: pixelated` (`img`, `.bs-mascot`). **Nunca em
DOM/texto** — fica borrado.

## Voice

pt-BR, direto, adulto. Números nunca arredondados "pra ficar bonito"; sinal sempre
explícito (`+`/`−`); labels curtos em uppercase tracked só em eyebrows de bloco. Rótulo
de espécie explica o porquê no `title` (ver `KIND_HINT` em `money.js`) — o usuário nunca
deve ter que adivinhar por que um valor não entrou num total.
