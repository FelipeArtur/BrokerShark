# BrokerShark — TODOS

Deferred work with enough context to pick up cold. Created from the
2026-06-05 CEO review (`~/.gstack/projects/FelipeArtur-BrokerShark/ceo-plans/2026-06-05-import-ux-foundation.md`).

> Removed 2026-06-12: **T-B** (systemd activation — done; superseded by the
> always-on service, see `deploy/README.md`) and **T-C** (Hermes/local AI —
> obsolete; Telegram bot and local AI removed in `5c9733c`, proposal archived
> in the git history of `CLAUDE.md`).

---

## T-A — Auto-suggest categories in Histórico (P2)

**What:** When categorizing in the Histórico table, suggest a likely category per
uncategorized row instead of a blank `<select>`.

**Why:** The CEO-review outside voice argued the real categorization win is *in
Histórico* (where categorization already lives and you see the whole month), not
moved into the import flow. Categorization stays "100% manual no Histórico" by
design; this just makes that manual pass faster.

**Context:** Categorization today is a manual `<select>` per row + "Sem categoria"
filter (`view-history.js`, `PATCH /api/transactions/<id>`). Suggestions could come
from prior `(description → category_id)` pairs the user already set, or from
`display_name`. No auto-apply — suggest, user confirms. Keeps the clean
"Sem categoria = everything imported" mental model intact.

**Effort:** M (human) → S (CC).  **Priority:** P2.  **Depends on:** nothing.

---

## Parked (in CEO plan, not yet TODOS)
- CP1 — inline category in import preview (revisit after living with editable preview).
- CP4 — CSV source auto-detect (only if the per-file account picker proves annoying;
  carries a dedup-key risk note).
