# Pixel Remodel + Faceted Interaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BrokerShark's dark-fintech dashboard with a full pixel-art / 8-bit look and make every widget a live filter over one shared transaction table — all on the existing single screen.

**Architecture:** Two workstreams on the same screen. (1) Visual: rewrite `:root` design tokens to a pixel palette, add a `pixel.css` structure layer, delete the Dark/Light theme machinery. (2) Interaction: lift the filter state that already lives inside `TxTableWidget` up into `DashboardView`, let widgets toggle facets, render a chip bar, keep search always visible, add inline recategorize and a month-compare toggle. Pure logic (`filter.js`, `meta.js`, juice helpers) is authored with a UMD dual-export tail so it unit-tests under `node --test` and still attaches to `window.BS` in the browser.

**Tech Stack:** Plain browser JS hyperscript (`React.createElement`, no JSX, no build step), React 18 vendored, CSS custom properties, `node --test` (Node ≥ 26), WebAudio (synth, no audio assets), self-hosted woff2 fonts.

## Global Constraints

- **100% offline. No CDN, no external network at runtime.** Every asset (fonts, scripts, fun sfx) is local or synthesized. Copied verbatim from spec.
- **No build step.** Frontend files are classic `<script>` tags sharing a global `window.BS`. Never introduce JSX, bundlers, or transpilers.
- **No new npm dependency.** `xlsx` stays the only one.
- **No backend / DB / API / financial-invariant change.** Frontend-only. The API contract is byte-for-byte identical.
- **Money stays in integer cents in the ledger; the frontend formats via `window.BS.fmtBRL`.** Never introduce float math on money.
- **Pixel is the only theme.** Dark/Light are deleted, not toggled.
- **Sound default-OFF; mute persisted in `localStorage` key `bs.muted`.** Motion respects `prefers-reduced-motion`.
- **Pure modules use the UMD dual tail** so `typeof module !== "undefined"` exports for node tests and otherwise assigns onto `window.BS`.
- **Run frontend unit tests with:** `node --test frontend/js/<name>.test.js` (frontend dir has no `package.json`, so `.js` is CommonJS under node).

---

### Task 1: Vendor pixel fonts + `@font-face`

**Files:**
- Create: `frontend/fonts/silkscreen-400.woff2`, `frontend/fonts/silkscreen-700.woff2`, `frontend/fonts/departure-mono-400.woff2`
- Modify: `frontend/css/fonts.css` (append)

**Interfaces:**
- Produces: CSS font families `"Silkscreen"` (400/700) and `"Departure Mono"` (400), available to all later tasks.

- [ ] **Step 1: Obtain the woff2 files offline.** Download once, commit the binaries. Sources (both free/embeddable):
  - Silkscreen (OFL) — from Google Fonts: `https://fonts.google.com/specimen/Silkscreen`. Download the family, convert the `.ttf` to `.woff2` (e.g. `woff2_compress Silkscreen-Regular.ttf`), place as `silkscreen-400.woff2` and `silkscreen-700.woff2`.
  - Departure Mono (free license permits embedding) — from `https://departuremono.com`. Take `DepartureMono-Regular.woff2`, place as `departure-mono-400.woff2`.

  Verify the three files exist and are non-empty:

  Run: `ls -l frontend/fonts/silkscreen-400.woff2 frontend/fonts/silkscreen-700.woff2 frontend/fonts/departure-mono-400.woff2`
  Expected: three files, each > 1 KB.

- [ ] **Step 2: Append `@font-face` blocks to `frontend/css/fonts.css`:**

```css
/* ── Pixel remodel fonts (vendored, offline) ─────────────────────────────── */
@font-face {
  font-family: 'Silkscreen';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(/static/fonts/silkscreen-400.woff2) format('woff2');
}
@font-face {
  font-family: 'Silkscreen';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(/static/fonts/silkscreen-700.woff2) format('woff2');
}
@font-face {
  font-family: 'Departure Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(/static/fonts/departure-mono-400.woff2) format('woff2');
}
```

- [ ] **Step 3: Verify in the browser.** Start the server (`cd backend-ts && npm start`), open `http://127.0.0.1:8000`, DevTools → Network → filter "font": confirm the three woff2 load from `/static/fonts/` with status 200 and no external font requests.

- [ ] **Step 4: Commit.**

```bash
git add frontend/fonts/silkscreen-400.woff2 frontend/fonts/silkscreen-700.woff2 frontend/fonts/departure-mono-400.woff2 frontend/css/fonts.css
git commit -m "feat(pixel): vendor Silkscreen + Departure Mono fonts (offline)"
```

---

### Task 2: `filter.js` — pure faceted-filter logic (TDD)

**Files:**
- Create: `frontend/js/filter.js`
- Test: `frontend/js/filter.test.js`

**Interfaces:**
- Produces (all on `window.BS` in browser, `module.exports` in node):
  - `emptyFilter() → { categories:Set, accounts:Set, banks:Set, flow:"all"|"expense"|"income", method:"all"|"pix"|"credit"|"ted", search:"" }`
  - `toggleFacet(filter, kind, value) → filter'` — immutable; `kind ∈ {"categories","accounts","banks"}`. Toggles set membership.
  - `facetCount(filter) → number` — total active facets + (flow≠all) + (method≠all) + (search≠"").
  - `searchMatch(label, query) → boolean` — case-insensitive substring; empty query ⇒ true.
  - `matchesFilter(tx, filter) → boolean` — `tx` shape `{ flow, method, category, bank, label }` (caller pre-derives `bank` display name and `label` string). AND across kinds, OR within a set.
- Consumed by: Task 6 (DashboardView owns the filter), Task 8 (TxTableWidget applies it).

- [ ] **Step 1: Write the failing test** `frontend/js/filter.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const F = require("./filter.js");

const tx = (o) => Object.assign({ flow: "expense", method: "pix", category: "Mercado", bank: "Nubank", label: "zaffari supermercado" }, o);

test("emptyFilter matches everything", () => {
  const f = F.emptyFilter();
  assert.equal(F.matchesFilter(tx(), f), true);
  assert.equal(F.facetCount(f), 0);
});

test("toggleFacet adds then removes a category", () => {
  let f = F.emptyFilter();
  f = F.toggleFacet(f, "categories", "Mercado");
  assert.equal(f.categories.has("Mercado"), true);
  assert.equal(F.matchesFilter(tx({ category: "Mercado" }), f), true);
  assert.equal(F.matchesFilter(tx({ category: "Transporte" }), f), false);
  f = F.toggleFacet(f, "categories", "Mercado");
  assert.equal(f.categories.has("Mercado"), false);
});

test("OR within a kind, AND across kinds", () => {
  let f = F.emptyFilter();
  f = F.toggleFacet(f, "categories", "Mercado");
  f = F.toggleFacet(f, "categories", "Transporte");
  f = F.toggleFacet(f, "banks", "Nubank");
  assert.equal(F.matchesFilter(tx({ category: "Transporte", bank: "Nubank" }), f), true);
  assert.equal(F.matchesFilter(tx({ category: "Mercado", bank: "Inter" }), f), false); // bank fails
  assert.equal(F.matchesFilter(tx({ category: "Lazer", bank: "Nubank" }), f), false);  // cat fails
});

test("flow and method narrow", () => {
  let f = Object.assign(F.emptyFilter(), { flow: "income", method: "pix" });
  assert.equal(F.matchesFilter(tx({ flow: "income", method: "pix" }), f), true);
  assert.equal(F.matchesFilter(tx({ flow: "expense", method: "pix" }), f), false);
});

test("searchMatch is case-insensitive substring; empty ⇒ true", () => {
  assert.equal(F.searchMatch("Zaffari Supermercado", "zaffari"), true);
  assert.equal(F.searchMatch("Zaffari", "nubank"), false);
  assert.equal(F.searchMatch("anything", ""), true);
});

test("facetCount counts every active dimension", () => {
  let f = F.emptyFilter();
  f = F.toggleFacet(f, "categories", "Mercado");
  f = Object.assign(f, { flow: "expense", search: "za" });
  assert.equal(F.facetCount(f), 3);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `node --test frontend/js/filter.test.js`
Expected: FAIL — `Cannot find module './filter.js'`.

- [ ] **Step 3: Write `frontend/js/filter.js`:**

```js
/* filter.js — pure faceted-filter logic. UMD dual tail: node require + window.BS. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  function emptyFilter() {
    return { categories: new Set(), accounts: new Set(), banks: new Set(), flow: "all", method: "all", search: "" };
  }

  function toggleFacet(filter, kind, value) {
    const next = new Set(filter[kind]);
    if (next.has(value)) next.delete(value); else next.add(value);
    return Object.assign({}, filter, { [kind]: next });
  }

  function facetCount(filter) {
    return filter.categories.size + filter.accounts.size + filter.banks.size
      + (filter.flow !== "all" ? 1 : 0) + (filter.method !== "all" ? 1 : 0)
      + (filter.search ? 1 : 0);
  }

  function searchMatch(label, query) {
    if (!query) return true;
    return String(label || "").toLowerCase().includes(String(query).toLowerCase());
  }

  const METHOD_MAP = { pix: "pix", pix_received: "pix", credit: "credit", ted: "ted" };

  function matchesFilter(tx, filter) {
    if (filter.flow !== "all" && tx.flow !== filter.flow) return false;
    if (filter.method !== "all") {
      const m = METHOD_MAP[tx.method] || tx.method;
      if (m !== filter.method) return false;
    }
    if (filter.categories.size && !filter.categories.has(tx.category)) return false;
    if (filter.banks.size && !filter.banks.has(tx.bank)) return false;
    if (filter.accounts.size && !filter.accounts.has(tx.account_id)) return false;
    if (!searchMatch(tx.label, filter.search)) return false;
    return true;
  }

  return { emptyFilter, toggleFacet, facetCount, searchMatch, matchesFilter };
});
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `node --test frontend/js/filter.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit.**

```bash
git add frontend/js/filter.js frontend/js/filter.test.js
git commit -m "feat(pixel): pure faceted-filter module + tests"
```

---

### Task 3: `meta.js` — derived score layer (TDD)

**Files:**
- Create: `frontend/js/meta.js`
- Test: `frontend/js/meta.test.js`

**Interfaces:**
- Produces (on `window.BS` / `module.exports`):
  - `savingsStreak(monthlyNet) → number` — `monthlyNet` is an array (chronological) of monthly net numbers (income − expenses). Returns the count of consecutive positive months ending at the last element (0 if the last is ≤ 0 or array empty).
  - `isAllTimeHigh(series) → boolean` — `series` is chronological array of numbers (e.g. patrimônio history values). True iff the last value is strictly the max and length ≥ 2.
  - `budgetProgress(spentCents, targetCents) → { pct, remainingCents } | null` — `null` when `targetCents` is null/≤0. `pct` clamped 0..100 as spent/target; `remainingCents = targetCents - spentCents` (may be negative).
- Consumed by: Task 11 (renders chips + budget bar).

- [ ] **Step 1: Write the failing test** `frontend/js/meta.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const M = require("./meta.js");

test("savingsStreak counts trailing positive months", () => {
  assert.equal(M.savingsStreak([100, -5, 20, 30, 40]), 3);
  assert.equal(M.savingsStreak([10, 20, 30]), 3);
  assert.equal(M.savingsStreak([10, 20, -1]), 0);
  assert.equal(M.savingsStreak([]), 0);
});

test("isAllTimeHigh needs a strict trailing max and ≥2 points", () => {
  assert.equal(M.isAllTimeHigh([10, 20, 30]), true);
  assert.equal(M.isAllTimeHigh([30, 20, 30]), false); // tie, not strict
  assert.equal(M.isAllTimeHigh([40, 20, 30]), false);
  assert.equal(M.isAllTimeHigh([30]), false);
  assert.equal(M.isAllTimeHigh([]), false);
});

test("budgetProgress math and guards", () => {
  assert.deepEqual(M.budgetProgress(186000, 300000), { pct: 62, remainingCents: 114000 });
  assert.deepEqual(M.budgetProgress(330000, 300000), { pct: 100, remainingCents: -30000 });
  assert.equal(M.budgetProgress(1000, 0), null);
  assert.equal(M.budgetProgress(1000, null), null);
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `node --test frontend/js/meta.test.js`
Expected: FAIL — `Cannot find module './meta.js'`.

- [ ] **Step 3: Write `frontend/js/meta.js`:**

```js
/* meta.js — pure derivations of the light "score" layer. UMD dual tail. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  Object.assign(root.BS, api);
})(typeof self !== "undefined" ? self : globalThis, function () {

  function savingsStreak(monthlyNet) {
    let n = 0;
    for (let i = (monthlyNet || []).length - 1; i >= 0; i--) {
      if (monthlyNet[i] > 0) n++; else break;
    }
    return n;
  }

  function isAllTimeHigh(series) {
    if (!series || series.length < 2) return false;
    const last = series[series.length - 1];
    for (let i = 0; i < series.length - 1; i++) if (series[i] >= last) return false;
    return true;
  }

  function budgetProgress(spentCents, targetCents) {
    if (targetCents == null || targetCents <= 0) return null;
    const pct = Math.max(0, Math.min(100, Math.round((spentCents / targetCents) * 100)));
    return { pct, remainingCents: targetCents - spentCents };
  }

  return { savingsStreak, isAllTimeHigh, budgetProgress };
});
```

- [ ] **Step 4: Run to verify it passes.**

Run: `node --test frontend/js/meta.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit.**

```bash
git add frontend/js/meta.js frontend/js/meta.test.js
git commit -m "feat(pixel): pure meta (streak/high-score/budget) module + tests"
```

---

### Task 4: Pixel palette tokens + delete Dark/Light theme

**Files:**
- Modify: `frontend/css/style.css:3-57` (the `:root` token block) and the `:root[data-theme="Light"]` block (delete it)
- Modify: `frontend/js/app.js:21-29` (`TWEAK_DEFAULTS` + `useTweaks`)
- Modify: `frontend/index.html:2` (`<html>` dataset) and script/style tags

**Interfaces:**
- Consumes: fonts from Task 1.
- Produces: the pixel palette on `:root`; no `data-theme` switching remains.

- [ ] **Step 1: Replace the `:root` block in `frontend/css/style.css` (lines 3–57) with the pixel palette.** Keep the same custom-property *names* (so every component inherits) but new values:

```css
:root {
  /* Balatro-CRT pixel palette */
  --bg-0: #0e0f1a;
  --bg-1: #161829;
  --bg-2: #1f2238;
  --bg-3: #2a2d48;
  --line-1: #000000;
  --line-2: #3a3d63;

  --fg-0: #fdf6e3;
  --fg-1: #cdd0ee;
  --fg-2: #9a9dc0;
  --fg-3: #6a6d95;

  /* accent = cyan; keep the shark identity */
  --accent: #5cc6ff;
  --accent-bg: rgba(92, 198, 255, 0.16);
  --accent-fg: #0e0f1a;

  --pos: #7be08a;
  --pos-bg: rgba(123, 224, 138, 0.16);
  --neg: #ff5b6e;
  --neg-bg: rgba(255, 91, 110, 0.16);
  --warn: #ffcf5c;
  --warn-bg: rgba(255, 207, 92, 0.16);
  --info: #5cc6ff;
  --info-bg: rgba(92, 198, 255, 0.14);
  --reserve: #c58cff;
  --reserve-bg: rgba(197, 140, 255, 0.16);

  --nubank: #c58cff;
  --inter:  #ffab5c;

  --ff-sans: "Silkscreen", "Inter", system-ui, sans-serif;
  --ff-mono: "Departure Mono", "JetBrains Mono", ui-monospace, monospace;

  --fz-9: 10px; --fz-8: 11px; --fz-7: 12px; --fz-6: 13px;
  --fz-5: 14px; --fz-4: 16px; --fz-3: 19px; --fz-2: 24px;
  --fz-1: 32px; --fz-0: 44px;

  --s-1: 2px; --s-2: 4px; --s-3: 6px; --s-4: 8px;
  --s-5: 12px; --s-6: 16px; --s-7: 20px; --s-8: 24px; --s-9: 32px;

  /* pixel = hard corners everywhere */
  --r-1: 0; --r-2: 0; --r-3: 0; --r-4: 0; --r-5: 0; --r-6: 0;

  --topbar-h: 52px;
  --sidebar-w: 320px;
}
```

  Note: `--ff-sans` is Silkscreen (pixel) for chrome/labels; body prose that must stay readable can opt into `--ff-mono` (Departure Mono). Numbers already use `.mono` (→ `--ff-mono`).

- [ ] **Step 2: Delete the entire `:root[data-theme="Light"] { … }` block** in `frontend/css/style.css` (starts at the line `:root[data-theme="Light"] {`, line ~59, through its closing `}`). Pixel is the only theme.

- [ ] **Step 3: Simplify `useTweaks` in `frontend/js/app.js` (lines 21–29)** to drop the theme entirely:

```js
/* ── App shell init (no theme switching — pixel is the only look) ─────────── */
function useAppInit() {
  useEffect(() => {
    document.documentElement.dataset.density = "comfortable";
  }, []);
}
```

  Then change the call site `useTweaks(); // just initialize side effects` (line 99) to `useAppInit();` and delete the now-unused `TWEAK_DEFAULTS` const and the `useTweaks` destructure if present. (There is no TweaksPanel rendered, so nothing else references it.)

- [ ] **Step 4: Update `frontend/index.html`.** Change line 2 from `<html lang="pt-BR" data-theme="Dark" data-density="comfortable">` to:

```html
<html lang="pt-BR" data-density="comfortable">
```

  Bump the `?v=` cache-busting query on `style.css`, `fonts.css` and every app `<script>` (e.g. `?v=42`) so the browser reloads them.

- [ ] **Step 5: Verify in the browser.** Reload `http://127.0.0.1:8000`. The dashboard now renders on the dark-navy pixel palette with hard corners and pixel fonts on labels; numbers render in Departure Mono. No console errors. Toggling nothing — there is no theme switch.

- [ ] **Step 6: Commit.**

```bash
git add frontend/css/style.css frontend/js/app.js frontend/index.html
git commit -m "feat(pixel): pixel palette tokens; delete Dark/Light theme machinery"
```

---

### Task 5: `pixel.css` — structural pixel layer

**Files:**
- Create: `frontend/css/pixel.css`
- Modify: `frontend/index.html` (add `<link>` after `style.css`)

**Interfaces:**
- Consumes: palette tokens from Task 4.
- Produces: hard borders, stepped shadows, scanline overlay, dither helpers, keyframes (`bs-boot`, `bs-coin`, `bs-pop`, `bs-shake`), mascot classes — used by Tasks 9–11.

- [ ] **Step 1: Create `frontend/css/pixel.css`:**

```css
/* pixel.css — structural pixel-art layer (borders, CRT, dither, animations).
   Palette comes from style.css tokens. Pixel is the only theme. */

html, body { background: var(--bg-0); }
* { image-rendering: pixelated; }

/* Panels: hard black border + stepped drop shadow (Balatro feel) */
.widget, .kpi, .modal, .drawer, .table-widget {
  border: 3px solid var(--line-1) !important;
  border-radius: 0 !important;
  box-shadow: 4px 4px 0 #05060d !important;
}
.widget:not(.table-widget):hover {
  transform: translate(-1px, -1px);
  box-shadow: 6px 6px 0 #05060d !important;
}

/* Uppercase pixel labels */
.widget-title, .kpi-label, .label {
  font-family: var(--ff-sans);
  letter-spacing: 1px;
}

/* Scanline overlay — whole viewport, non-interactive, subtle */
#app::after {
  content: "";
  position: fixed; inset: 0; z-index: 9999; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0 1px, transparent 1px 3px);
  mix-blend-mode: multiply;
}

/* Dither fills for bars */
.dither-pos { background: repeating-linear-gradient(45deg, var(--pos) 0 3px, #5cbf6e 3px 6px) !important; }
.dither-neg { background: repeating-linear-gradient(45deg, var(--neg) 0 3px, #d8455a 3px 6px) !important; }
.dither-warn { background: repeating-linear-gradient(45deg, var(--warn) 0 4px, #e0a93f 4px 8px) !important; }

/* Filter chips */
.facet-active { outline: 2px solid var(--accent); outline-offset: 1px; }

/* Keyframes */
@keyframes bs-boot { 0% { opacity: 0; transform: scaleY(0.002); filter: brightness(3); } 40% { opacity: 1; transform: scaleY(1); } 100% { filter: none; } }
@keyframes bs-coin { 0% { transform: translateY(0) scale(1); opacity: 1; } 100% { transform: translateY(-24px) scale(0.6); opacity: 0; } }
@keyframes bs-pop { 0% { transform: scale(1); } 50% { transform: scale(1.12); } 100% { transform: scale(1); } }
@keyframes bs-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }

.bs-boot { animation: bs-boot 420ms steps(6) both; }
.bs-pop { animation: bs-pop 180ms steps(3) both; }
.bs-shake { animation: bs-shake 200ms steps(2) 2; }

.bs-coin {
  position: fixed; z-index: 10000; pointer-events: none;
  font-family: var(--ff-mono); font-weight: 700; color: var(--warn);
  animation: bs-coin 600ms steps(6) forwards;
}

/* Silent mascot sprite (logo corner) */
.bs-mascot { image-rendering: pixelated; }

@media (prefers-reduced-motion: reduce) {
  .bs-boot, .bs-pop, .bs-shake, .bs-coin { animation: none !important; }
}
```

- [ ] **Step 2: Link it in `frontend/index.html`** right after the `style.css` link:

```html
  <link rel="stylesheet" href="/static/css/style.css?v=42" />
  <link rel="stylesheet" href="/static/css/pixel.css?v=42" />
```

- [ ] **Step 3: Verify in the browser.** Reload. Widgets now have hard black borders + offset shadows; a faint scanline overlay covers the screen; hover nudges a widget up-left. No horizontal scrollbar appears. No console errors.

- [ ] **Step 4: Commit.**

```bash
git add frontend/css/pixel.css frontend/index.html
git commit -m "feat(pixel): structural pixel layer (borders, CRT scanlines, dither, keyframes)"
```

---

### Task 6: Lift filter state into `DashboardView` + `FilterBar` chip primitive

**Files:**
- Modify: `frontend/js/view-dashboard.js:472-567` (`DashboardView`)
- Modify: `frontend/js/primitives.js` (add `FilterBar` component near other exports)
- Modify: `frontend/js/index.html` load order — `filter.js` must load before `view-dashboard.js`

**Interfaces:**
- Consumes: `window.BS.emptyFilter/toggleFacet/facetCount` (Task 2).
- Produces: `filter` object + `onToggleFacet(kind, value)` + `setFilterField(field, value)` passed to widgets (Task 7) and `TxTableWidget` (Task 8). `window.BS.FilterBar({ filter, onRemove, onClear })`.

- [ ] **Step 1: Ensure `filter.js` loads first.** In `frontend/index.html`, add its script tag before `view-dashboard.js` (and before `view-history.js`):

```html
  <script src="/static/js/filter.js?v=42"></script>
```

  Place it right after `primitives.js`.

- [ ] **Step 2: Add filter state to `DashboardView`.** In `frontend/js/view-dashboard.js`, inside `DashboardView` after the existing `useState` declarations (around line 486), add:

```js
  const [filter, setFilter] = _dSt(() => window.BS.emptyFilter());
  const onToggleFacet = (kind, value) => setFilter(f => window.BS.toggleFacet(f, kind, value));
  const setFilterField = (field, value) => setFilter(f => Object.assign({}, f, { [field]: value }));
  const clearFilter = () => setFilter(window.BS.emptyFilter());
  // Reset facets when the global month changes (stale facet values match nothing).
  _dEf(() => { setFilter(window.BS.emptyFilter()); }, [monthSel]);
```

- [ ] **Step 3: Add the `FilterBar` component to `frontend/js/primitives.js`** (near the other `window.BS` component exports):

```js
function FilterBar({ filter, onRemove, onClear }) {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  const chips = [];
  filter.categories.forEach(v => chips.push(["categories", v, v]));
  filter.banks.forEach(v => chips.push(["banks", v, v]));
  filter.accounts.forEach(v => chips.push(["accounts", v, v]));
  if (filter.flow !== "all") chips.push(["flow", filter.flow, filter.flow === "expense" ? "Despesas" : "Receitas"]);
  if (filter.method !== "all") chips.push(["method", filter.method, filter.method.toUpperCase()]);
  if (!chips.length && !filter.search) return null;
  return h("div", { className: "filter-bar" },
    chips.map(([kind, value, label]) => h("button", {
      key: kind + ":" + value, className: "filter-chip", onClick: () => onRemove(kind, value),
      title: "Remover filtro",
    }, label, h("span", { className: "filter-chip-x" }, "×"))),
    h("button", { className: "filter-chip filter-chip-clear", onClick: onClear }, "limpar tudo")
  );
}
```

  Add `FilterBar` to the file's `Object.assign(window.BS, { … })` export list.

- [ ] **Step 4: Add chip styles to `frontend/css/pixel.css`:**

```css
.filter-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; align-items: center; flex-shrink: 0; }
.filter-chip {
  font-family: var(--ff-sans); font-size: 9px; letter-spacing: 1px;
  color: var(--accent-fg); background: var(--accent);
  border: 2px solid var(--line-1); padding: 3px 7px; cursor: pointer; display: inline-flex; gap: 5px; align-items: center;
}
.filter-chip-x { font-weight: 700; }
.filter-chip-clear { background: var(--neg); color: var(--bg-0); }
```

- [ ] **Step 5: Render `FilterBar` and thread the filter through.** In `DashboardView`'s return (around line 549–565), wrap the main area so the bar sits above the table. Change the `dash-main` block to pass props and add the bar just before `TxTableWidget`:

```js
    h("div", { className: "dash-main fade-in" },
      h("div", { className: "widget-row" },
        h(GeneralWidget, { cashflow, liquidityHistory, monthly, monthSel, monthTx, uncatCount, backup }),
        h(TimelineWidget, { monthly, monthSel, onPickMonth }),
        h(AccountsWidget, { accounts, available, filter, onToggleFacet }),
        h(FaturaWidget, { monthTx, filter, onToggleFacet }),
        h(CategoriesWidget, { monthTx, uncatCount, onOpenBulk: () => setBulkOpen(true), filter, onToggleFacet }),
        h(InvestmentsWidget, { investments, evolution })
      ),
      h(window.BS.FilterBar, { filter, onRemove: (kind, value) => {
          if (kind === "flow" || kind === "method") setFilterField(kind, "all");
          else onToggleFacet(kind, value);
        }, onClear: clearFilter }),
      h(window.BS.TxTableWidget, {
        monthSel, refreshKey, onEditCategory,
        openBulk: bulkOpen, onBulkConsumed: () => setBulkOpen(false),
        monthTx, setMonthTx,
        filter, setFilterField, onToggleFacet,
      })
    )
```

- [ ] **Step 6: Verify in the browser.** Reload. Dashboard renders unchanged (widgets don't toggle yet — next task), no console errors. The `FilterBar` is absent (no active facets). This task is structural plumbing; visual behavior lands in Tasks 7–8.

- [ ] **Step 7: Commit.**

```bash
git add frontend/js/view-dashboard.js frontend/js/primitives.js frontend/css/pixel.css frontend/index.html
git commit -m "feat(pixel): lift faceted filter state into DashboardView + FilterBar chips"
```

---

### Task 7: Make widgets clickable facets

**Files:**
- Modify: `frontend/js/view-dashboard.js` — `CategoriesWidget` (321-364), `AccountsWidget` (284-318), `FaturaWidget` (367-417)

**Interfaces:**
- Consumes: `filter`, `onToggleFacet(kind, value)` (Task 6).
- Produces: clicking a category row toggles `categories`; an account row toggles `accounts` (by `account_id`); a fatura bank row toggles `banks`.

- [ ] **Step 1: `CategoriesWidget` — make each category row a facet toggle.** Change the `byCat.map((c, i) => …)` row wrapper (line 343) from a `div` to a `button` that toggles, and reflect active state. Replace the row's outer element:

```js
          byCat.map((c, i) => {
            const pct = totalExp ? (c.total / totalExp) * 100 : 0;
            const active = filter.categories.has(c.name);
            return h("button", { key: i, onClick: () => onToggleFacet("categories", c.name),
              className: active ? "facet-row facet-active" : "facet-row",
              style: { display: "flex", flexDirection: "column", gap: 3, flexShrink: 0, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "2px 0" } },
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } },
                h("span", { style: { fontSize: 11, fontWeight: 600, color: c.name === "Sem categoria" ? "var(--fg-3)" : "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name),
                h("span", { className: "mono", style: { fontSize: 11, fontWeight: 700, color: "var(--fg-0)", flexShrink: 0 } }, fmtBRL(c.total))
              ),
              h("div", { style: { height: 3, background: "var(--bg-2)", overflow: "hidden" } },
                h("div", { style: { width: pct + "%", height: "100%", background: c.name === "Sem categoria" ? "var(--line-2)" : i === 0 ? "var(--accent)" : "var(--fg-2)" } }))
            );
          }),
```

  Add `filter, onToggleFacet` to the `CategoriesWidget` destructured props (line 321): `function CategoriesWidget({ monthTx, uncatCount, onOpenBulk, filter, onToggleFacet })`.

- [ ] **Step 2: `AccountsWidget` — toggle `accounts` by `account_id`.** Add `filter, onToggleFacet` to its props (line 284). Change the per-account row wrapper (line 304, `checking.map((a, i, arr) => h("div", …`) to a `button`:

```js
        checking.map((a, i, arr) => {
          const active = filter && filter.accounts.has(a.id);
          return h("button", {
            key: a.id, onClick: () => onToggleFacet && onToggleFacet("accounts", a.id),
            className: active ? "facet-row facet-active" : "facet-row",
            style: { display: "flex", flexDirection: "column", gap: 2, padding: "9px 6px", textAlign: "left", cursor: "pointer", background: "none",
              border: "none", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none" }
          },
            h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
              h("span", { style: { width: 8, height: 8, background: colorOf(a), flexShrink: 0 } }),
              h("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.name),
              total > 0 && h("span", { className: "mono", style: { fontSize: 9, color: "var(--fg-3)", marginLeft: "auto" } }, `${(((a.balance || 0) / total) * 100).toFixed(0)}%`)
            ),
            h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, paddingLeft: 16, color: (a.balance || 0) < 0 ? "var(--neg)" : "var(--fg-0)" } }, fmtBRL(a.balance || 0))
          );
        })
```

- [ ] **Step 3: `FaturaWidget` — toggle `banks`.** Add `filter, onToggleFacet` to props (line 367). Replace the per-bank row (line 399, `Object.entries(byBank).map(([bank, amt], i, arr) => …`) with a toggling `button`:

```js
              Object.entries(byBank).map(([bank, amt], i, arr) => {
                const color = bank === "Nubank" ? "var(--nubank)" : bank === "Inter" ? "var(--inter)" : "var(--accent)";
                const active = filter && filter.banks.has(bank);
                return h("button", {
                  key: bank, onClick: () => onToggleFacet && onToggleFacet("banks", bank),
                  className: active ? "facet-row facet-active" : "facet-row",
                  style: { display: "flex", flexDirection: "column", gap: 2, padding: "9px 6px", textAlign: "left", cursor: "pointer", background: "none",
                    border: "none", borderBottom: i < arr.length - 1 ? "1px dashed var(--line-1)" : "none" }
                },
                  h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                    h("span", { style: { width: 8, height: 8, background: color, flexShrink: 0 } }),
                    h("span", { style: { fontSize: 11, fontWeight: 600, color: "var(--fg-1)" } }, `Fatura ${bank}`),
                    totalFatura > 0 && h("span", { className: "mono", style: { fontSize: 9, color: "var(--fg-3)", marginLeft: "auto" } }, `${((amt / totalFatura) * 100).toFixed(0)}%`)
                  ),
                  h("span", { className: "mono", style: { fontSize: 15, fontWeight: 700, paddingLeft: 16, color: "var(--neg)" } }, (amt >= 0 ? "−" : "+") + fmtBRL(Math.abs(amt)))
                );
              })
```

  Note: the `banks` facet keys on the display name `"Nubank"/"Inter"`, matching `bankOf(t)` in Task 8 — so a Fatura-bank facet correctly narrows the table to that bank.

- [ ] **Step 4: Verify in the browser.** Reload. Click a category → its row gets a cyan outline and a chip appears in the FilterBar; the table below (once Task 8 wires it) will narrow — for now confirm the chip appears and toggling twice removes it. Clicking an account and a fatura bank does the same. No console errors.

- [ ] **Step 5: Commit.**

```bash
git add frontend/js/view-dashboard.js
git commit -m "feat(pixel): widgets become clickable facets (category/account/bank)"
```

---

### Task 8: `TxTableWidget` consumes the shared filter + always-visible search + inline recategorize

**Files:**
- Modify: `frontend/js/view-history.js:26-233`

**Interfaces:**
- Consumes: `filter`, `setFilterField`, `onToggleFacet` from Task 6; `window.BS.matchesFilter` from Task 2; existing `patchTransactionCategory`.
- Produces: table rows reflect the shared filter; the toolbar search writes `filter.search`; category cell recategorizes inline.

- [ ] **Step 1: Replace the widget's local filter state with the shared filter.** In `TxTableWidget` (line 26), change the signature to accept the shared filter and drop the local filter `useState`s (lines 30–34, keep `sort` and `catsByFlow`):

```js
function TxTableWidget({ monthSel, refreshKey, onEditCategory, openBulk, onBulkConsumed, monthTx, setMonthTx, filter, setFilterField, onToggleFacet }) {
```

  Delete `filterFlow/filterMethod/filterCat/filterAccount/search` `useState` lines and the reset block inside the month effect (lines 50–53) — the parent now resets on month change (Task 6, Step 2).

- [ ] **Step 2: Build the per-tx `bank` + `label` and apply `matchesFilter`.** Replace the `filteredTx` memo (lines 90–110) with:

```js
  const bankOf = (t) => (t.bank === "nubank" || (t.account_id && t.account_id.startsWith("nu"))) ? "Nubank"
    : (t.bank === "inter" || (t.account_id && t.account_id.startsWith("inter"))) ? "Inter" : (t.bank || t.account_id);

  const filteredTx = _s2Memo(() => monthTx.filter(t => {
    const norm = {
      flow: t.flow, method: t.method, category: t.category, account_id: t.account_id,
      bank: bankOf(t),
      label: [t.display_name, window.BS.prettifyDesc(t.description), t.description].filter(Boolean).join(" "),
    };
    return window.BS.matchesFilter(norm, filter);
  }), [monthTx, filter]);
```

  Note: the widget's category facet uses `t.category`; the "Sem categoria" special-case from the old select is dropped (facets cover it — clicking the "Sem categoria" category row filters to `category === undefined`? No: give that row the literal name "Sem categoria"). To keep parity, when a tx has no category, set its `category` in `norm` to `"Sem categoria"` so the facet matches:

```js
      category: t.category || "Sem categoria",
```

- [ ] **Step 3: Replace the toolbar's local filter controls with shared-filter controls.** In the toolbar (lines 138–187): remove the flow pills / method pills / category `<select>` / bank `<select>` / local "Limpar" (facets now live in the widgets + FilterBar). Keep the title, count, bulk chip, and the **always-visible search input** bound to the shared filter:

```js
      h("input", {
        value: filter.search, onChange: e => setFilterField("search", e.target.value),
        placeholder: "Buscar lançamento…", className: "input",
        style: { height: 24, fontSize: 11, padding: "0 8px", width: 200, background: "var(--bg-0)", border: "2px solid var(--line-1)", color: "var(--fg-1)", fontWeight: 500 },
      }),
```

  Keep the flow pills if you want quick expense/income toggles, but bind them to `setFilterField("flow", k)` and `setFilterField("method", k)` instead of local state. Update `hasFilter` (line 126) to `const hasFilter = window.BS.facetCount(filter) > 0;` and the count label (line 141) stays `sortedTx.length de monthTx.length`.

- [ ] **Step 4: Inline recategorize on the category cell.** The rows render via `window.BS.TxRow` with `cols` including `"cat"`. Add an `onInlineCategory` callback prop to the `TxRow` call that opens a compact pixel `<select>` in place. Simplest reliable approach that reuses the existing path: pass a handler that writes immediately via `patchTransactionCategory`:

```js
            h(window.BS.TxRow, {
              key: t.id, t, cols: ["date", "desc", "cat", "account", "method", "amount"],
              onEditCategory,
              catsByFlow,
              onInlineCategory: async (tx, categoryId) => {
                const list = catsByFlow[tx.flow] || [];
                const catName = list.find(c => c.id === categoryId)?.name || "";
                try {
                  await patchTransactionCategory(tx.id, categoryId);
                  setMonthTx(prev => prev.map(x => x.id === tx.id ? { ...x, category_id: categoryId, category: catName } : x));
                  window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: `Categoria: ${catName}`, kind: "success" } }));
                } catch (e) {
                  window.dispatchEvent(new CustomEvent("bs-toast", { detail: { msg: "Erro ao categorizar", kind: "error" } }));
                }
              },
              onApplySuggestion: async (tx) => { /* keep the current inline arrow body verbatim */ },
            })
```

  Keep the existing `onApplySuggestion: async (tx) => { … }` inline arrow from the current `TxRow` call verbatim — only add the `catsByFlow` and `onInlineCategory` props alongside it.

  In `frontend/js/primitives.js`, locate `TxRow` and, for the `"cat"` column, when `onInlineCategory` and `catsByFlow` are provided, render a `<select>` (options from `catsByFlow[t.flow]`) whose `onChange` calls `onInlineCategory(t, parseInt(value))`; otherwise keep the current click-to-`onEditCategory` behavior. Style the select with `border: 2px solid var(--line-1); background: var(--bg-0); font-family: var(--ff-mono)`.

- [ ] **Step 5: Verify in the browser.** Reload. (a) Type in the toolbar search → table narrows live and a "search" is reflected. (b) Click a category widget row → table shows only that category; chip appears; remove via chip `×` or re-click. (c) Change a row's category via its inline select → persists (reload confirms), toast shows. (d) Empty-match shows "Nenhum lançamento com esses filtros." No console errors.

- [ ] **Step 6: Commit.**

```bash
git add frontend/js/view-history.js frontend/js/primitives.js
git commit -m "feat(pixel): table consumes shared filter; always-on search; inline recategorize"
```

---

### Task 9: `juice.js` — sfx/animation engine + mute (TDD on pure helpers)

**Files:**
- Create: `frontend/js/juice.js`
- Test: `frontend/js/juice.test.js`
- Modify: `frontend/index.html` (load `juice.js` after `filter.js`); `frontend/js/app.js` (mute toggle in topbar; boot + coin wiring)

**Interfaces:**
- Produces `window.BS.juice`: `muted() → bool`, `setMuted(bool)`, `sfx(name)`, `coinDrop(x, y)`, `boot(el)`, `pop(el)`, `shake(el)`. Pure helpers exported for tests: `nextMuted(cur) → !cur`, `shouldAnimate(reducedMotion, muted) → bool`.
- Consumes: `pixel.css` keyframe classes (Task 5).

- [ ] **Step 1: Write the failing test** `frontend/js/juice.test.js` (pure helpers only — DOM/audio are manual):

```js
const { test } = require("node:test");
const assert = require("node:assert");
const J = require("./juice.js");

test("nextMuted flips", () => {
  assert.equal(J.nextMuted(true), false);
  assert.equal(J.nextMuted(false), true);
});

test("shouldAnimate is false when reduced-motion, regardless of mute", () => {
  assert.equal(J.shouldAnimate(true, false), false);
  assert.equal(J.shouldAnimate(false, false), true);
  assert.equal(J.shouldAnimate(false, true), true); // mute is about sound, not motion
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `node --test frontend/js/juice.test.js`
Expected: FAIL — `Cannot find module './juice.js'`.

- [ ] **Step 3: Write `frontend/js/juice.js`:**

```js
/* juice.js — sfx (WebAudio synth, no files) + micro-animations + mute. UMD tail. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BS = root.BS || {};
  root.BS.juice = api;
  Object.assign(root.BS, { nextMuted: api.nextMuted, shouldAnimate: api.shouldAnimate });
})(typeof self !== "undefined" ? self : globalThis, function () {

  const KEY = "bs.muted";
  const nextMuted = (cur) => !cur;
  const shouldAnimate = (reducedMotion, _muted) => !reducedMotion;

  // Browser-only state; guarded so require() in node doesn't touch window.
  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
  let _ctx = null;

  function muted() {
    if (!hasDOM) return true;
    const v = window.localStorage.getItem(KEY);
    return v == null ? true : v === "1"; // default OFF (muted)
  }
  function setMuted(b) { if (hasDOM) window.localStorage.setItem(KEY, b ? "1" : "0"); }

  function reduced() { return hasDOM && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  function ctx() {
    if (!hasDOM) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!_ctx) _ctx = new AC();
    return _ctx;
  }

  const TONES = { coin: [880, 1320], blip: [440], error: [180, 120] };

  function sfx(name) {
    if (muted()) return;
    const c = ctx(); if (!c) return;
    const freqs = TONES[name] || TONES.blip;
    let t = c.currentTime;
    freqs.forEach((f) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.1); t += 0.08;
    });
  }

  function coinDrop(x, y) {
    if (!hasDOM || !shouldAnimate(reduced())) return;
    const el = document.createElement("div");
    el.className = "bs-coin"; el.textContent = "+";
    el.style.left = (x || window.innerWidth / 2) + "px";
    el.style.top = (y || 80) + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }

  function anim(el, cls, ms) {
    if (!el || !shouldAnimate(reduced())) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  function boot(el) { anim(el, "bs-boot", 460); }
  function pop(el) { anim(el, "bs-pop", 200); }
  function shake(el) { anim(el, "bs-shake", 420); }

  return { muted, setMuted, sfx, coinDrop, boot, pop, shake, nextMuted, shouldAnimate };
});
```

- [ ] **Step 4: Run to verify it passes.**

Run: `node --test frontend/js/juice.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Load it + add a mute toggle to the topbar.** In `frontend/index.html`, add `<script src="/static/js/juice.js?v=42"></script>` after `filter.js`. In `frontend/js/app.js` topbar (after the Categorias button, ~line 196), add:

```js
      h("button", { className: "btn btn-ghost", style: { height: 30, padding: "0 10px" },
        title: "Som", onClick: (e) => { const m = window.BS.juice.nextMuted(window.BS.juice.muted()); window.BS.juice.setMuted(m); if (!m) window.BS.juice.sfx("blip"); e.currentTarget.textContent = m ? "🔇" : "🔊"; } },
        window.BS.juice.muted() ? "🔇" : "🔊"),
```

- [ ] **Step 6: Wire boot + coin.** In `frontend/js/app.js`, add a boot effect inside `App` (after SSE effect, ~line 146):

```js
  useEffect(() => { window.BS.juice.boot(document.getElementById("app")); }, []);
```

  In `frontend/js/view-dashboard.js`, when new revenue appears (money-in), fire a coin — minimally, call `window.BS.juice.coinDrop()` + `window.BS.juice.sfx("coin")` in the KPI hero after `available` loads and is positive is noise; instead fire on the import-success path already in `app.js` (`push(msg, …)` after a successful `tx` import): add `window.BS.juice.sfx("coin"); window.BS.juice.coinDrop();` right after the success `push` (line ~231).

- [ ] **Step 7: Verify in the browser.** Reload → the whole app plays the CRT boot animation once. Click the 🔇 toggle → becomes 🔊 and a blip plays; reload → mute state persisted (starts 🔇 by default on first ever load). Import a statement → coin animation + sound (if unmuted). With OS reduced-motion on, no boot/coin animation. No console errors.

- [ ] **Step 8: Commit.**

```bash
git add frontend/js/juice.js frontend/js/juice.test.js frontend/index.html frontend/js/app.js frontend/js/view-dashboard.js
git commit -m "feat(pixel): juice engine (WebAudio sfx, coin, boot, mute) + tests"
```

---

### Task 10: `pixel-bars.js` — dithered cashflow bars + month-compare toggle

**Files:**
- Create: `frontend/js/pixel-bars.js`
- Modify: `frontend/js/view-dashboard.js` — `TimelineWidget` (203-281); `frontend/index.html` (load script)

**Interfaces:**
- Consumes: `dither-pos`/`dither-neg` classes (Task 5).
- Produces: `window.BS.PixelBars({ slots, maxV, picked, onPick })` rendering hard-edged dithered bars; a compare toggle overlaying previous-month ghost bars.

- [ ] **Step 1: Create `frontend/js/pixel-bars.js`** (a thin presentational component; the existing `TimelineWidget` keeps ownership of month data + click):

```js
/* pixel-bars.js — dithered pixel bars for the cashflow timeline. */
(function () {
  const h = (t, p, ...c) => React.createElement(t, p, ...c);
  function PixelBars({ slot, maxV, isPicked, compare }) {
    const d = slot.data;
    const scale = (v) => Math.max((v / maxV) * 52, v > 0 ? 2 : 0);
    const bars = [
      h("div", { key: "i", className: "tl-bar dither-pos", style: { height: d ? scale(d.income) : 0, opacity: isPicked ? 1 : 0.8 } }),
      h("div", { key: "e", className: "tl-bar dither-neg", style: { height: d ? scale(d.expenses) : 0, opacity: isPicked ? 1 : 0.8 } }),
    ];
    if (compare && slot.prev) {
      bars.push(h("div", { key: "gi", className: "tl-bar", style: { height: scale(slot.prev.income), width: 3, background: "var(--fg-3)", opacity: 0.5 } }));
    }
    return h("div", { className: "tl-bars" }, bars);
  }
  window.BS = window.BS || {};
  window.BS.PixelBars = PixelBars;
})();
```

- [ ] **Step 2: Add compare state + toggle to `TimelineWidget`.** After its `_dSt(null)` line (207), add `const [compare, setCompare] = _dSt(false);`. In the widget header (line 216-223), add a small toggle button:

```js
      h("button", { onClick: () => setCompare(c => !c), className: compare ? "filter-chip" : "filter-chip",
        style: { marginLeft: "auto", opacity: compare ? 1 : 0.6 }, title: "Comparar com o mês anterior" }, "vs ant."),
```

- [ ] **Step 3: Feed `prev` into each slot and render `PixelBars`.** Where `slots` is built (line 210-211), attach the previous month's data:

```js
  const slots = [];
  for (let m = 1; m <= 12; m++) {
    const data = monthly.find(x => x.year === activeYear && x.month === m);
    const idx = monthly.indexOf(data);
    const prev = idx > 0 ? monthly[idx - 1] : null;
    slots.push({ month: m, data, prev });
  }
```

  Replace the inline `h("div", { className: "tl-bars" }, …)` (lines 252-255) inside each slot button with `h(window.BS.PixelBars, { slot, maxV, isPicked, compare })`.

- [ ] **Step 4: Load the script.** In `frontend/index.html` add `<script src="/static/js/pixel-bars.js?v=42"></script>` before `view-dashboard.js`.

- [ ] **Step 5: Verify in the browser.** Reload. Cashflow bars now render with the 45° dither fill and hard edges; clicking a month still selects it globally (widgets update). Toggling "vs ant." overlays thin grey ghost bars of the previous month. No console errors.

- [ ] **Step 6: Commit.**

```bash
git add frontend/js/pixel-bars.js frontend/js/view-dashboard.js frontend/index.html
git commit -m "feat(pixel): dithered cashflow bars + month-compare toggle"
```

---

### Task 11: Render the meta layer (streak, high-score, budget bar)

**Files:**
- Modify: `frontend/js/view-dashboard.js` — `KpiStrip` (51-115) or topbar area; `frontend/index.html` (load `meta.js`); `frontend/js/app.js` (topbar chips)

**Interfaces:**
- Consumes: `window.BS.savingsStreak/isAllTimeHigh/budgetProgress` (Task 3); `monthly` (net per month), `liquidityHistory` (patrimônio series), `cashflow.expense_total`.
- Produces: streak chip + all-time-high chip in the topbar; a budget progress bar near the KPI strip.

- [ ] **Step 1: Load `meta.js`.** In `frontend/index.html`, add `<script src="/static/js/meta.js?v=42"></script>` after `filter.js`.

- [ ] **Step 2: Compute + render chips.** In `frontend/js/view-dashboard.js` `KpiStrip`, derive the meta and render two small chips at the end of the hero KPI (after the `kpi-sub` in block 1, ~line 88). Pass `monthly` and `liquidityHistory` into `KpiStrip` (already receives `liquidityHistory`; add `monthly` to its props at line 51 and the call site line 550):

```js
  const monthlyNet = (monthly || []).map(m => m.income - m.expenses);
  const streak = window.BS.savingsStreak(monthlyNet);
  const ath = window.BS.isAllTimeHigh((liquidityHistory || []).map(s => s.value));
```

  Render (inside block 1, after the `kpi-sub`):

```js
      h("div", { style: { display: "flex", gap: 6, marginTop: 8 } },
        streak > 0 && h("span", { className: "filter-chip", style: { background: "var(--bg-2)", color: "var(--warn)" } }, `🔥 ${streak}`),
        ath && h("span", { className: "filter-chip", style: { background: "var(--bg-2)", color: "var(--accent)" } }, "🏆 recorde")
      ),
```

- [ ] **Step 3: Budget progress bar.** Budget target lives in `localStorage` key `bs.budgetCents` (null ⇒ hidden). Add to `GeneralWidget` (or below the KPI strip) a bar driven by `budgetProgress`:

```js
  const target = (() => { const v = window.localStorage.getItem("bs.budgetCents"); return v ? parseInt(v) : null; })();
  const bp = window.BS.budgetProgress(exp, target); // exp = cashflow.expense_total (already in scope in GeneralWidget)
```

  Render when `bp`:

```js
      bp && h("div", { style: { marginTop: 8 } },
        h("div", { className: "label", style: { fontSize: 9, color: "var(--fg-3)", marginBottom: 4 } }, "Orçamento do mês"),
        h("div", { style: { height: 10, border: "2px solid var(--line-1)", background: "var(--bg-0)" } },
          h("div", { className: bp.pct >= 100 ? "dither-neg" : "dither-warn", style: { height: "100%", width: bp.pct + "%" } })),
        h("div", { className: "mono", style: { fontSize: 9, color: "var(--fg-3)", marginTop: 3 } },
          `${fmtBRL(exp)} / ${fmtBRL(target)} · ${100 - bp.pct >= 0 ? (100 - bp.pct) : 0}% restante`)
      ),
```

- [ ] **Step 4: Seed a budget target for verification.** In DevTools console: `localStorage.setItem("bs.budgetCents", "300000")` then reload.

- [ ] **Step 5: Verify in the browser.** With a positive trailing month, the 🔥 streak chip shows; when the latest patrimônio is a strict all-time high, 🏆 recorde shows; with a budget seeded, the orçamento bar renders (warn dither < 100%, neg dither ≥ 100%). Remove the localStorage key → bar hides, no error. No console errors.

- [ ] **Step 6: Commit.**

```bash
git add frontend/js/view-dashboard.js frontend/index.html
git commit -m "feat(pixel): meta layer — streak/high-score chips + budget progress bar"
```

---

### Task 12: Full verification pass + docs

**Files:**
- Modify: `CLAUDE.md` (Frontend section — reflect pixel theme, faceted filter, new files)

**Interfaces:** none (integration + docs).

- [ ] **Step 1: Run all frontend unit tests.**

Run: `node --test frontend/js/filter.test.js frontend/js/meta.test.js frontend/js/juice.test.js`
Expected: PASS — all suites green.

- [ ] **Step 2: Run the backend test suite to prove nothing there changed.**

Run: `cd backend-ts && npm test`
Expected: PASS — unchanged from baseline.

- [ ] **Step 3: Manual end-to-end QA on the running server** (`cd backend-ts && npm start`, open `http://127.0.0.1:8000`). Confirm each acceptance criterion:
  - CRT boot animation plays once; pixel look throughout; numbers legible in Departure Mono.
  - Click category / account / fatura-bank → table filters in place; chips appear in FilterBar; `×` and re-click remove; "limpar tudo" clears.
  - Always-visible search narrows the table live.
  - Click a month bar → global month changes; "vs ant." overlays previous month.
  - Inline recategorize persists across reload.
  - Mute toggle persists across reload (default 🔇 on first load); reduced-motion disables animations.
  - Empty-match state shows the pixel empty message.
  - No horizontal page scroll; no external network requests (DevTools Network, offline check).

- [ ] **Step 4: Update `CLAUDE.md`.** In the Frontend row of the Tech Stack table and the `frontend/` file map, note: pixel is the only theme (Dark/Light removed); new files `css/pixel.css`, `js/filter.js`, `js/meta.js`, `js/juice.js`, `js/pixel-bars.js`; widgets are faceted filters over the shared table; fonts Silkscreen + Departure Mono vendored.

- [ ] **Step 5: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs(claude): reflect pixel remodel + faceted-filter frontend"
```

---

## Notes for the implementer

- **Load order in `index.html` matters** (classic scripts, shared `window.BS`): `filter.js`, `meta.js`, `juice.js`, `pixel-bars.js` must all load **before** `view-dashboard.js`/`view-history.js`/`app.js` that consume them. Put them right after `primitives.js`.
- **`prettifyDesc`, `fmtBRL`, `isConsumptionExpense`, `isRevenue`** are existing `window.BS` helpers — reuse, don't reimplement.
- **The backend never changes.** If a task tempts you to touch `backend-ts/`, stop — it's out of scope.
- **`docs/` is gitignored in this repo** (local personal artefacts). This plan and its spec live there untracked by design; the code commits above are what land in git.
