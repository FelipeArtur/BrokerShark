# DESIGN.md — BrokerShark

Sistema visual do dashboard. Fonte dos tokens: `frontend/css/style.css` (`:root`).

## Theme

Dark-first (default `data-theme="Dark"`); Light completo via `:root[data-theme="Light"]`.
Neutros frios (hue 250), superfícies em degraus `--bg-0…3`, hairlines `--line-1/2`.

## Color

- **Accent** (única cor de marca): cyan "água de tubarão" `oklch(78% 0.13 200)` — ações primárias, foco, seleção (mês ativo na timeline). Nunca decoração.
- **Semânticas**: `--pos` (verde 150, receita/positivo), `--neg` (vermelho 20, despesa), `--info` (azul 255, transferências SELF/liquidação — deliberadamente distinto do accent), `--reserve` (violeta 290, movimento de investimento), `--warn` (âmbar 75).
- **Bancos**: `--nubank` (roxo 305), `--inter` (laranja 55) — chips e proporção de caixa.
- Paleta de investimentos: fria (teal→cyan→azul→índigo→violeta), liderada pelo accent — `INV_COLORS` em `view-dashboard.js`/`view-investments.js`.

## Typography

- **Inter** (UI) + **JetBrains Mono** (todo número financeiro — classe `.mono`, `tnum`/`zero`). Vendorizadas, offline.
- Escala fixa em px (`--fz-9…0`); dashboards não usam clamp fluido.
- Valores: mono 26–30px na faixa KPI, 11–14px em widgets. Labels: 10px uppercase tracked (`.kpi-label`, `.widget-title`).

## Layout (dashboard único)

- Shell: `.v3-topbar` (52px) → `.kpi-strip` (4 colunas, sticky) → `.dash-main` (scroll) com `.dash-grid` 12 colunas, max 1600px, gap 14px.
- Spans: `.wg-8`/`.wg-4` → 12/6 em ≤1280px → 12 em ≤900px. Alvo: desktop ≥1440 e notebook 1280; mobile não é alvo.
- Drill-downs: `.drill` overlay tela cheia (primitiva `Overlay`), header próprio com "‹ Painel" + Esc. Estado do dashboard preservado por trás.

## Components

- `Overlay` (drill), `Modal` (Esc fecha, focus trap), `Drawer`, `SegmentControl`, `BankChip`, `TxRow`, `Donut`/`DualLine`/`SingleAreaChart` (Chart.js), toasts (`useToasts`).
- Widgets: `.widget` (bg-1, hairline, r-4) com `.widget-h` + `.widget-open` (botão de drill com kbd hint).
- Timeline: `.tl-slot` clicável = seletor de mês (barras receita×despesa por mês).

## Motion

Curta e de estado: `fade-in` 0.18–0.3s ease-out; transições 0.1–0.15s em hover/tema. `prefers-reduced-motion` zera tudo. Sem coreografia de load.

## Voice

pt-BR, direto, adulto. Números nunca arredondados "pra ficar bonito"; sinais explícitos (+/−); labels curtos em uppercase tracked só em eyebrows de bloco.
