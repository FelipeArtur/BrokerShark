# BrokerShark — Pixel Remodel + Faceted Interaction

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan
**Scope:** Frontend-only. No backend, DB, API, or financial-logic changes.

---

## Goal

Two things at once, on the **same single screen** (the single-screen strategy stays —
it was the key readability win):

1. **New visual identity** — replace the current dark-fintech look entirely with a
   **full pixel-art / 8-bit videogame** aesthetic: animated, beautiful, fun. The old
   theme is **deleted**, not toggled — pixel is the only look.
2. **New interaction model** — the widgets today *show* but don't *do*. Make the whole
   screen **faceted**: every widget is a live filter over one shared transaction table.

North-star visual reference: **Balatro** — CRT pixel finish, juicy feedback, chunky
but crisp, fully legible numbers.

Hard constraint (unchanged): **100% offline, no CDN, no build step.** Everything
vendored. Plain hyperscript React (`React.createElement`), shared `window.BS` scope.

---

## The 4 pains this fixes (user-stated)

| Pain | Fix |
|---|---|
| Drill-down feels heavy / leaves the screen | Detail never leaves: clicking anything **filters the shared bottom table** in place |
| Month switching / comparing awkward | Keep click-a-bar month select; **add a compare toggle** (previous-month ghost bars + Δ) |
| Finding a transaction is slow/buried | **Always-visible** live search box over the table (no modal) |
| Categories & "where did it go" clunky | Category/account/bank rows become **clickable facets**; **inline recategorize** in the table |

---

## Decisions (locked during brainstorm)

| Axis | Decision |
|---|---|
| Structure | **Single screen kept.** KPI strip + widget row + one shared transaction table (the detail sink) |
| Interaction | **"Everything is a filter"** — widgets are facets; a filter-token bar sits above the table; live search always visible; inline recategorize; month-compare toggle |
| Visual | **Full pixel-art**, Balatro CRT palette (navy base, juicy red/green/gold/cyan, hard black borders + stepped shadows, subtle scanline overlay), dithered chunky bars |
| Theme | **Old Dark/Light deleted.** Pixel is the only theme; `useTweaks`/theme-switch machinery removed |
| Fonts | Headings/labels **Silkscreen** (OFL); numbers/body **Departure Mono** (readable pixel mono). Vendored woff2, offline. Inter/JetBrains kept only as fallback in the stack |
| Fun — juice | CRT boot, sfx, coin-drop on money-in, pop/shake micro-interactions, **silent** shark mascot (logo + coin sprite; no chatter) |
| Fun — meta (subtle) | Savings-streak chip, all-time-high milestone chip, budget progress bar. All derived from real data |
| Sound | Built, **default-OFF**, mute toggle persisted (localStorage) |
| Rollout | **Dashboard first.** Import/transaction/categories modals get pixel-styled to match, but deeper polish of those + any other views is later phases |

---

## Architecture

### Two workstreams, one screen

**A. Visual system (CSS-first).** The frontend already centralizes design tokens in
`css/style.css` (`:root` custom properties) consumed everywhere via `var(--…)`.
Rewrite the token *values* to the pixel palette and add pixel *structure* — so most
components inherit the new look without markup changes.

- Replace the `:root` token block with the pixel palette; force radii to 0; swap font
  tokens to Silkscreen/Departure Mono.
- **Delete** the `data-theme="Light"` block, the `data-theme` switching in `useTweaks`,
  and any Dark/Light assumptions. `<html>` no longer carries a theme dataset (or
  carries a single fixed `pixel`).
- New `css/pixel.css` for structure that tokens can't express: hard `3px solid #000`
  borders, `box-shadow: Npx Npx 0` stepped shadows, `image-rendering: pixelated`,
  scanline `::after` overlay, dither gradients, keyframes (CRT boot, coin, pop/shake),
  mascot sprite. Motion gated behind `prefers-reduced-motion`.

**B. Faceted interaction (state lift).** Today `monthTx` and the widgets live inside
`DashboardView`; the bottom `TxTableWidget` already receives `monthTx`. Introduce a
single **filter state** object owned by `DashboardView` and thread it down:

```
filter = {
  categories: Set<string>,   // clicked category facets
  accounts:   Set<string>,   // clicked account facets
  banks:      Set<string>,   // clicked bank facets (fatura widget)
  search:     string,        // always-visible search box
  // month stays the existing global monthSel (unchanged)
}
```

- Each widget receives `filter` + `onToggleFacet(kind, value)` and renders its rows as
  clickable, showing active state. Clicking toggles membership.
- A new **FilterBar** (pixel chips) renders active facets above the table; each chip
  has an `×` to remove; a "clear all" clears the set.
- The bottom table filters `monthTx` through a single **pure** predicate
  `applyFilter(tx, filter)` (AND across kinds, OR within a kind; search matches
  description/display_name/merchant/amount). Widgets keep showing full-month context;
  only the **table** narrows — so facets read as "focus", not "hide".
- **Inline recategorize**: the table's category cell becomes a pixel dropdown (reuses
  the existing `CategoryEditor`/`patchTransaction` path; no new endpoint).
- **Month compare**: a toggle in the TimelineWidget overlays previous-month ghost bars
  and a Δ read-out (data already available in `monthly`). Pure presentation.

### New / changed files

```
frontend/
  css/
    fonts.css        # + @font-face Silkscreen + Departure Mono (vendored)
    pixel.css        # NEW — pixel structure (borders, shadows, scanlines, dither, mascot, keyframes)
    style.css        # tokens rewritten to pixel palette; Light theme block DELETED; radii→0
  fonts/
    silkscreen-400.woff2, silkscreen-700.woff2, departure-mono-400.woff2   # NEW, vendored
  js/
    filter.js        # NEW — PURE: applyFilter(tx, filter), toggleFacet(filter, kind, value), searchMatch()
    juice.js         # NEW — WebAudio sfx (synth, no asset files), coinDrop/boot/pop/shake, mute (localStorage)
    meta.js          # NEW — PURE derivations: savingsStreak, isAllTimeHigh, budgetProgress
    pixel-bars.js    # NEW — dithered pixel-bar renderer for cashflow (keeps click→month)
    view-dashboard.js# lift filter state; pass filter+onToggleFacet to widgets; render FilterBar; wire compare toggle
    view-history.js  # TxTableWidget: consume filter, live search input, inline recategorize cell
    primitives.js    # pixel restyle of shared Panel/KPI/Sparkline; FilterBar chip primitive
    app.js           # remove theme/useTweaks Dark/Light; keep shell; pixel topbar; mute toggle
    icons.js         # pixel/sprite variants as needed
  index.html         # drop data-theme=Dark; load pixel css + fonts; load filter/juice/meta/pixel-bars scripts
```

### The pure modules (isolated, testable)

1. **`filter.js`** — `applyFilter(tx, filter) → bool`, `toggleFacet(filter, kind,
   value) → filter'`, `searchMatch(tx, q) → bool`. No DOM, no state. Fully unit-tested.
2. **`meta.js`** — streak/high-score/budget from real inputs. No fabricated numbers.
   Budget target = a localStorage constant for v1 (`null` → bar hidden). No backend.
3. **`juice.js`** — `window.BS.juice`: `sfx(name)`, `coinDrop(el)`, `boot()`,
   `pop(el)`, `shake(el)`, `muted()/setMuted()`. Sounds **synthesized via WebAudio**
   (no audio files → stays offline). Mute in localStorage (`bs.muted`, default `true`).
   Respects `prefers-reduced-motion`.
4. **`pixel-bars.js`** — dithered bar renderer; preserves the click→month contract and
   pos/neg coloring.

### Data flow (backend untouched)

```
API (unchanged) → DashboardView fetches same data (monthTx, cashflow, accounts, …)
   → owns filter state; widgets render facets (clickable) + FilterBar chips
   → TxTableWidget renders monthTx.filter(t => applyFilter(t, filter)); live search; inline recat
   → juice fires on interaction; meta derives chips; pixel-bars draws cashflow
```

No new endpoints, no schema change. Backend contract byte-for-byte identical.

---

## Components (dashboard surface)

- **Topbar** — pixel wordmark + silent shark; month nav (‹ label ›, Hoje); **live
  search box**; Import / Categories buttons; mute toggle; streak/high-score chips.
- **KPI strip** — hero "Em Caixa" + Patrimônio + Resultado do mês + Investido, pixel
  panels, Departure Mono numbers.
- **Widget row (facets)** — Visão Geral, Fluxo (with compare toggle), Contas,
  Fatura, Categorias, Investimentos. Category/account/bank rows are clickable facets
  with active-state styling.
- **FilterBar** — pixel chips of active facets (`×` to remove) + clear-all. Hidden
  when no facets active.
- **Transaction table** — the shared detail sink; filtered by facets + search; inline
  recategorize; budget progress bar can live near KPI or Visão Geral.

---

## Error handling & edge cases

- **Fonts fail** → `font-display: swap` + Inter/JetBrains fallback; layout must hold.
- **WebAudio blocked/autoplay** → `sfx` no-ops; default-OFF means sound only after a
  user gesture anyway.
- **`prefers-reduced-motion`** → CRT boot / shake / coin disabled; static pixel look.
- **Empty filter** → table shows the full month (identity predicate).
- **Filter matches nothing** → explicit pixel "nenhum lançamento com esses filtros"
  empty state + one-click clear.
- **Facet value disappears** across months (category absent) → stale facet simply
  matches nothing; clear-all recovers. Optionally prune facets on month change.
- **Sparse data (<2 months)** → meta chips return safe defaults and hide.
- **Inline recategorize failure** → toast error, cell reverts (reuse existing path).

---

## Testing

- **`filter.js` unit tests** (`node:test`): AND-across / OR-within logic, search over
  description/display_name/merchant/amount, empty filter identity, no-match, toggle
  add/remove.
- **`meta.js` unit tests**: streak, all-time-high, budget math, sparse/empty inputs.
- **`juice.js`**: mute persistence + reduced-motion gating (logic tested; audio manual).
- **Visual/interaction QA** via `/browse` or `/qa` on the running server: click a
  category → table filters; chip appears; `×` removes; search narrows live; month
  click still selects; compare toggle overlays previous month; inline recat persists;
  mute persists across reload.
- **Legibility check** — real numbers stay readable in Departure Mono at KPI, widget,
  and table sizes (the whole premise).
- **Offline check** — load with network off; zero external requests.

---

## Out of scope (this phase)

- Deep pixel polish of import/transaction/categories modals beyond matching styling.
- Backend, DB, API, or financial-invariant changes.
- Editable budget-target UI beyond a localStorage constant.
- Full RPG mechanics (XP/quests/achievements) — deliberately cut.
- Saving/persisting filter sets across reloads (v1 filters are session-only).

---

## Success criteria

1. One cohesive, animated pixel/8-bit screen — reads as "fun" on sight.
2. Every money figure as legible as today (or the change is rejected).
3. Clicking any category/account/bank/month filters the shared table in place; active
   filters are visible removable chips; search is always available.
4. Month compare works; inline recategorize works.
5. Old Dark/Light theme fully removed; pixel is the only look.
6. 100% offline, no CDN, no build step, no new npm dep.
7. Meta layer shows only real derived numbers; sound default-off with persisted mute;
   motion respects `prefers-reduced-motion`.
